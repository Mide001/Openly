import { Module } from "@nestjs/common";
import { BlockchainListenerService } from "./blockchain-listener.service";
import { OpenlySettlementService } from "@/blockchain/openly-settlement.service";
import { PrismaModule } from "@/common/prisma/prisma.module";
// We need to import the module that provides OpenlyGatewayService, or provide it here. 
// OpenlyGatewayService is in ApiModule/BlockchainModule/etc. 
// Let's assume we can provide it via imports or providers. 
// Since OpenlyGatewayService is currently in src/blockchain directory and perhaps not in a shared module,
// we will just recreate the providers array here or ideally import a BlockchainModule.
// Given previous steps, we don't have a BlockchainModule yet, so we will provide the services directly.
import { OpenlyGatewayService } from "@/blockchain/OpenlyGatewayService";
import { TelegramService } from "@/notifications/telegram.service";
import { ActivityLoggerService } from "@/notifications/activity-logger.service";
import { HttpModule } from "@nestjs/axios";
import { ConfigModule } from "@nestjs/config";

@Module({
    imports: [PrismaModule, HttpModule, ConfigModule],
    providers: [
        BlockchainListenerService,
        OpenlySettlementService,
        OpenlyGatewayService, // Needed by Listener
        TelegramService,
        ActivityLoggerService
    ],
    exports: [OpenlySettlementService]
})
export class JobsModule { }
