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

## Dashboard menus: audit (12 Oct 2026)
State before this work (Phase 0 code):
- Routes: `/` (campaign list + stats), `/brief`, `/campaigns/[id]` (pipeline steps, shot cards, upload slots, artifacts, approve/reject), `/settings` (budget caps + default source), `/api/inngest`. Sidebar `src/app/nav.tsx`, styles in `globals.css` (`card`, `pill`, `btn-*`, `input`, `label`), client widgets in `src/app/ui.tsx`, server actions in `src/app/actions.ts`.
- Auth: `src/middleware.ts` guards every route except `/auth/*` and `/api/inngest`, so new pages and server actions are protected automatically.
- Prisma: BrandKit, Setting (singleton), Campaign, Run, Step, Artifact, Shot, ShotAsset, Decision, CostEntry, PriceBook. Missing: TrendSignal, PublishJob, MetricSnapshot.
- Inngest: one function `campaign-pipeline` (`campaign/brief.submitted`); waits on `campaign/assets.complete` and `campaign/client.decision`.
- Tests: `node:test` via `tsx` (`npm test`), no DB needed.

Gaps vs PRD F10/F13:
- Pipeline mapped every non-approve decision to REJECTED; no revise/regenerate loop, no revision routing.
- No budget gate (only a ponytail note); monthly cap not enforced server-side.
- No Account Team QC / `ApprovalPackage` (captions, hashtags, brand-safety, self score).
- `decide()` supported approve/reject only; no regenerate estimate; no version compare/restore.
- Seedance `CostEntry.idemKey` was fixed to attempt `:1`, so a regenerate would have been silently not charged.
- No Approval, Pipeline, Costs, Trends, Analytics pages; Settings is a single form; no loading/error states.
- No publishing (F11), Trend Scout (F12) or metrics pulls yet, so Publication/Trends/Analytics have no data source.

