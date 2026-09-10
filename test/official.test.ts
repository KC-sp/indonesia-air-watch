import { describe, expect, it, vi } from 'vitest';
import { GovernmentJsonIspuProvider } from '../src/providers/official.js';

describe('official ISPU adapter', () => {
  it('accepts validated data from an approved government JSON endpoint', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ value: 85, metric: 'ISPU PM2.5', city: 'Jakarta', category: 'Sedang', observedAt: '2026-09-11T03:00:00.000Z', period: '24-hour', station: 'DKI 4', sourceUrl: 'https://ispu.menlhk.go.id/data/jakarta' }), { status: 200 }));
    const provider = new GovernmentJsonIspuProvider('https://api.menlhk.go.id/ispu', 'Kementerian Lingkungan Hidup', fetcher);
    const reading = await provider.getCurrent('Jakarta');
    expect(reading).toMatchObject({ provider: 'official-ispu', value: 85, city: 'Jakarta', sourceName: 'Kementerian Lingkungan Hidup' });
  });
  it('rejects non-government endpoints', () => expect(() => new GovernmentJsonIspuProvider('https://example.com/ispu', 'Example')).toThrow(/\.go\.id/));
});
