import { Controller, Post, Body, Headers, UnauthorizedException } from "@nestjs/common";
import { AdminAuthService } from "./admin-auth.service";
import { LoginAdminDto } from "./dto/admin-auth.dto";

@Controller('admin/auth')
export class AdminAuthController {
    constructor(private readonly authService: AdminAuthService) { }

    @Post('login')
    async login(@Body() body: LoginAdminDto) {
        return this.authService.login(body);
    }

    @Post('refresh')
    async refresh(@Headers('Authorization') authHeader: string) {
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            throw new UnauthorizedException("Invalid refresh token");
        }

        const refreshToken = authHeader.split(' ')[1];
        return this.authService.refreshToken(refreshToken);
    }
}
