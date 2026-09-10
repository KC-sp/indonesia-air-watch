import Fastify from 'fastify';
import OpenAI from 'openai';
import { loadConfig, requireRuntimeConfig } from './config.js';
import { prisma } from './db.js';
import { logger } from './logger.js';
import { IqAirQuota } from './services/quota.js';
import { prismaQuotaStore } from './services/prisma-quota.js';
import { IqAirProvider } from './providers/iqair.js';
import { GovernmentJsonIspuProvider, UnavailableOfficialIspuProvider } from './providers/official.js';
import { AirService } from './services/air-service.js';
import { OfficialNewsService } from './services/news.js';
import { SourceReviewService } from './services/source-review.js';
import { AirExplanationService } from './services/ai-explainer.js';
import { DiagnosticsService } from './services/diagnostics.js';
import { createBot } from './bot.js';
import { dailySummaryMessage, hourlyMessage } from './domain/air.js';
import { dispatchDailyOnce, dispatchOnce, startDailyScheduler, startHourlyScheduler } from './scheduler.js';

async function main() {
  const startedAt = new Date();
  const config = loadConfig();
  requireRuntimeConfig(config);
  const app = Fastify({ loggerInstance: logger });
  const quota = new IqAirQuota(prismaQuotaStore);
  const iqair = new IqAirProvider(config.IQAIR_API_KEY, quota);
  const official = config.OFFICIAL_ISPU_API_URL && config.OFFICIAL_ISPU_AGENCY ? new GovernmentJsonIspuProvider(config.OFFICIAL_ISPU_API_URL, config.OFFICIAL_ISPU_AGENCY) : new UnavailableOfficialIspuProvider();
  const air = new AirService(prisma, iqair, official, config.NATIONAL_SAMPLE_CITY_LIMIT, config.TRACKED_IQAIR_CITY_LIMIT);
  const openai = config.OPENAI_API_KEY ? new OpenAI({ apiKey: config.OPENAI_API_KEY }) : undefined;
  const officialDomains = ['indonesia.go.id', 'kemenlh.go.id', 'menlhk.go.id', 'klhk.go.id', 'bmkg.go.id', 'bnpb.go.id', 'data.go.id', 'jakarta.go.id'];
  const news = new OfficialNewsService(openai, config.OPENAI_MODEL, officialDomains);
  const sources = new SourceReviewService(prisma, openai, config.OPENAI_MODEL, officialDomains);
  const explainer = new AirExplanationService(openai, config.OPENAI_MODEL);
  const diagnostics = new DiagnosticsService(prisma, quota, config, startedAt);
  const bot = createBot(config, air, news, sources, diagnostics, explainer);
  app.get('/health', async () => ({ status: 'ok' }));
  app.get('/ready', async (_request, reply) => { try { await prisma.$queryRaw`SELECT 1`; return { status: 'ready' }; } catch { return reply.code(503).send({ status: 'not ready' }); } });
  await app.listen({ port: config.PORT, host: '0.0.0.0' });
  // Telegraf's polling promise stays pending for the lifetime of the bot. Wait only
  // for its launch callback so the schedulers below can start while polling runs.
  let pollingStarted = false;
  await new Promise<void>((resolve, reject) => {
    void bot.launch({ dropPendingUpdates: false }, () => {
      pollingStarted = true;
      resolve();
    }).catch((error) => {
      if (!pollingStarted) reject(error);
      else {
        logger.error(safeErrorDetails(error), 'Telegram polling stopped unexpectedly');
        process.exit(1);
      }
    });
  });
  const sendHourly = async () => {
    const tracked = await air.trackedStatus(true);
    const sample = await air.sample(true);
    const settings = await air.alertSettings();
    const officialReading = await air.officialReading('Jakarta');
    await bot.telegram.sendMessage(config.OWNER_TELEGRAM_USER_ID, hourlyMessage(sample.average, tracked.readings, officialReading, tracked.unavailable, settings.enabled ? settings.threshold : undefined));
  };
  startHourlyScheduler(prisma, sendHourly);
  // Catch up after a deploy or restart. The hour-bucket constraint prevents duplicate messages.
  await dispatchOnce(prisma, sendHourly)
    .then((sent) => logger.info({ sent }, sent ? 'startup hourly dispatch sent' : 'startup hourly dispatch already handled'))
    .catch((error) => logger.warn(error, 'startup hourly dispatch failed'));
  const summaryHour = await air.dailySummaryHour();
  const sendDaily = async () => { await bot.telegram.sendMessage(config.OWNER_TELEGRAM_USER_ID, dailySummaryMessage(await air.trackedTrends())); };
  startDailyScheduler(prisma, summaryHour, sendDaily);
  const singaporeHour = (new Date().getUTCHours() + 8) % 24;
  if (singaporeHour >= summaryHour) await dispatchDailyOnce(prisma, sendDaily).catch((error) => logger.warn(error, 'startup daily summary failed'));
  const shutdown = async () => { await bot.stop(); await app.close(); await prisma.$disconnect(); };
  process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
}
main().catch((error) => {
  logger.fatal(safeErrorDetails(error), 'startup failed');
  process.exit(1);
});

function safeErrorDetails(error: unknown) {
  const rawMessage = error instanceof Error ? error.message : String(error);
  const secrets = [process.env.TELEGRAM_BOT_TOKEN, process.env.IQAIR_API_KEY, process.env.OPENAI_API_KEY].filter((value): value is string => Boolean(value));
  const errorMessage = secrets.reduce((message, secret) => message.replaceAll(secret, '[REDACTED]'), rawMessage);
  return { errorName: error instanceof Error ? error.name : 'UnknownError', errorMessage };
}
