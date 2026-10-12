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

## Boards: Stage 4 (direct tasks)
- **`AgentTask`** (QUEUED/RUNNING/WAITING/DONE/FAILED, `attempt`, `estUsd`, `costUsd`, `confirmedOverCap`, `artifactId` unique, `campaignId` = campaign started from it, `requestedByRole` for hand-offs).
- **`Artifact.campaignId` is now optional** and `Artifact.agentTaskId` was added. Existing rows are untouched. The FK became `ON DELETE SET NULL` (Prisma's default for an optional relation); nothing deletes campaigns. A task's output is `campaignId = null, agentTaskId = task, version = attempt`; the `(campaignId, agentRole, version)` unique ignores nulls.
- **Task definitions** (`TASKS` in `src/lib/boards/tasks.ts`) reuse the pipeline's agent functions. Account Manager (goal, product, niche, platforms → InternalBrief), Creative Director (internal brief or a free idea → CreativeBrief), Art Director (creative brief + talent/locations/style → VisualDirection), Producer (visual direction → ProductionPlan, US$0) and Content Creator (visual direction → prompt packages, US$0). Missing ClientBrief fields (cap, source) come from Settings. Tasks get no memory recall (unchanged rule: recall only inside a pipeline run). There is no vidIQ trend cache, so the Account Manager gets no trend signals.
- **The form is generated from the Zod schema** (`z.toJSONSchema`, `io: "input"`): enums → select, enum arrays → checkboxes, `meta({ ref: role })` → picker of that role's latest artifacts, `meta({ library: kind })` → library checkboxes, `meta({ multiline })` → textarea.
- **Estimate (deterministic):** `(input + referenced artifacts + 3000 chars overhead) / 4` input tokens + a fixed 2000 output tokens, priced from PriceBook with the role's model. It is an upper bound shown before running.
- **Budget gate:** direct tasks have no campaign, so the **monthly cap** applies. It is checked in the estimate, enforced in `requestTask` (over cap throws unless confirmed) and re-checked in Inngest before the LLM unless the owner confirmed. A US$0 task is never blocked.
- **Event `agent/task.requested`** → Inngest `agent-task`: steps `start` → `budget-gate` → `agent` → `save`. The event id is `taskId:attempt` (Retry = attempt + 1). The LLM call is its own memoized step, so a later failure never repeats it. `save` creates the artifact and sets `task.artifactId` in one transaction guarded by `artifactId`, so a retried save writes once.
- **Cost stays on `Artifact.costUsd` (+ `AgentTask.costUsd`), not a `CostEntry` with reason `standalone_task`** as the brief suggested. All LLM cost already lives on artifacts and `monthSpent` sums both tables, so a CostEntry would count it twice. Direct tasks therefore count toward the monthly cap and never toward a campaign.
- **Send to flow** (AM → starts at Creative Director, CD → Art Director, AD → Producer): a form with the brief fields creates a Campaign and copies the task artifact plus the artifacts its input referenced (recursively) into it as v1 with cost 0. The Art Director's library picks are linked as the campaign's creative kit. Then `campaign/brief.submitted { from: next }` is sent. This is the existing `from` mechanism: the brief's `startFrom` = `from`, `seedArtifacts` = the copies. Producer and prompt-package outputs cannot be sent: the pipeline needs shot slots that only its own Producer step creates.
- **Pipeline change:** a skipped stage now loads its latest artifact or null (was: throw), because a seeded campaign may lack earlier stages (a CD idea has no internal brief). Later stages only read seeded outputs. The default path (`from` = accountManager) is unchanged.
- **Workspace tabs:** Quick task (form, estimate, task list with status/duration/cost, Retry, output, Send to flow), Current focus, the role's own tabs, Artifacts (ILIKE search over this role's outputs, compare any two side by side with changed fields), Memory (this role's active memories; LLM roles only).
- **Not verified live:** there is no Gemini key in `.env` and no Inngest dev server, so a real Creative Director run and a seeded campaign run were not executed. Verified: unit tests of the flow with injected failures, and a real-DB run of a free task (injected save failure + duplicate save → one artifact, `campaignId` null).

## Boards: Stage 5 (all role workspaces)
- **QC** (campaign → `accountTeam` → ApprovalPackage) and **Post-production** (campaign → new FFmpeg cut of its latest valid clips → `{ finalCut, clips }`) run as direct tasks against an existing campaign, picked with `meta({ ref: "campaign" })`. Neither touches the campaign (no status change, no `finalCutKey`); the cut lands under `tasks/<taskId>/`. Their outputs do not seed new campaigns. Post-production edit notes are still not interpreted (same known gap as the pipeline).
- **`renderCut`** (`src/lib/media/renderCut.ts`) was extracted from the pipeline's post-production step so both use the same code. The artifact payload shape is unchanged; a shot without a valid clip now fails with a clear message instead of a null dereference.
- **Workspaces per the table:** AM, CD, AD, Producer and Content Creator from Stage 4, plus QC and Post-production. Socmed Specialist has the Accounts tab only: Strategy, Planning, Content brief and Reports do not exist yet and arrive with their pages. Content Creator: Ready talent, Execution queue (the campaign shot/upload cards), Schedule & publishing (PublishJob list) and Library. Talent Manager: requests + character library.
- **Talent hand-off** (Talent = `CreativeAsset` kind character, owner ruling): new `CreativeAsset.lockedAt`. "Request new talent" in the Content Creator workspace creates `AgentTask(talentManager, WAITING, requestedByRole videographer, input {request, campaignId?, product?})`, which shows as the Talent Manager's waiting work. The Talent Manager answers with a new or existing character (stored as `input.creativeAssetId`). When the owner locks that character, every open request it answers gets an artifact `{creativeAssetId, name, …}` and is DONE (same idempotent `saveTaskResult`). The talent then shows under Ready talent, and the Content Creator's Team focus card shows "Talent Manager: <name> is ready" for 7 days. Hand-off history (who asked, status, when) is listed in both workspaces and on the task list.
- Verified against the local DB: request → answer → lock completes the task with one artifact and the talent appears as ready (probe rows removed afterwards).

## Boards: Stage 6 (outcomes and feedback)
- **Outcome labels** are computed on read by `outcomeLabel` (defined in Stage 3 above): success = delivered (APPROVED or PUBLISHED) with no revise/regenerate aimed at that role; needs_revision = delivered after one; rejected / failed / expired from the status; otherwise in progress. Shown per agent in the workspace "Results & feedback" tab, and in Campaign history.
- **`AgentFeedback`** (agentRole, campaignId?, agentTaskId?, source `client_decision|qc|metrics|owner_note`, sentiment, text, idemKey unique). One writer, `writeFeedback`, idempotent per idemKey.
- **Automatic feedback** (pipeline, never fails the campaign: errors are logged):
  - A revise note goes to the stage it was routed to (the owner's pick or the router's). The key is `decision:<id>`, written after `targetAgent` is set.
  - A regenerate goes to the Content Creator (videographer), naming the shots.
  - Approve has no notes. **Reject notes are not routed**: they have no target agent, so they stay on the campaign (Discussion notes).
  - QC: each Account Team result becomes feedback for **Post-production** (QC judges the assembled deliverable). Score ≥ 8 with no flags → positive; < 6 or any brand-safety flag → negative; else neutral. The key is `qc:<artifactId>`.
  - Metrics: `metrics` is a source value only; it gets a writer once `MetricSnapshot` exists.
- **Manual feedback:** thumbs up/down + a comment (max 500), from each Team focus card, the workspace Results tab and the campaign Decisions tab (pick the agent). Validated server-side against `ROLES`.
- **Shown:** latest feedback quote on Team focus (with "See all"), the full raw list with source and a source link in the workspace and on the campaign, and a "Feedback" section in the archive (agent filter + search).
- **Memory:** every feedback for an LLM role is also written as an episodic memory (`feedback:<id>`, redacted by `writeMemory`, only when memory is on), so it is part of the next recall/reflection.
- **No LLM narrative summary.** The brief made it optional; the raw feedback is what's shown. It can be added as a scheduled job (cost reason `reflection`) next to the raw list later.
- **No backfill:** decisions made before this stage have no feedback rows. Their notes still appear under Discussion notes and count in the outcome labels.

## AI model layer (OpenRouter) and Apify TikTok Trends (12 Oct 2026)
### Mapping to this repo
- **No monorepo** (Phase 0 ruling). The brief's `packages/agents/llm` is `src/lib/ai/` and `packages/providers/apify-tiktok-trends` is `src/lib/providers/apify-tiktok-trends/`.
- **UI stays English** (owner ruling above), overriding the brief's Indonesian UI. The hint reads "Default: your country (Indonesia)".
- **OpenRouter replaces Gemini for every LLM agent.** `GOOGLE_GENERATIVE_AI_API_KEY`, `AGENT_MODEL_*`, `ai` and `@ai-sdk/google` are removed. Gemini for keyframes and multimodal QC is still unbuilt; it would come back as its own provider.
- **The client is plain `fetch`**, not an SDK. There is one endpoint (`POST {AI_BASE_URL}/chat/completions`), and direct access is needed to `reasoning`, `usage.cost` and the HTTP status that drives failover.
  - Structured output: `response_format: json_schema` from `z.toJSONSchema` (non-strict). The schema is also in the system prompt. The reply goes through Zod parse plus one repair round with the validation errors, then fails clearly.
- **Producer has no LLM** (deterministic, Phase 0), so it gets no AI override row. The brief's `revisionRouter` is the existing role `router`. `accountTeam` (QC) can be overridden too.
- **vidIQ does not exist in code.** "Combined sources" means every `TrendSignal.source`, which today is only `apify_tiktok`. The `TrendSource` interface is in `providers/apify-tiktok-trends/index.ts`.

### Findings: OpenRouter (checked 12 Oct 2026)
- **`nvidia/nemotron-3-super-120b-a12b:free`** (`GET /api/v1/models`):
  - Reasoning: `reasoning.supported_efforts = [low, medium]`, `default_effort = medium`, on by default, `mandatory = false`, `supports_max_tokens = true`.
  - Supported parameters include `reasoning`, `response_format`, `structured_outputs`, `max_tokens` and `temperature`.
  - Price is 0/0, and the context window is 262k.
- **`reasoning` param** ([docs](https://openrouter.ai/docs/use-cases/reasoning-tokens)):
  - Fields: `effort` (none…max), `max_tokens`, `exclude`, `enabled`. Reasoning tokens are billed as output tokens and count against `max_tokens`.
  - The docs do not say whether the param is ignored on non-reasoning models, so we do not send it to them.
  - Mapping (`src/lib/ai/effort.ts`): `off` → `{enabled:false}` (or the lowest effort if a model makes reasoning mandatory); `low`/`medium` → `{effort}`; `high` → the highest supported level at or below it (medium for Nemotron); a model with no `reasoning` metadata gets no param.
- **Usage:** `usage.cost`, `prompt_tokens`, `completion_tokens` and `completion_tokens_details.reasoning_tokens` are always returned, so `CostEntry.usd` is the real charge. Estimates before a call use `/models` pricing per token, cached for 1 h.
- **Limits:** `:free` models allow 20 req/min, and 50 req/day (1000/day once ≥10 credits have been bought). 429 = rate limit, 402 = no credits.
- **Key check:** `GET /api/v1/key` with the key in the header is free. It is used by the daily integrations health check (card "OpenRouter (LLM)").

### Findings: Apify actor `GULLsEZsAD69QFACQ` (data_xplorer/tiktok-trends, stable build 1.0.22)
- The input schema was read from `GET /v2/acts/GULLsEZsAD69QFACQ/builds/default`, and the output shape from the dataset views and README examples. Constants live in `providers/apify-tiktok-trends/schema.ts`.
- **`trendType` is `hashtags | videos` only.** Songs and creators are not in the schema, and the README says TikTok removed those feeds, so the brief's songs/creators options are dropped.
- **Hashtag fields:**
  - `countryCode`: 27 ISO 3166-1 alpha-2 codes, `ID` included.
  - `hashtagPeriod`: 7/30/90.
  - `industryId`: 16 values (empty = all).
- **Video fields:**
  - `videoCountry`: only `US, JP, VN, TH, ID`.
  - `videoPeriod`: 7/30.
  - `videoContentTag`: 6 values.
  - `videoOrderBy`: 1 = views, 2 = engagement, 3 = 6 s views.
  - `videoOrganicOnly`.
- **Other inputs:** `maxItems` 1–1000 (we cap at 200), `saveMedia`, and `proxyConfiguration`.
- **Pricing:** pay per event, US$0.025 per actor start + US$0.0015 per item at the FREE tier (lower on paid tiers). Both prices are seeded in PriceBook (`provider apify`, model `tiktok-trends`). The actual cost comes from `run.usageTotalUsd`.
- **Default country:** `ID` is valid for both fields, so the fallback never needs the "first valid option" branch. A country with hashtags but no video feed (e.g. FR) gets `videoCountry = ID`.

### Settings and caps
- **`AiSettings`** is a singleton (`id "default"`, `brandKitId` nullable for later). It holds `defaultModel` (empty = env `AI_MODEL`), `reasoningEffort` (default **low**), `maxOutputTokens` (default 4096, range 256–32000), `temperature` and `perAgentOverrides`.
  - `perAgentOverrides` is JSON validated by `AiOverrides`. The default is Creative Director medium, QC low, router off.
  - The LLM caps are `monthlyBudgetUsd` (default 40), `maxCostPerCallUsd` (0.5) and `monthlyTokenCap` (5M), plus `enableFallbackKey`.
  - It is read through a 30 s in-process cache that the save action clears. The merge order is env < DB global < per-agent.
- **These caps are LLM-only** (`provider openrouter`). The existing `Setting.monthlyBudgetUsd` stays as the all-provider monthly cap used by the campaign and task budget gates.
- **Enforced in `generateStructured`** before any request:
  - month LLM spend + estimate vs budget;
  - estimate vs per-call cap;
  - month tokens vs token cap.
  - A failed check throws `AiBudgetError` (a `NonRetriableError`). The pipeline's `tracked()` writes it to `Step.error`, so it shows on the Pipeline page. A direct task shows it as its error.
- **Failover** (`failover.ts`): the primary key gets 2 retries with exponential backoff (honouring `Retry-After`, max 30 s) on 429/5xx/timeouts. After that, one switch to the fallback key on 401/402/429/5xx, if the key is set and enabled. Any other 4xx is thrown at once. The label `primary|fallback` goes to `CostEntry.keyLabel` and a warning log, never the key.
- **Keys** are read only in `src/lib/ai/env.ts` (lazy Zod: the app boots without them and the first call fails with "Set AI_API_KEY in .env"). They are sent only in `Authorization` headers. `keyStatus()` gives the UI booleans. Provider error text is truncated and has no headers.

### Cost ledger
- **`CostEntry` is now the single ledger.** This reverses the Boards Stage 4 note that LLM cost lives only on artifacts; the brief requires a row per LLM call.
  - `campaignId` became nullable (planned since the persona audit). New columns: `agentRole`, `tokensIn/Out/Reasoning`, `keyLabel`, `output`. New reasons: `trend`, `test`.
  - Migration `20261012190000_ai_settings_trends` **backfills** one row per `Artifact.costUsd > 0` (`idemKey artifact:<id>`).
  - `campaignSpent`, `monthSpent` and the Boards report now sum `CostEntry` only, so nothing is counted twice. `Artifact.costUsd` stays as a per-artifact display copy. The archive's per-agent spend uses `CostEntry.agentRole`, and Seedance rows (`provider byteplus`) count for the Content Creator.
- **Idempotency:** every HTTP call is its own row (`<idemKey>:c<n>`, so repair calls are recorded too), and the validated result is stored in `output`. A retried step with the same idemKey (pipeline `runId:role`, direct task `task:<id>:<attempt>`) gets the stored result back without a new call.
- **Free models** record US$0 with the real token counts.

### Trend Scout
- **Tables:**
  - `TrendSourceSettings`: one row per source + brand. The global row has `brandKitId` null, so it is looked up with `findFirst`; Postgres unique ignores nulls.
  - `TrendRun`: `idemKey trend:<inngestRunId>`.
  - `TrendSignal`: unique `(source, externalId, capturedDay)`, so a second run on the same day updates the row instead of duplicating it.
- **Schedule:** Inngest cron is static, so `trend-scout` ticks every 15 min. Each tick checks whether the stored `scheduleCron` (5 fields, owner time zone `Setting.timezone`) fires in its own 15-minute window, which means no double runs. The matcher is ~20 lines, tested; there is no cron library.
- **Cache:** the cron skips if a successful run is younger than `cacheHours` (default 20). "Run now" bypasses schedule and cache, but not the caps.
- **Caps:** `monthlyRunCap` is checked on runs that reached Apify. The estimate (PriceBook start + maxItems × item) is checked against `maxCostPerRunUsd`, and the same value is passed to Apify as `maxTotalChargeUsd`, which Apify enforces itself. A blocked run is stored as `TrendRun status blocked` with the reason.
- **Retry safety:** the `start` step upserts the TrendRun first and reuses its `apifyRunId`, so a retry polls the same run. Polling runs every 15 s for up to 10 min. **Known gap** (same as Seedance): if the start call succeeds but the id write fails, a retry can start a second run.
- **Visible errors:** FAILED, TIMED-OUT, ABORTED, an empty dataset and a run still going after 10 min each set `TrendRun.status/error`. These show on `/trends`. The cost row is written whatever the outcome.
- **outlierScore is 0–10 for both types**, so they can be ranked together:
  - Hashtags (which have no view/follower data): `10 × (1 − (rank−1)/n)`, × 1.2 if trending up / × 0.8 if down, capped at 10.
  - Videos: `2.5 × log10(1 + views/followers)`, capped at 10.
- **Field mapping:** `audio` is null (there is no songs feed). `hook` is the hashtag or the video title. The raw item is kept in `rawPayload`.
- **Account Manager** (pipeline and direct task) gets the top 5 signals of the last 7 days by score, de-duplicated by URL. **"Used"** on `/trends` means a campaign's internal brief cites the URL in `trendRefs`.

### Default country
- Resolution order: stored value → Auth0 claim (any `*/country` custom claim, `country`, or `user_metadata.country`) → `CloudFront-Viewer-Country` → `x-vercel-ip-country` → `cf-ipcountry` → `ID`.
- It runs only when the settings row is created (first visit to `/trends`); the result is stored. There is no UI to change it. The cron reads only the stored row, so a manual choice is never overwritten by a login from another country.
- Headers are read server-side only, and only the 2-letter code is used. IP addresses and headers are never stored or logged.

### Also fixed
- **`PriceBook` unique key now includes `unit`** (migration `20261012191000_pricebook_unit_unique`). Before, a model with two units on the same date (Gemini input/output tokens, Apify start/item) silently kept only the first row in the seed.

### Not verified live
- `.env` has no `AI_API_KEY` and no `APIFY_API_TOKEN`, so no real OpenRouter call and no real actor run were made.
- What was verified:
  - Unit tests: effort mapping, failover (429/5xx/401/402 yes, 400 no), override precedence, caps, idempotent reuse, the repair round, no key in errors or ledger, build-input per type, normalize on README fixtures, the settings Zod, resolveDefaultCountry, the cron matcher and the run gate.
  - Against the local DB: AI config resolution, country default `ID` without headers or profile, a manual change surviving a visit from another country, the backfill (7/7) and the run estimate (US$0.055 for 20 items).
  - The dev server compiles `/api/inngest` with `trend-scout` (6 functions).

## Sidebar (12 Oct 2026, owner)
- **Boards is the home page:** `/` redirects to `/boards`, and the campaign list moved to `/campaigns` (search and back links updated). The logo links to `/boards`.
- **No group headings.** Order: Boards, Campaigns, Briefs, Trends.
- **Submenus collapse:** a submenu opens only when its menu is clicked, or when you are on one of its pages. One open at a time; clicking the active menu again closes it.
- **Sidebar width** went from 240 px to 288 px (`w-72`).

## Trigger.dev migration, Phase 0 (12 Oct 2026)
- **SDK:** `@trigger.dev/sdk` and `@trigger.dev/build` 4.7.3 (imports from `@trigger.dev/sdk`, never `/v3`).
- **Hosting:** Trigger.dev Cloud (default); region is whatever the project `proj_yprvcvooehbxmyjxugzs` uses in the dashboard.
- **Layout:** the repo is a single Next app, not a monorepo, so tasks live in `src/trigger/` and the `WorkflowClient` in `src/lib/workflow/`. The brief's `packages/*` names map to `src/lib/*`.
- **Engine flag:** `WORKFLOW_ENGINE=inngest|trigger`, default `inngest`. Inngest is untouched; call sites move to `WorkflowClient` in Phase 2. The Trigger.dev implementation throws until then.
- **Queues:** shared `concurrencyLimit` per provider in `src/trigger/queues.ts` (`video`, `elevenlabs`, `vidiq`, `gemini-llm`, `ffmpeg-render`). The brief's `veo` is `video` because the video provider is Seedance.
- **Build extensions:** `ffmpeg` only; Prisma extension is added in Phase 1 when tasks touch the DB.
- **Not yet existing:** `runAgent`, `produceShots`, `runPostProduction`, `publishAll` are inline in `campaignPipeline.ts`/`agents/index.ts`; Phase 1 extracts them first.
