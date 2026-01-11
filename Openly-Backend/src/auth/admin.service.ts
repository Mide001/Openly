import { Injectable, NotFoundException } from "@nestjs/common"
import { PrismaService } from "@/common/prisma/prisma.service"

@Injectable()
export class AdminService {
    constructor(private prisma: PrismaService) { }

    async getPaymentDetails(paymentId: string) {
        const payment = await this.prisma.payment.findUnique({
            where: { id: paymentId },
            select: {
                paymentRef: true,
                amountExpected: true,
                amountPaid: true,
                currency: true,
                status: true,
                txHash: true,
                createdAt: true,
                confirmedAt: true,
                metadata: true,

                customer: {
                    select: {
                        firstName: true,
                        lastName: true,
                        email: true,
                        phoneNumber: true,
                        country: true,
                        totalAmount: true,
                        totalPayments: true
                    }
                },
                merchant: {
                    select: {
                        businessName: true,
                        businessEmail: true,
                        country: true
                    }
                }
            }
        });

        if (!payment) throw new NotFoundException("Payment not found");

        return payment;
    }
}