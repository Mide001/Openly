import { Injectable, Logger, BadRequestException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "@/common/prisma/prisma.service";
import { HttpService } from "@nestjs/axios";
import { createPublicClient, createWalletClient, http, parseAbi, formatUnits, Address } from "viem";
import { baseSepolia } from "viem/chains";
import { TelegramService } from "@/notifications/telegram.service";
import { ActivityLoggerService } from "@/notifications/activity-logger.service";
import { privateKeyToAccount } from "viem/accounts";



export const GATEWAY_ABI = parseAbi([
    'function computeForwarderAddress(string merchantId, string paymentRef) view returns (address)',
    'function deployForwarder(string merchantId, string paymentRef) external returns (address)',
    'function usdcToken() view returns (address)',
    'function batchWithdraw(string[] merchantIds, address[] recipients, uint256[] amounts)',
    'function withdrawForMerchant(string merchantId, address recipient, uint256 amount)',
    'event PaymentReceived(string indexed merchantId, string indexed paymentRef, uint256 amount, address payer, uint256 timestamp)'
]);
const FORWARDER_ABI = parseAbi([
    'function forward(string merchantId, string paymentRef, uint256 amount) external'
]);

@Injectable()
export class OpenlyGatewayService {
    private readonly logger = new Logger(OpenlyGatewayService.name);
    public publicClient;
    public walletClient;
    public account;
    public openlyGatewayAddress: Address;

    constructor(private config: ConfigService, private prisma: PrismaService, private httpService: HttpService, private telegram: TelegramService, private activityLog: ActivityLoggerService) {
        const rpcUrl = this.config.get<string>("RPC_URL");
        const privateKey = this.config.get<string>("PRIVATE_KEY");
        this.openlyGatewayAddress = this.config.get<string>("OPENLY_GATEWAY_ADDRESS") as Address;

        this.publicClient = createPublicClient({
            chain: baseSepolia,
            transport: http(rpcUrl)
        });

        if (privateKey) {
            this.account = privateKeyToAccount(privateKey as `0x${string}`);
            this.walletClient = createWalletClient({
                account: this.account,
                chain: baseSepolia,
                transport: http(rpcUrl)
            });
        }
    }


    async initializePayment(apiKey: string, paymentRef: string, amount: number) {
        const merchant = await this.prisma.merchant.findUnique({
            where: { apiKey }
        });

        if (!merchant) throw new BadRequestException("Invalid API Key");
        const existing = await this.prisma.payment.findUnique({
            where: { merchantId_paymentRef: { merchantId: merchant.id, paymentRef } }
        });
        if (existing) {
            return { ...existing, paymentAddress: existing.paymentAddress };
        }

        const paymentAddress = await this.publicClient.readContract({
            address: this.openlyGatewayAddress,
            abi: GATEWAY_ABI,
            functionName: "computeForwarderAddress",
            args: [merchant.id, paymentRef]
        });

        await this.telegram.sendMessage(`<b>New Payment Initiated</b>\n\n` + `Merchant: ${merchant.businessName}\n` + `Ref: ${paymentRef}\n` + `Expected: ${amount} USDC`);
        await this.activityLog.log("PAYMENT", `Payment initiated for ${paymentRef}`, "INFO", { amount, paymentRef }, merchant.id);


        return await this.prisma.payment.create({
            data: {
                merchantId: merchant.id,
                paymentRef,
                amountExpected: amount,
                paymentAddress: paymentAddress,
                status: "PENDING"
            }
        });
    }

    async handlePaymentSuccess(merchantId: string, paymentRef: string, amount: bigint, txHash: string) {
        const formattedAmount = formatUnits(amount, 6);

        const payment = await this.prisma.payment.findUnique({
            where: {
                merchantId_paymentRef: { merchantId, paymentRef }
            }
        });

        if (!payment || payment.status === "COMPLETED")
            return;

        await this.prisma.$transaction(async (tx) => {
            await tx.payment.update({
                where: { id: payment.id },
                data: {
                    status: "COMPLETED",
                    amountPaid: formattedAmount,
                    txHash,
                    confirmedAt: new Date(),
                }
            });

            await tx.merchant.update({
                where: { id: merchantId },
                data: {
                    usdcBalance: {
                        increment: formattedAmount
                    }
                }
            });
        });

        this.sendWebhook(merchantId, {
            event: "payment.success",
            data: { paymentRef: paymentRef, amount: formattedAmount, txHash }
        });
    }


    private async sendWebhook(merchantId: string, payload: any) {
        const merchant = await this.prisma.merchant.findUnique({
            where: {
                id: merchantId
            }
        });
        if (merchant?.webhookUrl) {
            try {
                await this.httpService.axiosRef.post(merchant.webhookUrl, payload);
            } catch (error) {
                this.logger.error(`Webhook failed for: ${merchantId}`);
            }
        }
    }

    async handlePaymentDetected(merchantId: string, paymentRef: string, amount: bigint, txHash: string) {
        const formattedAmount = Number(formatUnits(amount, 6));
        const merchant = await this.prisma.merchant.findUnique({
            where: {
                id: merchantId
            }
        });

        const payment = await this.prisma.payment.findUnique({
            where: {
                merchantId_paymentRef: {
                    merchantId,
                    paymentRef
                }
            }
        });

        if (!payment || payment.status !== "PENDING") return;

        await this.prisma.payment.update({
            where: { id: payment.id },
            data: {
                status: "CONFIRMING",
                amountPaid: formattedAmount,
                txHash
            }
        });

        this.sendWebhook(merchantId, {
            event: "payment.detected",
            data: { paymentRef, amount: formattedAmount, txHash }
        });

        await this.activityLog.log("PAYMENT", `Payment detected for ${paymentRef}`, "INFO", { amount: formattedAmount, txHash }, merchantId);

        this.flushPayment(merchantId, paymentRef, amount);

        await this.telegram.sendMessage(`<b>Payment Detected!</b>\n\n` + `Merchant: ${merchant?.businessName}\n` + `Ref: ${paymentRef}` + `Amount: ${formattedAmount} USDC\n` + `Tx: <a href="https://sepolia.basescan.org/tx/${txHash}>Check Blockscan</a>`)
    }


    async flushPayment(merchantId: string, paymentRef: string, amount: bigint) {
        if (!this.walletClient) {
            this.logger.error("No wallet client available for flushing payment");
            return;
        }

        try {
            const forwarderAddress = await this.publicClient.readContract({
                address: this.openlyGatewayAddress,
                abi: GATEWAY_ABI,
                functionName: "computeForwarderAddress",
                args: [merchantId, paymentRef]
            });


            const code = await this.publicClient.getByteCode({
                address: forwarderAddress
            });

            if (!code || code === "0x") {
                this.logger.log(`Deploying forwarder for ${paymentRef}`);

                try {
                    const deployHash = await this.walletClient.writeContract({
                        address: this.openlyGatewayAddress,
                        abi: GATEWAY_ABI,
                        functionName: "deployForwarder",
                        args: [merchantId, paymentRef]
                    });

                    await this.publicClient.waitForTransactionReceipt({
                        hash: deployHash
                    });
                } catch (deployError: any) {
                    const checkCode = await this.publicClient.getByteCode({
                        address: forwarderAddress
                    });
                    if (checkCode && checkCode !== "0x") {
                        this.logger.log(`Forwarder deployment race condition handled for ${paymentRef}`);
                    } else {
                        throw deployError;
                    }
                }
            }

            this.logger.log(`Forwarding funds for ${paymentRef}`);

            const forwardHash = await this.walletClient.writeContract({
                address: forwarderAddress,
                abi: FORWARDER_ABI,
                functionName: "forward",
                args: [merchantId, paymentRef, amount]
            });

            await this.publicClient.waitForTransactionReceipt({
                hash: forwardHash
            });
            this.logger.log(`Funds forwarded for ${paymentRef}: ${forwardHash}`);

            await this.handlePaymentSuccess(merchantId, paymentRef, amount, forwardHash);
        } catch (error: any) {
            this.logger.error(`Error flushing payment ${paymentRef}: ${error}`);
            await this.telegram.sendMessage(
                `⚠️ <b>System Error!</b>\n\n` + `Action: Flush Payment\n` + `Ref: ${paymentRef}\n` + `Error: ${error.shortMessage || error.message}`
            );
            await this.activityLog.log("ERROR", `Flush failed for ${paymentRef}`, "ERROR", { error: error.message }, merchantId);
        }
    }
}