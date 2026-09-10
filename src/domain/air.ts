import { formatObservationTime } from '../time.js';
import type { TrendSummary } from '../services/air-service.js';

export type City = { city: string; state: string };
export type Reading = {
  provider: 'iqair' | 'official-ispu'; metric: string; value: number; category?: string;
  city: string; state?: string; station?: string; period?: string; sourceName?: string; sourceUrl: string;
  observedAt: Date; fetchedAt: Date; lastKnown?: boolean;
};

export const DEFAULT_SAMPLE: City[] = [
  { city: 'Jakarta', state: 'Jakarta' }, { city: 'Bandung', state: 'West Java' },
  { city: 'Semarang', state: 'Central Java' }, { city: 'Surabaya', state: 'East Java' },
  { city: 'Yogyakarta', state: 'Yogyakarta' }, { city: 'Medan', state: 'North Sumatra' },
  { city: 'Pekanbaru', state: 'Riau' }, { city: 'Palembang', state: 'South Sumatra' },
  { city: 'Pontianak', state: 'West Kalimantan' }, { city: 'Banjarmasin', state: 'South Kalimantan' },
  { city: 'Makassar', state: 'South Sulawesi' }, { city: 'Denpasar', state: 'Bali' },
];

export function calculateSampleAverage(readings: Reading[], expected: number) {
  const valid = readings.filter((r) => Number.isFinite(r.value));
  return { value: valid.length ? Math.round(valid.reduce((sum, r) => sum + r.value, 0) / valid.length) : undefined, reported: valid.length, expected };
}

export function usAqiCategory(aqi: number): string {
  if (aqi <= 50) return 'Good';
  if (aqi <= 100) return 'Moderate';
  if (aqi <= 150) return 'Unhealthy for sensitive groups';
  if (aqi <= 200) return 'Unhealthy';
  if (aqi <= 300) return 'Very unhealthy';
  return 'Hazardous';
}

export function formatReading(reading: Reading): string {
  const source = reading.provider === 'iqair' ? 'iQAir' : `ISPU ${reading.sourceName ?? 'official provider'}`;
  const metric = reading.provider === 'iqair' ? 'US AQI iQAir' : reading.period ? `${reading.metric} ${reading.period}` : reading.metric;
  const category = reading.category ? ` (${reading.category})` : '';
  const stale = reading.lastKnown ? 'Last-known ' : '';
  const station = reading.station ? `\nStation: ${reading.station}` : '';
  return `${stale}${reading.city}: ${metric} ${reading.value}${category}\nObserved: ${formatObservationTime(reading.observedAt)}${station}\nSource: ${source}\nOriginal data: ${reading.sourceUrl}`;
}

export function hourlyMessage(sample: ReturnType<typeof calculateSampleAverage>, tracked: Reading[], official?: Reading, unavailableTracked: City[] = [], alertThreshold?: number): string {
  const headline = sample.value === undefined
    ? 'Indonesia iQAir sample average: unavailable'
    : `Indonesia iQAir sample average: ${sample.value} US AQI iQAir (${usAqiCategory(sample.value)})`;
  const lines = [headline, `Coverage: ${sample.reported} of ${sample.expected} sample cities reporting`, 'Source: iQAir'];
  if (tracked.length || unavailableTracked.length) lines.push('', 'Tracked locations:', ...tracked.map(formatReading), ...unavailableTracked.map((location) => `${location.city}${location.state ? `, ${location.state}` : ''}: US AQI iQAir temporarily unavailable`));
  const alerts = alertThreshold === undefined ? [] : tracked.filter((reading) => reading.value >= alertThreshold);
  if (alerts.length) lines.push('', '⚠️ Air-quality alert:', ...alerts.map((reading) => `${reading.city}: ${reading.value} US AQI iQAir (${reading.category ?? usAqiCategory(reading.value)})`));
  lines.push('', official ? formatReading(official) : 'Official ISPU currently unavailable.');
  return lines.join('\n');
}

export function formatTrend(trend: TrendSummary): string {
  if (!trend.count) return `${trend.city}: no observations stored for the last ${trend.hours} hours.`;
  return `${trend.city} — last ${trend.hours} hours\nLatest: ${trend.latest} US AQI iQAir\nAverage: ${trend.average}; minimum: ${trend.minimum}; maximum: ${trend.maximum}\nTrend: ${trend.direction} (${trend.count} observations)`;
}

export function dailySummaryMessage(trends: TrendSummary[]): string {
  const lines = ['Daily air-quality summary (24 hours)'];
  if (!trends.length) lines.push('No tracked locations. Use /setregion or /addregion first.');
  else lines.push(...trends.map(formatTrend));
  lines.push('', 'Values are US AQI iQAir, not PSI or official Indonesian ISPU.');
  return lines.join('\n\n');
}
