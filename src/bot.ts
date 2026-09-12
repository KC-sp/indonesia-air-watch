import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { Markup, Telegraf } from 'telegraf';
import type { Config } from './config.js';
import { ownerOnly } from './auth.js';
import { aqiActionGuidance, dailySummaryMessage, formatReading, formatTrend, hourlyMessage } from './domain/air.js';
import { nearestSupportedLocation, SUPPORTED_LOCATIONS } from './domain/locations.js';
import { errorName, safeErrorMessage } from './errors.js';
import { logger } from './logger.js';
import { AirService } from './services/air-service.js';
import { AirExplanationService } from './services/ai-explainer.js';
import { AlertService } from './services/alert-service.js';
import { DashboardService } from './services/dashboard-service.js';
import { DiagnosticsService } from './services/diagnostics.js';
import { formatNewsItem, OfficialNewsService } from './services/news.js';
import { collectAirReport } from './services/report.js';
import { SourceReviewService } from './services/source-review.js';
import { retryTelegram } from './services/telegram-delivery.js';
import { createTrendGraph } from './services/trend-graph.js';
import { formatObservationTime } from './time.js';

const APP_VERSION = (createRequire(import.meta.url)('../package.json') as { version: string }).version;
const commandArgument = (text: string, command: string) => text.replace(new RegExp(`^/${command}(?:@\\w+)?\\s*`, 'i'), '').trim();
const helpKeyboard = () => Markup.inlineKeyboard([
  [Markup.button.callback('🌤 Check air', 'help:air'), Markup.button.callback('📍 Locations', 'help:locations')],
  [Markup.button.callback('📈 Trends & alerts', 'help:trends'), Markup.button.callback('📰 News & sources', 'help:news')],
  [Markup.button.callback('⚙️ Bot status', 'help:system')],
]);

