import { Module } from "@nestjs/common";
import { OpenlyGatewayService } from "./OpenlyGatewayService";
import { OpenlySettlementService } from "./openly-settlement.service";
import { PrismaModule } from "@/common/prisma/prisma.module";
import { TelegramService } from "@/notifications/telegram.service";
import { ActivityLoggerService } from "@/notifications/activity-logger.service";
import { HttpModule } from "@nestjs/axios";
import { ConfigModule } from "@nestjs/config";
import { NotificationsModule } from "@/notifications/notifications.module";

@Module({
    imports: [PrismaModule, HttpModule, ConfigModule, NotificationsModule],
    providers: [
        OpenlyGatewayService,
        OpenlySettlementService
    ],
    exports: [OpenlyGatewayService, OpenlySettlementService]
})
export class BlockchainModule { }
