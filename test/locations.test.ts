import { describe, expect, it } from 'vitest';
import { haversineKm, nearestSupportedLocation } from '../src/domain/locations.js';

describe('location matching', () => {
  it('matches central Jakarta to Jakarta without storing coordinates', () => {
    const nearest = nearestSupportedLocation(-6.2, 106.84);
    expect(nearest?.location).toMatchObject({ city: 'Jakarta', state: 'Jakarta' });
    expect(nearest?.distanceKm).toBeLessThan(2);
  });

  it('rejects invalid coordinates', () => {
    expect(nearestSupportedLocation(91, 106)).toBeUndefined();
    expect(nearestSupportedLocation(-6, Number.NaN)).toBeUndefined();
  });

  it('calculates realistic city distances', () => {
    expect(haversineKm(-6.2088, 106.8456, -6.9175, 107.6191)).toBeGreaterThan(100);
  });
});
