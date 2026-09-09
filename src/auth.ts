import type { Context, MiddlewareFn } from 'telegraf';

export const ownerOnly = (ownerId: string): MiddlewareFn<Context> => async (ctx, next) => {
  if (String(ctx.from?.id ?? '') !== ownerId) { await ctx.reply('This is a private bot.').catch(() => undefined); return; }
  await next();
};
