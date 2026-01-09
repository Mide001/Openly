import { Module } from "@nestjs/common";
import { BlockchainListenerService } from "./blockchain-listener.service";
import { OpenlySettlementService } from "@/blockchain/openly-settlement.service";
import { PrismaModule } from "@/common/prisma/prisma.module";
import { BlockchainModule } from "@/blockchain/blockchain.module";
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
    imports: [
        PrismaModule,
        HttpModule,
        ConfigModule,
        BlockchainModule // Import shared module
    ],
    providers: [
        BlockchainListenerService,
        // OpenlySettlementService, // Removed (Provided by BlockchainModule)
        // OpenlyGatewayService, // Removed (Provided by BlockchainModule)
        // TelegramService, // Removed (Provided by BlockchainModule)
        // ActivityLoggerService // Removed (Provided by BlockchainModule)
    ],
    exports: [] // No need to export services from here if they are in BlockchainModule
})
export class JobsModule { }
