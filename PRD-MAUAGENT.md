# PRD: MauAgent — AI Multi-Agent Creative Agency Automation

Version: 2.1 · Date: 14 October 2026 · Owner: Maulana Ibrahim
Supersedes v2.0 (same day) and v1.0 (11 Oct 2026). v2.0 described the product **as built**. v2.1 adds automation campaigns (F16) and replaces F11's "every post needs the owner's Approve" with a server-side approval policy. Where the product differs from v1.0, the reason is in `DECISIONS.md`.

> Note for Claude Code or any coding agent: read this document before writing code. When a decision is not covered here, pick the simplest option, record it in `DECISIONS.md` and continue. `DECISIONS.md` has the detail behind every line below.

---

## 1. Summary

MauAgent mimics how a real creative agency works. One agency role = one AI agent, and the agents run in sequence. The user (the agency owner) acts as the Client: gives a brief, then approves, revises or regenerates the result. After approval, content is published through Buffer to the connected social channels, and separate pages track trends, performance, pipeline status and cost.

MauAgent produces three kinds of content:

1. **Video campaigns** (9:16 short video for Instagram and TikTok) through the full agent pipeline.
2. **Text posts** (single posts and threads for X and Threads) generated in batches by the Socmed Specialist, approved one by one, then scheduled in Buffer.
3. **Automation campaigns**: text posts for X and Threads at scale (1 to `AUTOMATION_MAX_POSTS`, default 2000) over a date range. The Post QC agent checks every post; confident posts are approved automatically and the rest go to the owner.

Video pipeline:

```
Client (user) → Account Manager → Creative Director → Art Director
→ Producer (deterministic) → Content Creator (Seedance / manual upload) → Post-production (FFmpeg)
→ QC (Account Team) → Client Approval → [Revise / Regenerate] → Publish via Buffer → Metrics
```

### 1.1 Goals

1. From one brief, produce a ready-to-post 9:16 short video with minimal human work, with clear approval points.
2. Every agent produces a structured artifact for its role; the next agent depends only on that artifact (plus curated memory and the creative kit).
3. Controlled cost: every spend is a `CostEntry`, estimates show before any regenerate, and budget caps are enforced in code.
4. Two video sources, mixable per shot: Seedance API (automatic) and Manual Upload (permanent mode; a failed Seedance shot opens an upload slot).
5. Text posts that sound like the owner: type mix, owner's writing voice, layered quality gate, and a stored approval for every post (the owner's, or the Post QC agent's under a campaign review policy).
6. Publishing through one provider (Buffer) for Instagram, TikTok, X and Threads.
7. Pages to run the agency: Boards, Trends, Briefs, Campaigns, Analytics, Connections, Settings.

### 1.2 Non-goals (v1)

- Multi-tenant use for external clients (single user; `brandKitId` keeps the schema ready).
- A full visual video editor in the browser.
- Direct publishers for Instagram Graph or TikTok Content Posting (OAuth connect exists, publishing goes through Buffer).
- Platforms beyond Instagram, TikTok, X and Threads (YouTube Shorts and others later).
- Native mobile app.
- Scraping that breaks a platform's terms of service.

### 1.3 Persona

