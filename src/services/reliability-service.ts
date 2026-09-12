import type { PrismaClient } from '@prisma/client';
import type { Telegram } from 'telegraf';
import { safeErrorMessage } from '../errors.js';
import { sendTelegramMessage } from './telegram-delivery.js';

export class ReliabilityService {
  constructor(private readonly db: PrismaClient, private readonly ownerId: string) {}

  async failure(telegram: Telegram, key: string, summary: string, correlationId: string): Promise<void> {
    const safeSummary = safeErrorMessage(summary, 300);
    const current = await this.db.serviceIncident.findUnique({ where: { key } });
    const incident = !current || current.status === 'RECOVERED'
      ? await this.db.serviceIncident.upsert({
        where: { key },
        create: { key, summary: safeSummary, correlationId },
        update: { status: 'OPEN', summary: safeSummary, correlationId, firstSeenAt: new Date(), lastSeenAt: new Date(), notifiedAt: null, recoveredAt: null, recoveryNotifiedAt: null },
      })
      : await this.db.serviceIncident.update({ where: { key }, data: { summary: safeSummary, correlationId, lastSeenAt: new Date() } });
    if (incident.notifiedAt) return;
    await sendTelegramMessage(this.db, telegram, this.ownerId, `⚠️ Indonesia Air Watch service issue\n\n${safeSummary}\n\nIncident: ${key}\nThe bot will retry automatically.`, { kind: 'incident-open', correlationId });
    await this.db.serviceIncident.update({ where: { key }, data: { notifiedAt: new Date() } });
  }

  async recovered(telegram: Telegram, key: string, correlationId: string): Promise<void> {
    const changed = await this.db.serviceIncident.updateMany({ where: { key, status: 'OPEN' }, data: { status: 'RECOVERED', recoveredAt: new Date(), correlationId } });
    if (!changed.count) return;
    const incident = await this.db.serviceIncident.findUnique({ where: { key } });
    if (!incident?.notifiedAt || incident.recoveryNotifiedAt) return;
    await sendTelegramMessage(this.db, telegram, this.ownerId, `✅ Indonesia Air Watch recovered\n\n${incident.summary}\n\nIncident: ${key}`, { kind: 'incident-recovery', correlationId });
    await this.db.serviceIncident.update({ where: { key }, data: { recoveryNotifiedAt: new Date() } });
  }
}
