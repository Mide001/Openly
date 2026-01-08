import { Injectable, BadRequestException, UnauthorizedException } from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";
import { OpenlyGatewayService } from "@/blockchain/OpenlyGatewayService";
import { OpenlySettlementService } from "@/blockchain/openly-settlement.service";
import { InitializePaymentDto, RequestPayoutDto } from "./dto/api.dto";

@Injectable()
export class ApiService {
    constructor(private prisma: PrismaService, private openlyGateway: OpenlyGatewayService, private settlement: OpenlySettlementService) { }

    async initializePayment(apiKey: string, dto: InitializePaymentDto) {
        if (!apiKey) throw new UnauthorizedException("Missing API Key");

        const payment = await this.openlyGateway.initializePayment(apiKey, dto.paymentRef, dto.amount, dto.customer, dto.metadata);

        return {
            status: "success",
            data: {
                paymentId: payment.id,
                paymentRef: payment.paymentRef,
                paymentAddress: payment.paymentAddress,
                amount: Number(payment.amountExpected),
                expires_at: new Date(Date.now() + 3600000),
                currency: "USDC",
                network: "Base Sepolia",
                status: payment.status
            }
        };
    }

    async getPaymentStatus(apiKey: string, paymentRef: string) {
        const merchant = await this.prisma.merchant.findUnique({ where: { apiKey } });
        if (!merchant) throw new UnauthorizedException("Invalid API Key");
        const payment = await this.prisma.payment.findUnique({
            where: {
                merchantId_paymentRef: {
                    merchantId: merchant.id,
                    paymentRef
                }
            }
        });

        if (!payment) throw new BadRequestException("Payment not found");

        return {
            status: "success",
            data: {
                paymentRef: payment.paymentRef,
                status: payment.status,
                amountPaid: Number(payment.amountPaid),
                txHash: payment.txHash,
                confirmedAt: payment.confirmedAt
            }
        };
    }


    async requestPayout(apiKey: string, dto: RequestPayoutDto) {
        if (!apiKey) throw new UnauthorizedException("Missing API Key");

        const result = await this.settlement.manualSettlement(apiKey, dto.amount);

        return {
            status: "success",
            data: result
        };
    }

    async getPayoutHistory(apiKey: string) {
        if (!apiKey) throw new UnauthorizedException("Missing API Key");

        const payouts = await this.settlement.getPayouts(apiKey);

        return {
            status: "success",
            data: payouts.map(p => ({
                id: p.id,
                amount: Number(p.amount),
                status: p.status,
                txHash: p.txHash,
                createdAt: p.createdAt
            }))
        };
    }
}