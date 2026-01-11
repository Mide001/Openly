import { BadRequestException, Injectable, UnauthorizedException } from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";
import { OpenlyGatewayService } from "@/blockchain/OpenlyGatewayService";
import { OpenlySettlementService } from "@/blockchain/openly-settlement.service";
import { InitializePaymentDto, RequestPayoutDto } from "./dto/api.dto";
import { createHash } from "crypto";

@Injectable()
export class ApiService {
    constructor(private prisma: PrismaService, private openlyGateway: OpenlyGatewayService, private settlementService: OpenlySettlementService) { }

    async initializePayment(apiKey: string, dto: InitializePaymentDto) {
        // Pass network explicitly
        return await this.openlyGateway.initializePayment(apiKey, dto.paymentRef, dto.amount, dto.customer, dto.metadata, dto.network || 'TESTNET');
    }

    async getPaymentStatus(apiKey: string, paymentRef: string) {
        // Hash key
        const hashedKey = createHash('sha256').update(apiKey).digest('hex');

        const merchant = await this.prisma.merchant.findUnique({
            where: { apiKeyHash: hashedKey }
        });

        if (!merchant) throw new UnauthorizedException("Invalid API Key");

        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(paymentRef);

        let payment;

        if (isUuid) {
            payment = await this.prisma.payment.findFirst({
                where: {
                    id: paymentRef,
                    merchantId: merchant.id
                }
            });
        }

        if (!payment) {
            payment = await this.prisma.payment.findUnique({
                where: {
                    merchantId_paymentRef: {
                        merchantId: merchant.id,
                        paymentRef
                    }
                }
            });
        }

        if (!payment) throw new BadRequestException("Payment not found");

        return {
            status: "success",
            data: {
                paymentRef: payment.paymentRef,
                network: payment.network,
                status: payment.status,
                amountPaid: Number(payment.amountPaid),
                txHash: payment.txHash,
                confirmedAt: payment.confirmedAt
            }
        };
    }

    async requestPayout(apiKey: string, dto: RequestPayoutDto) {
        // Manual Settlement now just needs key and amount, service handles hash
        return await this.settlementService.manualSettlement(apiKey, dto.amount);
    }

    async getPayouts(apiKey: string) {
        return await this.settlementService.getPayouts(apiKey);
    }
}