import { Injectable, Logger, BadRequestException, ConflictException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "@/common/prisma/prisma.service";
import { HttpService } from "@nestjs/axios";
import { createPublicClient, createWalletClient, http, parseAbi, formatUnits, parseUnits, Address } from "viem";
import { baseSepolia, base } from "viem/chains";
import { TelegramService } from "@/notifications/telegram.service";
import { ActivityLoggerService } from "@/notifications/activity-logger.service";
import { privateKeyToAccount } from "viem/accounts";
import { createHash } from "crypto";

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

    // Testnet (Sepolia)
    public publicClientTest;
    public walletClientTest;
    public accountTest;
    public addressTest: Address;

    // Mainnet (Base)
    public publicClientMain;
    public walletClientMain;
    public accountMain;
    public addressMain: Address;

    constructor(private config: ConfigService, private prisma: PrismaService, private httpService: HttpService, private telegram: TelegramService, private activityLog: ActivityLoggerService) {
        // --- TESTNET ---
        const rpcTest = this.config.get<string>("RPC_URL_TESTNET") || this.config.get<string>("RPC_URL");
        const pkTest = this.config.get<string>("PRIVATE_KEY");
        this.addressTest = (this.config.get<string>("OPENLY_GATEWAY_ADDRESS_TESTNET") || this.config.get<string>("OPENLY_GATEWAY_ADDRESS")) as Address;

        this.publicClientTest = createPublicClient({ chain: baseSepolia, transport: http(rpcTest) });
        if (pkTest) {
            this.accountTest = privateKeyToAccount(pkTest as `0x${string}`);
            this.walletClientTest = createWalletClient({ account: this.accountTest, chain: baseSepolia, transport: http(rpcTest) });
        }

        // --- MAINNET ---
        const rpcMain = this.config.get<string>("RPC_URL_MAINNET") || rpcTest;
        const pkMain = this.config.get<string>("PRIVATE_KEY_MAINNET") || pkTest;
        this.addressMain = (this.config.get<string>("OPENLY_GATEWAY_ADDRESS_MAINNET") || this.addressTest) as Address;

        this.publicClientMain = createPublicClient({ chain: baseSepolia, transport: http(rpcMain) });

        if (pkMain) {
            this.accountMain = privateKeyToAccount(pkMain as `0x${string}`);
            this.walletClientMain = createWalletClient({ account: this.accountMain, chain: baseSepolia, transport: http(rpcMain) });
        }
    }

    private getContext(network: string = 'TESTNET') {
        const isTest = network === 'TESTNET';
        return isTest ? {
            type: 'TESTNET',
            client: this.publicClientTest,
            wallet: this.walletClientTest,
            address: this.addressTest
        } : {
            type: 'MAINNET',
            client: this.publicClientMain,
            wallet: this.walletClientMain,
            address: this.addressMain
        };
    }

    // UPDATED: Accepts network from DTO
    async initializePayment(apiKey: string, paymentRef: string, amount: number, customerData?: any, metadata?: any, network: 'TESTNET' | 'MAINNET' = 'TESTNET') {
        // Authenticate using Single Key
        const hashedKey = createHash('sha256').update(apiKey).digest('hex');

        const merchant = await this.prisma.merchant.findUnique({
            where: { apiKeyHash: hashedKey }
        });

        if (!merchant) throw new BadRequestException("Invalid API Key");

        // Use Network from Request
        const ctx = this.getContext(network);

        const existing = await this.prisma.payment.findUnique({
            where: { merchantId_paymentRef: { merchantId: merchant.id, paymentRef } }
        });
        if (existing) {
            if (existing.status === "COMPLETED" || existing.status === "CONFIRMING") {
                throw new ConflictException(`Payment ${paymentRef} has already been processed.`);
            }
            return { ...existing, paymentAddress: existing.paymentAddress };
        }

        const paymentAddress = await ctx.client.readContract({
            address: ctx.address,
            abi: GATEWAY_ABI,
            functionName: "computeForwarderAddress",
            args: [merchant.id, paymentRef]
        });

        await this.telegram.sendMessage(`<b>[${ctx.type}] New Payment Initiated</b>\n\n` + `Merchant: ${merchant.businessName}\n` + `Ref: ${paymentRef}\n` + `Expected: ${amount} USDC`);
        await this.activityLog.log("PAYMENT", `Payment initiated for ${paymentRef} on ${ctx.type}`, "INFO", { amount, paymentRef, network: ctx.type }, merchant.id);

        let customerId: string | null = null;
        if (customerData) {
            const customer = await this.prisma.customer.upsert({
                where: { merchantId_email: { merchantId: merchant.id, email: customerData.email } },
                update: { firstName: customerData.firstName, lastName: customerData.lastName, email: customerData.email, phoneNumber: customerData.phoneNumber },
                create: { merchantId: merchant.id, firstName: customerData.firstName, lastName: customerData.lastName, email: customerData.email, phoneNumber: customerData.phoneNumber }
            });
            customerId = customer.id;
        }

        return await this.prisma.payment.create({
            data: {
                merchantId: merchant.id,
                paymentRef,
                amountExpected: amount,
                paymentAddress: paymentAddress,
                status: "PENDING",
                customerId: customerId,
                metadata: metadata || {},
                network: ctx.type // Store "TESTNET" or "MAINNET"
            }
        });
    }

    async handlePaymentSuccess(merchantId: string, paymentRef: string, amount: bigint, txHash: string) {
        const formattedAmount = formatUnits(amount, 6);
        const payment = await this.prisma.payment.findUnique({ where: { merchantId_paymentRef: { merchantId, paymentRef } } });
        if (!payment || payment.status === "COMPLETED") return;

        await this.prisma.$transaction(async (tx) => {
            await tx.payment.update({
                where: { id: payment.id },
                data: { status: "COMPLETED", amountPaid: formattedAmount, txHash, confirmedAt: new Date() }
            });
            await tx.merchant.update({ where: { id: merchantId }, data: { usdcBalance: { increment: formattedAmount } } });
        });

        this.sendWebhook(merchantId, { event: "payment.success", data: { paymentRef, amount: formattedAmount, txHash } });
    }

    private async sendWebhook(merchantId: string, payload: any) {
        const merchant = await this.prisma.merchant.findUnique({ where: { id: merchantId } });
        if (merchant?.webhookUrl) {
            try { await this.httpService.axiosRef.post(merchant.webhookUrl, payload); } catch (error) { this.logger.error(`Webhook failed for: ${merchantId}`); }
        }
    }

    async handlePaymentDetected(merchantId: string, paymentRef: string, amount: bigint, txHash: string, blockNumber?: bigint) {
        const formattedAmount = Number(formatUnits(amount, 6));
        const payment = await this.prisma.payment.findUnique({ where: { merchantId_paymentRef: { merchantId, paymentRef } } });
        if (!payment || payment.status !== "PENDING") return;

        await this.prisma.payment.update({
            where: { id: payment.id },
            data: { status: "CONFIRMING", amountPaid: formattedAmount, txHash, blockNumber: blockNumber ? Number(blockNumber) : undefined }
        });

        if (payment.customerId) {
            await this.prisma.customer.update({
                where: { id: payment.customerId },
                data: {
                    totalPayments: { increment: 1 },
                    totalAmount: { increment: formattedAmount },
                    lastPaymentAt: new Date(),
                }
            });
        }

        this.sendWebhook(merchantId, { event: "payment.detected", data: { paymentRef, amount: formattedAmount, txHash } });

        // Fix: Pass network/context to flush. But wait, flushPayment can now self-resolve from DB.
        // Just trigger it. The new flushPayment logic reads the DB.
        const amountBigInt = parseUnits(formattedAmount.toString(), 6); // Re-parsing for type consistency
        await this.flushPayment(merchantId, paymentRef, amountBigInt);
    }

    async flushPayment(merchantId: string, paymentRef: string, amount: bigint) {
        // 1. Resolve Network Context from DB
        const payment = await this.prisma.payment.findUnique({
            where: { merchantId_paymentRef: { merchantId, paymentRef } }
        });

        if (!payment) {
            this.logger.error(`Flush failed: Payment ${paymentRef} not found`);
            return;
        }

        const ctx = this.getContext(payment.network);

        if (!ctx.wallet) {
            this.logger.error(`Flush failed: No wallet client for ${ctx.type}`);
            return;
        }

        try {
            const forwarderAddress = await ctx.client.readContract({
                address: ctx.address,
                abi: GATEWAY_ABI,
                functionName: "computeForwarderAddress",
                args: [merchantId, paymentRef]
            });

            const code = await ctx.client.getBytecode({
                address: forwarderAddress
            });

            if (!code || code === "0x") {
                this.logger.log(`[${ctx.type}] Deploying forwarder for ${paymentRef}`);
                try {
                    const deployHash = await ctx.wallet.writeContract({
                        address: ctx.address,
                        abi: GATEWAY_ABI,
                        functionName: "deployForwarder",
                        args: [merchantId, paymentRef]
                    });
                    await ctx.client.waitForTransactionReceipt({ hash: deployHash });
                } catch (deployError: any) {
                    const checkCode = await ctx.client.getBytecode({ address: forwarderAddress });
                    if (!checkCode || checkCode === "0x") throw deployError;
                }
            }

            this.logger.log(`[${ctx.type}] Forwarding funds for ${paymentRef}`);

            const forwardHash = await ctx.wallet.writeContract({
                address: forwarderAddress,
                abi: FORWARDER_ABI,
                functionName: "forward",
                args: [merchantId, paymentRef, amount]
            });

            await ctx.client.waitForTransactionReceipt({ hash: forwardHash });
            this.logger.log(`Funds forwarded: ${forwardHash}`);

            await this.handlePaymentSuccess(merchantId, paymentRef, amount, forwardHash);

        } catch (error: any) {
            this.logger.error(`Error flushing payment ${paymentRef}: ${error}`);
            await this.activityLog.log("ERROR", `Flush failed for ${paymentRef}`, "ERROR", { error: error.message }, merchantId);
        }
    }

    async getUsdcTokenAddress() {
        return this.addressTest; // Default
    }
}