import { describe, expect, it, vi } from 'vitest';
import { dispatchOnce } from '../src/scheduler.js';

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
    await expect(dispatchOnce({ hourlyDispatch: { create: vi.fn().mockRejectedValue(new Error('unique')), update: vi.fn() } } as never, send, new Date('2026-01-01T01:00:10Z'))).resolves.toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
});
