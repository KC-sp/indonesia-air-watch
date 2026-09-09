import { prisma } from '../db.js';
import type { QuotaStore } from './quota.js';

export const prismaQuotaStore: QuotaStore = {
  async count(provider, bucket) {
    return (await prisma.providerQuotaUsage.findUnique({ where: { provider_bucket: { provider, bucket } } }))?.count ?? 0;
  },
  async increment(provider, bucket) {
    const record = await prisma.providerQuotaUsage.upsert({
      where: { provider_bucket: { provider, bucket } }, create: { provider, bucket, count: 1 }, update: { count: { increment: 1 } },
    });
    return record.count;
  },
};
