import type { PrismaClient } from '@prisma/client';
import type { Config } from '../config.js';
import { safeErrorMessage } from '../errors.js';
import { formatSingaporeTime, nextUtcHour } from '../time.js';
import { IqAirQuota } from './quota.js';

export class DiagnosticsService {
  constructor(
    private readonly db: PrismaClient,
    private readonly quota: IqAirQuota,
    private readonly config: Config,
    private readonly startedAt: Date,
    private readonly openAiProbe?: () => Promise<void>,
  ) {}

  async report(now = new Date()): Promise<string> {
    let database = 'Connected';
    try { await this.db.$queryRaw`SELECT 1`; } catch { database = 'Unavailable'; }
    const [lastHourly, lastDaily, provider, tracked, usage, observations, lastDeliveryFailure, openIncidents, dashboard, openAiStatus] = await Promise.all([
      this.db.hourlyDispatch.findFirst({ orderBy: { hourBucket: 'desc' } }).catch(() => undefined),
      this.db.dailyDispatch.findFirst({ orderBy: { dayBucket: 'desc' } }).catch(() => undefined),
      this.db.providerHealth.findUnique({ where: { provider: 'iqair' } }).catch(() => undefined),
      this.db.trackedLocation.count({ where: { provider: 'iqair' } }).catch(() => 0),
      this.quota.usage(now).catch(() => ({ minute: 0, daily: 0 })),
      this.db.airObservation.count({ where: { observedAt: { gte: new Date(now.getTime() - 24 * 3_600_000) } } }).catch(() => 0),
      this.db.deliveryAttempt.findFirst({ where: { status: 'FAILED' }, orderBy: { createdAt: 'desc' } }).catch(() => undefined),
      this.db.serviceIncident.count({ where: { status: 'OPEN' } }).catch(() => 0),
      this.db.dashboardMessage.findUnique({ where: { id: 1 } }).catch(() => undefined),
      this.openAiHealth(),
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
      `Pinned dashboard: ${dashboard ? `${dashboard.mode === 'QUIET' ? 'Dashboard only' : 'Hourly messages'} — last updated ${dashboard.lastUpdatedAt ? formatSingaporeTime(dashboard.lastUpdatedAt) : 'never'}` : 'Not created'}`,
      `Delivery health: ${lastDeliveryFailure ? `Last failure ${formatSingaporeTime(lastDeliveryFailure.createdAt)} (${lastDeliveryFailure.kind})` : 'No recorded failures'}`,
      `Open incidents: ${openIncidents}`,
      `OpenAI features: ${openAiStatus}`,
      `Official ISPU: ${this.config.OFFICIAL_ISPU_API_URL && this.config.OFFICIAL_ISPU_AGENCY ? 'Configured' : 'Disabled pending approved endpoint'}`,
    ].join('\n');
  }

  private async openAiHealth(): Promise<string> {
    if (!this.config.OPENAI_API_KEY || !this.config.OPENAI_MODEL) return 'Disabled';
    if (!this.openAiProbe) return 'Configured but not actively verified';
    try {
      await this.openAiProbe();
      return `Verified (${this.config.OPENAI_MODEL})`;
    } catch (error) {
      return `${classifyOpenAiError(error)} — ${safeErrorMessage(error, 120)}`;
    }
  }
}

export function classifyOpenAiError(error: unknown): string {
  const details = typeof error === 'object' && error !== null ? error as Record<string, unknown> : {};
  const status = typeof details.status === 'number' ? details.status : undefined;
  const code = String(details.code ?? '').toLowerCase();
  if (status === 401 || code.includes('invalid_api_key')) return 'Authentication failed';
  if (status === 404 || code.includes('model_not_found')) return 'Model unavailable';
  if (status === 429 || code.includes('quota')) return 'Quota or rate limit reached';
  if (status !== undefined && status >= 500) return 'OpenAI service unavailable';
  return 'Verification failed';
}
