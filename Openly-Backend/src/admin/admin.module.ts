import { Module } from "@nestjs/common";
import { AdminController } from "./admin.controller";
import { AdminService } from "@/auth/admin.service";
import { PrismaService } from "@/common/prisma/prisma.service";
import { PrismaModule } from "@/common/prisma/prisma.module";


@Module({
    imports: [PrismaModule],
    controllers: [AdminController],
    providers: [AdminService],
    exports: [AdminService]
})
export class AdminModule { }