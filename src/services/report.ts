import type { Reading } from '../domain/air.js';
import type { AirService, TrackedAirStatus } from './air-service.js';

export type AirReportSnapshot = {
  sample: Awaited<ReturnType<AirService['sample']>>;
  tracked: TrackedAirStatus;
  official?: Reading;
  alertSettings: Awaited<ReturnType<AirService['alertSettings']>>;
  generatedAt: Date;
};

export async function collectAirReport(air: AirService, waitForQuota = false): Promise<AirReportSnapshot> {
  const tracked = await air.trackedStatus(waitForQuota);
  const sample = await air.sample(waitForQuota);
  const alertSettings = await air.alertSettings();
  const official = await air.officialReading('Jakarta');
  return { sample, tracked, official, alertSettings, generatedAt: new Date() };
}
