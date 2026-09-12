export function safeErrorMessage(error: unknown, maxLength = 500): string {
  const raw = error instanceof Error ? error.message : String(error);
  const knownSecrets = [process.env.TELEGRAM_BOT_TOKEN, process.env.IQAIR_API_KEY, process.env.OPENAI_API_KEY, process.env.DATABASE_URL]
    .filter((value): value is string => Boolean(value));
  const genericRedaction = raw
    .replace(/bot\d+:[A-Za-z0-9_-]+/g, 'bot[REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]+\b/g, '[REDACTED]')
    .replace(/([?&](?:key|token|api_key)=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/(postgres(?:ql)?:\/\/)[^@\s]+@/gi, '$1[REDACTED]@');
  return knownSecrets.reduce((message, secret) => message.replaceAll(secret, '[REDACTED]'), genericRedaction).slice(0, maxLength);
}

export function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError';
}
