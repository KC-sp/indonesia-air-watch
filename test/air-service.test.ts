import { describe, expect, it, vi } from 'vitest';
import { AirService } from '../src/services/air-service.js';

const unavailableOfficial = { id: 'unavailable', getCurrent: vi.fn().mockResolvedValue(undefined) };

describe('tracked air service', () => {
  it('keeps saved locations visible when a provider reading is unavailable', async () => {
    const db = {
      trackedLocation: { findMany: vi.fn().mockResolvedValue([{ id: '1', provider: 'iqair', city: 'Jakarta', state: 'Jakarta', country: 'Indonesia', stationId: null, createdAt: new Date(), updatedAt: new Date() }]) },
      airObservation: { findFirst: vi.fn().mockResolvedValue(undefined) },
      providerHealth: { upsert: vi.fn().mockResolvedValue({}) },
    };
    const iqair = { getCurrent: vi.fn().mockResolvedValue(undefined) };
    const service = new AirService(db as never, iqair as never, unavailableOfficial, 12, 3);
    await expect(service.trackedStatus()).resolves.toEqual({ readings: [], unavailable: [{ city: 'Jakarta', state: 'Jakarta' }] });
  });

  it('summarizes stored observations without inventing values', async () => {
    const db = { airObservation: { findMany: vi.fn().mockResolvedValue([{ city: 'Jakarta', value: 160 }, { city: 'Jakarta', value: 120 }]) } };
    const service = new AirService(db as never, {} as never, unavailableOfficial, 12, 3);
    await expect(service.trend('Jakarta')).resolves.toMatchObject({ city: 'Jakarta', count: 2, minimum: 120, maximum: 160, average: 140, latest: 120, direction: 'improving' });
  });
});
