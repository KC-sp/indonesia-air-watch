import { Telegraf, Markup } from 'telegraf';
import type { Config } from './config.js';
import { ownerOnly } from './auth.js';
import { formatReading, hourlyMessage } from './domain/air.js';
import { AirService } from './services/air-service.js';
import { OfficialNewsService } from './services/news.js';
import { SourceReviewService } from './services/source-review.js';

const TRACKABLE_CITIES = [{ city: 'Jakarta', state: 'Jakarta' }, { city: 'Bogor', state: 'West Java' }, { city: 'Bekasi', state: 'West Java' }, { city: 'Tangerang', state: 'Banten' }, { city: 'Depok', state: 'West Java' }, { city: 'Balikpapan', state: 'East Kalimantan' }];
export function createBot(config: Config & { TELEGRAM_BOT_TOKEN: string; OWNER_TELEGRAM_USER_ID: string }, air: AirService, news: OfficialNewsService, sources: SourceReviewService) {
  const bot = new Telegraf(config.TELEGRAM_BOT_TOKEN);
  bot.use(ownerOnly(config.OWNER_TELEGRAM_USER_ID));
  bot.start((ctx) => ctx.reply('Indonesia Air Watch is ready. This is a private bot. Use /help for commands.'));
  bot.command('help', (ctx) => ctx.reply('/status /air city /setregion /regions /removeregion /news [topic] /sources /approvesource source-id /version /whoami'));
  bot.command('whoami', (ctx) => ctx.reply(config.OWNER_TELEGRAM_USER_ID));
  bot.command('version', (ctx) => ctx.reply(`v${process.env.npm_package_version ?? '1.0.0'}\nGit: ${process.env.GIT_SHA ?? 'unavailable'}\nEnvironment: ${config.NODE_ENV}\nStarted: ${new Date().toISOString()}`));
  bot.command('status', async (ctx) => { const sample = await air.sample(); const tracked = await air.tracked(); await ctx.reply(hourlyMessage(sample.average, tracked)); });
  bot.command('air', async (ctx) => { const query = ctx.message.text.replace(/^\/air(?:@\w+)?\s*/i, '').trim(); if (!query) return ctx.reply('Usage: /air city or region'); const [city, ...state] = query.split(',').map((x) => x.trim()); const result = await air.lookup(city, state.join(', ') || undefined); await ctx.reply([result.iqair && formatReading(result.iqair), result.official && formatReading(result.official), !result.iqair && !result.official && 'No current reading is available.'].filter(Boolean).join('\n\n')); });
  bot.command('setregion', (ctx) => ctx.reply('Choose up to three cities to show separately in hourly updates.', Markup.inlineKeyboard(TRACKABLE_CITIES.map((x) => [Markup.button.callback(`${x.city}, ${x.state}`, `add:${x.city}|${x.state}`)]))));
  bot.action(/^add:(.+)$/, async (ctx) => { const [city, state] = ctx.match[1].split('|'); const outcome = await air.addTracked({ city, state }); await ctx.answerCbQuery(); await ctx.editMessageText(outcome === 'added' ? `${city} added.` : outcome === 'duplicate' ? `${city} is already included.` : 'You can track at most three iQAir locations.'); });
  bot.command('regions', async (ctx) => { const locations = await air.tracked(); await ctx.reply(locations.length ? locations.map((r) => `${r.city}${r.state ? `, ${r.state}` : ''}`).join('\n') : 'No tracked locations.'); });
  bot.command('removeregion', async (ctx) => { const locations = await air.trackedLocations(); await ctx.reply(locations.length ? 'Select a location to remove:' : 'No tracked locations.', locations.length ? Markup.inlineKeyboard(locations.map((x) => [Markup.button.callback(x.city, `remove:${x.id}`)])) : undefined); });
  bot.action(/^remove:(.+)$/, async (ctx) => { await air.removeTracked(ctx.match[1]); await ctx.answerCbQuery('Removed'); await ctx.editMessageText('Location removed.'); });
  bot.command('news', async (ctx) => { const topic = ctx.message.text.replace(/^\/news(?:@\w+)?\s*/i, '').trim() || 'environment'; const items = await news.latest(topic); await ctx.reply(items.length ? items.map((x) => `${x.title} (${x.date})\n${x.summary}\n${x.url}`).join('\n\n') : 'No verified official source was found.'); });
  bot.command('sources', async (ctx) => { const candidates = await sources.discover(); await ctx.reply(candidates.length ? candidates.map((x) => `${x.id}\n${x.agency} (${x.domain})\n${x.metric}; ${x.period}; ${x.coverage}\n${x.recommendation}, confidence ${x.confidenceScore}\n${x.endpoint}`).join('\n\n') : 'No verified official source was found. Official ISPU currently unavailable.'); });
  bot.command('approvesource', async (ctx) => { const [, id, confirmation] = ctx.message.text.trim().split(/\s+/); if (!id) return ctx.reply('Usage: /approvesource source-id CONFIRM'); const result = await sources.approve(id, confirmation ?? '', config.OWNER_TELEGRAM_USER_ID); await ctx.reply(result === 'approved' ? 'Source approval recorded. A deterministic provider adapter must still be configured before readings can be published.' : result === 'confirm' ? 'Repeat with /approvesource source-id CONFIRM to record approval.' : 'Source candidate not found.'); });
  bot.on('text', (ctx) => ctx.reply('Use /help for commands.'));
  return bot;
}
