import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { OpenlyGatewayService } from "@/blockchain/OpenlyGatewayService";
import { parseAbiItem, parseUnits } from "viem";
import { PrismaService } from "@/common/prisma/prisma.service";
import { TelegramService } from "@/notifications/telegram.service";

@Injectable()
export class BlockchainListenerService implements OnModuleInit {
    private readonly logger = new Logger(BlockchainListenerService.name);
    private usdcAddress!: `0x${string}`;
    private lastScannedBlock = 0n;

    constructor(private gateway: OpenlyGatewayService, private prisma: PrismaService, private telegram: TelegramService) { }

    async onModuleInit() {
        this.usdcAddress = await this.gateway.getUsdcTokenAddress();
        this.logger.log(`Listening for USDC transfers on: ${this.usdcAddress}`);
    }

    @Cron('*/30 * * * * *')
    async retryStuckPayments() {
        try {
            const stuckPayments = await this.prisma.payment.findMany({
                where: {
                    status: "CONFIRMING",
                    updatedAt: {
                        lte: new Date(Date.now() - 3 * 60 * 1000) // Only retry if stuck for > 3 minutes
                    }
                }
            });

            for (const payment of stuckPayments) {
                if (!payment.amountPaid) continue;

                this.logger.log(`Retrying flush for stuck payment: ${payment.paymentRef}`);
                // Convert stored float back to bigint (assuming 6 decimals for USDC)
                const amountBigInt = parseUnits(payment.amountPaid.toString(), 6);

                await this.gateway.flushPayment(
                    payment.merchantId,
                    payment.paymentRef,
                    amountBigInt
                );
            }
        } catch (error) {
            this.logger.error(`Error retrying stuck payments: ${error}`);
        }
    }

    @Cron('*/5 * * * * *')
    async syncEvents() {
        try {
            if (!this.usdcAddress) {
                this.logger.warn("Waiting for USDC Address...");
                return;
            }

            // 1. Get Pending Payments to watch
            const pendingPayments = await this.prisma.payment.findMany({
                where: { status: "PENDING" },
                select: { paymentAddress: true, merchantId: true, paymentRef: true }
            });



            if (pendingPayments.length === 0) return;

            const targets = pendingPayments.map(p => p.paymentAddress as `0x${string}`);

            // Clean/validate targets to ensure they are valid addresses
            const validTargets = targets.filter(t => t && t.startsWith('0x'));

            if (validTargets.length === 0) return;

            // 2. Poll for Transfer(any, target, val)
            // Transfer event signature: 0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef
            const transferEvent = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');

            const currentBlock = await this.gateway.publicClient.getBlockNumber();
            if (this.lastScannedBlock === 0n) {
                // Look back ~1000 blocks (~35-40 mins on Base) on startup to catch recent pending payments
                this.lastScannedBlock = currentBlock - 1200n;
            }

            if (currentBlock <= this.lastScannedBlock) return;

            const logs = await this.gateway.publicClient.getLogs({
                address: this.usdcAddress,
                event: transferEvent,
                args: {
                    to: validTargets
                },
                fromBlock: this.lastScannedBlock + 1n,
                toBlock: currentBlock
            });

            for (const log of logs) {
                const { to, value } = log.args;
                // Match log to payment
                const payment = pendingPayments.find(p => p.paymentAddress?.toLowerCase() === to?.toLowerCase());
                if (payment && value) {
                    this.logger.log(`Detected incoming payment to ${to}`);
                    await this.gateway.handlePaymentDetected(
                        payment.merchantId,
                        payment.paymentRef,
                        value,
                        log.transactionHash,
                        log.blockNumber
                    );
                }
            }
            this.lastScannedBlock = currentBlock;
        } catch (error) {
            this.logger.error(`Error syncing events: ${error}`);
        }
    }
}
