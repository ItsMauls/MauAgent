# DECISIONS

Decisions that deviate from, or are not covered by, PRD v1.0 (11 Oct 2026).

## From the product owner
- **Video: BytePlus ModelArk (Seedance) replaces Veo.** Gemini stays for LLM, keyframes, QC.
- **Manual Upload is a permanent mode.** Two sources: `seedance_api` | `manual_upload`. Default set in Settings, overridable per campaign in the brief form. A failed Seedance shot automatically opens a manual upload slot.
- **Budget caps are configurable** in `/settings` (default per campaign + per month). Monthly cap enforcement: Phase 1.
- **Approval reminders: email only** (Phase 1).
- **IG/TikTok accounts are already Business/Creator**; the "Connect account" page (OAuth) is built at the start of Phase 1.

## Technical (Phase 0)
- **One Next.js app, not a monorepo.** PRD §8 packages become `src/lib/{agents,workflows,providers,media}`. Split into packages if a separate worker appears.
- **Prisma 6, AI SDK 5, Inngest 3** are pinned (latest majors not yet verified for this project).
- **Producer without an LLM.** Per-shot source comes from the toggle and cost from `PriceBook`, so it is fully deterministic.
- **No `VideoProvider` interface.** There is only one implementation (`providers/seedance.ts`). Add the interface when a second provider appears.
- **Seedance:** `POST /contents/generations/tasks`, then poll every 15 seconds (max 15 minutes), with `ratio: "9:16"`, `generate_audio: true`. Fields come from secondary sources; **verify against the official ModelArk docs** before production. Model IDs are in env.
- **Seedance idempotency:** task creation runs in its own `step.run` (memoized by Inngest), and `CostEntry.idemKey` is unique. Remaining gap: if `createSeedanceTask` succeeds but the step fails before returning, the retry creates a second task.
- **Waiting for upload:** `waitForEvent` with a 1-hour timeout inside a loop that checks the DB (max 14 days), because an event sent before the wait is active can be missed.
- **FFmpeg** uses `ffmpeg-static`/`ffprobe-static` (no system install needed). Post-production runs inside the `/api/inngest` request (`maxDuration` 300). Move to an ECS worker if clips get long.
- **PriceBook seed contains price 0 (placeholder).** Fill in from the official pricing pages.
- Entities `TrendSignal`, `PublishJob`, `MetricSnapshot` are not created yet (Phase 1/2).
