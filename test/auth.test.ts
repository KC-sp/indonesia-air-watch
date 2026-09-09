import { describe, expect, it, vi } from 'vitest';
import { ownerOnly } from '../src/auth.js';

describe('owner authorization', () => {
  it('rejects non-owner updates without leaking details', async () => { const reply = vi.fn().mockResolvedValue(undefined); const next = vi.fn(); await ownerOnly('42')({ from: { id: 7 }, reply } as never, next); expect(reply).toHaveBeenCalledWith('This is a private bot.'); expect(next).not.toHaveBeenCalled(); });
  it('passes owner updates through', async () => { const next = vi.fn(); await ownerOnly('42')({ from: { id: 42 }, reply: vi.fn() } as never, next); expect(next).toHaveBeenCalledOnce(); });
});
