import { usAqiCategory, type City, type Reading } from '../domain/air.js';
import { IqAirQuota } from '../services/quota.js';

type IqAirPayload = { status: string; data?: { current?: { pollution?: { aqius?: number; mainus?: string; ts?: string } }; city?: string; state?: string } };

export class IqAirProvider {
  readonly id = 'iqair';
  constructor(private readonly apiKey: string | undefined, private readonly quota: IqAirQuota, private readonly fetcher: typeof fetch = fetch) {}

  async getCurrent(location: City, waitForQuota = false): Promise<Reading | undefined> {
    if (!this.apiKey || !(waitForQuota ? await this.quota.reserveWhenAvailable() : await this.quota.reserve())) return undefined;
    const url = new URL('https://api.airvisual.com/v2/city');
    url.search = new URLSearchParams({ city: location.city, state: location.state, country: 'Indonesia', key: this.apiKey }).toString();
    const response = await this.request(url);
    if (!response?.data?.current?.pollution || response.status !== 'success') return undefined;
    const pollution = response.data.current.pollution;
    if (!Number.isFinite(pollution.aqius)) return undefined;
    return { provider: 'iqair', metric: 'US AQI iQAir', value: pollution.aqius!, category: usAqiCategory(pollution.aqius!), city: response.data.city ?? location.city, state: response.data.state ?? location.state, sourceUrl: iqAirLocationUrl(location), observedAt: pollution.ts ? new Date(pollution.ts) : new Date(), fetchedAt: new Date() };
  }

  async discoverCities(state: string): Promise<string[]> {
    if (!this.apiKey || !(await this.quota.reserve())) return [];
    const url = new URL('https://api.airvisual.com/v2/cities');
    url.search = new URLSearchParams({ state, country: 'Indonesia', key: this.apiKey }).toString();
    const response = await this.request(url) as (IqAirPayload & { data?: { city: string }[] }) | undefined;
    return response?.status === 'success' ? (response.data ?? []).map((x) => x.city).filter(Boolean) : [];
  }

  private async request(url: URL): Promise<IqAirPayload | undefined> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await this.fetcher(url, { signal: AbortSignal.timeout(8_000) });
        if ([401, 404, 429].includes(response.status)) return undefined;
        if (!response.ok) throw new Error(`iQAir HTTP ${response.status}`);
        return await response.json() as IqAirPayload;
      } catch {
        if (attempt === 2) return undefined;
        await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
      }
    }
    return undefined;
  }
}

function iqAirLocationUrl(location: City): string {
  const slug = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  return `https://www.iqair.com/indonesia/${slug(location.state)}/${slug(location.city)}`;
}
