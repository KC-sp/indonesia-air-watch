import { describe, expect, it, vi } from 'vitest';
import { dispatchDailyOnce, dispatchOnce, nextDailySummaryTime } from '../src/scheduler.js';

describe('hourly dispatch de-duplication', () => {
  it('sends once when the hour bucket is unique', async () => {
    const create = vi.fn().mockResolvedValue({});
    const update = vi.fn().mockResolvedValue({});
    const send = vi.fn().mockResolvedValue(undefined);
    await expect(dispatchOnce({ hourlyDispatch: { create, update } } as never, send, new Date('2026-01-01T01:00:10Z'))).resolves.toBe(true);
    expect(send).toHaveBeenCalledOnce();
  });
  it('does not send when another replica owns the hour', async () => {
    const send = vi.fn();
    await expect(dispatchOnce({ hourlyDispatch: { create: vi.fn().mockRejectedValue({ code: 'P2002' }), updateMany: vi.fn().mockResolvedValue({ count: 0 }), update: vi.fn() } } as never, send, new Date('2026-01-01T01:00:10Z'))).resolves.toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
  it('retries a dispatch recorded as failed', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const update = vi.fn().mockResolvedValue({});
    await expect(dispatchOnce({ hourlyDispatch: { create: vi.fn().mockRejectedValue({ code: 'P2002' }), updateMany: vi.fn().mockResolvedValue({ count: 1 }), update } } as never, send, new Date('2026-01-01T01:00:10Z'))).resolves.toBe(true);
    expect(send).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'SENT' }) }));
  });
  it('does not hide database failures as duplicate dispatches', async () => {
    const send = vi.fn();
    const failure = new Error('database unavailable');
    await expect(dispatchOnce({ hourlyDispatch: { create: vi.fn().mockRejectedValue(failure), update: vi.fn() } } as never, send, new Date('2026-01-01T01:00:10Z'))).rejects.toThrow('database unavailable');
    expect(send).not.toHaveBeenCalled();
  });
});

describe('daily summaries', () => {
  it('schedules 20:00 Singapore time', () => {
    expect(nextDailySummaryTime(20, new Date('2026-09-11T03:00:00Z')).toISOString()).toBe('2026-09-11T12:00:00.000Z');
    expect(nextDailySummaryTime(20, new Date('2026-09-11T13:00:00Z')).toISOString()).toBe('2026-09-12T12:00:00.000Z');
  });
  it('deduplicates the daily summary', async () => {
    const send = vi.fn();
    await expect(dispatchDailyOnce({ dailyDispatch: { create: vi.fn().mockRejectedValue({ code: 'P2002' }), updateMany: vi.fn().mockResolvedValue({ count: 0 }), update: vi.fn() } } as never, send, new Date('2026-09-11T12:00:00Z'))).resolves.toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
});
