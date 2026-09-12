import type { PrismaClient } from '@prisma/client';
import { formatObservationTime } from '../time.js';
import { usAqiCategory, type Reading } from '../domain/air.js';
import { safeErrorMessage } from '../errors.js';

export type AlertEventType = 'THRESHOLD_CROSSED' | 'SEVERITY_INCREASED' | 'RAPID_RISE' | 'RECOVERED';
export type AlertConfig = { threshold: number; cooldownMinutes: number; hysteresis: number; rapidRise: number };
export type AlertStateSnapshot = {
  threshold: number;
  status: string;
  lastValue?: number;
  lastCategory?: string;
  lastObservedAt?: Date;
  consecutiveBelow: number;
};
export type AlertDecision = {
  isNewObservation: boolean;
  eventType?: AlertEventType;
  next: AlertStateSnapshot;
};

type PendingAlert = { id: string; message: string };

export class AlertService {
  constructor(private readonly db: PrismaClient) {}

  async evaluate(readings: Reading[], enabled: boolean, threshold?: number): Promise<PendingAlert[]> {
    if (!enabled || threshold === undefined) return [];
    const settings = await this.db.userSettings.findUnique({ where: { id: 1 } });
    const config: AlertConfig = {
      threshold,
      cooldownMinutes: settings?.alertCooldownMinutes ?? 180,
      hysteresis: settings?.alertHysteresis ?? 10,
      rapidRise: settings?.alertRapidRise ?? 25,
    };

    for (const reading of readings.filter((item) => item.provider === 'iqair')) {
      await this.evaluateReading(reading, config);
    }
    return this.pending();
  }

  async markSent(id: string): Promise<void> {
    await this.db.alertEvent.update({ where: { id }, data: { sentAt: new Date(), deliveryError: null } });
  }

  async markFailed(id: string, error: unknown): Promise<void> {
    await this.db.alertEvent.update({ where: { id }, data: { deliveryError: safeErrorMessage(error) } }).catch(() => undefined);
  }

  async reset(): Promise<void> {
    await this.db.$transaction([
      this.db.alertEvent.deleteMany({ where: { sentAt: null } }),
      this.db.alertState.deleteMany(),
    ]);
  }

  private async evaluateReading(reading: Reading, config: AlertConfig): Promise<void> {
    const region = reading.state ?? '';
    const current = await this.db.alertState.findUnique({ where: { provider_city_region: { provider: reading.provider, city: reading.city, region } } });
    const state = current ? {
      threshold: current.threshold,
      status: current.status,
      lastValue: current.lastValue ?? undefined,
      lastCategory: current.lastCategory ?? undefined,
      lastObservedAt: current.lastObservedAt ?? undefined,
      consecutiveBelow: current.consecutiveBelow,
    } : undefined;
    const decision = decideAlert(state, reading, config);
    if (!decision.isNewObservation) return;
    await this.db.alertState.upsert({
      where: { provider_city_region: { provider: reading.provider, city: reading.city, region } },
      create: { provider: reading.provider, city: reading.city, region, ...stateData(decision.next) },
      update: stateData(decision.next),
    });
    if (!decision.eventType) return;

    const since = new Date(Date.now() - config.cooldownMinutes * 60_000);
    const duplicate = await this.db.alertEvent.findFirst({
      where: { provider: reading.provider, city: reading.city, region, eventType: decision.eventType, createdAt: { gte: since } },
    });
    if (duplicate && !['SEVERITY_INCREASED', 'RECOVERED'].includes(decision.eventType)) return;
    const dedupeKey = `${reading.provider}:${reading.city}:${region}:${reading.observedAt.toISOString()}:${decision.eventType}`;
    await this.db.alertEvent.create({
      data: {
        dedupeKey,
        provider: reading.provider,
        city: reading.city,
        region,
        eventType: decision.eventType,
        value: reading.value,
        previousValue: state?.lastValue,
        threshold: config.threshold,
        category: reading.category ?? usAqiCategory(reading.value),
        message: alertMessage(decision.eventType, reading, state?.lastValue, config.threshold),
        observedAt: reading.observedAt,
      },
    }).catch((error) => {
      if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002')) throw error;
    });
  }

