import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "@/common/prisma/prisma.service";
import { OpenlyGatewayService, GATEWAY_ABI } from "./OpenlyGatewayService";
import { parseUnits } from "viem";
import { TelegramService } from "@/notifications/telegram.service";
import { ActivityLoggerService } from "@/notifications/activity-logger.service";



@Injectable()
export class OpenlySettlementService {
    private readonly logger = new Logger(OpenlySettlementService.name);

    constructor(private prisma: PrismaService, private openlyGateway: OpenlyGatewayService, private telegram: TelegramService, private activityLog: ActivityLoggerService) { }

    @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
    async processDailySettlement() {
        const merchants = await this.prisma.merchant.findMany({
            where: {
                usdcBalance: {
                    gte: 10
                }
            }
        });

        if (merchants.length === 0) return;

        const merchantIds = merchants.map(m => m.id);
        const recipients = merchants.map(m => m.walletAddress as `0x${string}`);
        const amounts = merchants.map(m => parseUnits(m.usdcBalance.toFixed(6), 6));

        try {
            this.logger.log(`Settling ${merchants.length} merchants...`);
            const hash = await this.openlyGateway.walletClient.writeContract({
                address: this.openlyGateway.openlyGatewayAddress,
                abi: GATEWAY_ABI,
                functionName: "batchWithdraw",
                args: [merchantIds, recipients, amounts]
            });

            this.logger.log(`Batch Settlement: ${hash}`);

            // 1. Create Payouts IMMEDIATELY (Status: PENDING)
            // 2. Deduct Balance IMMEDIATELY
            await this.prisma.$transaction([
                this.prisma.merchant.updateMany({
                    where: { id: { in: merchantIds } },
                    data: { usdcBalance: 0 }
                }),
                this.prisma.payout.createMany({
                    data: merchants.map(m => ({
                        merchantId: m.id,
                        amount: m.usdcBalance,
                        txHash: hash,
                        walletAddress: m.walletAddress,
                        status: "PENDING"
                    }))
                })
            ]);

            // 3. Wait for confirmation
            await this.openlyGateway.publicClient.waitForTransactionReceipt({ hash });

            // 4. Update status to COMPLETED
            await this.prisma.payout.updateMany({
                where: { txHash: hash },
                data: { status: "COMPLETED" }
            });

            await this.activityLog.log("PAYOUT", `Settled ${merchantIds.length} merchants`, "SUCCESS", { txHash: hash, count: merchants.length });
        } catch (error: any) {
            this.logger.error(`Settlement failed: ${error}`);
            await this.activityLog.log("ERROR", "Daily settlement failed", "ERROR", { error: error.message });
        }
    }

    async manualSettlement(apiKey: string, amount: number) {
        const merchantInfo = await this.prisma.merchant.findUnique({
            where: { apiKey }
        });

        if (!merchantInfo) throw new BadRequestException("Invalid API KEY");

        try {
            await this.prisma.merchant.update({
                where: {
                    id: merchantInfo.id,
                    usdcBalance: {
                        gte: amount
                    }
                },
                data: {
                    usdcBalance: {
                        decrement: amount
                    }
                }
            });
        } catch (error: any) {
            await this.telegram.sendMessage(`${merchantInfo.businessName} tried to withdraw ${amount} USDC but has insufficient balance.`);
            throw new Error("Insufficient balance");
        }

        const amountBigInt = parseUnits(amount.toString(), 6);
        const recipient = merchantInfo.walletAddress as `0x${string}`;

        try {
            this.logger.log(`Manual withdrawal for ${merchantInfo.businessName}: ${amount} USDC`);
            await this.telegram.sendMessage(`${merchantInfo.businessName} has requested a manual withdrawal of ${amount} USDC`);
            const hash = await this.openlyGateway.walletClient.writeContract({
                address: this.openlyGateway.openlyGatewayAddress,
                abi: GATEWAY_ABI,
                functionName: "withdrawForMerchant",
                args: [merchantInfo.id, recipient, amountBigInt]
            });

            // Create Payout IMMEDIATELY (PENDING)
            await this.prisma.payout.create({
                data: {
                    merchantId: merchantInfo.id,
                    amount: amount,
                    txHash: hash,
                    walletAddress: merchantInfo.walletAddress,
                    status: "PENDING"
                }
            });

            await this.openlyGateway.publicClient.waitForTransactionReceipt({ hash });

            // Update to COMPLETED
            await this.prisma.payout.updateMany({
                where: { txHash: hash },
                data: { status: "COMPLETED" }
            });


            await this.telegram.sendMessage(`${merchantInfo.businessName} manual withdrawal of ${amount} USDC completed\nHash: ${hash}`);

            await this.activityLog.log("PAYOUT", `Manual withdrawal of ${amount} USDC`, "SUCCESS", { txHash: hash, amount }, merchantInfo.id);

            return { txHash: hash, status: "COMPLETED" };
        } catch (error: any) {
            this.logger.error(`Manual withdrawal failed: ${error}. REFUNDING.`);

            await this.prisma.merchant.update({
                where: {
                    id: merchantInfo.id
                },
                data: {
                    usdcBalance: { increment: amount }
                }
            });

            await this.telegram.sendMessage(`${merchantInfo.businessName} manual withdrawal failed - Refunded. Error: ${error}`);
            // Also log the error to activity log
            await this.activityLog.log("ERROR", `Manual withdrawal failed - Refunded`, "ERROR", { error: error.message }, merchantInfo.id);
            throw error;
        }
    }

    async getPayouts(apiKey: string) {
        return await this.prisma.payout.findMany({
            where: { merchant: { apiKey } },
            orderBy: { createdAt: "desc" },
            take: 20
        });
    }
}