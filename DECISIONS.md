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
- **UI language stays English** (product owner, 12 Oct 2026), overriding PRD §6 "Bahasa Indonesia by default". Routes: `/approval`, `/campaigns/workflow` (was `/pipeline`, redirected), `/costs`, `/trends`, `/analytics`. Detail route stays `/campaigns/[id]`.
- **Sidebar items are added in the stage that builds the page** (no links to pages that don't exist yet). Final order: Campaigns, Briefs, Approval, Pipeline, Costs, Trends, Analytics, Settings.
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
- **"Log" = Step history per campaignId + step** across all runs, with the full error and the Inngest run ID, at `/campaigns/workflow?campaign=…&step=…`. There is no separate log store; Step rows are the structured log.
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

## Stage 2: Agent memory
- **Owner confirmed (12 Oct 2026):** episodic memory is written on `APPROVED`. Post-metric reflection (Stage 3) listens to `campaign/metrics.snapshot` and is tested with a synthetic event.
- **Tables:** `AgentMemory` holds all three layers (`MemoryLayer` enum: `episodic|lesson|procedural`) with tags, evidence `campaignIds`, `confidence`, `pinned` and `archivedAt`. `AgentMemoryUse` records `(runId, role) → memoryIds`. It is unique per run and role, so a step retry overwrites the row instead of adding one. Memory version history (restore) comes with the Stage 5 edit UI.
- **Episodes are built in code, not by an LLM** (`buildEpisodes` in `src/lib/agents/memory.ts`), so they cost nothing. Each one holds a summary of the role's latest artifact plus the client outcome: approved first pass, or the number of client revisions aimed at that role and their notes. Regenerate counts as a Videographer revision. Each episode links to its artifact; the Videographer has no artifact and links through `campaignId`. An invalid artifact payload means no episode for that role.
- **Trigger:** the pipeline sends `campaign/approved` after the `finish` step. The separate `agent-episodes` function writes the episodes in one step. Its idemKey is `episode:<campaignId>:<role>`, and an upsert with `update: {}` means a retry never duplicates rows or overwrites owner edits.
- **One writer.** `writeMemory` → `sanitizeMemory` redacts secrets and personal data and caps content at 600 characters. The filter covers private keys, JWTs, bearer tokens, URL credentials, `password=`/`token=`/`api_key=`, `sk-`/AWS/Google/GitHub/Slack keys, emails, any number of 9 or more digits (phones, cards, NIK; dates have fewer) and long mixed letter-digit tokens. It redacts rather than rejects, so the rest of the memory is kept.
- **Retrieval** (`selectMemories`): procedural memories first, then lessons and episodes ranked by pinned (+100), tag overlap ×2, confidence ×3 and recency (e^(−age/90 days)). Archived memories are never used. Items are packed until `Setting.memoryTokenBudget` (default 800) is reached, with tokens estimated as characters/4. Tags are the platforms plus content words (4 or more letters) from product, audience and objective. The job type is the role itself. No pgvector.
- **Injection:** the memory block is appended to the persona system prompt and says the brief, brand kit and budget cap win on conflict. Memory is recalled only inside a pipeline run, so the router and ad-hoc calls get none.
- **Flag:** `Setting.memoryEnabled` (default on). Off means no recall, no episodes and no `AgentMemoryUse` rows, which is exactly the old path. The UI toggle comes in Stage 5.
- **Experience is computed on read** (`agentExperience`), not stored. A role "worked on" a campaign if it has an artifact there (the Videographer if the campaign has shots). Delivered = `APPROVED|PUBLISHED`. First-pass rate = delivered campaigns with no revision aimed at that role. Seniority is a pure function: Lead at 75 delivered and ≥0.8, Senior at 30 and ≥0.7, Mid at 10 and ≥0.5, otherwise Junior. Thresholds are in `LEVELS`.
- **Size and decay:** content is capped and recall decays by recency now. Archiving, per-role caps and confidence decay come in Stage 3 consolidation.

## Role workspaces: audit (12 Oct 2026)
This brief adds the Socmed Specialist and Socmed Officer workspaces and a Talent Manager. It assumes things this repo does not have:
- **No monorepo** (see Phase 0). `apps/web` and `packages/*` map to `src/app`, `src/lib/{agents,workflows,providers,media}` and `prisma/`.
- **Brief overridden by earlier owner rulings:** the UI is English, not Indonesian (above). Seedance replaces Veo, so the brief's `veo_api` is `seedance_api`.
- **Missing before this work:**
  - Publishing: no F11 code, no `Publisher`, no `PublishJob`.
  - Data: no `MetricSnapshot` or `TrendSignal`.
  - Accounts: no OAuth and no token encryption.
  - Pages: no Costs, Trends, Analytics or Agent Team page, and no "Connected accounts" Settings tab. Settings is one form, so there is no data to migrate.
  - Providers: no Gemini image provider.
  - Agents: no deliberation.
  - Libraries: no PDF library and no sharp.
- **Present and reused:**
  - Agents: personas (`agents/persona.ts`) and memory and experience (`agents/memory.ts`).
  - Cost and status: budget gate and PriceBook (`cost.ts`), and the state machine (`status.ts`).
  - Media: S3 presign with a 15-minute TTL (`s3.ts`) and FFmpeg (`media/`).
  - App patterns: the server action → `inngest.send` flow (`app/actions.ts`), and the root `loading.tsx`/`error.tsx`, which cover every route.

## Role workspaces: decisions
- **Publishing (owner, 12 Oct 2026):** the `PublishJob` table and account connection land now. The Instagram/TikTok/Orshot publishers and multi-account posting land with the Officer workspace (Stage 5). Until then the pipeline still ends at `APPROVED`.
- **OAuth behind env (owner, 12 Oct 2026):** there are no Meta/TikTok apps yet. Without keys, the Connect button is disabled and the page names the env vars to set.
- **Schema lands per stage** (same rule as above):
  - Stage 1 migrates `SocialAccount` and `PublishJob` only.
  - `ContentStrategy`, `ContentPlan` and `ContentItem` land in Stage 4; `Report` lands in Stage 6. The brief lists them all under Stage 1, but nothing uses them before those stages.
- **`ContentItem` → `Campaign` is 1:1** (Stage 4), via a nullable unique `Campaign.contentItemId`. Campaigns created from New Brief stay valid without an item. `campaign/brief.submitted` gains optional `contentItemId`, `talentIds`, `locationId` and `targetAccountIds` fields, so old events still parse.
- **Single user.** Workspaces are sidebar groups, not permissions. To support more users later, add `ownerId`/`workspaceId` columns to the new tables and scope queries by them. No auth model changes now.
- **Sidebar groups:**
  - Groups: Operations (Campaigns, Briefs, Approval, Pipeline), then Social Media Specialist (Accounts), then Settings.
  - The Officer and Insights groups appear once their pages exist, following the rule that items arrive with their page.
  - Settings links to `/accounts`.
- **Mapping for later stages:**
  - Talent collage: FFmpeg `xstack` + `drawtext`, so no new dependency.
  - Talent cost: needs `CostEntry.campaignId` to be nullable (already planned) and a new `CostReason` value `talent_generation`.
  - Seedance reference images: verify support in the ModelArk docs. The fallback is a Gemini keyframe → image-to-video.
  - PDF approach: decided in Stage 6.
  - Deliberation: does not exist, so Stage 7 only adds the two roles, their personas and memory, plus hook points.

## Stage 1 (workspaces): social accounts
- **Tokens are encrypted with AES-256-GCM** (`src/lib/crypto.ts`, `node:crypto`).
  - Stored format: `v1:iv:tag:ciphertext`. The key comes from env `TOKEN_ENC_KEY` (32-byte hex).
  - Without a valid key, encryption throws; plaintext is never stored. Rotating the key orphans existing tokens (reconnect). Key rotation is not built.
- **Tokens never reach the client.** Pages select through `ACCOUNT_PUBLIC_SELECT` (`src/lib/accounts.ts`), which has no `*Enc` columns, and a test enforces that. Provider error strings never include the request URL, because Meta takes `access_token` as a query parameter.
- **One OAuth route per platform:** `/api/oauth/[platform]` starts the flow when there is no `code` or `error` in the URL; otherwise it acts as the callback.
  - `state` is a random value kept in an httpOnly cookie scoped to the route path and compared in constant time.
  - Auth0 middleware already guards the route.
  - Reconnecting the same platform account updates its tokens and reactivates it (unique on `(platform, platformUserId)`).
- **Instagram** uses the Instagram API with Instagram Login, verified against Meta's docs in Oct 2026:
  - Scopes: `instagram_business_basic`, `instagram_business_content_publish`.
  - Tokens: the code → short-lived token is exchanged for a 60-day long-lived token, refreshed with `ig_refresh_token`.
  - Profile: `/me?fields=user_id,username,account_type`. `user_id` is the IG account ID used in API paths.
  - Quota: `GET /{ig-user-id}/content_publishing_limit?fields=quota_usage,config`. The reference says the total is currently 50 per 24 h.
  - The Graph version comes from env `IG_GRAPH_VERSION` (default `v25.0`).
- **TikTok** uses Login Kit for Web v2 (no PKCE for web):
  - Scopes: `user.info.basic`, `video.upload`.
  - Lifetimes: the access token lasts 24 h and the refresh token 365 d.
  - Handle: `display_name`, because `@username` needs `user.info.profile` and an extra app review.
  - TikTok redirect URIs must be https, so local testing needs a tunnel.
  - The audit status is entered by hand on the account card.
- **Token status is computed on read** (`tokenStatus`), not stored:
  - The deadline is the refresh token's expiry when there is one (TikTok); otherwise it is the access token's expiry.
  - Under 7 days left → "expiring". Expired, or `lastError` starting with `reauth` → "reconnect needed".
  - A banner on `/accounts` lists accounts in either state, with a Reconnect link.
- **Daily check** (`accounts-refresh`: Inngest cron at 03:00 Asia/Jakarta, plus the event `accounts/refresh` from "Check now"):
  - Refreshes access tokens within 7 days of expiry (every TikTok token, every day).
  - Reads the IG quota.
  - Writes failures to `lastError` instead of retrying. An invalid-token response (HTTP 401, Meta code 190, a TikTok error body) is prefixed `reauth:`.
  - The calls are free, but they still run in Inngest so the dashboard never calls providers directly.
- **Deactivate keeps the row** and its `PublishJob` history; there is no delete. Publisher choices are restricted per platform (Instagram Graph only for Instagram, TikTok inbox only for TikTok; Orshot for both).
- **`PublishJob`** stores one row per campaign per target account, with `idemKey = campaignId:socialAccountId`. Nothing writes to it until Stage 5. The account card's "scheduled posts" count reads from it.
- **Known gaps:**
  - The per-account performance summary needs `MetricSnapshot`, so it comes with Analytics.
  - The Stage 5 publish step will refresh a TikTok token on demand, because the daily check alone can leave it expired for part of the day.

## AI Content Creator
- **Library at `/creator`** (sidebar under Operations): characters, locations and video styles (`CreativeAsset`, `kind` enum) with optional reference image URLs. Style presets (8-bit pixel art, 2D animation, 3D cartoon, Anime, Claymation, Live action) are one-click adds, not seeded rows.
- **Many-to-many with Campaign.** Link at brief time (Creative kit chips on `/brief`) or later from each library card (link/unlink any campaign, any status).
- **Only the Art Director reads the kit** (`creativeKitPrompt` in `src/lib/agents/index.ts`), loaded in the pipeline `init` step. It must build `characterDescription`, shot settings, `moodboardPrompts[0]` and `styleRefImageUrls` from it, so the kit reaches the Seedance prompt package through the existing fields. A kit change on an existing campaign applies from its next Art Director run (a revision routed to the Art Director, or an earlier stage).

## Boards: audit (12 Oct 2026)
- **Owner rulings for this brief:** UI stays **English** (the brief asked for Indonesian; same override as above). **Talent = `CreativeAsset` kind `character`**, no separate Talent table. The pending AI Content Creator work was committed first.
- **Brief assumes things this repo does not have:** Deliberation/DeliberationMessage, ContentItem, Talent, MetricSnapshot, TrendSignal, Strategy/Planning/Reports pages, a planning calendar, vidIQ/ElevenLabs/Notion/Threads code, Veo (Seedance replaced it) and dark-mode tokens. There was **no Specialist/Officer sidebar group**: only `/accounts` (account menu) and `/creator` (Operations).
- **Reused:** `callLlm`/agent functions + `saveArtifact`, `budgetGate`/`monthSpent`, `tokenStatus` + `ACCOUNT_PUBLIC_SELECT`, `agentExperience`, `getPersona`, `formatDuration`, `presignGet`, `AutoRefresh`, `UploadSlot`/`CopyBlock`, and the pipeline's `from` + `load-<role>` reuse (= the brief's `startFrom`).

