import { createHash, randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { Markup, type Telegram } from 'telegraf';
import { safeErrorMessage } from '../errors.js';
import { formatObservationTime } from '../time.js';
import { usAqiCategory } from '../domain/air.js';
import type { AirReportSnapshot } from './report.js';
import { editTelegramMessage, pinTelegramMessage, sendTelegramMessage } from './telegram-delivery.js';

export type DashboardMode = 'HOURLY' | 'QUIET';

export class DashboardService {
  constructor(private readonly db: PrismaClient, private readonly ownerId: string) {}

  async mode(): Promise<DashboardMode> {
    const dashboard = await this.db.dashboardMessage.findUnique({ where: { id: 1 } });
    return dashboard?.mode === 'QUIET' ? 'QUIET' : 'HOURLY';
  }

  async setMode(mode: DashboardMode): Promise<boolean> {
    const result = await this.db.dashboardMessage.updateMany({ where: { id: 1 }, data: { mode } });
    return result.count === 1;
  }

  async ensure(telegram: Telegram, snapshot: AirReportSnapshot, correlationId: string = randomUUID()) {
    const current = await this.db.dashboardMessage.findUnique({ where: { id: 1 } });
    const text = renderDashboard(snapshot, current?.mode === 'QUIET' ? 'QUIET' : 'HOURLY');
    const hash = createHash('sha256').update(text).digest('hex');
    const buttons = dashboardKeyboard();

    if (!current) return this.create(telegram, text, hash, correlationId, 'HOURLY');
    try {
      if (current.lastRenderedHash !== hash) {
        await editTelegramMessage(this.db, telegram, current.chatId, current.messageId, text, { kind: 'dashboard-edit', correlationId }, { reply_markup: buttons.reply_markup });
      }
      await this.db.dashboardMessage.update({ where: { id: 1 }, data: { lastRenderedHash: hash, lastUpdatedAt: snapshot.generatedAt, lastError: null } });
      if (!current.pinnedAt) await this.pin(telegram, current.chatId, current.messageId, correlationId);
      return current;
    } catch (error) {
      await this.db.dashboardMessage.update({ where: { id: 1 }, data: { lastError: safeErrorMessage(error) } }).catch(() => undefined);
      if (isMissingMessage(error)) return this.create(telegram, text, hash, correlationId, current.mode === 'QUIET' ? 'QUIET' : 'HOURLY');
      throw error;
    }
  }

  async refreshIfExists(telegram: Telegram, snapshot: AirReportSnapshot, correlationId: string): Promise<boolean> {
    if (!(await this.db.dashboardMessage.findUnique({ where: { id: 1 }, select: { id: true } }))) return false;
    await this.ensure(telegram, snapshot, correlationId);
    return true;
  }

  private async create(telegram: Telegram, text: string, hash: string, correlationId: string, mode: DashboardMode) {
    const message = await sendTelegramMessage(this.db, telegram, this.ownerId, text, { kind: 'dashboard-create', correlationId }, { reply_markup: dashboardKeyboard().reply_markup });
    const record = await this.db.dashboardMessage.upsert({
      where: { id: 1 },
      create: { id: 1, chatId: this.ownerId, messageId: message.message_id, mode, lastRenderedHash: hash, lastUpdatedAt: new Date(), lastError: null },
      update: { chatId: this.ownerId, messageId: message.message_id, mode, lastRenderedHash: hash, lastUpdatedAt: new Date(), pinnedAt: null, lastError: null },
    });
    await this.pin(telegram, record.chatId, record.messageId, correlationId);
    return record;
  }

  private async pin(telegram: Telegram, chatId: string, messageId: number, correlationId: string): Promise<void> {
    await pinTelegramMessage(this.db, telegram, chatId, messageId, { kind: 'dashboard-pin', correlationId }, { disable_notification: true });
    await this.db.dashboardMessage.update({ where: { id: 1 }, data: { pinnedAt: new Date(), lastError: null } });
  }
}

export function renderDashboard(snapshot: AirReportSnapshot, mode: DashboardMode): string {
  const average = snapshot.sample.average;
  const headline = average.value === undefined ? 'National sample unavailable' : `${average.value} US AQI iQAir — ${usAqiCategory(average.value)}`;
  const tracked = snapshot.tracked.readings.length
    ? snapshot.tracked.readings.map((reading) => `${reading.city}: ${reading.value} (${reading.category ?? usAqiCategory(reading.value)})`).join('\n')
    : 'No tracked readings available.';
  const unavailable = snapshot.tracked.unavailable.length
    ? `\nUnavailable: ${snapshot.tracked.unavailable.map((location) => location.city).join(', ')}`
    : '';
  const alerts = snapshot.alertSettings.enabled && snapshot.alertSettings.threshold
    ? `Enabled at ${snapshot.alertSettings.threshold}`
    : 'Disabled';
  return [
    'INDONESIA AIR WATCH • LIVE STATUS',
    '',
    headline,
    `Coverage: ${average.reported}/${average.expected} sample cities`,
    `Updated: ${formatObservationTime(snapshot.generatedAt)}`,
    '',
    'Tracked locations',
    `${tracked}${unavailable}`,
    '',
    `Smart alerts: ${alerts}`,
    `Hourly messages: ${mode === 'QUIET' ? 'Dashboard only' : 'Enabled'}`,
    `Official ISPU: ${snapshot.official ? 'Available' : 'Unavailable'}`,
    '',
    'Values are US AQI iQAir unless explicitly labelled official ISPU.',
  ].join('\n');
}

function dashboardKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('↻ Refresh', 'dash:refresh'), Markup.button.callback('📈 Trends', 'dash:trends')],
    [Markup.button.callback('📍 Locations', 'help:locations'), Markup.button.callback('⚠️ Alerts', 'dash:alerts')],
  ]);
}

function isMissingMessage(error: unknown): boolean {
  const message = safeErrorMessage(error).toLowerCase();
  return message.includes('message to edit not found') || message.includes("message can't be edited") || message.includes('message_id_invalid');
}
