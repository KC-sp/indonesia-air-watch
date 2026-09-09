export type City = { city: string; state: string };
export type Reading = {
  provider: 'iqair' | 'official-ispu'; metric: string; value: number; category?: string;
  city: string; state?: string; station?: string; period?: string; sourceUrl: string;
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

export function formatReading(reading: Reading): string {
  const source = reading.provider === 'iqair' ? 'iQAir' : `ISPU ${reading.provider}`;
  const metric = reading.provider === 'iqair' ? 'US AQI iQAir' : reading.period ? `${reading.metric} ${reading.period}` : reading.metric;
  const category = reading.category ? ` (${reading.category})` : '';
  const stale = reading.lastKnown ? 'Last-known ' : '';
  return `${stale}${reading.city}: ${metric} ${reading.value}${category}, observed ${reading.observedAt.toISOString()}\nSource: ${source} ${reading.sourceUrl}`;
}

export function hourlyMessage(sample: ReturnType<typeof calculateSampleAverage>, tracked: Reading[], official?: Reading): string {
  const headline = sample.value === undefined
    ? 'Indonesia iQAir sample average: unavailable'
    : `Indonesia iQAir sample average: ${sample.value} US AQI iQAir`;
  const lines = [headline, `Coverage: ${sample.reported} of ${sample.expected} sample cities reporting`, 'Source: iQAir'];
  if (tracked.length) lines.push('', 'Tracked locations:', ...tracked.map(formatReading));
  lines.push('', official ? formatReading(official) : 'Official ISPU currently unavailable.');
  return lines.join('\n');
}
