import { Module } from "@nestjs/common";
import { ApiController } from "./api.controller";
import { ApiService } from "./api.service";
import { PrismaModule } from "@/common/prisma/prisma.module";
import { ApiKeyGuard } from "./guards/api-key.guard";
import { OpenlyGatewayService } from "@/blockchain/OpenlyGatewayService";
import { OpenlySettlementService } from "@/blockchain/openly-settlement.service";
import { TelegramService } from "@/notifications/telegram.service";
import { ActivityLoggerService } from "@/notifications/activity-logger.service";
import { HttpModule } from "@nestjs/axios";
import { ConfigModule } from "@nestjs/config";


@Module({
    imports: [PrismaModule, HttpModule, ConfigModule],
    controllers: [ApiController],
    providers: [ApiService, ApiKeyGuard, OpenlyGatewayService, OpenlySettlementService, TelegramService, ActivityLoggerService],
    exports: []
})

export class ApiModule { }