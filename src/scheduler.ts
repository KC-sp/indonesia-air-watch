import type { PrismaClient } from '@prisma/client';
import { logger } from './logger.js';

const hourBucket = (now = new Date()) => new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000);
const SGT_OFFSET = 8 * 3_600_000;
const sgtDayBucket = (now = new Date()) => {
  const local = new Date(now.getTime() + SGT_OFFSET);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - SGT_OFFSET);
};
export async function dispatchOnce(db: PrismaClient, send: () => Promise<void>, now = new Date()): Promise<boolean> {
  const bucket = hourBucket(now);
  try { await db.hourlyDispatch.create({ data: { hourBucket: bucket } }); }
  catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
      const staleBefore = new Date(now.getTime() - 10 * 60_000);
      const reclaimed = await db.hourlyDispatch.updateMany({ where: { hourBucket: bucket, OR: [{ status: 'FAILED' }, { status: 'SENDING', createdAt: { lt: staleBefore } }] }, data: { status: 'SENDING', error: null } });
      if (reclaimed.count === 0) return false;
    } else {
      throw error;
    }
  }
  try { await send(); await db.hourlyDispatch.update({ where: { hourBucket: bucket }, data: { status: 'SENT', sentAt: new Date() } }); return true; }
  catch (error) { await db.hourlyDispatch.update({ where: { hourBucket: bucket }, data: { status: 'FAILED', error: error instanceof Error ? error.message.slice(0, 500) : 'unknown error' } }); throw error; }
}

export function startHourlyScheduler(db: PrismaClient, send: () => Promise<void>) {
  const schedule = () => { const delay = 3_600_000 - (Date.now() % 3_600_000) + 50; setTimeout(async () => { try { const sent = await dispatchOnce(db, send); logger.info({ sent }, sent ? 'hourly dispatch sent' : 'hourly dispatch already handled'); } catch (error) { logger.error(error, 'hourly dispatch failed'); } finally { schedule(); } }, delay); };
  schedule();
}

export async function dispatchDailyOnce(db: PrismaClient, send: () => Promise<void>, now = new Date()): Promise<boolean> {
  const dayBucket = sgtDayBucket(now);
  try { await db.dailyDispatch.create({ data: { dayBucket } }); }
  catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
      const staleBefore = new Date(now.getTime() - 10 * 60_000);
      const reclaimed = await db.dailyDispatch.updateMany({ where: { dayBucket, OR: [{ status: 'FAILED' }, { status: 'SENDING', createdAt: { lt: staleBefore } }] }, data: { status: 'SENDING', error: null } });
      if (reclaimed.count === 0) return false;
    } else throw error;
  }
  try { await send(); await db.dailyDispatch.update({ where: { dayBucket }, data: { status: 'SENT', sentAt: new Date() } }); return true; }
  catch (error) { await db.dailyDispatch.update({ where: { dayBucket }, data: { status: 'FAILED', error: error instanceof Error ? error.message.slice(0, 500) : 'unknown error' } }); throw error; }
}

export function nextDailySummaryTime(hour: number, now = new Date()): Date {
  const local = new Date(now.getTime() + SGT_OFFSET);
  let target = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), hour) - SGT_OFFSET);
  if (target.getTime() <= now.getTime()) target = new Date(target.getTime() + 24 * 3_600_000);
  return target;
}

export function startDailyScheduler(db: PrismaClient, hour: number, send: () => Promise<void>) {
  const schedule = () => { const delay = nextDailySummaryTime(hour).getTime() - Date.now() + 50; setTimeout(async () => { try { const sent = await dispatchDailyOnce(db, send); logger.info({ sent }, sent ? 'daily summary sent' : 'daily summary already handled'); } catch (error) { logger.error(error, 'daily summary failed'); } finally { schedule(); } }, delay); };
  schedule();
}
