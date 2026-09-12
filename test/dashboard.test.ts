import { describe, expect, it } from 'vitest';
import { renderDashboard } from '../src/services/dashboard-service.js';

describe('live dashboard', () => {
  const snapshot = {
    sample: { readings: [], average: { value: 100, reported: 5, expected: 12 } },
    tracked: { readings: [{ provider: 'iqair' as const, metric: 'US AQI iQAir', value: 161, city: 'Jakarta', category: 'Unhealthy', sourceUrl: 'https://www.iqair.com/', observedAt: new Date('2026-01-01T00:00:00Z'), fetchedAt: new Date() }], unavailable: [] },
    alertSettings: { enabled: true, threshold: 150, cooldownMinutes: 180, hysteresis: 10, rapidRise: 25 },
    generatedAt: new Date('2026-01-01T00:00:00Z'),
  };

  it('shows the tracked location, source metric, and hourly mode', () => {
    const text = renderDashboard(snapshot, 'HOURLY');
    expect(text).toContain('Jakarta: 161');
    expect(text).toContain('US AQI iQAir');
    expect(text).toContain('Hourly messages: Enabled');
  });

  it('clearly labels dashboard-only mode', () => {
    expect(renderDashboard(snapshot, 'QUIET')).toContain('Hourly messages: Dashboard only');
  });
});
