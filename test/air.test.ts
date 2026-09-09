import { describe, expect, it } from 'vitest';
import { calculateSampleAverage, formatReading, hourlyMessage } from '../src/domain/air.js';
import { IqAirQuota, type QuotaStore } from '../src/services/quota.js';

const reading = (value: number) => ({ provider: 'iqair' as const, metric: 'US AQI iQAir', value, city: 'Jakarta', sourceUrl: 'https://www.iqair.com/', observedAt: new Date('2026-01-01T00:00:00Z'), fetchedAt: new Date() });
describe('air accuracy rules', () => {
  it('calculates only valid sample readings and coverage', () => expect(calculateSampleAverage([reading(40), reading(60)], 12)).toEqual({ value: 50, reported: 2, expected: 12 }));
  it('never renders PSI and labels iQAir as US AQI', () => { const text = `${formatReading(reading(60))}\n${hourlyMessage(calculateSampleAverage([reading(60)], 12), [])}`; expect(text).toContain('US AQI iQAir'); expect(text).not.toMatch(/PSI/i); });
  it('marks unavailable official readings clearly', () => expect(hourlyMessage(calculateSampleAverage([], 12), [])).toContain('Official ISPU currently unavailable.'));
});

class MemoryStore implements QuotaStore {
  readonly values = new Map<string, number>();
  private key(provider: string, bucket: Date) { return `${provider}:${bucket.toISOString()}`; }
  async count(provider: string, bucket: Date) { return this.values.get(this.key(provider, bucket)) ?? 0; }
  async increment(provider: string, bucket: Date) { const next = await this.count(provider, bucket) + 1; this.values.set(this.key(provider, bucket), next); return next; }
}
describe('iQAir quota', () => {
  it('allows at most five requests per minute', async () => { const quota = new IqAirQuota(new MemoryStore(), () => new Date('2026-01-01T00:00:00Z')); for (let i = 0; i < 5; i += 1) await expect(quota.reserve()).resolves.toBe(true); await expect(quota.reserve()).resolves.toBe(false); });
});
