import { PrismaClient } from "@/generated/prisma/client";
import { createAdapter } from "./db-adapter";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// Reuse one client across hot reloads in dev.
export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter: createAdapter() });
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
