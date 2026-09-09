import type { City, Reading } from '../domain/air.js';
import { IqAirQuota } from '../services/quota.js';

type IqAirPayload = { status: string; data?: { current?: { pollution?: { aqius?: number; mainus?: string; ts?: string } }; city?: string; state?: string } };

export class IqAirProvider {
  readonly id = 'iqair';
  constructor(private readonly apiKey: string | undefined, private readonly quota: IqAirQuota, private readonly fetcher: typeof fetch = fetch) {}

  async getCurrent(location: City): Promise<Reading | undefined> {
    if (!this.apiKey || !(await this.quota.reserve())) return undefined;
    const url = new URL('https://api.airvisual.com/v2/city');
    url.search = new URLSearchParams({ city: location.city, state: location.state, country: 'Indonesia', key: this.apiKey }).toString();
    const response = await this.request(url);
    if (!response?.data?.current?.pollution || response.status !== 'success') return undefined;
    const pollution = response.data.current.pollution;
    if (!Number.isFinite(pollution.aqius)) return undefined;
    return { provider: 'iqair', metric: 'US AQI iQAir', value: pollution.aqius!, category: category(pollution.aqius!), city: response.data.city ?? location.city, state: response.data.state ?? location.state, sourceUrl: 'https://www.iqair.com/', observedAt: pollution.ts ? new Date(pollution.ts) : new Date(), fetchedAt: new Date() };
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

function category(aqi: number): string { if (aqi <= 50) return 'Good'; if (aqi <= 100) return 'Moderate'; if (aqi <= 150) return 'Unhealthy for sensitive groups'; if (aqi <= 200) return 'Unhealthy'; if (aqi <= 300) return 'Very unhealthy'; return 'Hazardous'; }
