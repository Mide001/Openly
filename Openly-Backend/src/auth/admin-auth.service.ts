import { Injectable, UnauthorizedException, ForbiddenException } from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcrypt";
import { LoginAdminDto } from "./dto/admin-auth.dto";

@Injectable()
export class AdminAuthService {
    constructor(private prisma: PrismaService, private jwtService: JwtService) { }

    async login(dto: LoginAdminDto) {
        const admin = await this.prisma.adminUser.findUnique({
            where: { email: dto.email },
        });

        if (!admin || !admin.passwordHash) {
            throw new UnauthorizedException("Invalid admin credentials");
        }

        if (!admin.isActive) {
            throw new ForbiddenException("Admin account disabled");
        }

        const valid = await bcrypt.compare(dto.password, admin.passwordHash);
        if (!valid) throw new UnauthorizedException("Invalid admin credentials");

        const payload = { sub: admin.id, email: admin.email, role: admin.role, type: "admin" };
        const accessToken = this.jwtService.sign(payload, { expiresIn: '1h' });

        return {
            accessToken,
            admin: {
                id: admin.id,
                email: admin.email,
                firstName: admin.firstName,
                lastName: admin.lastName,
                role: admin.role,
            },
        };
    }

    async refreshToken(token: string) {
        try {
            const payload = this.jwtService.verify(token);

            if (payload.type !== 'admin') throw new UnauthorizedException("Invalid token type");

            const admin = await this.prisma.adminUser.findUnique({
                where: { id: payload.sub }
            });

            if (!admin) throw new UnauthorizedException("Admin not found");

            const newPayload = { sub: admin.id, email: admin.email, role: admin.role, type: "admin" };


            return {
                accessToken: this.jwtService.sign(newPayload, { expiresIn: '1h' })
            };
        } catch (e) {
            throw new UnauthorizedException("Invalid refresh token");
        }
    }
}