import type { PrismaClient } from '@prisma/client';
import { logger } from './logger.js';

const hourBucket = (now = new Date()) => new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000);
export async function dispatchOnce(db: PrismaClient, send: () => Promise<void>, now = new Date()): Promise<boolean> {
  const bucket = hourBucket(now);
  try { await db.hourlyDispatch.create({ data: { hourBucket: bucket } }); }
  catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
      const reclaimed = await db.hourlyDispatch.updateMany({ where: { hourBucket: bucket, status: 'FAILED' }, data: { status: 'SENDING', error: null } });
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
