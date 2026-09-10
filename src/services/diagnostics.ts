import type { PrismaClient } from '@prisma/client';
import type { Config } from '../config.js';
import { formatSingaporeTime, nextUtcHour } from '../time.js';
import { IqAirQuota } from './quota.js';

export class DiagnosticsService {
  constructor(private readonly db: PrismaClient, private readonly quota: IqAirQuota, private readonly config: Config, private readonly startedAt: Date) {}

  async report(now = new Date()): Promise<string> {
    let database = 'Connected';
    try { await this.db.$queryRaw`SELECT 1`; } catch { database = 'Unavailable'; }
    const [lastHourly, lastDaily, provider, tracked, usage, observations] = await Promise.all([
      this.db.hourlyDispatch.findFirst({ orderBy: { hourBucket: 'desc' } }).catch(() => undefined),
      this.db.dailyDispatch.findFirst({ orderBy: { dayBucket: 'desc' } }).catch(() => undefined),
      this.db.providerHealth.findUnique({ where: { provider: 'iqair' } }).catch(() => undefined),
      this.db.trackedLocation.count({ where: { provider: 'iqair' } }).catch(() => 0),
      this.quota.usage(now).catch(() => ({ minute: 0, daily: 0 })),
      this.db.airObservation.count({ where: { observedAt: { gte: new Date(now.getTime() - 24 * 3_600_000) } } }).catch(() => 0),
    ]);
    const lastHourlyText = lastHourly ? `${lastHourly.status} — ${formatSingaporeTime(lastHourly.hourBucket)}` : 'None recorded';
    const lastDailyText = lastDaily ? `${lastDaily.status} — ${formatSingaporeTime(lastDaily.dayBucket)}` : 'None recorded';
    return [
      'Indonesia Air Watch diagnostics',
      `Service: Online since ${formatSingaporeTime(this.startedAt)}`,
      `Database: ${database}`,
      `iQAir configuration: ${this.config.IQAIR_API_KEY ? 'Configured' : 'Missing key'}`,
      `iQAir health: ${provider?.state ?? 'UNKNOWN'}`,
      `iQAir quota: ${usage.minute}/5 this minute; ${usage.daily}/400 today`,
      `Tracked locations: ${tracked}/${this.config.TRACKED_IQAIR_CITY_LIMIT}`,
      `Observations stored (24h): ${observations}`,
      `Last hourly dispatch: ${lastHourlyText}`,
      `Next hourly dispatch: ${formatSingaporeTime(nextUtcHour(now))}`,
      `Last daily summary: ${lastDailyText}`,
      `OpenAI features: ${this.config.OPENAI_API_KEY && this.config.OPENAI_MODEL ? 'Configured' : 'Disabled'}`,
      `Official ISPU: ${this.config.OFFICIAL_ISPU_API_URL && this.config.OFFICIAL_ISPU_AGENCY ? 'Configured' : 'Disabled pending approved endpoint'}`,
    ].join('\n');
  }
}
