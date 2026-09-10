import type { Reading } from '../domain/air.js';
import { z } from 'zod';

export interface OfficialIspuProvider { readonly id: string; getCurrent(location: string): Promise<Reading | undefined>; }

/** No adapter is active until an owner approves a documented, permitted government source. */
export class UnavailableOfficialIspuProvider implements OfficialIspuProvider {
  readonly id = 'official-ispu-unavailable';
  async getCurrent(): Promise<Reading | undefined> { return undefined; }
}

const OfficialPayload = z.object({
  value: z.number().int().nonnegative(),
  metric: z.string().min(1).default('ISPU'),
  city: z.string().min(1),
  category: z.string().min(1).optional(),
  observedAt: z.string().datetime(),
  period: z.string().min(1),
  station: z.string().min(1).optional(),
  sourceUrl: z.string().url().optional(),
});

/** Deterministic adapter for an owner-approved government JSON endpoint. */
export class GovernmentJsonIspuProvider implements OfficialIspuProvider {
  readonly id = 'official-ispu-json';
  constructor(private readonly endpoint: string, private readonly agency: string, private readonly fetcher: typeof fetch = fetch) {
    assertOfficialUrl(endpoint);
  }

  async getCurrent(location: string): Promise<Reading | undefined> {
    try {
      const url = new URL(this.endpoint);
      url.searchParams.set('city', location);
      const response = await this.fetcher(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8_000) });
      if (!response.ok) return undefined;
      const parsed = OfficialPayload.safeParse(await response.json());
      if (!parsed.success || parsed.data.city.toLowerCase() !== location.toLowerCase()) return undefined;
      const sourceUrl = parsed.data.sourceUrl ?? this.endpoint;
      assertOfficialUrl(sourceUrl);
      return { provider: 'official-ispu', metric: parsed.data.metric, value: parsed.data.value, category: parsed.data.category, city: parsed.data.city, station: parsed.data.station, period: parsed.data.period, sourceName: this.agency, sourceUrl, observedAt: new Date(parsed.data.observedAt), fetchedAt: new Date() };
    } catch {
      return undefined;
    }
  }
}

function assertOfficialUrl(value: string): void {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !(url.hostname.endsWith('.go.id') || url.hostname.endsWith('.go.id.'))) throw new Error('Official ISPU endpoint must use HTTPS on a .go.id domain');
}