## Dashboard menus: decisions
- **UI language stays English** (product owner, 12 Oct 2026), overriding PRD §6 "Bahasa Indonesia by default". Routes: `/approval`, `/pipeline`, `/costs`, `/trends`, `/analytics`. Detail route stays `/campaigns/[id]`.
- **Sidebar items are added in the stage that builds the page** (no links to pages that don't exist yet). Final order: Campaigns, New Brief, Approval, Pipeline, Costs, Trends, Analytics, Settings.
- **New status `AWAITING_BUDGET`** for the budget gate (PRD §3.1 has no state for it). It appears in the Approval queue and the sidebar badge together with `AWAITING_APPROVAL` and `AWAITING_VIDEO_UPLOAD`.
- **Budget gate** runs after the Producer and checks both the campaign cap and the monthly cap (`src/lib/cost.ts › budgetGate`). Event `campaign/budget.decision` `{action: proceed|cancel}`; "change cap" updates `Campaign.budgetCapUsd` in the server action, then sends `proceed`. Timeout 7 days → `EXPIRED`.
- **Revise/regenerate = a new run of the same function.** `campaign/brief.submitted` accepts `{from, notes, shotIds, reason, budgetConfirmed}`; stages before `from` reuse their latest Artifact. Each round gets its own `Run` (old one marked `superseded`), which keeps step IDs unique and makes every round visible on the Pipeline page.
- **Revision routing:** the user may pick the target (Concept / Visuals / Edit); otherwise a small LLM call classifies the note (`routeRevision`, artifact `router`). The chosen target is written back to `Decision.targetAgent`.
- **Regenerate:** the estimate is computed from PriceBook in code (`estimateRegenerate`), shown before execution and re-checked in the server action; over cap requires an explicit confirmation checkbox, otherwise the action throws. Manual shots cost US$0 and get a fresh round of `maxAttempts` upload attempts. Seedance idemKey is now `campaignId:seedance:shotId:runId`; `CostEntry.reason` comes from the run (`initial`/`revision`/`regenerate`).
- **Account Team QC is text-only for now** (brief + concept + shot list → captions, hashtags, brand-safety checklist, self score). `costSoFar` is computed in code. Multimodal QC of the final cut comes later.
- **Free restore:** a final cut is restored by copying the old `postProduction` artifact as a new version and pointing `finalCutKey` at it; a shot clip is restored by copying an old valid `ShotAsset` as a new version. No generation, no cost; history is kept.
- **Version compare:** final cuts side by side on the Approval card; artifacts side by side (JSON) with a list of changed top-level fields on the Artifacts tab. No diff library.
- **Known gap:** post-production does not interpret edit notes yet, so a revision routed to post-production re-renders the same cut until full F8 post-production exists.
- **Known race (accepted):** an event sent in the few ms between a status change and `waitForEvent` becoming active is missed; same as the existing decision wait. The UI only shows the buttons once the status is set.
- **Publication tab is an empty state** until F11 adds `PublishJob`.

## Stage 2: Pipeline
- **The state machine is enforced in code** (`src/lib/status.ts`). Pipeline status changes go through an atomic conditional update (`WHERE status IN allowedFrom(to)`). An invalid jump throws `NonRetriableError`, so the run is marked FAILED instead of silently corrupting the status. Setting the same status again is allowed (step retries). `FAILED` is reachable from any non-terminal status. The transitions include the rerun paths: REVISING/REGENERATING → AWAITING_BUDGET / AWAITING_VIDEO_UPLOAD / POST_PRODUCTION → AWAITING_APPROVAL.
- **Lanes come from the latest Run.** A stage with no Step row but an existing artifact is shown as "Reused" (a rerun skipped it). The Videographer has no Step rows (it is many small Inngest steps), so its lane is derived from the shot slots.
- **"Log" = Step history per campaignId + step** across all runs, with the full error and the Inngest run ID, at `/pipeline?campaign=…&step=…`. There is no separate log store; Step rows are the structured log.
- **Polling:** `router.refresh()` every 10 s while the tab is visible (`AutoRefresh`). No websocket.
- **Demo data:** `npm run db:seed:demo` (`prisma/seed-demo.ts`) creates `demo_kopi` (awaiting approval after one post-production revision) and `demo_bakery` (failed at the Creative Director after 4 attempts). It is idempotent with fixed IDs. Its videos are real ffmpeg clips uploaded to S3 when S3 is reachable. The demo campaigns have no live Inngest run, so decisions on them create a Decision row and send the event, but nothing advances.

## Agent personas & memory: audit (12 Oct 2026)
- **No `packages/`.** The brief's `packages/agents|workflows|db` map to `src/lib/agents`, `src/lib/workflows`, `prisma/`. Personas live in `src/lib/agents/personas/`.
- **There is no `runAgent`.** Every LLM agent goes through `callLlm(role, schema, prompt)` (`src/lib/agents/index.ts`) → `generateObject`. Before this work it used one shared system prompt. LLM roles: accountManager, creativeDirector, artDirector, accountTeam, plus `router`. The Producer is deterministic; Videographer and Post-production have no LLM.
- **Prompts** are inline strings in each agent function in `src/lib/agents/index.ts`.
- **Costs:** LLM cost is stored on `Artifact.costUsd`, not `CostEntry`. Only Seedance writes `CostEntry` (`idemKey` unique; `reason` = `initial|revision|regenerate`). `campaignSpent`/`monthSpent` sum both tables, so a new `CostEntry` counts toward the caps without changes.
- **Gaps that shape later stages:** `PUBLISHED` is unreachable (no F11) and `MetricSnapshot` doesn't exist. `CostEntry.campaignId` is required, but reflection spans campaigns. There is no `/costs` page.

## Agent personas & memory: decisions
- **English everywhere** (owner, 12 Oct 2026), overriding the brief's Indonesian UI and persona voices. Same rule as the dashboard menus.
- **Schema lands per stage** (owner): each stage migrates only the tables it uses. Stage 1 = `AgentProfile` only.
- **New inputs allowed beyond artifacts** (extends PRD §4): curated agent memory (Stage 2+) and deliberation summaries for the same campaign (Stage 4). Artifacts stay the contract between stages, and artifact Zod schemas are unchanged.
- **Persona = tone and perspective only.** `personaSystem()` (`src/lib/agents/persona.ts`) builds the system prompt: agency context + persona + fixed guardrails (output must match the schema; client brief, brand kit and budget cap override the persona). The output format is still enforced by `generateObject` + the artifact schema.
- **Defaults in JSON, active version in the DB.** `personas/<role>.json` (validated by `Persona` in `schemas.ts`) are the defaults. `AgentProfile(role, version)` holds every version, and the latest one is active. A restore copies an old version as a new one, the same pattern as artifact restore. There is no separate history table. `getPersona` is read on every LLM call, so a DB edit applies to the next run without a redeploy. If a role has no row (or an invalid one), the JSON default is used.
- **Seed** creates v1 only for roles with no rows, so owner edits survive reseeding.
- **`router` has no persona** (it is a classifier, not a team member). Producer, Videographer and Post-production personas are stored now but only speak in Stage 4 deliberations.
- **Planned for later stages:**
  - Episodic memory is written when a campaign reaches `APPROVED`, because `PUBLISHED` is not reachable yet.
  - Post-metric reflection listens to `campaign/metrics.snapshot`, which nothing emits until metrics exist.
  - Stage 3 makes `CostEntry.campaignId` nullable and adds `CostReason` `deliberation`/`reflection`.
  - Memory retrieval uses tag filter + recency + confidence/pin score. No pgvector until memories per role reach the hundreds.
- **Migration naming:** `20261012100000_agent_profile` was renamed so it sorts after the hand-named `20261012090000_approval_budget_gate`. The local `_prisma_migrations` row was updated to match.
