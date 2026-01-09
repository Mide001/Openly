import { Module } from "@nestjs/common";
import { OpenlyGatewayService } from "./OpenlyGatewayService";
import { OpenlySettlementService } from "./openly-settlement.service";
import { PrismaModule } from "@/common/prisma/prisma.module";
import { TelegramService } from "@/notifications/telegram.service";
import { ActivityLoggerService } from "@/notifications/activity-logger.service";
import { HttpModule } from "@nestjs/axios";
import { ConfigModule } from "@nestjs/config";

@Module({
    imports: [PrismaModule, HttpModule, ConfigModule],
    providers: [
        OpenlyGatewayService,
        OpenlySettlementService,
        TelegramService,
        ActivityLoggerService
    ],
    exports: [OpenlyGatewayService, OpenlySettlementService, TelegramService, ActivityLoggerService]
})
export class BlockchainModule { }
