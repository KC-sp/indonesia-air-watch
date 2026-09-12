import { describe, expect, it } from 'vitest';
import type { Reading } from '../src/domain/air.js';
import { decideAlert, type AlertConfig, type AlertStateSnapshot } from '../src/services/alert-service.js';

const config: AlertConfig = { threshold: 150, cooldownMinutes: 180, hysteresis: 10, rapidRise: 25 };
const reading = (value: number, hour: number): Reading => ({
  provider: 'iqair', metric: 'US AQI iQAir', value, city: 'Jakarta', state: 'Jakarta',
  sourceUrl: 'https://www.iqair.com/indonesia/jakarta', observedAt: new Date(`2026-01-01T${String(hour).padStart(2, '0')}:00:00Z`), fetchedAt: new Date(),
});
const nextState = (state: AlertStateSnapshot | undefined, value: number, hour: number) => decideAlert(state, reading(value, hour), config);

describe('smart alert decisions', () => {
  it('notifies only when a threshold is crossed', () => {
    const normal = nextState(undefined, 140, 1);
    expect(normal.eventType).toBeUndefined();
    expect(nextState(normal.next, 155, 2).eventType).toBe('THRESHOLD_CROSSED');
  });

  it('ignores duplicate observations', () => {
    const first = nextState(undefined, 155, 1);
    expect(nextState(first.next, 155, 1).isNewObservation).toBe(false);
  });

  it('notifies when severity increases', () => {
    const first = nextState(undefined, 155, 1);
    expect(nextState(first.next, 205, 2).eventType).toBe('SEVERITY_INCREASED');
  });

  it('detects a rapid rise inside two hours', () => {
    const first = nextState(undefined, 151, 1);
    expect(nextState(first.next, 180, 2).eventType).toBe('RAPID_RISE');
  });

  it('requires two readings below the hysteresis recovery level', () => {
    const high = nextState(undefined, 160, 1);
    const firstLow = nextState(high.next, 140, 2);
    expect(firstLow.eventType).toBeUndefined();
    expect(nextState(firstLow.next, 135, 3).eventType).toBe('RECOVERED');
  });
});
