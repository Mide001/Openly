import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import * as bcrypt from "bcrypt";
import * as dotenv from "dotenv";

dotenv.config();

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
    const email = 'admin@openly.com';
    const password = 'admin';

    const existingAdmin = await prisma.adminUser.findUnique({
        where: { email },
    });

    if (!existingAdmin) {
        const hashedPassword = await bcrypt.hash(password, 10);

        await prisma.adminUser.create({
            data: {
                email,
                passwordHash: hashedPassword,
                firstName: 'Super',
                lastName: 'Admin',
                role: 'SUPER_ADMIN',
                isActive: true,
            },
        });
        console.log('Super Admin created: ', email);
    } else {
        console.log('Super Admin already exists: ', email);
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
}).finally(async () => {
    await prisma.$disconnect();
});