## Boards: Stage 1 (navigation, agenda, integrations)
- **One roles list** (`src/lib/boards/roles.ts`): sidebar children, `/boards/[role]` and the cards all read `ROLES`. Content Creator = agent role `videographer`, QC = `accountTeam`; Socmed Specialist and Talent Manager have no LLM role (keys `socmedSpecialist`, `talentManager` for tasks).
- **Old routes:** `/creator` permanently redirects to `/boards/content-creator?tab=library` and its page became the `CreatorLibrary` component (Talent Manager shows it filtered to characters). `/accounts` stays (Settings menu) and is also the Socmed Specialist "Accounts" tab (same page component, no copy). Shot cards moved to `campaigns/[id]/shots.tsx` so the Content Creator "Execution queue" reuses them.
- **Sidebar status dots** come from `boardSnapshot()` + `roleWork()` (`src/lib/boards/status.ts`, pure): busy = a running Step of a running Run (videographer: pending Seedance shots of a running run, since it has no Step rows); waiting = campaign parked at a gate the role owns (upload → Content Creator, budget → Producer, approval → QC) or a queued/waiting task; else idle. Brought forward from Stage 2 because the sidebar needs it. A snapshot failure hides the dots, never the shell.
- **Agenda** uses `Setting.timezone` (new, default `Asia/Jakarta`; no UI yet). Items: scheduled `PublishJob`s, brief deadlines, and the 7-day decision timeout of the approval/budget gates (start = end of the latest QC/Producer step). Agent sessions and report deliveries have no data source yet. **"Open calendar" is omitted**: there is no planning calendar; the card's own month grid is the calendar until one exists.
- **Integrations** (`src/lib/integrations.ts` registry): states connected / key set, not verified / needs attention / not active / coming soon. "Connected" only when verified: IG/TikTok from active `SocialAccount` + `tokenStatus`; S3 and Gemini from the cached health check. Seedance has no free verification endpoint, so a set key shows "key set, not verified". Orshot, ElevenLabs and vidIQ show "not active" (no code yet; vidIQ credits appear once Trend Scout exists). **Threads and Notion are "coming soon"** (outside PRD v1), with no publisher or sync.
- **Health check:** Inngest `integrations-health` (daily 03:10 Asia/Jakarta + `integrations/check` from the card's Check button) runs free calls only (S3 `HeadBucket`, Gemini model list with the key in a header) and caches them in `IntegrationStatus`. The page never calls a provider.
- **Card isolation:** each card is an async server component in its own `<Suspense>` with a skeleton; `load()` turns a failure into that card's error state.
- **Migration** `20261012140000_boards_integrations` was renamed (local clock gave it an earlier timestamp), same as before.

## Boards: Stage 2 (team focus, agent sessions)
- **Team focus** cards: persona nickname (one `AgentProfile` query, JSON default as fallback), role, seniority from `agentExperience`, status from `roleWork`, up to 2 work items (+n) with time in stage, and the last delivered campaign the role worked on ("Approved/Published …, first pass | after n revisions"). Engagement rate is left out until `MetricSnapshot` exists. "Filter archive" sets `?agent=` for card D. Latest feedback joins in Stage 6.
- **Agent sessions = pipeline Runs** (no Deliberation entity exists, so **no `AgentSession` table**: it would have no writer). Participants are the roles with Steps in the run, the green dot is the running Step, From/To are the run's start/end ("Ongoing"), and Adopted/Skipped are the Creative Director's chosen vs. other concepts in that campaign. "Enter meeting room" opens the campaign on the Workflow page. With no live run, the last run is shown. When deliberation lands, it can add a `Deliberation` table and this card reads it instead.
- **Near real time:** the Boards page uses the existing `AutoRefresh` (10 s, only while the tab is visible). No SSE.
- **No paid call on load:** every card reads Postgres only; the sole outbound calls are in Inngest functions.
- **Indexes** for Boards queries: `Step(runId)`, `Step(agentRole,status)`, `Run(campaignId,status)`, `Artifact(agentRole,createdAt)`, `Campaign(status)` (migration `20261012150000_boards_indexes`, renamed like the others).

## Boards: Stage 3 (archive & sources)
- **Search is Postgres `ILIKE` only** (no vectors, no LLM): campaigns by brief JSON or any artifact payload (`::text ILIKE`), prompt packages by `Shot.promptPackage::text`, discussion notes by `Decision.notes`, talent/assets by name and description. `%`/`_` in the query are taken literally. Reports are not searchable and hide while a query is set.
- **Types:** Campaign history, Reports, Video (valid shot clips + final cuts), Talent (library characters), Assets (library locations and styles), Prompt packages, Discussion notes (client decision notes). **Audio is left out** entirely, chip included: nothing produces audio yet (no ElevenLabs).
- **Agent AND type** (`archiveSections`): a section shows when it matches the type and the agent can produce it. Campaigns, reports and notes take every agent and filter inside the query (campaigns the role worked on, cost spent by that role, notes aimed at it — regenerate notes go to the Content Creator).
- **Reports are computed in code** from `Artifact.costUsd` + `CostEntry` (the same sum as the budget caps): spend, cost per approved video, approved videos and the regenerate share of video cost, this calendar month vs the last, with up/down arrows. Views and engagement wait for `MetricSnapshot`; impressions and plays are never shown.
- **Outcome labels** (`src/lib/boards/outcome.ts`, used here and in Stage 6): rejected / failed / expired from the status; a delivered campaign (APPROVED counts, since publishing is not live) is a success, or needs_revision when the client sent a revise/regenerate (aimed at the role, for a per-agent label); anything else is in progress.
- **Pagination:** 6 per section, `?p_<type>=n`, reset when a filter changes. Video merges two lists by fetching (page+1)×6 of each (`ponytail:` note in code).
- **Files:** links are 15-minute presigned URLs (local signature, no network). File size is not shown: it would need an S3 `HeadObject` per item on render.
- **Load time** was checked per query against the local DB (all archive probes together ≈0.3 s), not as a full authenticated page load.
