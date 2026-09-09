import pino from 'pino';

export const logger = pino({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  redact: { paths: ['*.token', '*.apiKey', '*.authorization', 'TELEGRAM_BOT_TOKEN', 'IQAIR_API_KEY', 'OPENAI_API_KEY'], censor: '[REDACTED]' },
});
