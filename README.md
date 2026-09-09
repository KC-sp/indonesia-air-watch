# Indonesia Air Watch

Indonesia Air Watch is a private, owner-only Telegram bot that sends an hourly Indonesia iQAir city-sample update at minute 0 in Asia/Singapore, supports up to three extra iQAir locations, and can report approved official Indonesian ISPU readings.

It does not use the term PSI. iQAir values are always labelled **US AQI iQAir**. Indonesian government values are only displayed as **ISPU <agency>** with their metric and stated period. The bot never converts one scale to another.

## Requirements

- Node.js 22 or newer and pnpm
- A Telegram bot token
- PostgreSQL locally or Railway PostgreSQL
- Optional iQAir and OpenAI credentials

## Create the Telegram bot and find the owner ID

1. In Telegram, open **@BotFather**, send `/newbot`, and copy the token it gives you.
2. Copy `.env.example` to `.env`, set `TELEGRAM_BOT_TOKEN`, then run `pnpm telegram:owner-id`.
3. Message the new bot once. The helper prints your numeric Telegram user ID locally; put it in `OWNER_TELEGRAM_USER_ID`.

Never commit `.env`, the Telegram token, database URL, or API keys.

## Local development

```sh
corepack enable
pnpm install
cp .env.example .env
pnpm prisma:generate
pnpm prisma:migrate
pnpm dev
```

Run checks with `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build`.

The service exposes `GET /health` and `GET /ready`. It uses Telegram long polling, not webhooks.

## Railway deployment

1. Push this directory to GitHub and create a Railway project from the repository.
2. Add Railway PostgreSQL and copy its `DATABASE_URL` into the service variables.
3. Set `TELEGRAM_BOT_TOKEN`, `OWNER_TELEGRAM_USER_ID`, `IQAIR_API_KEY`, `OPENAI_API_KEY`, and `OPENAI_MODEL` as Railway variables. Do not put them in source control.
4. Railway builds the supplied Dockerfile and runs `prisma migrate deploy` before starting the service. Its readiness check uses `/ready`.

## iQAir usage and national sample

The national value is a geographically representative set of up to 12 configured iQAir cities. It is an arithmetic average of responding sample cities only, never an official national average. Coverage is shown explicitly. A persistent daily cap of 400 iQAir requests and a five-per-minute cap protect the Community-tier allocation. Cached readings are fresh for 15 minutes; unavailable or partial data is labelled as such.

## Official Indonesian ISPU sources

No official ISPU provider is enabled by default. The active adapter returns `Official ISPU currently unavailable` until an owner reviews and explicitly approves a documented, public, permitted, machine-readable government source. The bot must not scrape protected pages, bypass access controls, or use iQAir values in place of ISPU. A future approved adapter must retain agency, station, metric, period, observation time, and direct source URL.

`/sources` is intentionally informational until a vetted source-discovery workflow has produced a PostgreSQL candidate. `/approvesource` must only approve a recorded candidate after the owner explicitly confirms it; approval alone does not make the AI fetch readings. A deterministic adapter is still required.

## OpenAI news

OpenAI Responses API calls are limited to official-news summaries and source assessment. The news service uses a configurable exact-domain allowlist, requests web-search sources, validates each resulting URL against that allowlist, and sets `store: false`. It is not involved in scheduled air collection, authorization, configuration, database updates, or Telegram dispatch.

## Commands

`/start`, `/status`, `/air city[, state]`, `/setregion`, `/regions`, `/removeregion`, `/news [topic]`, `/sources`, `/approvesource source-id`, `/version`, `/whoami`, `/help`.

Every command, text update, inline keyboard action, and callback is checked against `OWNER_TELEGRAM_USER_ID`. A non-owner receives only `This is a private bot.`
