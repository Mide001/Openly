import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";
import { createHash } from "crypto";

@Injectable()
export class ApiKeyGuard implements CanActivate {
    constructor(private prisma: PrismaService) { }

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest();
        const apiKey = request.headers['x-api-key'];
        if (!apiKey) {
            throw new UnauthorizedException('Missing API Key');
        }

        // Secure Hash Lookup (Single Key)
        const hashedKey = createHash('sha256').update(apiKey).digest('hex');

        const merchant = await this.prisma.merchant.findUnique({
            where: { apiKeyHash: hashedKey },
        });

        if (!merchant || !merchant.isActive) {
            throw new UnauthorizedException("Invalid API Key");
        }

        request.merchant = merchant;
        // Network is now determined by Body DTO, not Key

        return true;
    }
}