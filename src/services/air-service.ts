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

export class AirService {
  constructor(private readonly db: PrismaClient, private readonly iqair: IqAirProvider, private readonly official: OfficialIspuProvider, private readonly sampleLimit: number) {}

  async sample(): Promise<{ readings: Reading[]; average: ReturnType<typeof calculateSampleAverage> }> {
    const locations = await this.nationalSample();
    const readings = (await Promise.all(locations.map((city) => this.currentIqAir(city)))).filter((r): r is Reading => Boolean(r));
    return { readings, average: calculateSampleAverage(readings, locations.length) };
  }

  async lookup(city: string, state?: string): Promise<{ iqair?: Reading; official?: Reading }> {
    const iqair = await this.currentIqAir({ city, state: state ?? '' });
    const official = await this.official.getCurrent(city);
    return { iqair, official };
  }

  async tracked(): Promise<Reading[]> {
    const locations: TrackedLocationRecord[] = await this.db.trackedLocation.findMany({ orderBy: { createdAt: 'asc' } });
    const readings = await Promise.all(locations.filter((x) => x.provider === 'iqair').map((x) => this.currentIqAir({ city: x.city, state: x.state ?? '' })));
    return readings.filter((r): r is Reading => Boolean(r));
  }

  async trackedLocations(): Promise<TrackedLocationRecord[]> { return this.db.trackedLocation.findMany({ where: { provider: 'iqair' }, orderBy: { createdAt: 'asc' } }); }

  async addTracked(city: City): Promise<'added' | 'duplicate' | 'limit'> {
    const sample = await this.nationalSample();
    if (sample.some((x) => x.city.toLowerCase() === city.city.toLowerCase())) return 'duplicate';
    const existing: TrackedLocationRecord[] = await this.db.trackedLocation.findMany({ where: { provider: 'iqair' } });
    if (existing.some((x) => x.city.toLowerCase() === city.city.toLowerCase())) return 'duplicate';
    if (existing.length >= 3) return 'limit';
    await this.db.trackedLocation.create({ data: { provider: 'iqair', city: city.city, state: city.state } });
    return 'added';
  }

  async removeTracked(id: string): Promise<void> { await this.db.trackedLocation.delete({ where: { id } }).catch(() => undefined); }

  private async nationalSample(): Promise<City[]> {
    const settings = await this.db.userSettings.upsert({ where: { id: 1 }, create: { id: 1, nationalSample: DEFAULT_SAMPLE.slice(0, this.sampleLimit) }, update: {} });
    const value = settings.nationalSample as unknown;
    return Array.isArray(value) && value.length ? (value as City[]).slice(0, this.sampleLimit) : DEFAULT_SAMPLE.slice(0, this.sampleLimit);
  }

  private async currentIqAir(city: City): Promise<Reading | undefined> {
    const cached = await this.db.airObservation.findFirst({ where: { provider: 'iqair', city: city.city, fetchedAt: { gte: new Date(Date.now() - 15 * 60_000) } }, orderBy: { fetchedAt: 'desc' } });
    if (cached) return { provider: 'iqair', metric: cached.metric, value: cached.value, category: cached.category ?? undefined, city: cached.city, state: cached.region ?? undefined, sourceUrl: cached.sourceUrl, observedAt: cached.observedAt, fetchedAt: cached.fetchedAt };
    const result = await this.iqair.getCurrent(city);
    if (!result) return undefined;
    await this.db.airObservation.upsert({ where: { provider_providerId_metric_observedAt: { provider: 'iqair', providerId: `${result.city}:${result.state ?? ''}`, metric: result.metric, observedAt: result.observedAt } }, create: { provider: 'iqair', providerId: `${result.city}:${result.state ?? ''}`, kind: 'IQAIR', metric: result.metric, value: result.value, category: result.category, city: result.city, region: result.state, sourceUrl: result.sourceUrl, observedAt: result.observedAt }, update: { value: result.value, category: result.category, fetchedAt: result.fetchedAt, sourceUrl: result.sourceUrl } });
    return result;
  }
}
