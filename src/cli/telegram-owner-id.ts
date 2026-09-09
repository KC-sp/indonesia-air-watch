/** Safe helper: receives updates directly from Telegram and prints only the sender's numeric user id. */
import { existsSync } from 'node:fs';

if (existsSync('.env')) process.loadEnvFile('.env');
const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error('TELEGRAM_BOT_TOKEN is required');
let offset = 0;
console.log('Message the bot, then wait for your numeric Telegram user ID. Press Ctrl+C to exit.');
for (;;) {
  const response = await fetch(`https://api.telegram.org/bot${token}/getUpdates?timeout=25&offset=${offset}`, { signal: AbortSignal.timeout(30_000) });
  const body = await response.json() as { ok: boolean; result?: { update_id: number; message?: { from?: { id: number } } }[] };
  if (!body.ok) throw new Error('Telegram rejected getUpdates');
  for (const update of body.result ?? []) { offset = update.update_id + 1; if (update.message?.from?.id) console.log(update.message.from.id); }
}
