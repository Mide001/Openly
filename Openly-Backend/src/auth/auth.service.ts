import { Injectable, UnauthorizedException, BadRequestException, ForbiddenException } from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";
import { RegisterMerchantDto, LoginMerchantDto } from "./dto/auth.dto";
import * as bcrypt from "bcrypt";
import { JwtService } from "@nestjs/jwt";
import { createHash, randomBytes } from "crypto";

// Helper to hash API keys (SHA-256 for deterministic lookup)
export function hashApiKey(key: string): string {
    return createHash('sha256').update(key).digest('hex');
}

@Injectable()
export class AuthService {
    constructor(private prisma: PrismaService, private jwtService: JwtService) { }

    async register(dto: RegisterMerchantDto) {
        const existing = await this.prisma.merchant.findUnique({
            where: { businessEmail: dto.businessEmail },
        });

        if (existing) throw new BadRequestException("Email already in use");

        const hashedPassword = await bcrypt.hash(dto.password, 10);

        // 1. Generate Single API Key (User sees this ONCE)
        const apiKey = 'sk_live_' + randomBytes(24).toString('hex');

        // 2. Hash it for storage
        const keyHash = hashApiKey(apiKey);

        const verifyToken = randomBytes(32).toString('hex');

        const merchant = await this.prisma.merchant.create({
            data: {
                businessEmail: dto.businessEmail,
                businessName: dto.businessName,
                country: dto.country,
                passwordHash: hashedPassword,

                // Store ONLY Hash
                apiKeyHash: keyHash,

                walletAddress: dto.walletAddress,
                emailVerificationToken: verifyToken,
                isEmailVerified: false
            }
        });

        console.log(`[Mock Email] Verify token for ${dto.businessEmail}: ${verifyToken}`);

        return {
            merchantId: merchant.id,
            apiKey: apiKey,
            message: 'SAVE THIS KEY! We do not store it. \n\nPlease verify your email. (Check server logs for token in dev)',
        };
    }

    async login(dto: LoginMerchantDto) {
        const merchant = await this.prisma.merchant.findUnique({
            where: { businessEmail: dto.email },
        });

        if (!merchant || !merchant.passwordHash) {
            throw new UnauthorizedException('Invalid credentials');
        }

        if (!merchant.isActive) {
            throw new ForbiddenException('Account is disabled');
        }

        const valid = await bcrypt.compare(dto.password, merchant.passwordHash);
        if (!valid) throw new UnauthorizedException('Invalid credentials');

        const payload = { sub: merchant.id, email: merchant.businessEmail };
        const accessToken = this.jwtService.sign(payload, { expiresIn: '1h' });
        const refreshToken = this.jwtService.sign(payload, { expiresIn: '7d' });

        return {
            accessToken,
            refreshToken,
            merchant: {
                id: merchant.id,
                email: merchant.businessEmail,
                businessName: merchant.businessName,
                isEmailVerified: merchant.isEmailVerified
            }
        };
    }

    async verifyEmail(token: string) {
        const merchant = await this.prisma.merchant.findFirst({
            where: { emailVerificationToken: token },
        });

        if (!merchant) throw new BadRequestException('Invalid verification token');

        await this.prisma.merchant.update({
            where: { id: merchant.id },
            data: {
                isEmailVerified: true,
                emailVerificationToken: null
            }
        });

        return { message: 'Email verified successfully' };
    }

    async forgotPassword(email: string) {
        const merchant = await this.prisma.merchant.findUnique({
            where: { businessEmail: email }
        });

        if (!merchant) return { message: 'If account exists, reset email sent' };

        const resetToken = randomBytes(32).toString('hex');
        const expires = new Date(Date.now() + 3600000); // 1 hour

        await this.prisma.merchant.update({
            where: { id: merchant.id },
            data: {
                passwordResetToken: resetToken,
                passwordResetExpires: expires
            }
        });

        console.log(`[Mock Email] Reset token for ${email}: ${resetToken}`);

        return { message: 'Reset email sent' };
    }

    async resetPassword(token: string, newPass: string) {
        const merchant = await this.prisma.merchant.findFirst({
            where: {
                passwordResetToken: token,
                passwordResetExpires: { gt: new Date() }
            }
        });

        if (!merchant) throw new BadRequestException('Invalid or expired reset token');

        const hashedPassword = await bcrypt.hash(newPass, 10);

        await this.prisma.merchant.update({
            where: { id: merchant.id },
            data: {
                passwordHash: hashedPassword,
                passwordResetToken: null,
                passwordResetExpires: null
            }
        });

        return { message: 'Password reset successful' };
    }

    async refreshToken(token: string) {
        try {
            const payload = this.jwtService.verify(token);
            const merchant = await this.prisma.merchant.findUnique({
                where: { id: payload.sub }
            });

            if (!merchant) throw new UnauthorizedException('User not found');

            const newPayload = { sub: merchant.id, email: merchant.businessEmail };
            return {
                accessToken: this.jwtService.sign(newPayload, { expiresIn: '1h' })
            };
        } catch (e) {
            throw new UnauthorizedException('Invalid refresh token');
        }
    }
}