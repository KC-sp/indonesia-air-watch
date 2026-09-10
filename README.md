# Indonesia Air Watch

Indonesia Air Watch is a private, owner-only Telegram bot that sends an hourly Indonesia iQAir city-sample update, tracks up to five custom Indonesian cities by default, stores trends, creates daily and weekly PNG graphs, sends threshold alerts and daily summaries, and can report approved official Indonesian ISPU readings.

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
3. Set `TELEGRAM_BOT_TOKEN`, `OWNER_TELEGRAM_USER_ID`, `IQAIR_API_KEY`, `OPENAI_API_KEY`, and `OPENAI_MODEL` as Railway variables. OpenAI variables are optional and power `/news`, `/sources`, and `/explain`.
4. Leave `OFFICIAL_ISPU_API_URL` and `OFFICIAL_ISPU_AGENCY` unset unless you have approved a documented government JSON endpoint. If enabled, the URL must use HTTPS on a `.go.id` domain and return the validated schema described below.
5. Railway builds the supplied Dockerfile and runs `prisma migrate deploy` before starting the service. Its readiness check uses `/ready`.

## iQAir usage and national sample

The national value is a geographically representative set of up to 12 configured iQAir cities. It is an arithmetic average of responding sample cities only, never an official national average. Coverage is shown explicitly. A persistent daily cap of 400 iQAir requests and a five-per-minute cap protect the Community-tier allocation. Scheduled reports wait for later minute slots, so a complete 12-city report can arrive two to three minutes after the hour. Tracked locations are collected first. Manual `/status` calls never consume or suppress the automatic hourly dispatch record.

All displayed observation times use WIB and SGT instead of raw UTC. Each reading includes the provider and direct data page. `/trend city` summarizes stored 24-hour observations. `/daily` shows the same daily summary that is automatically sent at 20:00 SGT. `/diagnostics` reports service, database, provider, quota, dispatch, and integration status.

`/trendgraph Jakarta daily` creates a graph from the last 24 hours of stored readings. `/trendgraph Jakarta weekly` uses the last seven days. The caption shows latest, average, low, high, direction, and cautious US AQI activity guidance sourced from AirNow. Graph generation is local and does not use OpenAI or transmit readings to another chart provider.

Enable hourly threshold warnings with `/setalert 150`, inspect them with `/alerts`, and disable them with `/removealert`. Alerts use US AQI iQAir and do not convert values to PSI or ISPU.

## Official Indonesian ISPU sources

No official ISPU provider is enabled by default. The active adapter returns `Official ISPU currently unavailable` until an owner reviews and explicitly approves a documented, public, permitted, machine-readable government source. The bot must not scrape protected pages, bypass access controls, or use iQAir values in place of ISPU.

The optional deterministic JSON adapter requires `OFFICIAL_ISPU_API_URL` and `OFFICIAL_ISPU_AGENCY`. It accepts only HTTPS `.go.id` endpoints and validates this response shape: `{ "value": 85, "metric": "ISPU PM2.5", "city": "Jakarta", "category": "Sedang", "observedAt": "ISO timestamp", "period": "24-hour", "station": "station name", "sourceUrl": "https://...go.id/..." }`. It rejects mismatched cities, malformed data, and non-government source URLs.

`/sources` is intentionally informational until a vetted source-discovery workflow has produced a PostgreSQL candidate. `/approvesource` must only approve a recorded candidate after the owner explicitly confirms it; approval alone does not make the AI fetch readings. A deterministic adapter is still required.

## OpenAI news

OpenAI Responses API calls are limited to official-news summaries, source assessment, and `/explain` trend explanations. The news service uses an official-domain allowlist, requests web-search sources, validates each resulting URL, and sets `store: false`. AI never supplies, changes, converts, or estimates an air-quality measurement and is not involved in authorization or Telegram dispatch.

## Commands

`/start`, `/status`, `/air city[, state]`, `/setregion`, `/addregion city, state`, `/regions`, `/removeregion`, `/setalert number`, `/alerts`, `/removealert`, `/trend city`, `/trendgraph city daily|weekly`, `/daily`, `/explain city`, `/diagnostics`, `/news [topic]`, `/sources`, `/approvesource source-id CONFIRM`, `/version`, `/whoami`, `/help`.

`/help` uses a small category button menu so the owner does not need to read or remember the complete command list at once.

Every command, text update, inline keyboard action, and callback is checked against `OWNER_TELEGRAM_USER_ID`. A non-owner receives only `This is a private bot.`
