import { randomUUID } from 'node:crypto';
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
import { AlertService } from './services/alert-service.js';
import { DashboardService } from './services/dashboard-service.js';
import { ReliabilityService } from './services/reliability-service.js';
import { collectAirReport } from './services/report.js';
import { sendTelegramMessage } from './services/telegram-delivery.js';
import { createBot } from './bot.js';
import { dailySummaryMessage, hourlyMessage } from './domain/air.js';
import { dispatchDailyOnce, dispatchOnce, startDailyScheduler, startHourlyScheduler } from './scheduler.js';
import { errorName, safeErrorMessage } from './errors.js';

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
  const alerts = new AlertService(prisma);
  const dashboard = new DashboardService(prisma, config.OWNER_TELEGRAM_USER_ID);
  const diagnostics = new DiagnosticsService(prisma, quota, config, startedAt, openai && config.OPENAI_MODEL ? async () => { await openai.models.retrieve(config.OPENAI_MODEL!); } : undefined);
  const bot = createBot(config, air, news, sources, diagnostics, explainer, alerts, dashboard);
  const reliability = new ReliabilityService(prisma, config.OWNER_TELEGRAM_USER_ID);
  let schedulersReady = false;
  app.get('/health', async () => ({ status: 'ok' }));
  app.get('/ready', async (_request, reply) => { try { await prisma.$queryRaw`SELECT 1`; return schedulersReady ? { status: 'ready' } : reply.code(503).send({ status: 'starting' }); } catch { return reply.code(503).send({ status: 'not ready' }); } });
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
        logger.error({ errorName: errorName(error), errorMessage: safeErrorMessage(error) }, 'Telegram polling stopped unexpectedly');
        process.exit(1);
      }
    });
  });
  const sendHourly = async (correlationId: string) => {
    try {
      const report = await collectAirReport(air, true);
      const mode = await dashboard.mode();
      if (mode === 'HOURLY') {
        await sendTelegramMessage(
          prisma,
          bot.telegram,
          config.OWNER_TELEGRAM_USER_ID,
          hourlyMessage(report.sample.average, report.tracked.readings, report.official, report.tracked.unavailable),
          { kind: 'hourly-report', correlationId },
        );
      }

      try {
        await dashboard.refreshIfExists(bot.telegram, report, correlationId);
        await reliability.recovered(bot.telegram, 'dashboard-delivery', correlationId);
      } catch (error) {
        await reliability.failure(bot.telegram, 'dashboard-delivery', `Pinned dashboard could not be refreshed: ${safeErrorMessage(error)}`, correlationId).catch(() => undefined);
        if (mode === 'QUIET') throw error;
      }

      let alertDeliveryFailed = false;
      for (const alert of await alerts.evaluate(report.tracked.readings, report.alertSettings.enabled, report.alertSettings.threshold)) {
        try {
          await sendTelegramMessage(prisma, bot.telegram, config.OWNER_TELEGRAM_USER_ID, alert.message, { kind: 'smart-alert', correlationId });
          await alerts.markSent(alert.id);
        } catch (error) {
          alertDeliveryFailed = true;
          await alerts.markFailed(alert.id, error);
        }
      }
      if (alertDeliveryFailed) await reliability.failure(bot.telegram, 'smart-alert-delivery', 'One or more smart alerts could not be delivered.', correlationId).catch(() => undefined);
      else await reliability.recovered(bot.telegram, 'smart-alert-delivery', correlationId);

      if (report.sample.average.reported === 0) await reliability.failure(bot.telegram, 'iqair-data', 'iQAir returned no national sample readings for this report.', correlationId).catch(() => undefined);
      else await reliability.recovered(bot.telegram, 'iqair-data', correlationId);
      await reliability.recovered(bot.telegram, 'hourly-dispatch', correlationId);
    } catch (error) {
      await reliability.failure(bot.telegram, 'hourly-dispatch', `Hourly report failed: ${safeErrorMessage(error)}`, correlationId).catch(() => undefined);
      throw error;
    }
  };
  startHourlyScheduler(prisma, sendHourly);
  const summaryHour = await air.dailySummaryHour();
  const sendDaily = async (correlationId: string) => {
    try {
      await sendTelegramMessage(prisma, bot.telegram, config.OWNER_TELEGRAM_USER_ID, dailySummaryMessage(await air.trackedTrends()), { kind: 'daily-summary', correlationId });
      await reliability.recovered(bot.telegram, 'daily-dispatch', correlationId);
    } catch (error) {
      await reliability.failure(bot.telegram, 'daily-dispatch', `Daily summary failed: ${safeErrorMessage(error)}`, correlationId).catch(() => undefined);
      throw error;
    }
  };
  startDailyScheduler(prisma, summaryHour, sendDaily);
  schedulersReady = true;
  // Catch up after a deploy or restart without delaying readiness. Unique time buckets prevent duplicates.
  const startupReference = new Date();
  void dispatchOnce(prisma, sendHourly, startupReference)
    .then((sent) => logger.info({ sent }, sent ? 'startup hourly dispatch sent' : 'startup hourly dispatch already handled'))
    .catch((error) => logger.warn({ error: safeErrorMessage(error) }, 'startup hourly dispatch failed'));
  setTimeout(() => {
    void dispatchOnce(prisma, sendHourly, startupReference)
      .then((sent) => { if (sent) logger.info('stale startup hourly dispatch recovered'); })
      .catch((error) => logger.warn({ error: safeErrorMessage(error) }, 'startup hourly recovery failed'));
  }, 10 * 60_000 + 5_000);
  const singaporeHour = (new Date().getUTCHours() + 8) % 24;
  if (singaporeHour >= summaryHour) {
    void dispatchDailyOnce(prisma, sendDaily, startupReference).catch((error) => logger.warn({ error: safeErrorMessage(error) }, 'startup daily summary failed'));
    setTimeout(() => {
      void dispatchDailyOnce(prisma, sendDaily, startupReference)
        .then((sent) => { if (sent) logger.info('stale startup daily dispatch recovered'); })
        .catch((error) => logger.warn({ error: safeErrorMessage(error) }, 'startup daily recovery failed'));
    }, 10 * 60_000 + 5_000);
  }
  const shutdown = async () => { schedulersReady = false; await bot.stop(); await app.close(); await prisma.$disconnect(); };
  process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
}
main().catch((error) => {
  logger.fatal({ correlationId: randomUUID(), errorName: errorName(error), errorMessage: safeErrorMessage(error) }, 'startup failed');
  process.exit(1);
});
