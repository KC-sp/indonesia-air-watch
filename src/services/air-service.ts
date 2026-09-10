import type { PrismaClient } from '@prisma/client';
import { calculateSampleAverage, DEFAULT_SAMPLE, type City, type Reading } from '../domain/air.js';
import { IqAirProvider } from '../providers/iqair.js';
import type { OfficialIspuProvider } from '../providers/official.js';

type TrackedLocationRecord = {
  id: string;
  provider: string;
  city: string;
  state: string | null;
  country: string;
  stationId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type TrackedAirStatus = { readings: Reading[]; unavailable: City[] };
export type TrendSummary = { city: string; hours: number; count: number; minimum?: number; maximum?: number; average?: number; latest?: number; direction: 'improving' | 'worsening' | 'steady' | 'unavailable' };
export type TrendPoint = { observedAt: Date; value: number };

export class AirService {
  constructor(private readonly db: PrismaClient, private readonly iqair: IqAirProvider, private readonly official: OfficialIspuProvider, private readonly sampleLimit: number, private readonly trackedLimit = 3) {}

  async sample(waitForQuota = false): Promise<{ readings: Reading[]; average: ReturnType<typeof calculateSampleAverage> }> {
    const locations = await this.nationalSample();
    const results = waitForQuota
      ? await this.collectSequentially(locations)
      : await Promise.all(locations.map((city) => this.currentIqAir(city)));
    const readings = results.filter((r): r is Reading => Boolean(r));
    return { readings, average: calculateSampleAverage(readings, locations.length) };
  }

  async lookup(city: string, state?: string): Promise<{ iqair?: Reading; official?: Reading }> {
    const iqair = await this.currentIqAir({ city, state: state ?? '' });
    const official = await this.official.getCurrent(city);
    return { iqair, official };
  }

  async tracked(): Promise<Reading[]> {
    return (await this.trackedStatus()).readings;
  }

  async trackedStatus(waitForQuota = false): Promise<TrackedAirStatus> {
    const locations: TrackedLocationRecord[] = await this.db.trackedLocation.findMany({ orderBy: { createdAt: 'asc' } });
    const iqairLocations = locations.filter((x) => x.provider === 'iqair');
    const cities = iqairLocations.map((x) => ({ city: x.city, state: x.state ?? '' }));
    const readings = waitForQuota ? await this.collectSequentially(cities) : await Promise.all(cities.map((city) => this.currentIqAir(city)));
    return iqairLocations.reduce<TrackedAirStatus>((status, location, index) => {
      const reading = readings[index];
      if (reading) status.readings.push(reading);
      else status.unavailable.push({ city: location.city, state: location.state ?? '' });
      return status;
    }, { readings: [], unavailable: [] });
  }

  async trackedLocations(): Promise<TrackedLocationRecord[]> { return this.db.trackedLocation.findMany({ where: { provider: 'iqair' }, orderBy: { createdAt: 'asc' } }); }

  async addTracked(city: City): Promise<'added' | 'duplicate' | 'limit' | 'unavailable'> {
    const existing: TrackedLocationRecord[] = await this.db.trackedLocation.findMany({ where: { provider: 'iqair' } });
    if (existing.some((x) => x.city.toLowerCase() === city.city.toLowerCase())) return 'duplicate';
    if (existing.length >= this.trackedLimit) return 'limit';
    if (!(await this.currentIqAir(city, true))) return 'unavailable';
    await this.db.trackedLocation.create({ data: { provider: 'iqair', city: city.city, state: city.state } });
    return 'added';
  }

  async removeTracked(id: string): Promise<void> { await this.db.trackedLocation.delete({ where: { id } }).catch(() => undefined); }

  async alertSettings(): Promise<{ enabled: boolean; threshold?: number }> {
    const settings = await this.settings();
    return { enabled: settings.alertsEnabled, threshold: settings.alertThreshold ?? undefined };
  }

  async setAlertThreshold(threshold: number): Promise<void> {
    await this.db.userSettings.upsert({ where: { id: 1 }, create: { id: 1, alertThreshold: threshold, alertsEnabled: true }, update: { alertThreshold: threshold, alertsEnabled: true } });
  }

  async disableAlerts(): Promise<void> {
    await this.db.userSettings.upsert({ where: { id: 1 }, create: { id: 1, alertsEnabled: false }, update: { alertsEnabled: false } });
  }

  async dailySummaryHour(): Promise<number> {
    return (await this.settings()).dailySummaryHour;
  }

  async trend(city: string, hours = 24): Promise<TrendSummary> {
    const observations = await this.trendSeries(city, hours);
    if (!observations.length) return { city, hours, count: 0, direction: 'unavailable' };
    const values = observations.map((item) => item.value);
    const change = values.at(-1)! - values[0];
    return { city, hours, count: values.length, minimum: Math.min(...values), maximum: Math.max(...values), average: Math.round(values.reduce((sum, value) => sum + value, 0) / values.length), latest: values.at(-1), direction: change <= -5 ? 'improving' : change >= 5 ? 'worsening' : 'steady' };
  }

  async trendSeries(city: string, hours = 24): Promise<TrendPoint[]> {
    const since = new Date(Date.now() - hours * 3_600_000);
    return this.db.airObservation.findMany({ where: { provider: 'iqair', city: { equals: city, mode: 'insensitive' }, observedAt: { gte: since } }, orderBy: { observedAt: 'asc' }, select: { observedAt: true, value: true } });
  }

  async trackedTrends(hours = 24): Promise<TrendSummary[]> {
    const locations = await this.trackedLocations();
    return Promise.all(locations.map((location) => this.trend(location.city, hours)));
  }

  async officialReading(city: string): Promise<Reading | undefined> {
    const reading = await this.official.getCurrent(city);
    if (!reading) return undefined;
    await this.db.airObservation.upsert({ where: { provider_providerId_metric_observedAt: { provider: 'official-ispu', providerId: `${reading.city}:${reading.station ?? ''}`, metric: reading.metric, observedAt: reading.observedAt } }, create: { provider: 'official-ispu', providerId: `${reading.city}:${reading.station ?? ''}`, kind: 'OFFICIAL_ISPU', metric: reading.metric, value: reading.value, category: reading.category, period: reading.period, city: reading.city, station: reading.station, sourceUrl: reading.sourceUrl, observedAt: reading.observedAt, metadata: reading.sourceName ? { sourceName: reading.sourceName } : undefined }, update: { value: reading.value, category: reading.category, fetchedAt: reading.fetchedAt, sourceUrl: reading.sourceUrl } });
    return reading;
  }

  private async nationalSample(): Promise<City[]> {
    const settings = await this.db.userSettings.upsert({ where: { id: 1 }, create: { id: 1, nationalSample: DEFAULT_SAMPLE.slice(0, this.sampleLimit) }, update: {} });
    const value = settings.nationalSample as unknown;
    return Array.isArray(value) && value.length ? (value as City[]).slice(0, this.sampleLimit) : DEFAULT_SAMPLE.slice(0, this.sampleLimit);
  }

  private async currentIqAir(city: City, waitForQuota = false): Promise<Reading | undefined> {
    const cached = await this.db.airObservation.findFirst({ where: { provider: 'iqair', city: city.city, fetchedAt: { gte: new Date(Date.now() - 15 * 60_000) } }, orderBy: { fetchedAt: 'desc' } });
    if (cached) return { provider: 'iqair', metric: cached.metric, value: cached.value, category: cached.category ?? undefined, city: cached.city, state: cached.region ?? undefined, sourceUrl: cached.sourceUrl, observedAt: cached.observedAt, fetchedAt: cached.fetchedAt };
    const result = await this.iqair.getCurrent(city, waitForQuota);
    if (!result) { await this.recordProviderHealth(false); return undefined; }
    await this.recordProviderHealth(true);
    await this.db.airObservation.upsert({ where: { provider_providerId_metric_observedAt: { provider: 'iqair', providerId: `${result.city}:${result.state ?? ''}`, metric: result.metric, observedAt: result.observedAt } }, create: { provider: 'iqair', providerId: `${result.city}:${result.state ?? ''}`, kind: 'IQAIR', metric: result.metric, value: result.value, category: result.category, city: result.city, region: result.state, sourceUrl: result.sourceUrl, observedAt: result.observedAt }, update: { value: result.value, category: result.category, fetchedAt: result.fetchedAt, sourceUrl: result.sourceUrl } });
    return result;
  }

  private async collectSequentially(cities: City[]): Promise<(Reading | undefined)[]> {
    const readings: (Reading | undefined)[] = [];
    for (const city of cities) readings.push(await this.currentIqAir(city, true));
    return readings;
  }

  private settings() {
    return this.db.userSettings.upsert({ where: { id: 1 }, create: { id: 1, nationalSample: DEFAULT_SAMPLE.slice(0, this.sampleLimit) }, update: {} });
  }

  private async recordProviderHealth(success: boolean): Promise<void> {
    const now = new Date();
    await this.db.providerHealth.upsert({ where: { provider: 'iqair' }, create: { provider: 'iqair', state: success ? 'HEALTHY' : 'DEGRADED', lastSuccessAt: success ? now : undefined, lastFailureAt: success ? undefined : now, errorSummary: success ? undefined : 'Reading unavailable or quota exhausted' }, update: success ? { state: 'HEALTHY', lastSuccessAt: now, errorSummary: null } : { state: 'DEGRADED', lastFailureAt: now, errorSummary: 'Reading unavailable or quota exhausted' } }).catch(() => undefined);
  }
}
