import { PrismaClient } from '@prisma/client';
import { env } from '../config/env.js';

export const prisma = new PrismaClient({
  log: env.isProd ? ['error', 'warn'] : ['query', 'error', 'warn'],
});

// Graceful shutdown hooks.
const shutdown = async () => {
  await prisma.$disconnect();
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
