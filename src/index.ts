import Fastify from 'fastify';
import OpenAI from 'openai';
import { loadConfig, requireRuntimeConfig } from './config.js';
import { prisma } from './db.js';
import { logger } from './logger.js';
import { IqAirQuota } from './services/quota.js';
import { prismaQuotaStore } from './services/prisma-quota.js';
import { IqAirProvider } from './providers/iqair.js';
import { UnavailableOfficialIspuProvider } from './providers/official.js';
import { AirService } from './services/air-service.js';
import { OfficialNewsService } from './services/news.js';
import { SourceReviewService } from './services/source-review.js';
import { createBot } from './bot.js';
import { hourlyMessage } from './domain/air.js';
import { dispatchOnce, startHourlyScheduler } from './scheduler.js';

async function main() {
  const config = loadConfig();
  requireRuntimeConfig(config);
  const app = Fastify({ loggerInstance: logger });
  const quota = new IqAirQuota(prismaQuotaStore);
  const iqair = new IqAirProvider(config.IQAIR_API_KEY, quota);
  const air = new AirService(prisma, iqair, new UnavailableOfficialIspuProvider(), config.NATIONAL_SAMPLE_CITY_LIMIT);
  const news = new OfficialNewsService(config.OPENAI_API_KEY ? new OpenAI({ apiKey: config.OPENAI_API_KEY }) : undefined, config.OPENAI_MODEL, ['indonesia.go.id', 'klhk.go.id', 'bmkg.go.id', 'bnpb.go.id']);
  const sources = new SourceReviewService(prisma, config.OPENAI_API_KEY ? new OpenAI({ apiKey: config.OPENAI_API_KEY }) : undefined, config.OPENAI_MODEL, ['indonesia.go.id', 'klhk.go.id', 'bmkg.go.id', 'bnpb.go.id']);
  const bot = createBot(config, air, news, sources);
  app.get('/health', async () => ({ status: 'ok' }));
  app.get('/ready', async (_request, reply) => { try { await prisma.$queryRaw`SELECT 1`; return { status: 'ready' }; } catch { return reply.code(503).send({ status: 'not ready' }); } });
  await app.listen({ port: config.PORT, host: '0.0.0.0' });
  await bot.launch({ dropPendingUpdates: false });
  const sendHourly = async () => { const sample = await air.sample(); const tracked = await air.tracked(); await bot.telegram.sendMessage(config.OWNER_TELEGRAM_USER_ID, hourlyMessage(sample.average, tracked)); };
  startHourlyScheduler(prisma, sendHourly);
  // Send exactly once for the current SGT-aligned hour only when an operator deliberately starts at minute 0.
  if (new Date().getUTCMinutes() === 0) await dispatchOnce(prisma, sendHourly).catch((error) => logger.warn(error, 'initial dispatch skipped'));
  const shutdown = async () => { await bot.stop(); await app.close(); await prisma.$disconnect(); };
  process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
}
main().catch((error) => { logger.fatal(error, 'startup failed'); process.exit(1); });
