import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";

@Injectable()
export class ApiKeyGuard implements CanActivate {
    constructor(private prisma: PrismaService) { }

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest();
        const apiKey = request.headers['x-api-key'];
        if (!apiKey) {
            throw new UnauthorizedException('Missing API Key');
        }

        const merchant = await this.prisma.merchant.findUnique({
            where: { apiKey: apiKey },
        });

        if (!merchant || !merchant.isActive) {
            throw new UnauthorizedException("Invalid API Key");
        }
        request.merchant = merchant;
        return true;
    }
}