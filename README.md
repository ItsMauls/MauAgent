# MauAgent

Multi-agent AI creative agency. PRD: `PRD-MAUAGENT.md` · decisions: `DECISIONS.md`.

## Run locally (Phase 0)
1. Node 22 recommended (20.11 works, but some dependencies want ≥20.19/22).
2. `cp .env.example .env`, then fill in Auth0, Gemini, ModelArk.
3. Postgres + S3: `docker compose up -d` (or your own Postgres/MinIO/S3, adjust `.env`).
4. `npm install && npm run db:migrate && npm run db:seed`
5. Terminal 1: `npm run dev` · Terminal 2: `npm run inngest` (UI at http://localhost:8288)
6. Open http://localhost:3000 → New brief.

Demo data: `npm run db:seed:demo` (2 campaigns; rerun after starting S3 so the demo videos play).

Tests: `npm test` (Producer, ffprobe validation, 1080×1920 final cut; no DB/API key needed).
