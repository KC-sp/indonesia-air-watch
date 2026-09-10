import { Markup, Telegraf } from 'telegraf';
import type { Config } from './config.js';
import { ownerOnly } from './auth.js';
import { dailySummaryMessage, formatReading, formatTrend, hourlyMessage } from './domain/air.js';
import { AirService } from './services/air-service.js';
import { AirExplanationService } from './services/ai-explainer.js';
import { DiagnosticsService } from './services/diagnostics.js';
import { formatNewsItem, OfficialNewsService } from './services/news.js';
import { SourceReviewService } from './services/source-review.js';

const TRACKABLE_CITIES = [{ city: 'Jakarta', state: 'Jakarta' }, { city: 'Bogor', state: 'West Java' }, { city: 'Bekasi', state: 'West Java' }, { city: 'Tangerang', state: 'Banten' }, { city: 'Depok', state: 'West Java' }, { city: 'Balikpapan', state: 'East Kalimantan' }];
const commandArgument = (text: string, command: string) => text.replace(new RegExp(`^/${command}(?:@\\w+)?\\s*`, 'i'), '').trim();

export function createBot(
  config: Config & { TELEGRAM_BOT_TOKEN: string; OWNER_TELEGRAM_USER_ID: string },
  air: AirService,
  news: OfficialNewsService,
  sources: SourceReviewService,
  diagnostics: DiagnosticsService,
  explainer: AirExplanationService,
) {
  const bot = new Telegraf(config.TELEGRAM_BOT_TOKEN);
  bot.use(ownerOnly(config.OWNER_TELEGRAM_USER_ID));
  bot.start((ctx) => ctx.reply('Indonesia Air Watch is ready. This is a private bot. Use /help for commands.'));
  bot.command('help', (ctx) => ctx.reply([
    'Air: /status, /air city[, state], /setregion, /addregion city, state, /regions, /removeregion',
    'Alerts: /setalert number, /alerts, /removealert',
    'History: /trend city, /daily, /explain city',
    'System: /diagnostics, /news [topic], /sources, /approvesource source-id CONFIRM, /version, /whoami',
  ].join('\n')));
  bot.command('whoami', (ctx) => ctx.reply(config.OWNER_TELEGRAM_USER_ID));
  bot.command('version', (ctx) => ctx.reply(`v${process.env.npm_package_version ?? '1.0.0'}\nGit: ${process.env.GIT_SHA ?? 'unavailable'}\nEnvironment: ${config.NODE_ENV}\nStarted: ${new Date().toISOString()}`));

  bot.command('status', async (ctx) => {
    const tracked = await air.trackedStatus();
    const sample = await air.sample();
    const settings = await air.alertSettings();
    const official = await air.officialReading('Jakarta');
    await ctx.reply(hourlyMessage(sample.average, tracked.readings, official, tracked.unavailable, settings.enabled ? settings.threshold : undefined));
  });
  bot.command('air', async (ctx) => {
    const query = commandArgument(ctx.message.text, 'air');
    if (!query) return ctx.reply('Usage: /air city, state');
    const [city, ...state] = query.split(',').map((value) => value.trim());
    const result = await air.lookup(city, state.join(', ') || undefined);
    await ctx.reply([result.iqair && formatReading(result.iqair), result.official && formatReading(result.official), !result.iqair && !result.official && 'No current reading is available.'].filter(Boolean).join('\n\n'));
  });
  bot.command('setregion', (ctx) => ctx.reply(`Choose up to ${config.TRACKED_IQAIR_CITY_LIMIT} cities to show separately in hourly updates.`, Markup.inlineKeyboard(TRACKABLE_CITIES.map((location) => [Markup.button.callback(`${location.city}, ${location.state}`, `add:${location.city}|${location.state}`)]))));
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
    await ctx.reply(`Hourly alerts enabled at ${threshold} US AQI iQAir.`);
  });
  bot.command('alerts', async (ctx) => {
    const settings = await air.alertSettings();
    await ctx.reply(settings.enabled && settings.threshold ? `Alerts are enabled at ${settings.threshold} US AQI iQAir.` : 'Alerts are disabled. Use /setalert 150 to enable them.');
  });
  bot.command('removealert', async (ctx) => { await air.disableAlerts(); await ctx.reply('Air-quality alerts disabled.'); });

  bot.command('trend', async (ctx) => {
    const city = commandArgument(ctx.message.text, 'trend');
    if (!city) return ctx.reply('Usage: /trend city\nExample: /trend Jakarta');
    await ctx.reply(formatTrend(await air.trend(city)));
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
  bot.on('text', (ctx) => ctx.reply('Use /help for commands.'));
  return bot;
}

function addRegionResult(city: string, outcome: Awaited<ReturnType<AirService['addTracked']>>, limit: number): string {
  if (outcome === 'added') return `${city} added and will appear in hourly updates.`;
  if (outcome === 'duplicate') return `${city} is already tracked.`;
  if (outcome === 'limit') return `You can track at most ${limit} iQAir locations.`;
  return `${city} was not added because iQAir could not verify a current reading. Check the city and state spelling, then try again.`;
}
