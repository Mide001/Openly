import { Injectable, Logger, BadRequestException, ConflictException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "@/common/prisma/prisma.service";
import { HttpService } from "@nestjs/axios";
import { createPublicClient, http, parseAbi, formatUnits, parseUnits, Address, Hex } from "viem";
import { baseSepolia, base } from "viem/chains";
import { TelegramService } from "@/notifications/telegram.service";
import { ActivityLoggerService } from "@/notifications/activity-logger.service";
import { privateKeyToAccount } from "viem/accounts";
import { createHash } from "crypto";
import { createSmartAccountClient } from "permissionless";
import { createBundlerClient, createPaymasterClient } from "viem/account-abstraction";
import { toSimpleSmartAccount } from "permissionless/accounts";

// Standard EntryPoint v0.6 address
const ENTRYPOINT_ADDRESS_V06 = "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789";

export const GATEWAY_ABI = parseAbi([
    'function computeForwarderAddress(string merchantId, string paymentRef) view returns (address)',
    'function deployForwarder(string merchantId, string paymentRef) external returns (address)',
    'function usdcToken() view returns (address)',
    'function batchWithdraw(string[] merchantIds, address[] recipients, uint256[] amounts)',
    'function withdrawForMerchant(string merchantId, address recipient, uint256 amount)',
    'function executeForward(address forwarder, string merchantId, string paymentRef, uint256 amount)',
    'event PaymentReceived(string indexed merchantId, string indexed paymentRef, uint256 amount, address payer, uint256 timestamp)'
]);
const FORWARDER_ABI = parseAbi([
    'function forward(string merchantId, string paymentRef, uint256 amount) external'
]);

@Injectable()
export class OpenlyGatewayService {
    private readonly logger = new Logger(OpenlyGatewayService.name);

    public publicClientTest;
    public publicClientMain;
    public addressTest: Address;
    public addressMain: Address;

    // Smart Account Clients
    public smartClientTest;
    public smartClientMain;

    constructor(private config: ConfigService, private prisma: PrismaService, private httpService: HttpService, private telegram: TelegramService, private activityLog: ActivityLoggerService) {
        const rpcTest = this.config.get<string>("RPC_URL_TESTNET") || this.config.get<string>("RPC_URL");
        const rpcMain = this.config.get<string>("RPC_URL_MAINNET") || rpcTest;
        const paymasterRpcTest = this.config.get<string>("PAYMASTER_RPC_URL_TESTNET");
        const paymasterRpcMain = this.config.get<string>("PAYMASTER_RPC_URL_MAINNET");
        const pk = this.config.get<string>("PRIVATE_KEY");

        this.addressTest = (this.config.get<string>("OPENLY_GATEWAY_ADDRESS_TESTNET") || this.config.get<string>("OPENLY_GATEWAY_ADDRESS")) as Address;
        this.addressMain = (this.config.get<string>("OPENLY_GATEWAY_ADDRESS_MAINNET") || this.addressTest) as Address;

        this.publicClientTest = createPublicClient({ chain: baseSepolia, transport: http(rpcTest) });
        this.publicClientMain = createPublicClient({ chain: base, transport: http(rpcMain) });

        if (pk) {
            this.initSmartAccounts(pk as Hex, paymasterRpcTest, paymasterRpcMain);
        } else {
            this.logger.warn("Missing PRIVATE_KEY. Smart Accounts cannot be initialized.");
        }
    }

    private async initSmartAccounts(pk: Hex, paymasterUrlTest: string | undefined, paymasterUrlMain: string | undefined) {
        try {
            const owner = privateKeyToAccount(pk);

            if (paymasterUrlTest) {
                const accountTest = await toSimpleSmartAccount({
                    client: this.publicClientTest,
                    owner: owner,
                    entryPoint: {
                        address: ENTRYPOINT_ADDRESS_V06,
                        version: "0.6"
                    },
                    factoryAddress: "0x9406Cc6185a346906296840746125a0E44976454"
                });

                const paymasterTest = createPaymasterClient({
                    transport: http(paymasterUrlTest),
                });

                this.smartClientTest = createSmartAccountClient({
                    account: accountTest,
                    chain: baseSepolia,
                    bundlerTransport: http(paymasterUrlTest),
                    paymaster: paymasterTest,
                });

                this.logger.log(`[TESTNET] Smart Account Ready: ${accountTest.address}`);
            } else {
                this.logger.warn("[TESTNET] Paymaster URL missing. Skipping Smart Account init.");
            }

            if (paymasterUrlMain) {
                const accountMain = await toSimpleSmartAccount({
                    client: this.publicClientMain,
                    owner: owner,
                    entryPoint: {
                        address: ENTRYPOINT_ADDRESS_V06,
                        version: "0.6"
                    },
                    factoryAddress: "0x9406Cc6185a346906296840746125a0E44976454"
                });

                const paymasterMain = createPaymasterClient({
                    transport: http(paymasterUrlMain),
                });

                this.smartClientMain = createSmartAccountClient({
                    account: accountMain,
                    chain: base,
                    bundlerTransport: http(paymasterUrlMain),
                    paymaster: paymasterMain,
                });
                this.logger.log(`[MAINNET] Smart Account Ready: ${accountMain.address}`);
            } else {
                this.logger.warn("[MAINNET] Paymaster URL missing. Skipping Smart Account init.");
            }

        } catch (error) {
            this.logger.error(`Failed to init Smart Accounts: ${error}`);
        }
    }

    private getContext(network: string = 'TESTNET') {
        const isTest = network === 'TESTNET';
        return isTest ? {
            type: 'TESTNET',
            client: this.publicClientTest,
            smartClient: this.smartClientTest,
            address: this.addressTest
        } : {
            type: 'MAINNET',
            client: this.publicClientMain,
            smartClient: this.smartClientMain,
            address: this.addressMain
        };
    }

    async initializePayment(apiKey: string, paymentRef: string, amount: number, customerData?: any, metadata?: any, network: 'TESTNET' | 'MAINNET' = 'TESTNET') {
        const hashedKey = createHash('sha256').update(apiKey).digest('hex');

        const merchant = await this.prisma.merchant.findUnique({
            where: { apiKeyHash: hashedKey }
        });

        if (!merchant) throw new BadRequestException("Invalid API Key");

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
                network: ctx.type
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

        const merchant = await this.prisma.merchant.findUnique({ where: { id: merchantId } });
        if (merchant) {
            await this.telegram.sendMessage(`<b>[SUCCESS] Payment Confirmed!</b>\n\nMerchant: ${merchant.businessName}\nRef: ${paymentRef}\nAmount: ${formattedAmount} USDC\nTx: ${txHash}`);
            await this.activityLog.log("PAYMENT", `Payment confirmed for ${paymentRef}`, "SUCCESS", { amount: formattedAmount, txHash }, merchantId);
        }

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

        const merchant = await this.prisma.merchant.findUnique({ where: { id: merchantId } });
        await this.telegram.sendMessage(`<b>[DETECTED] Payment Received!</b>\n\nMerchant: ${merchant?.businessName}\nRef: ${paymentRef}\nAmount: ${formattedAmount} USDC\nTx: ${txHash}`);
        await this.activityLog.log("PAYMENT", `Payment detected on chain`, "INFO", { amount: formattedAmount, txHash, paymentRef }, merchantId);

        this.sendWebhook(merchantId, { event: "payment.detected", data: { paymentRef, amount: formattedAmount, txHash } });

        const amountBigInt = parseUnits(formattedAmount.toString(), 6);
        await this.flushPayment(merchantId, paymentRef, amountBigInt);
    }

    async flushPayment(merchantId: string, paymentRef: string, amount: bigint) {
        const payment = await this.prisma.payment.findUnique({
            where: { merchantId_paymentRef: { merchantId, paymentRef } }
        });

        if (!payment) return;

        const ctx = this.getContext(payment.network);

        if (!ctx.smartClient) {
            this.logger.error(`Flush failed: No Smart Account for ${ctx.type} (Check Paymaster Config)`);
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
                this.logger.log(`[${ctx.type}] Deploying forwarder for ${paymentRef} (SPONSORED)`);
                const deployHash = await ctx.smartClient.writeContract({
                    address: ctx.address,
                    abi: GATEWAY_ABI,
                    functionName: "deployForwarder",
                    args: [merchantId, paymentRef]
                });
                await ctx.client.waitForTransactionReceipt({ hash: deployHash });
                this.logger.log(`Forwarder deployed: ${deployHash}`);
            }

            this.logger.log(`[${ctx.type}] Forwarding funds via Gateway for ${paymentRef} (SPONSORED)`);

            const forwardHash = await ctx.smartClient.writeContract({
                address: ctx.address,
                abi: GATEWAY_ABI,
                functionName: "executeForward",
                args: [forwarderAddress, merchantId, paymentRef, amount]
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
        return this.addressTest;
    }
}