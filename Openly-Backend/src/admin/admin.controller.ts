import { Controller, Get, Param, UseGuards } from "@nestjs/common";
import { AdminService } from "../auth/admin.service";
import { JwtAuthGuard } from "@/auth/guards/jwt-auth.guard";

@Controller('admin')
@UseGuards(JwtAuthGuard)
export class AdminController {
    constructor(private readonly adminService: AdminService) { }

    @Get('payments/:id')
    async getPayment(@Param('id') id: string) {
        return this.adminService.getPaymentDetails(id);
    }
}