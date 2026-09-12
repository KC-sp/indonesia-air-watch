import type { PrismaClient } from '@prisma/client';
import type { Telegram } from 'telegraf';
import { safeErrorMessage } from '../errors.js';

type Sleep = (milliseconds: number) => Promise<void>;
type SendExtra = Parameters<Telegram['sendMessage']>[2];
type EditExtra = Parameters<Telegram['editMessageText']>[4];
type PinExtra = Parameters<Telegram['pinChatMessage']>[2];

export type DeliveryContext = {
  kind: string;
  correlationId: string;
};

export async function retryTelegram<T>(
  operation: () => Promise<T>,
  sleep: Sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  onAttempt: (attempt: number) => Promise<void> = async () => undefined,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await onAttempt(attempt);
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const delay = telegramRetryDelay(error, attempt);
      if (delay === undefined || attempt === 3) throw error;
      await sleep(delay);
    }
  }
  throw lastError;
}

export function telegramRetryDelay(error: unknown, attempt: number): number | undefined {
  const details = asRecord(error);
  const response = asRecord(details.response);
  const parameters = asRecord(response.parameters);
  const status = numberValue(response.error_code) ?? numberValue(details.status) ?? numberValue(details.code);
  const retryAfter = numberValue(parameters.retry_after);
  if (status === 429) return Math.max(1_000, Math.min(60_000, (retryAfter ?? 1) * 1_000));
  if (status !== undefined && status >= 500) return Math.min(4_000, 500 * 2 ** (attempt - 1));
  const code = String(details.code ?? '');
  if (['ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT'].includes(code)) return Math.min(4_000, 500 * 2 ** (attempt - 1));
  return undefined;
}

export async function sendTelegramMessage(
  db: PrismaClient,
  telegram: Telegram,
  chatId: string,
  text: string,
  context: DeliveryContext,
  extra?: SendExtra,
) {
  return trackedDelivery(db, context, chatId, () => telegram.sendMessage(chatId, text, extra));
}

export async function editTelegramMessage(
  db: PrismaClient,
  telegram: Telegram,
  chatId: string,
  messageId: number,
  text: string,
  context: DeliveryContext,
  extra?: EditExtra,
) {
  return trackedDelivery(db, context, chatId, () => telegram.editMessageText(chatId, messageId, undefined, text, extra));
}

export async function pinTelegramMessage(
  db: PrismaClient,
  telegram: Telegram,
  chatId: string,
  messageId: number,
  context: DeliveryContext,
  extra?: PinExtra,
) {
  return trackedDelivery(db, context, chatId, () => telegram.pinChatMessage(chatId, messageId, extra));
}

async function trackedDelivery<T>(
  db: PrismaClient,
  context: DeliveryContext,
  chatId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const record = await db.deliveryAttempt.create({ data: { kind: context.kind, correlationId: context.correlationId, chatId } });
  try {
    const result = await retryTelegram(operation, undefined, async (attempt) => {
      await db.deliveryAttempt.update({ where: { id: record.id }, data: { attemptCount: attempt } });
    });
    const messageId = messageIdFrom(result);
    await db.deliveryAttempt.update({ where: { id: record.id }, data: { status: 'SENT', messageId, error: null, completedAt: new Date() } });
    return result;
  } catch (error) {
    await db.deliveryAttempt.update({ where: { id: record.id }, data: { status: 'FAILED', error: safeErrorMessage(error), completedAt: new Date() } }).catch(() => undefined);
    throw error;
  }
}

function messageIdFrom(value: unknown): number | undefined {
  const record = asRecord(value);
  return numberValue(record.message_id);
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
