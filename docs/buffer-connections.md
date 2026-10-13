# Buffer connections

MauAgent publishes through Buffer. One personal Buffer API key posts to every Instagram, TikTok and Threads channel linked in Buffer. MauAgent never connects social accounts itself (Buffer's API has no way to add a channel).

## Setup
1. In Buffer: Settings → API → create a key (it acts as you and covers all your organizations).
2. In `.env`: `BUFFER_API_KEY=...`. Optional: `BUFFER_ORGANIZATION_ID` (default: the key's first), `BUFFER_API_URL`, `BUFFER_MAX_CONCURRENCY` (default 2). The key is server-only and never shown in the UI, logs or client bundles.
3. Connect your Instagram / TikTok / Threads accounts in Buffer (publish.buffer.com).
4. Open **Connections** → **Sync from Buffer**. New channels start disabled: switch on **Enabled for publishing**, optionally mark a **Default for this platform** and pick a **Brand kit**.

## How it works
- **Sync** (`src/lib/bufferAccounts.ts`, cron every 6 h, button, event `buffer/channels.sync.requested`): channels become `SocialAccount` rows. Buffer-owned fields (name, avatar, time zone, status) are refreshed; your settings (enabled, default, brand kit) are never overwritten. A channel that left Buffer is marked **Missing**, deactivated and kept (its history stays valid). Opening `/connections` never calls Buffer; only Sync, Test connection and the cron do.
- **Approve** (`/approval`): Approve opens the target picker (channels, mode, caption and hashtags per platform, time in the Settings time zone) and asks for confirmation. Modes: *Add to Buffer queue*, *Schedule*, *Save as draft*, *Publish now* (extra confirmation). Approving without selecting any channel does not publish. If the picker is not used, each platform's default channel is queued; with no default the campaign stays **Approved** and the campaign's Publication tab says so.
- **Publish job** (`src/lib/workflows/publishJob.ts`): one job per channel (`idemKey = campaign:account:attempt`). A scheduled job sleeps until 5 minutes before its time so the video URL is fresh. A job that already holds a Buffer post id never calls `createPost` again; `createPost` is never retried automatically. One failing channel does not affect the others; the campaign becomes **Published** when at least one non-draft post is accepted, or returns to **Approved** when none was.
- **Status**: no webhooks exist, so each accepted post is polled (1, 2, 5, 15 min, then hourly; sleeps until the due time for far-off posts; gives up 24 h after it). Permalink and failure text come from Buffer. A failed job that never reached Buffer has **Retry** (a new attempt).
- **Metrics** (`bufferMetrics`): 1 h, 24 h and 7 d after a post is sent, `Post.metrics` is stored in `MetricSnapshot` and shown on **Analytics**. Only what Buffer returns is stored; never impressions or plays.
- **AI label**: every post is sent with `aiAssisted: true` and TikTok with `isAiGenerated: true`.

## Text posts for X and Threads (Socmed Specialist)

A separate path from the campaign video, for single posts and threads:

1. **Boards → Socmed Specialist → Quick task**: goal, product, audience, platforms (X / Threads) and how many posts. One LLM call writes the batch; it is costed and capped like every other task.
2. The result page shows a **Schedule** panel: a date range, the publish times for each day, the channels and the time zone (default `Setting.timezone`). `buildScheduleSlots` (`src/lib/publish.ts`) lays the posts into the day × time slots in order — deterministic code, never an AI call.
3. The preview table is editable: change a post's text, or swap which post sits in which slot. A character counter blocks over-budget text before anything is sent (X 280, Threads 500, counted in UTF-16 so an emoji is 2, and a URL always counts as 23 on X). More posts than slots shows a warning; fewer simply leaves the rest of the grid empty.
4. **Send to Buffer as drafts** creates the rows (`PublishJob` with `agentTaskId`, `idemKey = task:<taskId>:<slot>:<accountId>`) and `publish-job` puts each one in Buffer with `saveToDraft: true`, carrying the intended `dueAt` already. Only a row without a Buffer post id is ever sent, so pressing it twice cannot duplicate a post.
5. **Schedule** is a deliberate second step (`schedule/apply` → `src/lib/workflows/scheduleApply.ts`): each draft becomes a scheduled post through `editPost`. Nothing reaches a live account without that second click. The job's `mode` is the state machine (`draft` = not converted), so a repeat is skipped.

Status comes from `buffer-posts-sync` (cron every 15 min, 50 rows per pass) rather than a long-lived run, since a scheduled post can be days away. A post that has just gone out hands itself to the existing metrics function exactly once.

Threads are built from `thread[]` on each generated post: part 1 is the post's own text, and Buffer wants every part in `metadata.<service>.thread` with the top-level text repeating part 1. Buffer's cap is 25 parts per thread.

## Known limits
- Metrics need a personal API key (`insightsRead`); switching to OAuth would end them. Buffer refreshes them about daily, so the 1 h snapshot is often empty.
- Buffer reads the video when the post goes out, so signed URLs must outlive that: scheduled/now posts use 6 h, queue/draft use the S3 maximum of 7 days. A queued post that waits longer than 7 days, or a draft you schedule in Buffer later, can fail to fetch the video.
- Rate limits are per key (100 requests / 15 min; 250 or 500 / day by plan). Daily posting limits are per channel; `Save as draft` skips them.
- Buffer rejections show as the job's error text. Video size/duration limits per network are not enforced by MauAgent.
- Orshot, Instagram Graph and TikTok inbox publishers are not built; the integration list shows them as not active.
- Text posts carry no media, so the video limits above do not apply to them. The character budget assumes X Free (280); raise `CHAR_LIMIT.twitter` in `src/lib/publish.ts` to 25,000 on a paid X plan.
- The Threads thread shape was not verified against a live Threads channel (none is connected); it mirrors X's.