- **Owner/Client:** agency owner, full-stack engineer. Gives briefs, reviews, decides approve/revise/regenerate, watches cost. **The UI and all output are in English** (owner ruling, overrides v1.0's Indonesian default). Text posts follow the language of the topic or audience.

---

## 2. Technical decisions

| Area | Decision |
| --- | --- |
| Language/runtime | TypeScript, Node.js 20.19+ or 22 |
| Web app | Next.js 15 (App Router), one app (no monorepo), Tailwind 4, Auth0 for login |
| Database | PostgreSQL with Prisma 6 |
| Asset storage | Cloudinary (images and video; permanent URLs). S3/MinIO is **legacy**: videos, files, presigned URLs and the health check still use it until the migration is finished |
| Workflow orchestration | Inngest (default) and Trigger.dev (`WORKFLOW_ENGINE`) coexist until parity is proven. Each agent = one step; approval pauses = `waitForEvent` with a 7-day timeout |
| Agent layer | Own `callLlm` + `generateStructured` over plain `fetch` (no AI SDK in the call path), structured output validated with Zod, one repair round |
| LLM | OpenRouter (OpenAI-compatible), model per agent in `/settings/ai`, primary + fallback key, failover on 401/402/429/5xx |
| Video | BytePlus ModelArk Seedance (draft and final model IDs in env) and Manual Upload; Magic Hour as an alternative provider in `/settings/ai` |
| Images | Magic Hour, BytePlus Seedream, OpenRouter image models, in a configurable fallback order |
| Editing | FFmpeg (`ffmpeg-static`, `ffprobe-static`), run inside the Next.js request (`maxDuration` 300) |
| Trends | Apify TikTok Trends actor (cached, scheduled). X and Threads trend pages are placeholders |
| Web research | Tavily (facts and news for text posts) |
| Publishing | Buffer GraphQL API (personal API key) for Instagram, TikTok, X, Threads |
| Social accounts | Buffer channels synced into `SocialAccount`; Instagram and TikTok OAuth connect (AES-256-GCM encrypted tokens) |
| Infra | No deployment yet. Docker Compose for local Postgres and MinIO |

Principle: model IDs, prices and providers are **not hardcoded**. They come from env, `/settings` and the `PriceBook` table because they change often.

Not used: Veo/Gemini API (replaced by Seedance and OpenRouter), Remotion, Mastra, ECS/Fargate/Lambda, Orshot as a publisher (dropped 14 Oct 2026), ElevenLabs and vidIQ (planned, not built).

---

## 3. Third-party tools and what they are for

Status: **Live** = in use and wired; **Optional** = used only when its key is set; **Legacy** = still used, being replaced; **Not built** = in the integrations list but no code yet.

| Tool | What it is used for | Where in the product | Config | Status |
| --- | --- | --- | --- | --- |
| **Auth0** | Login. Middleware guards every route except `/auth/*` and the workflow endpoints | Whole app | `AUTH0_*` | Live |
| **PostgreSQL + Prisma** | All state: campaigns, artifacts, runs, costs, accounts, publish jobs, memory, trends, settings | Whole app | `DATABASE_URL` | Live |
| **OpenRouter** | Every LLM call: agents, revision router, voice analysis, text posts, judge, vision. Real cost per call comes from `usage.cost` | Pipeline, Boards tasks, Briefs | `AI_API_KEY`, `AI_API_KEY_FALLBACK`, `AI_BASE_URL`, `AI_MODEL`, `AI_VISION_MODEL`, `IMAGE_MODEL`; per-agent model, effort and caps in `/settings/ai` | Live |
| **BytePlus ModelArk (Seedance)** | Video generation per shot: draft and final tier, 9:16 with audio. Task create then poll | Content Creator step | `ARK_API_KEY`, `ARK_BASE_URL`, `SEEDANCE_MODEL_*`, `SEEDANCE_RES_*` | Live (key set, not verifiable by a free call) |
| **BytePlus Seedream** | Image generation for library characters (front/right/back/left views) | Library | `ARK_API_KEY`, `SEEDREAM_MODEL` | Optional |
| **Magic Hour** | Image and video generation provider, in the fallback order set in `/settings/ai` | Library, video | `MAGIC_HOUR_API_KEY` | Optional |
| **Cloudinary** | Storage and delivery of library reference images and generated images (REST, no SDK); target storage for video | Library, assets | `CLOUDINARY_*` | Live (videos not migrated yet) |
| **S3 / MinIO** | Storage and presigned URLs for video clips, final cuts and context files; daily health check | Campaigns, uploads | `S3_*`, `AWS_*` | Legacy (to be replaced by Cloudinary) |
| **Buffer** | The only publisher. Syncs channels, creates posts (schedule, queue, draft, share now), converts drafts to scheduled, polls status, reads post metrics. Needs the personal API key (the `insightsRead` scope) | Connections, Approval, Campaign publication, Schedule panel, Analytics | `BUFFER_API_KEY`, `BUFFER_ORGANIZATION_ID`, `BUFFER_API_URL`, `BUFFER_MAX_CONCURRENCY` | Live |
| **Apify (TikTok Trends actor)** | Trending TikTok hashtags and top videos per country, cached daily; the Account Manager and the text brief read the top signals | Trends, Briefs | `APIFY_API_TOKEN`, `APIFY_TIKTOK_TRENDS_ACTOR_ID` | Live |
| **Tavily** | Web search for text posts: facts (credible domains only) for educational posts and recent news for satire about a trend | Text brief generation | `TAVILY_API_KEY` | Optional |
| **Inngest** | Durable workflows: campaign pipeline, direct tasks, publishing, Buffer sync and metrics, trend scout, token refresh, health checks | Background work | `INNGEST_*` | Live (default engine) |
| **Trigger.dev** | Second orchestrator, being evaluated for parity. Queues per provider; build extension for FFmpeg | `src/trigger/` | `TRIGGER_*`, `WORKFLOW_ENGINE` | Evaluation |
| **FFmpeg / ffprobe** | Validate uploaded clips (duration, resolution, 9:16, audio), join clips, burn subtitles, export the 1080×1920 final cut and thumbnail | Content Creator, Post-production | bundled via `ffmpeg-static` | Live |
| **Instagram API (Instagram Login)** | Connect an Instagram Business/Creator account, long-lived token refresh, publishing quota read | Connections / Accounts | `IG_APP_ID`, `IG_APP_SECRET`, `IG_GRAPH_VERSION` | Optional (publishing goes through Buffer) |
| **TikTok Login Kit** | Connect a TikTok account, token refresh | Connections / Accounts | `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` | Optional (publishing goes through Buffer) |
| **ElevenLabs** | Planned: voice cleanup, music, transcription | Post-production | none | Not built |
| **vidIQ** | Planned: extra trend signals | Trends | none | Not built |
| **Threads / Notion** | Planned: direct Threads connection and Notion sync | Connections | none | Coming soon |

Secrets live only in env. Social tokens are encrypted at rest with `TOKEN_ENC_KEY` and never reach the client.

---

## 4. Flow and state

### 4.1 Campaign status

`DRAFTING → AWAITING_BUDGET (budget gate) → AWAITING_VIDEO_UPLOAD (manual path) → POST_PRODUCTION → AWAITING_APPROVAL → APPROVED → PUBLISHING → PUBLISHED`

Branches: `AWAITING_APPROVAL → REVISING | REGENERATING → AWAITING_APPROVAL`, `→ REJECTED`, `→ EXPIRED` (7-day timeout). `FAILED` for permanent failures after retry. The state machine is enforced in code (`src/lib/status.ts`) with atomic conditional updates.

### 4.2 Orchestration

- One run of the campaign pipeline per round. A revise or regenerate starts a **new run** of the same function with `from` (the stage to restart at); earlier stages reuse their latest artifact.
- Idempotency: every costly call has an idempotency key; every LLM HTTP call is a `CostEntry` row whose stored output is reused on retry.
- Approve creates `PublishJob` rows per target account and sends them to Buffer. A draft-only result is not `PUBLISHED`.

---

## 5. Functional requirements

Each agent: input = previous artifacts, output = a Zod-validated JSON artifact stored in `Artifact` with version, `agentRole`, `costUsd` and `runId`. Agents do not read chat history. Allowed extra inputs: curated agent memory, the creative kit (Art Director) and the owner's writing voice (text posts).

### F1. Briefs (`/brief`)
- **Video brief:** objective, product, audience, platforms, budget cap, deadline, brand kit, references, video source (default from Settings, overridable), creative kit (characters, locations, styles). A helper suggests details from the goal.
- **Text brief** (`?mode=text`): goals, audience, content types as cards, post count, length, call to action, media and link, hashtag policy, avoid list, trend bubbles, owner's writing voice, context files.
- Output: `ClientBrief` for video; a Socmed Specialist task for text.

### F2. Account Manager
Turns the brief and the top 5 cached trend signals into `InternalBrief { problemStatement, insight, mandatories[], tone, deliverables[], trendRefs[] }`.

### F3. Creative Director
Three concept options, one chosen with reasons: `CreativeBrief { bigIdea, conceptOptions[3], chosenConcept, keyMessage, cta }`.

### F4. Art Director
Visual direction and shot list; must build from the linked creative kit: `VisualDirection { moodboardPrompts[], palette, typography, shotList[], styleRefImageUrls[] }`. Also: Storyboard Artist turns the shot list into timed panels.

### F5. Producer (no LLM)
Chooses the source per shot and computes the estimate **in code** from `PriceBook`. Budget gate checks the campaign cap and the monthly cap; over cap stops the run and waits for the owner (`AWAITING_BUDGET`: proceed, change cap, cancel).

### F6. Content Creator (Videographer)
- `seedance_api`: draft tier first, final tier after approval; results saved as `ShotAsset` versions.
- `manual_upload`: a Prompt Package per shot (copy-ready card) and an upload slot with ffprobe validation and attempt count. A failed Seedance shot opens a manual slot automatically.
- The owner can request new talent from the Talent Manager (hand-off), who answers with a character from the library; locking it completes the request.

### F7. Post-production
FFmpeg joins the latest valid clips into a 1080×1920 H.264/AAC final cut with subtitles and thumbnail. Edit notes are not interpreted yet (known gap). Audio cleanup and music (ElevenLabs) are not built.

### F8. QC (Account Team)
Text-only for now: captions, hashtags, brand-safety checklist and self score from the brief, concept and shot list: `ApprovalPackage`. Multimodal QC of the final cut is future work.

### F9. Approval, revision, regenerate (`/approval`)
- 9:16 preview, version compare, Approve, Revise (notes), Regenerate (pick shots), Reject.
- Before Regenerate, an estimate from `PriceBook` is shown; over cap needs an explicit confirmation.
- Revision routing: the owner picks the target (Concept / Visuals / Edit) or a small LLM classifier does. Only that stage and later ones re-run.
- Free restore of an earlier final cut, clip or artifact version.
- Every decision becomes feedback for the target agent and an episodic memory.

### F10. Publishing and Buffer (`/connections`)
- Channels sync from Buffer into `SocialAccount` (default off, one default per platform). Disconnected or locked channels raise a sidebar alert.
- Modes: schedule, queue, draft, share now. Drafts convert to scheduled with `editPost`. TikTok posts carry the AI-generated flag; every post is `aiAssisted`.
- Status is polled (video, growing intervals) or synced by cron (text posts, every 15 min). No webhooks.
- Metrics (T+1h, T+24h, T+7d) are stored exactly as Buffer reports them; `impressions` and `plays` are never shown.

### F11. Text posts (Socmed Specialist)
- Ten content types with weights in `config/content-types.yaml`; angles in `config/angles.yaml`; banned phrases in `config/banned.yaml`. Each slot gets its own type with an anti-repeat rule and a weekly thread cap.
- Per post: three variants from three angles, best usable variant wins, others are swappable.
- Quality gate in layers: format and length per platform, language check, banned words, similarity against the last 30 days, source rules, real-person heuristic, then an LLM judge. Educational and data posts name their own source and confidence and are always reviewed (sources are not verified; the UI says so).
- Optional Tavily research (facts from credible domains, or recent news).
- Owner's writing voice from pasted tweets (one LLM call, stored in `Setting.writingVoice`); context files (notes as text, pictures described once by a vision model).
- **Approval rule (changed in v2.1):** a post can be pushed to Buffer only with a **stored approval record**, checked server-side.
  - Socmed Specialist batch: the record is the owner's Approve (enforced in `pushDrafts`).
  - Automation campaign: the record is either the owner's decision or a Post QC auto-approval under the campaign's review policy (F16), stored with a policy snapshot (`assertApproved`).
- Reject removes a post from the slots; Regenerate rewrites one post.
- Schedule panel: slots in the owner's timezone, draft first then schedule; a second press never double-posts.

### F12. Trends (`/trends`)
- TikTok: hashtags and top videos for 7 and 30 days in the owner's country, cached; a daily scheduled sync plus "Sync now". Caps per run and per month; blocked runs are recorded. `outlierScore` 0–10 for both types.
- X and Threads pages are placeholders. The Account Manager and the text brief use the top signals; "used" is detected from `trendRefs`.

### F13. Boards (`/boards`, home)
- Cards: team focus (persona nickname, seniority, status, work items, last delivery), agent sessions (pipeline runs), agenda (scheduled posts, deadlines, decision timeouts), integrations status.
- **Agent Roles** (`/boards/roles`): flow chart of ten roles, grouped by purpose (Planning, Creative, Production, Delivery) with a submenu per group. Each role opens a workspace: Quick task (direct task with estimate and budget gate, retry, send to flow), Current focus, role tabs, Artifacts (search, side-by-side compare), Memory, Results & feedback.
- Archive search (Postgres `ILIKE` only): campaigns, reports, video, talent, assets, prompt packages, discussion notes, feedback.

### F14. Analytics, Costs and Settings
- **Analytics** (`/analytics`): post metrics from Buffer per window.
- **Costs:** `CostEntry` is the single ledger (LLM, Seedance, Apify, tasks). Caps: all-provider monthly and per-campaign caps in `/settings`; LLM monthly, per-call and token caps in `/settings/ai`.
- **Settings:** budget caps, default video source, timezone, AI model per agent, effort, image and video provider order, integrations.

### F15. Agent personas and memory
Persona (tone and perspective only) per role, versioned in `AgentProfile` with JSON defaults; three memory layers (episodic, lesson, procedural) with redaction, ranked recall inside pipeline runs only, and experience/seniority computed on read.

### F16. Automation campaigns (`/campaigns/automation`)
- **Separate model** from the video Campaign:
  - `AutomationCampaign`: goal, plan settings, review policy, QC settings, generation settings, budget cap, warning %, status, seed.
  - `CampaignPost`: one row per slot and account.
  - Spend is linked through `CostEntry.automationCampaignId`. The video pipeline is untouched.
- **Cross-posting:** one slot = one generated text, sent to every selected X/Threads account at its own time. The target counts texts.
- **Form** (one page): accounts, date range, total or rate, pillars, audience, language, CTA, KPI target, schedule limits (max per day, active hours, minimum gap, quiet days), review policy, QC threshold, variants, horizon and budget. A live feasibility check (a shortfall blocks creation and is re-checked on the server) and a cost estimate.
- **Planner** (deterministic, seeded, no LLM):
  - Every slot is fully specified up front: time per account, type, angles, pillar, CTA.
  - Posts are spread evenly over the active hours with a small jitter, and keep the minimum gap per account.
  - The type mix follows the `content-types.yaml` weights, with the anti-repeat rule and the weekly thread cap applied across the whole plan.
  - Scheduling is "best times for the audience" only: nothing is built to make automation look human or to avoid detection, and every post is `aiAssisted`.
- **Post QC agent** (role `postQc`, with its own model in `/settings/ai`):
  - Layer 1: deterministic rules from `config/qc-rules.yaml`, on top of the text-post checks. They cover unsourced numbers, dates and quotes, forbidden claims, engagement bait, foreign links, and repeated openings and structure.
  - Layer 2: an LLM verdict (pass / fail / uncertain) with per-rule results, issues and a score.
  - Confidence is a documented formula over the judge scores, variant spread, source quality, near misses and judge/rule agreement, never the raw LLM number.
  - A second QC sample runs only for borderline posts.
- **Decision table:**
  - A hard-rule fail regenerates with the issues as feedback (up to 2 times), then goes to review.
  - A pass with confidence ≥ the threshold (default 0.8), on a type not forced to review, is auto-approved.
  - Everything else goes to review.
  - Review policies are `qc_auto` (default) or `manual_all`; there is no mode without QC.
  - By default, educational and story posts and posts that may name a real person are reviewed (editable per campaign).
- **Generation** is just in time: only posts due within the horizon (default 10 days) are written, topped up by a daily Inngest cron and a "Generate now" button. It runs in chunks of 8, one step per post, with stable idempotency keys, so a retry never re-bills. Pause, resume and cancel work at any time.
- **Pilot:** the first 10 posts are always reviewed. The Overview shows the measured cost per post, a re-estimate for the whole campaign and QC-vs-human agreement. "Scale up" continues.
- **Budget:** the monthly cap first, then the campaign cap, checked in code before each post. A warning shows at the warning %, and generation pauses automatically at 100%.
- **Owner decisions** on reviewed posts are stored (with agreement vs QC) and fed to agent feedback and memory.
- **Open (phases 3-5):** review inbox with shortcuts, Buffer push window with a shared rate-limit bucket and kill switch, calendar, tracking dashboard.

### Sidebar

Boards · Agent Roles (Planning, Creative, Production, Delivery) · Trends (TikTok, X, Threads) · Briefs (Library) · Campaigns (Approval, Automation, Publishing, Artifacts & results) · Analytics · Connections. Account menu: Accounts, Settings, Log out.

---

## 6. Data model (Prisma, conceptual)

| Area | Entities |
| --- | --- |
| Core | `BrandKit`, `Setting`, `Campaign`, `Run`, `Step`, `Artifact`, `Shot`, `ShotAsset`, `Decision` |
| Cost | `CostEntry` (single ledger), `PriceBook` (unique incl. unit), `AiSettings` |
| Agents | `AgentProfile`, `AgentMemory`, `AgentMemoryUse`, `AgentTask`, `AgentFeedback`, `AgentMessage` |
| Library | `CreativeAsset` (character, location, style; talent = character), `ContentFile` |
| Trends | `TrendSourceSettings`, `TrendRun`, `TrendSignal` |
| Publishing | `SocialAccount`, `PublishJob` (campaign video and text posts), `MetricSnapshot`, `IntegrationStatus` |
| Automation | `AutomationCampaign`, `CampaignPost` (one per slot and account; links to `PublishJob`); `CostEntry.automationCampaignId` |

`Artifact.campaignId` and `CostEntry.campaignId` are nullable (direct tasks and trend runs have no campaign).

---

## 7. Non-functional requirements

- **Reliability:** retry per step without repeating completed steps; idempotency keys on all costly calls; flows survive a server restart. Known accepted gap: a Seedance or Apify start that succeeds but fails before its id is stored can be repeated on retry.
- **Observability:** Step rows are the structured log, shown per campaign on the Campaigns workflow page; every failure is visible there.
- **Security:** keys only in env; Auth0 on the dashboard; short-lived presigned URLs; OAuth tokens encrypted with AES-256-GCM; secrets and personal data redacted before they are written to memory.
- **Compliance:** AI-generated content flagged on platforms that support it; only commercially licensed music; no scraping against terms of service.
- **Performance:** every Boards card reads Postgres only (no paid call on page load); one text agent step under 60 seconds.
- **Cost:** every call is recorded; caps are enforced in code before the call, not only in the UI.
- **Language:** English UI and output; text posts follow the topic or audience language.
- **Tests:** `node:test` through `tsx` (`npm test`), no database or API key needed.

---

## 8. Build status

| Phase | Scope | Status |
| --- | --- | --- |
| 0 | Next.js, Prisma, Inngest, Auth0, brief form, agents F2–F5, Prompt Package, manual upload with ffprobe validation, FFmpeg cut, manual approval | Done |
| 1 | Budget gate, revise/regenerate with routing, QC, Seedance path, accounts and OAuth connect, publishing through Buffer, cost ledger | Done (Instagram Graph and TikTok direct publishers dropped in favour of Buffer) |
| 2 | Trend Scout (Apify, TikTok), metrics from Buffer, Analytics, Costs | Done for TikTok trends and Buffer metrics; X and Threads trends not built |
| 2.5 | Boards, role workspaces, direct tasks, personas and memory, feedback, archive, Agent Roles grouping | Done |
| 2.6 | Text posts for X and Threads: content types, quality gate, voice, research, per-post approval, Buffer scheduling | Done |
| 2.7 | Automation campaigns (F16). Phase 1: schema, planner, feasibility, form, plan view. Phase 2: Post QC agent, confidence, decision table, just-in-time worker, budget gates, pilot | Phases 1-2 done (pilot not run yet); phases 3-5 (review inbox, Buffer push window and kill switch, calendar, tracking) open |
| 3 | Move video storage fully to Cloudinary; ElevenLabs audio; multimodal QC; vidIQ; direct Threads; Trigger.dev parity and cutover; deploy; performance feedback to the Creative Director; A/B hooks; multi-brand | Open |

Open work, in order: finish the S3 → Cloudinary migration; Post-production edit notes and audio; multimodal QC; Trigger.dev cutover decision; deployment.

---

## 9. Repo layout (actual)

```
src/app/            # pages: boards, brief, campaigns, approval, trends, analytics, connections, settings, accounts, api
src/lib/agents/     # callLlm, personas, memory, Zod schemas
src/lib/ai/         # OpenRouter client, failover, effort, image, settings
src/lib/boards/     # roles, tasks, status, archive, outcome, feedback
src/lib/content/    # text-post pipeline (types, prompt, validate, judge, research)
src/lib/automation/ # automation campaigns: planner, Post QC rules/judge/confidence, pipeline, worker
src/lib/providers/  # buffer, apify-tiktok-trends, seedance, instagram, tiktok
src/lib/workflows/  # Inngest functions (pipeline, publish, sync, metrics, trends)
src/lib/media/      # FFmpeg cut and ffprobe validation
src/trigger/        # Trigger.dev tasks and queues (evaluation)
config/             # content-types, angles, banned, qc-rules (YAML)
prisma/             # schema, migrations, seeds
DECISIONS.md  PRD-MAUAGENT.md  docs/
```

Not an interface yet: `VideoProvider` (Seedance and Magic Hour are chosen by a provider order in settings; extract the interface when a third provider needs different behavior).

---

## 10. Operating cost (reference)

Assumption: 30 videos a month, 4 shots × 8 s each, 2 attempts per shot on average. All prices are placeholders; fill `PriceBook` from the official pricing pages.

| Component (USD per month) | Seedance path | Manual Upload path |
| --- | --- | --- |
| Video (Seedance) | per `PriceBook` | 0 |
| LLM (OpenRouter) | 0–40 (a free model costs 0; cap in `/settings/ai`, default 40) | 0–40 |
| Apify trends | about 0.055 per sync of 20 items; capped per run and month | same |
| Buffer | plan price (API limits: 100 requests / 15 min per key) | same |
| Cloudinary, hosting, DB | plan price | same |
| Tavily | free tier or plan | same |

---

## 11. Risks and open questions

| Risk / question | Impact | Handling |
| --- | --- | --- |
| Buffer metrics need the personal API key | Moving to an OAuth app would break metrics | Stay on the personal key |
| Buffer fetches media at publish time | Expiring URLs fail silently | Cloudinary permanent URLs (S3 presign is a stopgap: 6 h for scheduled, up to 7 days for queue) |
| Seedance request fields come from secondary sources | Calls can fail | Verify against the official ModelArk docs before production |
| Free LLM models invent specifics and sources | Wrong facts in posts | Educational and data posts always reviewed; sources shown as unverified |
| Two orchestrators coexist | Double maintenance | Decide the cutover once Trigger.dev reaches parity |
| A running dev server keeps the old Prisma client | Schema errors after migration | Stop the server, run `prisma generate`, restart |
| Video clips are processed inside the web request | Long clips time out | Move FFmpeg to a worker when clips grow |
| X Free plan limits (280 characters) | Longer posts are trimmed | `CHAR_LIMIT` in `src/lib/publish.ts` is the single place to raise it |

Open questions for the owner:
1. When should the Trigger.dev cutover happen, and which engine is the one to keep?
2. Is a Threads channel going to be connected in Buffer (the Threads thread cap is assumed, not verified)?
3. Is ElevenLabs still wanted for audio cleanup and music, or is Seedance's own audio enough?
4. Should X and Threads trend pages get a source (and which one)?