  private pending(): Promise<PendingAlert[]> {
    return this.db.alertEvent.findMany({ where: { sentAt: null }, orderBy: { createdAt: 'asc' }, take: 20, select: { id: true, message: true } });
  }
}

export function decideAlert(state: AlertStateSnapshot | undefined, reading: Reading, config: AlertConfig): AlertDecision {
  const reset = !state || state.threshold !== config.threshold;
  const previous = reset ? undefined : state;
  if (previous?.lastObservedAt && reading.observedAt.getTime() <= previous.lastObservedAt.getTime()) {
    return { isNewObservation: false, next: previous };
  }

  let status = previous?.status ?? 'NORMAL';
  let consecutiveBelow = previous?.consecutiveBelow ?? 0;
  let eventType: AlertEventType | undefined;
  const category = reading.category ?? usAqiCategory(reading.value);
  const recoveryLevel = Math.max(0, config.threshold - config.hysteresis);

  if (status === 'ALERTING') {
    if (reading.value <= recoveryLevel) {
      consecutiveBelow += 1;
      if (consecutiveBelow >= 2) {
        status = 'NORMAL';
        consecutiveBelow = 0;
        eventType = 'RECOVERED';
      }
    } else {
      consecutiveBelow = 0;
    }
    if (!eventType && reading.value >= config.threshold && previous?.lastCategory && categoryRank(category) > categoryRank(previous.lastCategory)) eventType = 'SEVERITY_INCREASED';
    if (!eventType && reading.value >= config.threshold && isRapidRise(previous, reading, config.rapidRise)) eventType = 'RAPID_RISE';
  } else {
    consecutiveBelow = 0;
    if (reading.value >= config.threshold) {
      status = 'ALERTING';
      eventType = 'THRESHOLD_CROSSED';
    }
  }

  return {
    isNewObservation: true,
    eventType,
    next: { threshold: config.threshold, status, lastValue: reading.value, lastCategory: category, lastObservedAt: reading.observedAt, consecutiveBelow },
  };
}

function stateData(state: AlertStateSnapshot) {
  return {
    threshold: state.threshold,
    status: state.status,
    lastValue: state.lastValue,
    lastCategory: state.lastCategory,
    lastObservedAt: state.lastObservedAt,
    consecutiveBelow: state.consecutiveBelow,
  };
}

function isRapidRise(state: AlertStateSnapshot | undefined, reading: Reading, rapidRise: number): boolean {
  if (state?.lastValue === undefined || !state.lastObservedAt) return false;
  const elapsed = reading.observedAt.getTime() - state.lastObservedAt.getTime();
  return elapsed > 0 && elapsed <= 2 * 3_600_000 && reading.value - state.lastValue >= rapidRise;
}

function categoryRank(category: string): number {
  return ['Good', 'Moderate', 'Unhealthy for sensitive groups', 'Unhealthy', 'Very unhealthy', 'Hazardous'].indexOf(category);
}

function alertMessage(type: AlertEventType, reading: Reading, previousValue: number | undefined, threshold: number): string {
  const title = type === 'RECOVERED' ? '✅ Air quality returned below the alert level'
    : type === 'SEVERITY_INCREASED' ? '⚠️ Air-quality severity increased'
      : type === 'RAPID_RISE' ? '⚠️ Rapid air-quality deterioration'
        : '⚠️ Air-quality threshold crossed';
  const previous = previousValue === undefined ? '' : `\nPrevious reading: ${previousValue}`;
  return `${title}\n\n${reading.city}: ${reading.value} US AQI iQAir (${reading.category ?? usAqiCategory(reading.value)})${previous}\nAlert threshold: ${threshold}\nObserved: ${formatObservationTime(reading.observedAt)}\nSource: iQAir\nOriginal data: ${reading.sourceUrl}`;
}
