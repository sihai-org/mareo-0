# Mareo gateway

The Mareo gateway is the thin backend that lets end users of the Mareo desktop app
use DeepSeek models **without ever handling a DeepSeek API key**. Users authenticate
to the gateway; the gateway holds your DeepSeek key and forwards model traffic.

```
Mareo desktop ── user token ──> Mareo gateway ── your DeepSeek key ──> api.deepseek.com
```

## How it works

- `POST /v1/*` (and any other path) authenticates the caller's bearer token,
  checks the per-user daily limit, proxies the request to `UPSTREAM_BASE_URL`
  with your `DEEPSEEK_API_KEY`, streams the response back, and records one usage
  row per request.
- `GET /me` lets the desktop app validate a stored token at launch.
- `GET /health` is a liveness probe.
- `POST /events` stores anonymous client events (installs, launches, harness
  exits, sign-in results). Authentication is optional: a client that cannot sign
  in has no token, and its failures are exactly what we need to count. Anonymous
  events are rate limited per address and never store the address.

Only the SHA-256 digest of each token is stored. The database lives in a single
SQLite file (`data/mareo.db`) with the tables `users`, `identities`, `tokens`,
`usage` and `events` — the same shape a future Postgres/Supabase migration can
adopt.

`npm run metrics` prints install / launch / sign-in / harness-exit / first-task
metrics from that database; definitions are in [`../docs/metrics.md`](../docs/metrics.md).

## Run locally

Requires Node.js >= 24 (uses the built-in `node:sqlite`).

```sh
cd server
npm install            # dev dependency: typescript, @types/node
cp .env.example .env   # fill in DEEPSEEK_API_KEY with your own DeepSeek key
npm start              # gateway on http://127.0.0.1:3000
```

## Issue a user token

A token is the only thing a user pastes into the Mareo sign-in screen:

```sh
cd server
npm run issue-token -- Alice
# prints one line: the token (shown exactly once)
```

`--db <path>` overrides the database location; `DB_PATH` in `.env` also works.

## Test

```sh
cd server
npm test
```

The suite runs the gateway against a local stub upstream, so it never needs a
real DeepSeek key: auth rejection, `/me`, JSON proxying, streaming, usage
accounting, and the daily limit are all exercised offline.

## Sponsored Ad Slot

Optional manual sponsored content and account-linked impression/click events use
separate `/sponsored-ad` endpoints and the `ad_events` table. No ad is shown by
default. Configuration, privacy boundaries, counting rules and rollout order:
[`../docs/sponsored-ad.md`](../docs/sponsored-ad.md).

## Deploy

Run the same code on a server (for example an Aliyun ECS instance) behind HTTPS.
The Docker packaging, nginx/Caddy TLS setup, backups, and a step-by-step
Aliyun runbook live in [`deploy/DEPLOY.md`](deploy/DEPLOY.md); the short version
is: `cd deploy`, copy `.env.example` to `.env` with your real `DEEPSEEK_API_KEY`,
then `docker compose up -d --build`. Point Mareo at the gateway with
`MAREO_GATEWAY_URL`.
