import Link from "next/link";
import { Suspense } from "react";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { presignGet } from "@/lib/s3";
import { ROLES, roleByAgent } from "@/lib/boards/roles";
import { agentNames } from "@/lib/boards/snapshot";
import { ARCHIVE_TYPES, archiveSections, delta, likePattern, pageOf, PAGE_SIZE, workedOn, type ArchiveType } from "@/lib/boards/archive";
import { OUTCOME, outcomeLabel } from "@/lib/boards/outcome";
import type { PromptPackage } from "@/lib/agents/schemas";
import { load } from "./cards";
import { FeedbackList } from "./feedback";

type Qs = (p: Record<string, string | undefined>) => string;
type Props = { q?: string; agent?: string; type?: string; sp: Record<string, string | undefined>; qs: Qs };
type SectionProps = { q?: string; agent?: string; page: number; qs: Qs };

const product = (b: unknown, id: string) => (b as { product?: string }).product ?? id;
const date = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

/** Campaigns whose brief or any artifact payload matches (ILIKE, no LLM, no vectors). */
async function matchCampaignIds(q: string) {
  const p = likePattern(q);
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT DISTINCT c.id FROM "Campaign" c LEFT JOIN "Artifact" a ON a."campaignId" = c.id
    WHERE c."clientBrief"::text ILIKE ${p} OR a.payload::text ILIKE ${p}`;
  return rows.map((r) => r.id);
}


export async function ArchiveCard({ q, agent, type, sp, qs }: Props) {
  const names = await agentNames().catch(() => ({}) as Record<string, string>);
  const sections = archiveSections(type, agent).filter((t) => !(q && t === "reports")); // reports are not searchable
  const SECTION: Record<ArchiveType, (p: SectionProps) => Promise<React.ReactNode>> = {
    campaigns: Campaigns, reports: Reports, videos: Videos, talent: Talent, assets: Assets, prompts: Prompts, notes: Notes, feedback: Feedback,
  };
  const chip = (active: boolean) =>
    `rounded-full px-3 py-1 text-xs font-semibold transition ${active ? "bg-brand text-white" : "bg-canvas text-ink-2 hover:bg-brand-soft"}`;
  // A new filter starts every section at page 1.
  const reset = Object.fromEntries(Object.keys(sp).filter((k) => k.startsWith("p_")).map((k) => [k, undefined]));

  return (
    <section aria-labelledby="arc-h" className="card space-y-4 p-6">
      <h2 id="arc-h" className="text-xl font-bold">Archive & sources</h2>
      <form action="/boards" role="search" className="relative">
        {Object.entries(sp).filter(([k, v]) => v && k !== "q" && !k.startsWith("p_")).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <span className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3">search</span>
        <input name="q" type="search" defaultValue={q} aria-label="Search sources" placeholder="Search sources…" className="input rounded-full pl-10" />
      </form>

      <div className="space-y-2">
        <nav aria-label="Filter by agent" className="flex flex-wrap gap-1.5">
          <Link href={qs({ ...reset, agent: undefined })} aria-current={!agent ? "true" : undefined} className={chip(!agent)}>All</Link>
          {ROLES.map((r) => (
            <Link key={r.slug} href={qs({ ...reset, agent: r.agentRole })} aria-current={agent === r.agentRole ? "true" : undefined} className={chip(agent === r.agentRole)}>
              {names[r.agentRole] ?? r.label}
            </Link>
          ))}
        </nav>
        <nav aria-label="Filter by type" className="flex flex-wrap gap-1.5">
          <Link href={qs({ ...reset, type: undefined })} aria-current={!type ? "true" : undefined} className={chip(!type)}>All types</Link>
          {(Object.keys(ARCHIVE_TYPES) as ArchiveType[]).map((t) => (
            <Link key={t} href={qs({ ...reset, type: t })} aria-current={type === t ? "true" : undefined} className={chip(type === t)}>{ARCHIVE_TYPES[t]}</Link>
          ))}
        </nav>
      </div>

      {!sections.length && <p className="rounded-2xl bg-canvas p-6 text-center text-sm text-ink-2">This agent produces nothing of this type.</p>}
      <div className="space-y-6">
        {sections.map((t) => {
          const Section = SECTION[t];
          return (
            <Suspense key={t} fallback={<div className="h-24 animate-pulse rounded-2xl bg-canvas" aria-label={`Loading ${ARCHIVE_TYPES[t]}`} />}>
              <Section q={q} agent={agent} page={pageOf(sp[`p_${t}`])} qs={qs} />
            </Suspense>
          );
        })}
      </div>
    </section>
  );
}

function Section({ type, total, page, qs, children }: { type: ArchiveType; total: number; page: number; qs: Qs; children: React.ReactNode }) {
  const pages = Math.ceil(total / PAGE_SIZE);
  return (
    <section aria-label={ARCHIVE_TYPES[type]}>
      <h3 className="mb-2 flex items-center gap-2 font-bold">
        {ARCHIVE_TYPES[type]} <span className="text-sm font-normal text-ink-3">({total})</span>
      </h3>
      {total === 0 ? <p className="rounded-2xl bg-canvas p-4 text-sm text-ink-2">Nothing found.</p> : children}
      {pages > 1 && (
        <nav aria-label={`${ARCHIVE_TYPES[type]} pages`} className="mt-2 flex items-center justify-end gap-2 text-xs font-semibold">
          {page > 0 && <Link href={qs({ [`p_${type}`]: page > 1 ? String(page - 1) : undefined })} className="rounded-full bg-canvas px-3 py-1 hover:bg-brand-soft">Previous</Link>}
          <span className="text-ink-2">{page * PAGE_SIZE + 1}–{Math.min(total, (page + 1) * PAGE_SIZE)} of {total}</span>
          {page + 1 < pages && <Link href={qs({ [`p_${type}`]: String(page + 1) })} className="rounded-full bg-canvas px-3 py-1 hover:bg-brand-soft">Show more</Link>}
        </nav>
      )}
    </section>
  );
}

const SectionError = ({ type }: { type: ArchiveType }) => (
  <p role="alert" className="rounded-2xl bg-bad-soft p-3 text-sm text-red-800">{ARCHIVE_TYPES[type]} could not load.</p>
);

// ---------- sections ----------

async function Campaigns({ q, agent, page, qs }: SectionProps) {
  const r = await load(async () => {
    const ids = q ? await matchCampaignIds(q) : null;
    const where: Prisma.CampaignWhereInput = { ...(ids && { id: { in: ids } }), ...(agent && workedOn(agent)) };
    return Promise.all([
      db.campaign.count({ where }),
      db.campaign.findMany({
        where, orderBy: { createdAt: "desc" }, skip: page * PAGE_SIZE, take: PAGE_SIZE,
        select: {
          id: true, status: true, clientBrief: true, createdAt: true,
          artifacts: { select: { agentRole: true }, distinct: ["agentRole"] },
          decisions: { select: { type: true, targetAgent: true, notes: true } },
          _count: { select: { shots: true } },
        },
      }),
    ]);
  });
  if (!r.ok) return <SectionError type="campaigns" />;
  const [total, rows] = r.data;
  return (
    <Section type="campaigns" total={total} page={page} qs={qs}>
      <ul className="divide-y divide-line">
        {rows.map((c) => {
          const [label, cls] = OUTCOME[outcomeLabel(c.status, c.decisions, agent)];
          const roles = [...c.artifacts.map((a) => a.agentRole), ...(c._count.shots ? ["videographer"] : [])].map((x) => roleByAgent(x)?.label).filter(Boolean);
          return (
            <li key={c.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
              <Link href={`/campaigns/${c.id}`} className="font-semibold hover:underline">{product(c.clientBrief, c.id)}</Link>
              <span className={`pill ${cls}`}>{label}</span>
              <span className="text-xs text-ink-2">{date(c.createdAt)}</span>
              {roles.length > 0 && <span className="w-full truncate text-xs text-ink-3">{roles.join(" · ")}</span>}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

async function Reports({ agent, page, qs }: SectionProps) {
  const r = await load(async () => {
    const now = new Date();
    const cur = new Date(now.getFullYear(), now.getMonth(), 1);
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const ranges = [{ gte: cur }, { gte: prev, lt: cur }];
    const withVideo = !agent || agent === "videographer";
    // Spend = LLM cost on artifacts + video cost entries, the same sum as the budget caps (cost.ts).
    const spend = async (createdAt: Prisma.DateTimeFilter, campaignIds?: string[]) => {
      const scope = campaignIds ? { campaignId: { in: campaignIds } } : {};
      const [a, c] = await Promise.all([
        db.artifact.aggregate({ _sum: { costUsd: true }, where: { createdAt, ...scope, ...(agent && { agentRole: agent }) } }),
        withVideo ? db.costEntry.aggregate({ _sum: { usd: true }, where: { createdAt, ...scope } }) : null,
      ]);
      return Number(a._sum.costUsd ?? 0) + Number(c?._sum.usd ?? 0);
    };
    return Promise.all(ranges.map(async (createdAt) => {
      const delivered = await db.campaign.findMany({ where: { status: { in: ["APPROVED", "PUBLISHED"] }, createdAt, ...(agent && workedOn(agent)) }, select: { id: true } });
      const [total, onDelivered, regen, video] = await Promise.all([
        spend(createdAt),
        delivered.length ? spend({}, delivered.map((d) => d.id)) : 0,
        withVideo ? db.costEntry.aggregate({ _sum: { usd: true }, where: { createdAt, reason: "regenerate" } }) : null,
        withVideo ? db.costEntry.aggregate({ _sum: { usd: true }, where: { createdAt } }) : null,
      ]);
      const videoUsd = Number(video?._sum.usd ?? 0);
      return {
        spend: total,
        perVideo: delivered.length ? onDelivered / delivered.length : 0,
        delivered: delivered.length,
        regenShare: videoUsd ? Number(regen?._sum.usd ?? 0) / videoUsd : 0,
      };
    }));
  });
  if (!r.ok) return <SectionError type="reports" />;
  const [cur, prev] = r.data;
  // Views/engagement need MetricSnapshot (not built). Impressions and plays are never shown (removed by Meta).
  const tiles = [
    { label: agent ? "Spend by this agent" : "Spend this month", v: `US$${cur.spend.toFixed(2)}`, d: delta(cur.spend, prev.spend), upIsGood: false },
    { label: "Cost per approved video", v: cur.delivered ? `US$${cur.perVideo.toFixed(2)}` : "—", d: delta(cur.perVideo, prev.perVideo), upIsGood: false },
    { label: "Approved videos", v: String(cur.delivered), d: delta(cur.delivered, prev.delivered), upIsGood: true },
    ...(!agent || agent === "videographer" ? [{ label: "Regenerate share of video cost", v: `${Math.round(cur.regenShare * 100)}%`, d: delta(cur.regenShare, prev.regenShare), upIsGood: false }] : []),
  ];
  return (
    <Section type="reports" total={tiles.length} page={page} qs={qs}>
      <ul className="grid gap-2 sm:grid-cols-2">
        {tiles.map((t) => {
          const good = t.d && t.d.dir !== "flat" && (t.d.dir === "up") === t.upIsGood;
          return (
            <li key={t.label} className="rounded-2xl bg-canvas p-3">
              <p className="text-xs text-ink-2">{t.label}</p>
              <p className="text-lg font-bold">{t.v}</p>
              <p className={`text-xs font-semibold ${!t.d || t.d.dir === "flat" ? "text-ink-3" : good ? "text-emerald-700" : "text-red-700"}`}>
                {!t.d ? "No data last month" : t.d.dir === "flat" ? "Same as last month" : (
                  <>
                    <span aria-hidden className="material-symbols-outlined !text-[14px] align-[-2px]">{t.d.dir === "up" ? "arrow_upward" : "arrow_downward"}</span>
                    {t.d.pct == null ? " new vs last month" : ` ${Math.abs(t.d.pct)}% vs last month`}
                  </>
                )}
              </p>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-xs text-ink-3">Calendar months. Views and engagement appear once analytics metrics are pulled.</p>
    </Section>
  );
}

async function Videos({ q, agent, page, qs }: SectionProps) {
  const r = await load(async () => {
    const ids = q ? await matchCampaignIds(q) : null;
    const clipWhere: Prisma.ShotAssetWhereInput = {
      validation: { path: ["ok"], equals: true },
      ...(q && { OR: [{ shot: { campaignId: { in: ids! } } }, { shot: { shotId: { contains: q, mode: "insensitive" } } }] }),
    };
    const cutWhere: Prisma.ArtifactWhereInput = { agentRole: "postProduction", ...(ids && { campaignId: { in: ids } }) };
    const clips = agent !== "postProduction";
    const cuts = agent !== "videographer";
    // ponytail: merged pagination fetches (page+1)×size of each list; fine for an archive, use a UNION query if it grows.
    const take = (page + 1) * PAGE_SIZE;
    const [nClips, nCuts, clipRows, cutRows] = await Promise.all([
      clips ? db.shotAsset.count({ where: clipWhere }) : 0,
      cuts ? db.artifact.count({ where: cutWhere }) : 0,
      clips ? db.shotAsset.findMany({ where: clipWhere, orderBy: { createdAt: "desc" }, take, select: { id: true, s3Key: true, version: true, durationSec: true, createdAt: true, shot: { select: { shotId: true, campaignId: true, campaign: { select: { clientBrief: true } } } } } }) : [],
      cuts ? db.artifact.findMany({ where: cutWhere, orderBy: { createdAt: "desc" }, take, select: { id: true, version: true, payload: true, createdAt: true, campaignId: true, campaign: { select: { clientBrief: true } } } }) : [],
    ]);
    const items = [
      ...clipRows.map((a) => ({ id: a.id, key: a.s3Key, title: `${product(a.shot.campaign.clientBrief, a.shot.campaignId)} · ${a.shot.shotId} v${a.version}`, sub: `Clip${a.durationSec ? ` · ${a.durationSec.toFixed(1)}s` : ""}`, at: a.createdAt, campaignId: a.shot.campaignId })),
      ...cutRows.flatMap((a) => {
        const key = (a.payload as { finalCut?: string }).finalCut;
        return key && a.campaignId ? [{ id: a.id, key, title: `${product(a.campaign?.clientBrief, a.campaignId)} · final cut v${a.version}`, sub: "Final cut", at: a.createdAt, campaignId: a.campaignId }] : [];
      }),
    ].sort((x, y) => y.at.getTime() - x.at.getTime()).slice(page * PAGE_SIZE, take);
    // Presigning is a local signature (no network call); links expire after 15 minutes.
    return { total: nClips + nCuts, items: await Promise.all(items.map(async (i) => ({ ...i, url: await presignGet(i.key) }))) };
  });
  if (!r.ok) return <SectionError type="videos" />;
  return (
    <Section type="videos" total={r.data.total} page={page} qs={qs}>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {r.data.items.map((v) => (
          <li key={v.id} className="space-y-1">
            <video src={v.url} preload="metadata" muted aria-label={v.title} className="aspect-[9/16] w-full rounded-2xl bg-black object-cover" />
            <p className="truncate text-xs font-semibold" title={v.title}>{v.title}</p>
            <p className="flex justify-between text-xs text-ink-2">
              {v.sub}
              <a href={v.url} target="_blank" rel="noreferrer" className="font-semibold text-brand">Open</a>
            </p>
          </li>
        ))}
      </ul>
    </Section>
  );
}

async function library(kinds: ("character" | "location" | "style")[], q: string | undefined, page: number) {
  const where: Prisma.CreativeAssetWhereInput = {
    kind: { in: kinds },
    ...(q && { OR: [{ name: { contains: q, mode: "insensitive" } }, { description: { contains: q, mode: "insensitive" } }] }),
  };
  return Promise.all([
    db.creativeAsset.count({ where }),
    db.creativeAsset.findMany({ where, orderBy: { createdAt: "desc" }, skip: page * PAGE_SIZE, take: PAGE_SIZE, include: { _count: { select: { campaigns: true } } } }),
  ]);
}

function LibraryList({ rows, tab }: { rows: Awaited<ReturnType<typeof library>>[1]; tab: string }) {
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {rows.map((a) => (
        <li key={a.id}>
          <Link href={tab} className="flex gap-3 rounded-2xl bg-canvas p-3 hover:bg-brand-soft">
            {a.imageUrls[0] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={a.imageUrls[0]} alt="" className="h-12 w-12 shrink-0 rounded-xl object-cover" />
            ) : (
              <span aria-hidden className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white text-ink-3"><span className="material-symbols-outlined">image</span></span>
            )}
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">{a.name}</span>
              <span className="block text-xs text-ink-2">{a.kind} · {a._count.campaigns} campaign{a._count.campaigns === 1 ? "" : "s"}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

async function Talent({ q, page, qs }: SectionProps) {
  const r = await load(() => library(["character"], q, page));
  if (!r.ok) return <SectionError type="talent" />;
  return <Section type="talent" total={r.data[0]} page={page} qs={qs}><LibraryList rows={r.data[1]} tab="/boards/talent-manager?tab=talent" /></Section>;
}

async function Assets({ q, page, qs }: SectionProps) {
  const r = await load(() => library(["location", "style"], q, page));
  if (!r.ok) return <SectionError type="assets" />;
  return <Section type="assets" total={r.data[0]} page={page} qs={qs}><LibraryList rows={r.data[1]} tab="/boards/content-creator?tab=library" /></Section>;
}

async function Prompts({ q, page, qs }: SectionProps) {
  const r = await load(async () => {
    let where: Prisma.ShotWhereInput = { promptPackage: { not: Prisma.DbNull } };
    if (q) {
      const p = likePattern(q);
      const [shots, ids] = await Promise.all([
        db.$queryRaw<{ id: string }[]>`SELECT id FROM "Shot" WHERE "promptPackage"::text ILIKE ${p}`,
        matchCampaignIds(q),
      ]);
      where = { OR: [{ id: { in: shots.map((s) => s.id) } }, { campaignId: { in: ids } }] };
    }
    return Promise.all([
      db.shot.count({ where }),
      db.shot.findMany({ where, orderBy: [{ campaignId: "desc" }, { shotId: "asc" }], skip: page * PAGE_SIZE, take: PAGE_SIZE, select: { id: true, shotId: true, campaignId: true, promptPackage: true, campaign: { select: { clientBrief: true } } } }),
    ]);
  });
  if (!r.ok) return <SectionError type="prompts" />;
  return (
    <Section type="prompts" total={r.data[0]} page={page} qs={qs}>
      <ul className="space-y-2">
        {r.data[1].map((s) => {
          const pkg = s.promptPackage as PromptPackage | null;
          return (
            <li key={s.id}>
              <Link href={`/campaigns/${s.campaignId}?tab=shots`} className="block rounded-2xl bg-canvas p-3 text-sm hover:bg-brand-soft">
                <span className="font-semibold">{product(s.campaign.clientBrief, s.campaignId)} · {s.shotId}</span>
                {pkg && <span className="block truncate text-xs text-ink-2">{pkg.fileName} · {pkg.prompt.split("\n")[0]}</span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

async function Notes({ q, agent, page, qs }: SectionProps) {
  const r = await load(async () => {
    const where: Prisma.DecisionWhereInput = {
      notes: q ? { contains: q, mode: "insensitive" } : { not: null },
      ...(agent && (agent === "videographer" ? { type: "regenerate" } : { targetAgent: agent })),
    };
    return Promise.all([
      db.decision.count({ where }),
      db.decision.findMany({ where, orderBy: { createdAt: "desc" }, skip: page * PAGE_SIZE, take: PAGE_SIZE, select: { id: true, type: true, notes: true, targetAgent: true, createdAt: true, campaignId: true, campaign: { select: { clientBrief: true } } } }),
    ]);
  });
  if (!r.ok) return <SectionError type="notes" />;
  return (
    <Section type="notes" total={r.data[0]} page={page} qs={qs}>
      <ul className="space-y-2">
        {r.data[1].map((d) => (
          <li key={d.id}>
            <Link href={`/campaigns/${d.campaignId}?tab=decisions`} className="block rounded-2xl bg-canvas p-3 text-sm hover:bg-brand-soft">
              <span className="flex flex-wrap gap-2 text-xs text-ink-2">
                <span className="font-bold capitalize text-ink">{d.type}</span>
                {d.targetAgent && <span>→ {roleByAgent(d.targetAgent)?.label ?? d.targetAgent}</span>}
                <span>{product(d.campaign.clientBrief, d.campaignId)}</span>
                <span className="ml-auto">{date(d.createdAt)}</span>
              </span>
              <span className="mt-1 line-clamp-2 block">{d.notes}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Section>
  );
}


async function Feedback({ q, agent, page, qs }: SectionProps) {
  const r = await load(async () => {
    const where: Prisma.AgentFeedbackWhereInput = { ...(agent && { agentRole: agent }), ...(q && { text: { contains: q, mode: "insensitive" } }) };
    return Promise.all([
      db.agentFeedback.count({ where }),
      db.agentFeedback.findMany({ where, orderBy: { createdAt: "desc" }, skip: page * PAGE_SIZE, take: PAGE_SIZE }),
    ]);
  });
  if (!r.ok) return <SectionError type="feedback" />;
  return <Section type="feedback" total={r.data[0]} page={page} qs={qs}><FeedbackList rows={r.data[1]} showAgent={!agent} /></Section>;
}