export function createBot(
  config: Config & { TELEGRAM_BOT_TOKEN: string; OWNER_TELEGRAM_USER_ID: string },
  air: AirService,
  news: OfficialNewsService,
  sources: SourceReviewService,
  diagnostics: DiagnosticsService,
  explainer: AirExplanationService,
  alerts: AlertService,
  dashboard: DashboardService,
) {
  const bot = new Telegraf(config.TELEGRAM_BOT_TOKEN);
  bot.use(ownerOnly(config.OWNER_TELEGRAM_USER_ID));
  bot.catch(async (error, ctx) => {
    const correlationId = randomUUID();
    logger.error({ correlationId, errorName: errorName(error), errorMessage: safeErrorMessage(error) }, 'Telegram command failed');
    await retryTelegram(() => ctx.reply(`Something went wrong while processing that command. Please try again.\nReference: ${correlationId}`)).catch((replyError) => {
      logger.error({ correlationId, errorMessage: safeErrorMessage(replyError) }, 'Telegram error reply failed');
    });
  });
  bot.start((ctx) => ctx.reply('Indonesia Air Watch is ready. This is a private bot. Use /help for commands.'));
  bot.command('help', (ctx) => ctx.reply('What would you like to do?', helpKeyboard()));
  bot.action(/^help:(.+)$/, async (ctx) => {
    const section = ctx.match[1];
    await ctx.answerCbQuery();
    if (section === 'main') return ctx.editMessageText('What would you like to do?', helpKeyboard());
    const descriptions: Record<string, string> = {
      air: '🌤 Check air quality\n\n/status — full report\n/air Jakarta, Jakarta — one city',
      locations: `📍 Manage locations\n\n/nearby — use your Telegram location\n/setregion — choose from buttons\n/addregion Jakarta, Jakarta — add any supported city\n/regions — show saved cities\n/removeregion — remove a city\n\nMaximum: ${config.TRACKED_IQAIR_CITY_LIMIT}`,
      trends: '📈 Trends and smart alerts\n\n/trend Jakarta — text summary\n/trendgraph Jakarta daily — 24-hour graph\n/trendgraph Jakarta weekly — 7-day graph\n/daily — daily summary\n/setalert 150 — enable smart warnings\n/alerts — view warning rules\n/removealert — disable warnings',
      news: '📰 News and official sources\n\n/news air pollution — verified government news\n/sources — find official ISPU candidates\n/explain Jakarta — AI explanation',
      system: '⚙️ Bot status\n\n/dashboard — create or refresh pinned live status\n/dashboardmode hourly — dashboard plus hourly messages\n/dashboardmode quiet — dashboard only\n/diagnostics — check service and scheduler\n/version — app version\n/whoami — owner ID',
    };
    return ctx.editMessageText(descriptions[section] ?? 'Choose a help category.', Markup.inlineKeyboard([[Markup.button.callback('← Back', 'help:main')]]));
  });
  bot.command('whoami', (ctx) => ctx.reply(config.OWNER_TELEGRAM_USER_ID));
  bot.command('version', (ctx) => ctx.reply(`v${APP_VERSION}\nGit: ${process.env.RAILWAY_GIT_COMMIT_SHA ?? process.env.GIT_SHA ?? 'unavailable'}\nEnvironment: ${config.NODE_ENV}\nStarted: ${new Date().toISOString()}`));

  bot.command('status', async (ctx) => {
    const report = await collectAirReport(air);
    await ctx.reply(hourlyMessage(report.sample.average, report.tracked.readings, report.official, report.tracked.unavailable, report.alertSettings.enabled ? report.alertSettings.threshold : undefined));
  });
  bot.command('air', async (ctx) => {
    const query = commandArgument(ctx.message.text, 'air');
    if (!query) return ctx.reply('Usage: /air city, state');
    const [city, ...state] = query.split(',').map((value) => value.trim());
    const result = await air.lookup(city, state.join(', ') || undefined);
    await ctx.reply([result.iqair && formatReading(result.iqair), result.official && formatReading(result.official), !result.iqair && !result.official && 'No current reading is available.'].filter(Boolean).join('\n\n'));
  });
  bot.command('setregion', (ctx) => ctx.reply(`Choose up to ${config.TRACKED_IQAIR_CITY_LIMIT} cities to show separately in hourly updates.`, Markup.inlineKeyboard(SUPPORTED_LOCATIONS.map((location) => [Markup.button.callback(`${location.city}, ${location.state}`, `add:${location.city}|${location.state}`)]))));
  bot.command('nearby', (ctx) => ctx.reply('Tap the button below to privately share your current location. The bot uses it once to choose the nearest supported city and does not save your coordinates.', Markup.keyboard([[Markup.button.locationRequest('📍 Use my location')]]).resize().oneTime()));
  bot.command('addregion', async (ctx) => {
    const query = commandArgument(ctx.message.text, 'addregion');
    const [city, state] = query.split(',').map((value) => value.trim());
    if (!city || !state) return ctx.reply('Usage: /addregion city, state\nExample: /addregion Jakarta, Jakarta');
    const outcome = await air.addTracked({ city, state });
    await ctx.reply(addRegionResult(city, outcome, config.TRACKED_IQAIR_CITY_LIMIT));
  });
  bot.action(/^add:(.+)$/, async (ctx) => {
    const [city, state] = ctx.match[1].split('|');
    const outcome = await air.addTracked({ city, state });
    await ctx.answerCbQuery();
    await ctx.editMessageText(addRegionResult(city, outcome, config.TRACKED_IQAIR_CITY_LIMIT));
  });
  bot.action(/^tracknear:(\d+)$/, async (ctx) => {
    const location = SUPPORTED_LOCATIONS[Number(ctx.match[1])];
    if (!location) return ctx.answerCbQuery('Location is no longer available.');
    const outcome = await air.addTracked(location);
    await ctx.answerCbQuery();
    await ctx.editMessageText(addRegionResult(location.city, outcome, config.TRACKED_IQAIR_CITY_LIMIT));
  });
  bot.command('regions', async (ctx) => {
    const locations = await air.trackedLocations();
    await ctx.reply(locations.length ? locations.map((location) => `${location.city}${location.state ? `, ${location.state}` : ''}`).join('\n') : 'No tracked locations.');
  });
  bot.command('removeregion', async (ctx) => {
    const locations = await air.trackedLocations();
    await ctx.reply(locations.length ? 'Select a location to remove:' : 'No tracked locations.', locations.length ? Markup.inlineKeyboard(locations.map((location) => [Markup.button.callback(location.city, `remove:${location.id}`)])) : undefined);
  });
  bot.action(/^remove:(.+)$/, async (ctx) => { await air.removeTracked(ctx.match[1]); await ctx.answerCbQuery('Removed'); await ctx.editMessageText('Location removed.'); });

  bot.command('setalert', async (ctx) => {
    const threshold = Number(commandArgument(ctx.message.text, 'setalert'));
    if (!Number.isInteger(threshold) || threshold < 1 || threshold > 500) return ctx.reply('Usage: /setalert number (1–500)\nExample: /setalert 150');
    await air.setAlertThreshold(threshold);
    await alerts.reset();
    await ctx.reply(`Smart alerts enabled at ${threshold} US AQI iQAir. You will be notified when a tracked location crosses the threshold, worsens to a higher severity, rises rapidly, or recovers. Repeated unchanged warnings are suppressed.`);
  });
  bot.command('alerts', async (ctx) => {
    const settings = await air.alertSettings();
    await ctx.reply(settings.enabled && settings.threshold ? `Smart alerts are enabled at ${settings.threshold} US AQI iQAir.\nCooldown: ${settings.cooldownMinutes} minutes\nRecovery: 2 readings at or below ${Math.max(0, settings.threshold - settings.hysteresis)}\nRapid rise: ${settings.rapidRise} points within 2 hours` : 'Alerts are disabled. Use /setalert 150 to enable them.');
  });
  bot.command('removealert', async (ctx) => { await air.disableAlerts(); await alerts.reset(); await ctx.reply('Air-quality alerts disabled.'); });

  bot.command('dashboard', async (ctx) => {
    await dashboard.ensure(ctx.telegram, await collectAirReport(air), randomUUID());
    await ctx.reply('Your live status dashboard is ready and pinned. Use its Refresh button whenever you want.');
  });
  bot.command('dashboardmode', async (ctx) => {
    const requested = commandArgument(ctx.message.text, 'dashboardmode').toLowerCase();
    if (requested !== 'hourly' && requested !== 'quiet') return ctx.reply('Usage: /dashboardmode hourly\nor /dashboardmode quiet');
    const mode = requested === 'quiet' ? 'QUIET' : 'HOURLY';
    if (!(await dashboard.setMode(mode))) return ctx.reply('Create your dashboard first with /dashboard.');
    await dashboard.ensure(ctx.telegram, await collectAirReport(air), randomUUID());
    await ctx.reply(mode === 'QUIET' ? 'Dashboard-only mode enabled. The dashboard will refresh hourly without sending a separate hourly message.' : 'Hourly message mode enabled. You will receive the regular top-of-hour message and the dashboard will refresh too.');
  });
  bot.action('dash:refresh', async (ctx) => { await dashboard.ensure(ctx.telegram, await collectAirReport(air), randomUUID()); await ctx.answerCbQuery('Dashboard refreshed'); });
  bot.action('dash:trends', async (ctx) => { await ctx.answerCbQuery(); await ctx.reply('Use /trendgraph City daily or /trendgraph City weekly. Example: /trendgraph Jakarta daily'); });
  bot.action('dash:alerts', async (ctx) => { const settings = await air.alertSettings(); await ctx.answerCbQuery(); await ctx.reply(settings.enabled && settings.threshold ? `Smart alerts are enabled at ${settings.threshold} US AQI. Use /alerts for all rules.` : 'Smart alerts are disabled. Use /setalert 150 to enable them.'); });

  bot.command('trend', async (ctx) => {
    const city = commandArgument(ctx.message.text, 'trend');
    if (!city) return ctx.reply('Usage: /trend city\nExample: /trend Jakarta');
    await ctx.reply(formatTrend(await air.trend(city)));
  });
  bot.command('trendgraph', async (ctx) => {
    const query = commandArgument(ctx.message.text, 'trendgraph');
    const pieces = query.split(/\s+/).filter(Boolean);
    const requestedPeriod = pieces.at(-1)?.toLowerCase();
    const period = requestedPeriod === 'weekly' ? 'weekly' : 'daily';
    if (requestedPeriod === 'weekly' || requestedPeriod === 'daily') pieces.pop();
    const city = pieces.join(' ');
    if (!city) return ctx.reply('Choose a city and period:\n/trendgraph Jakarta daily\n/trendgraph Jakarta weekly');
    const hours = period === 'weekly' ? 168 : 24;
    const [points, trend] = await Promise.all([air.trendSeries(city, hours), air.trend(city, hours)]);
    if (!points.length || trend.latest === undefined) return ctx.reply(`${city} does not have enough stored data yet. Try /air ${city} first, then check again after more readings are collected.`);
    const image = createTrendGraph(points);
    const first = points[0].observedAt;
    const last = points.at(-1)!.observedAt;
    const caption = [`${city} ${period} US AQI iQAir graph`, `Period: ${formatObservationTime(first)} to ${formatObservationTime(last)}`, `Latest ${trend.latest}; average ${trend.average}; low ${trend.minimum}; high ${trend.maximum}`, `Trend: ${trend.direction}`, aqiActionGuidance(trend.latest), 'General activity guidance, not medical advice.', 'Guidance source: https://www.airnow.gov/aqi/aqi-basics/'].join('\n');
    await ctx.replyWithPhoto({ source: image }, { caption });
  });
  bot.command('daily', async (ctx) => ctx.reply(dailySummaryMessage(await air.trackedTrends())));
  bot.command('explain', async (ctx) => {
    const city = commandArgument(ctx.message.text, 'explain');
    if (!city) return ctx.reply('Usage: /explain city\nExample: /explain Jakarta');
    const trend = await air.trend(city);
    if (!trend.count) return ctx.reply(formatTrend(trend));
    const explanation = await explainer.explain(trend);
    await ctx.reply(`${formatTrend(trend)}\n\n${explanation ?? 'AI explanation is unavailable. Check OPENAI_API_KEY and OPENAI_MODEL.'}`);
  });
  bot.command('diagnostics', async (ctx) => ctx.reply(await diagnostics.report()));

  bot.command('news', async (ctx) => { const topic = commandArgument(ctx.message.text, 'news') || 'environment'; const items = await news.latest(topic); await ctx.reply(items.length ? items.map(formatNewsItem).join('\n\n') : 'No verified original official article was found.'); });
  bot.command('sources', async (ctx) => { const candidates = await sources.discover(); await ctx.reply(candidates.length ? candidates.map((candidate) => `${candidate.id}\n${candidate.agency} (${candidate.domain})\n${candidate.metric}; ${candidate.period}; ${candidate.coverage}\n${candidate.recommendation}, confidence ${candidate.confidenceScore}\n${candidate.endpoint}`).join('\n\n') : 'No verified official source was found. Official ISPU currently unavailable.'); });
  bot.command('approvesource', async (ctx) => { const [, id, confirmation] = ctx.message.text.trim().split(/\s+/); if (!id) return ctx.reply('Usage: /approvesource source-id CONFIRM'); const result = await sources.approve(id, confirmation ?? '', config.OWNER_TELEGRAM_USER_ID); await ctx.reply(result === 'approved' ? 'Source approval recorded. Configure its deterministic provider adapter before publishing readings.' : result === 'confirm' ? 'Repeat with /approvesource source-id CONFIRM to record approval.' : 'Source candidate not found.'); });
  bot.on('location', async (ctx) => {
    const nearest = nearestSupportedLocation(ctx.message.location.latitude, ctx.message.location.longitude);
    await ctx.reply('Location received. Your exact coordinates were not saved.', Markup.removeKeyboard());
    if (!nearest) return ctx.reply('I could not understand that location. Please try /nearby again.');
    const result = await air.lookup(nearest.location.city, nearest.location.state);
    const reading = result.iqair ? `\nCurrent reading: ${result.iqair.value} US AQI iQAir (${result.iqair.category})` : '\nA current reading could not be verified right now.';
    await ctx.reply(`Nearest supported city: ${nearest.location.city}, ${nearest.location.state}\nDistance from city centre: ${Math.round(nearest.distanceKm)} km${reading}`, Markup.inlineKeyboard([[Markup.button.callback(`Track ${nearest.location.city}`, `tracknear:${nearest.index}`)]]));
  });
  bot.on('text', (ctx) => ctx.reply('Use /help for commands.'));
  return bot;
}

function addRegionResult(city: string, outcome: Awaited<ReturnType<AirService['addTracked']>>, limit: number): string {
  if (outcome === 'added') return `${city} added and will appear in hourly updates.`;
  if (outcome === 'duplicate') return `${city} is already tracked.`;
  if (outcome === 'limit') return `You can track at most ${limit} iQAir locations.`;
  return `${city} was not added because iQAir could not verify a current reading. Check the city and state spelling, then try again.`;
}
