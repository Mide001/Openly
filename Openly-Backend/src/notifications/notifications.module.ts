import { Module } from "@nestjs/common";
import { ActivityLoggerService } from "./activity-logger.service";
import { TelegramService } from "./telegram.service";
import { PrismaModule } from "@/common/prisma/prisma.module";
import { HttpModule } from "@nestjs/axios";
import { ConfigModule } from "@nestjs/config";

@Module({
    imports: [PrismaModule, HttpModule, ConfigModule],
    providers: [ActivityLoggerService, TelegramService],
    exports: [ActivityLoggerService, TelegramService]
})
export class NotificationsModule { }
