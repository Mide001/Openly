import { Injectable } from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";
import { LogType, LogSeverity } from "@prisma/client";

@Injectable()
export class ActivityLoggerService {
    constructor(private prisma: PrismaService) { }

    async log(type: string, message: string, severity: string, metadata?: any, merchantId?: string) {
        // Normalize to uppercase to ensure matching with Prisma Enum
        const safeType = LogType[type.toUpperCase()] || LogType.SYSTEM;
        const safeSeverity = LogSeverity[severity.toUpperCase()] || LogSeverity.INFO;

        await this.prisma.activityLog.create({
            data: {
                type: safeType,
                message,
                severity: safeSeverity,
                metadata: metadata || {},
                merchantId: merchantId || null,
            },
        });
    }
}


