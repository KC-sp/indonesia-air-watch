import { describe, expect, it, vi } from 'vitest';
import { retryTelegram, telegramRetryDelay } from '../src/services/telegram-delivery.js';

describe('Telegram delivery retries', () => {
  it('honours Telegram retry_after for rate limits', () => {
    expect(telegramRetryDelay({ response: { error_code: 429, parameters: { retry_after: 3 } } }, 1)).toBe(3_000);
  });

  it('retries transient failures and then succeeds', async () => {
    const operation = vi.fn().mockRejectedValueOnce({ code: 'ETIMEDOUT' }).mockResolvedValue('sent');
    const sleep = vi.fn().mockResolvedValue(undefined);
    await expect(retryTelegram(operation, sleep)).resolves.toBe('sent');
    expect(operation).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledOnce();
  });

  it('does not retry permanent Telegram errors', async () => {
    const operation = vi.fn().mockRejectedValue({ response: { error_code: 400 } });
    await expect(retryTelegram(operation, vi.fn())).rejects.toEqual({ response: { error_code: 400 } });
    expect(operation).toHaveBeenCalledOnce();
  });
});
