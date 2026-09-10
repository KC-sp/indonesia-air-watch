import { describe, expect, it } from 'vitest';
import { aqiActionGuidance, calculateSampleAverage, dailySummaryMessage, formatReading, hourlyMessage } from '../src/domain/air.js';
import { IqAirQuota, type QuotaStore } from '../src/services/quota.js';

const reading = (value: number) => ({ provider: 'iqair' as const, metric: 'US AQI iQAir', value, city: 'Jakarta', sourceUrl: 'https://www.iqair.com/', observedAt: new Date('2026-01-01T00:00:00Z'), fetchedAt: new Date() });
describe('air accuracy rules', () => {
  it('calculates only valid sample readings and coverage', () => expect(calculateSampleAverage([reading(40), reading(60)], 12)).toEqual({ value: 50, reported: 2, expected: 12 }));
  it('never renders PSI and labels iQAir as US AQI', () => { const text = `${formatReading(reading(60))}\n${hourlyMessage(calculateSampleAverage([reading(60)], 12), [])}`; expect(text).toContain('US AQI iQAir'); expect(text).not.toMatch(/PSI/i); });
  it('marks unavailable official readings clearly', () => expect(hourlyMessage(calculateSampleAverage([], 12), [])).toContain('Official ISPU currently unavailable.'));
  it('keeps a tracked city visible when its reading is unavailable', () => {
    const text = hourlyMessage(calculateSampleAverage([], 12), [], undefined, [{ city: 'Jakarta', state: 'Jakarta' }]);
    expect(text).toContain('Tracked locations:');
    expect(text).toContain('Jakarta, Jakarta: US AQI iQAir temporarily unavailable');
  });
  it('uses local timestamps and identifies original data', () => {
    const text = formatReading(reading(60));
    expect(text).toContain('01 Jan 2026, 07:00 WIB (01 Jan 2026, 08:00 SGT)');
    expect(text).toContain('Original data: https://www.iqair.com/');
    expect(text).not.toContain('2026-01-01T00:00:00.000Z');
  });
  it('includes configured threshold alerts', () => expect(hourlyMessage(calculateSampleAverage([], 12), [reading(160)], undefined, [], 150)).toContain('⚠️ Air-quality alert:'));
  it('formats a daily trend summary', () => expect(dailySummaryMessage([{ city: 'Jakarta', hours: 24, count: 4, minimum: 80, maximum: 160, average: 120, latest: 100, direction: 'improving' }])).toContain('Trend: improving'));
  it('uses cautious official AQI action guidance', () => expect(aqiActionGuidance(160)).toContain('everyone else should limit'));
});

class MemoryStore implements QuotaStore {
  readonly values = new Map<string, number>();
  private key(provider: string, bucket: Date) { return `${provider}:${bucket.toISOString()}`; }
  async count(provider: string, bucket: Date) { return this.values.get(this.key(provider, bucket)) ?? 0; }
  async increment(provider: string, bucket: Date) { const next = await this.count(provider, bucket) + 1; this.values.set(this.key(provider, bucket), next); return next; }
}
describe('iQAir quota', () => {
  it('allows at most five requests per minute', async () => { const quota = new IqAirQuota(new MemoryStore(), () => new Date('2026-01-01T00:00:00Z')); for (let i = 0; i < 5; i += 1) await expect(quota.reserve()).resolves.toBe(true); await expect(quota.reserve()).resolves.toBe(false); });
  it('waits for the next minute when collecting an hourly sample', async () => {
    const store = new MemoryStore();
    let now = new Date('2026-01-01T00:00:00Z');
    const quota = new IqAirQuota(store, () => now, async (milliseconds) => { now = new Date(now.getTime() + milliseconds); });
    for (let i = 0; i < 5; i += 1) await quota.reserve();
    await expect(quota.reserveWhenAvailable()).resolves.toBe(true);
    await expect(quota.usage()).resolves.toEqual({ minute: 1, daily: 6 });
  });
});
