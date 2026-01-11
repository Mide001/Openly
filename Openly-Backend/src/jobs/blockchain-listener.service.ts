import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { OpenlyGatewayService, GATEWAY_ABI } from "@/blockchain/OpenlyGatewayService";
import { parseAbiItem, parseUnits } from "viem";
import { PrismaService } from "@/common/prisma/prisma.service";
import { TelegramService } from "@/notifications/telegram.service";

@Injectable()
export class BlockchainListenerService implements OnModuleInit {
    private readonly logger = new Logger(BlockchainListenerService.name);

    // State for each network
    private usdcTest: `0x${string}`;
    private usdcMain: `0x${string}`;

    private lastBlockTest = 0n;
    private lastBlockMain = 0n;

    constructor(private gateway: OpenlyGatewayService, private prisma: PrismaService, private telegram: TelegramService) { }

    async onModuleInit() {
        // Fetch USDC token addresses from the contracts
        try {
            this.usdcTest = await this.gateway.publicClientTest.readContract({
                address: this.gateway.addressTest,
                abi: GATEWAY_ABI,
                functionName: 'usdcToken'
            });
            this.logger.log(`[TESTNET] Listening for USDC: ${this.usdcTest}`);
        } catch (e) { this.logger.warn("[TESTNET] Failed to fetch USDC address"); }

        try {
            this.usdcMain = await this.gateway.publicClientMain.readContract({
                address: this.gateway.addressMain,
                abi: GATEWAY_ABI,
                functionName: 'usdcToken'
            });
            this.logger.log(`[MAINNET] Listening for USDC: ${this.usdcMain}`);
        } catch (e) { this.logger.warn("[MAINNET] Failed to fetch USDC address"); }
    }

    @Cron('*/30 * * * * *')
    async retryStuckPayments() {
        try {
            const stuckPayments = await this.prisma.payment.findMany({
                where: {
                    status: "CONFIRMING",
                    updatedAt: { lte: new Date(Date.now() - 3 * 60 * 1000) }
                }
            });

            for (const payment of stuckPayments) {
                if (!payment.amountPaid) continue;
                this.logger.log(`Retrying flush for stuck payment: ${payment.paymentRef}`);
                const amountBigInt = parseUnits(payment.amountPaid.toString(), 6);

                await this.gateway.flushPayment(payment.merchantId, payment.paymentRef, amountBigInt);
            }
        } catch (error) {
            this.logger.error(`Error retrying stuck payments: ${error}`);
        }
    }

    @Cron('*/5 * * * * *')
    async syncAllEvents() {
        await Promise.all([
            this.syncNetwork('TESTNET'),
            this.syncNetwork('MAINNET')
        ]);
    }

    async syncNetwork(network: 'TESTNET' | 'MAINNET') {
        const isTest = network === 'TESTNET';
        const client = isTest ? this.gateway.publicClientTest : this.gateway.publicClientMain;
        const usdc = isTest ? this.usdcTest : this.usdcMain;
        let lastBlock = isTest ? this.lastBlockTest : this.lastBlockMain;

        if (!usdc || !client) return;

        try {
            // 1. Get Pending Payments for this network
            const pendingPayments = await this.prisma.payment.findMany({
                where: { status: "PENDING", network: network },
                select: { paymentAddress: true, merchantId: true, paymentRef: true }
            });

            if (pendingPayments.length === 0) return;

            const targets = pendingPayments.map(p => p.paymentAddress as `0x${string}`);
            const validTargets = targets.filter(t => t && t.startsWith('0x'));
            if (validTargets.length === 0) return;

            // 2. Poll for Transfer(any, target, val)
            const transferEvent = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');

            const currentBlock = await client.getBlockNumber();
            if (lastBlock === 0n) {
                lastBlock = currentBlock - 50n; // Look back small amount on startup/first-run
                if (isTest) this.lastBlockTest = lastBlock; else this.lastBlockMain = lastBlock;
            }

            if (currentBlock <= lastBlock) return;

            const logs = await client.getLogs({
                address: usdc,
                event: transferEvent,
                args: { to: validTargets },
                fromBlock: lastBlock + 1n,
                toBlock: currentBlock
            });

            for (const log of logs) {
                const { to, value } = log.args;
                const payment = pendingPayments.find(p => p.paymentAddress?.toLowerCase() === to?.toLowerCase());
                if (payment && value) {
                    this.logger.log(`[${network}] Detected incoming payment to ${to}`);
                    await this.gateway.handlePaymentDetected(
                        payment.merchantId,
                        payment.paymentRef,
                        value,
                        log.transactionHash,
                        log.blockNumber
                    );
                }
            }

            // Update state
            if (isTest) this.lastBlockTest = currentBlock; else this.lastBlockMain = currentBlock;

        } catch (error) {
            this.logger.error(`[${network}] Error syncing events: ${error}`);
        }
    }
}
