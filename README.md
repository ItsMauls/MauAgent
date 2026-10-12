# MauAgent

Multi-agent AI creative agency. PRD: `PRD-MAUAGENT.md` · decisions: `DECISIONS.md`.

## Run locally (Phase 0)
1. Node 22 recommended (20.11 works, but some dependencies want ≥20.19/22).
2. `cp .env.example .env`, then fill in Auth0, the AI and Apify keys (below) and ModelArk.
3. Postgres + S3: `docker compose up -d` (or your own Postgres/MinIO/S3, adjust `.env`).
4. `npm install && npm run db:migrate && npm run db:seed`
5. Terminal 1: `npm run dev` · Terminal 2: `npm run inngest` (UI at http://localhost:8288)
6. Open http://localhost:3000 → New brief.

Demo data: `npm run db:seed:demo` (2 campaigns; rerun after starting S3 so the demo videos play).

Tests: `npm test` (Producer, ffprobe validation, 1080×1920 final cut, AI layer, trend source; no DB/API key needed).

## AI model (OpenRouter)
Every agent calls the model through one function (`src/lib/ai/generate.ts`). Only four variables live in `.env`:

| Variable | |
| --- | --- |
| `AI_API_KEY` | required, an OpenRouter key (`sk-or-v1-…`) |
| `AI_BASE_URL` | required, `https://openrouter.ai/api/v1` |
| `AI_MODEL` | required, the default model, e.g. `nvidia/nemotron-3-super-120b-a12b:free` |
| `AI_API_KEY_FALLBACK` | optional, used when the primary key gets 401/402/429/5xx |

Model per agent, reasoning effort, max output tokens, temperature and the LLM caps (monthly US$, per call US$, monthly tokens) are set at **Settings → AI model** (`/settings/ai`) and apply within 30 s without a restart. "Test connection" makes one small call. Every call is written to `CostEntry`.

## Trend source (Apify TikTok Trends)
Set `APIFY_API_TOKEN` in `.env` (`APIFY_TIKTOK_TRENDS_ACTOR_ID` is optional, default `GULLsEZsAD69QFACQ`). There is no settings page: **Trends** (`/trends`) shows cached TikTok hashtags and top videos for 7 and 30 days in your country (stored on first visit, else Indonesia). A daily sync fills the cache; **Sync now** forces one (needs the Inngest dev server). One sync is 4 actor runs. The Account Manager uses the top 5.
