import Link from "next/link";
import { Suspense } from "react";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { presignGet } from "@/lib/s3";
import { ROLES, roleByAgent } from "@/lib/boards/roles";
import { ARCHIVE_TYPES, archiveSections, delta, likePattern, pageOf, PAGE_SIZE, workedOn, type ArchiveType } from "@/lib/boards/archive";
import { OUTCOME, outcomeLabel } from "@/lib/boards/outcome";
import type { PromptPackage } from "@/lib/agents/schemas";
import { load } from "./cards";
import { FeedbackList } from "./feedback";
import { Modal } from "./modal";

type Qs = (p: Record<string, string | undefined>) => string;
type Props = { q?: string; agent?: string; sp: Record<string, string | undefined>; qs: Qs };
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

// Left column = documents + reports, right column = media, like the reference layout.
const LEFT: ArchiveType[] = ["campaigns", "prompts", "notes", "feedback", "reports"];

export async function ArchiveCard({ q, agent, sp, qs }: Props) {
  const sections = archiveSections(undefined, agent).filter((t) => !(q && t === "reports")); // reports are not searchable
  const SECTION: Record<ArchiveType, (p: SectionProps) => Promise<React.ReactNode>> = {
    campaigns: Campaigns, reports: Reports, videos: Videos, talent: Talent, assets: Assets, prompts: Prompts, notes: Notes, feedback: Feedback,
  };
  const chip = (active: boolean) =>
    `inline-flex shrink-0 items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-semibold transition ${active ? "border-ink bg-ink text-white" : "border-line bg-white text-ink-2 hover:bg-canvas"}`;
  // A new filter starts every section at page 1.
  const reset = Object.fromEntries(Object.keys(sp).filter((k) => k.startsWith("p_")).map((k) => [k, undefined]));
  const col = (types: ArchiveType[]) =>
    sections.filter((t) => types.includes(t)).map((t) => {
      const Section = SECTION[t];
      return (
        <Suspense key={t} fallback={<div className="h-24 animate-pulse rounded-2xl bg-canvas" aria-label={`Loading ${ARCHIVE_TYPES[t]}`} />}>
          <Section q={q} agent={agent} page={pageOf(sp[`p_${t}`])} qs={qs} />
        </Suspense>
      );
    });

  return (
    <section aria-labelledby="arc-h" className="card flex h-full flex-col gap-3 p-5">
      <h2 id="arc-h" className="sr-only">Archive & sources</h2>
      <form action="/boards" role="search" className="relative">
        {Object.entries(sp).filter(([k, v]) => v && k !== "q" && !k.startsWith("p_")).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <span className="material-symbols-outlined pointer-events-none absolute left-0 top-1/2 -translate-y-1/2 text-ink-3">search</span>
        <input name="q" type="search" defaultValue={q} aria-label="Search sources" placeholder="Search for sources to chat with…" className="w-full bg-transparent py-1 pl-9 text-base outline-none placeholder:text-ink-3" />
      </form>

      <nav aria-label="Filter by role" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        <Link href={qs({ ...reset, agent: undefined })} scroll={false} aria-current={!agent ? "true" : undefined} className={chip(!agent)}>
          <span className="material-symbols-outlined !text-[16px]">database</span>All
        </Link>
        {ROLES.map((r) => (
          <Link key={r.slug} href={qs({ ...reset, agent: r.agentRole })} scroll={false} aria-current={agent === r.agentRole ? "true" : undefined} className={chip(agent === r.agentRole)}>
            <span className="material-symbols-outlined !text-[16px]">{r.icon}</span>{r.label}
          </Link>
        ))}
      </nav>

      {!sections.length && <p className="rounded-2xl bg-canvas p-6 text-center text-sm text-ink-2">This role produces nothing to archive.</p>}
      <div className="grid min-h-0 flex-1 content-start gap-x-8 gap-y-6 overflow-y-auto pr-1 md:grid-cols-[1.2fr_1fr]">
        <div className="min-w-0 space-y-6">{col(LEFT)}</div>
        <div className="min-w-0 space-y-6">{col(["videos", "talent", "assets"])}</div>
      </div>
    </section>
  );
}

function Section({ type, total, page, qs, children }: { type: ArchiveType; total: number; page: number; qs: Qs; children: React.ReactNode }) {
  const pages = Math.ceil(total / PAGE_SIZE);
  const more = "font-semibold text-brand hover:underline";
  return (
    <section aria-label={ARCHIVE_TYPES[type]}>
      <h3 className="mb-2 text-xs text-ink-2">
        {ARCHIVE_TYPES[type]} ({total})
      </h3>
      {total === 0 ? <p className="rounded-2xl bg-canvas p-4 text-sm text-ink-2">Nothing found.</p> : children}
      {pages > 1 && (
        <nav aria-label={`${ARCHIVE_TYPES[type]} pages`} className="mt-2 flex items-center gap-3 text-xs">
          {page + 1 < pages && (
            <Link href={qs({ [`p_${type}`]: String(page + 1) })} scroll={false} className={more}>
              show more <span aria-hidden className="material-symbols-outlined !text-[14px] align-[-3px]">expand_more</span>
            </Link>
          )}
          {page > 0 && (
            <Link href={qs({ [`p_${type}`]: page > 1 ? String(page - 1) : undefined })} scroll={false} className={more}>
              show less <span aria-hidden className="material-symbols-outlined !text-[14px] align-[-3px]">expand_less</span>
            </Link>
          )}
          <span className="ml-auto text-ink-3">{page * PAGE_SIZE + 1}–{Math.min(total, (page + 1) * PAGE_SIZE)} of {total}</span>
        </nav>
      )}
    </section>
  );
}

const SectionError = ({ type }: { type: ArchiveType }) => (
  <p role="alert" className="rounded-2xl bg-bad-soft p-3 text-sm text-red-800">{ARCHIVE_TYPES[type]} could not load.</p>
);

/** A file-like row (icon tile, title, subline) that opens its detail in a modal. */
function DocRow({ icon, tone, title, sub, children }: { icon: string; tone: string; title: string; sub: string; children: React.ReactNode }) {
  return (
    <li>
      <Modal
        title={title}
        className="flex w-full items-center gap-3 rounded-xl p-1.5 text-left hover:bg-canvas"
        trigger={
          <>
            <span aria-hidden className={`flex h-10 w-9 shrink-0 items-center justify-center rounded-lg ${tone}`}>
              <span className="material-symbols-outlined !text-[20px]">{icon}</span>
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">{title}</span>
              <span className="block truncate text-xs text-ink-2">{sub}</span>
            </span>
          </>
        }
      >
        {children}
      </Modal>
    </li>
  );
}

/** Square thumbnail with a corner badge that opens its detail in a modal. */
function Thumb({ title, badge, media, children }: { title: string; badge: string; media: React.ReactNode; children: React.ReactNode }) {
  return (
    <li>
      <Modal
        title={title}
        label={title}
        className="relative block aspect-[4/5] w-full overflow-hidden rounded-xl bg-canvas"
        trigger={
          <>
            {media}
            <span className="absolute bottom-1 left-1 max-w-[calc(100%-0.5rem)] truncate rounded-md bg-ink/70 px-1.5 py-0.5 text-[10px] font-semibold text-white">{badge}</span>
          </>
        }
      >
        {children}
      </Modal>
    </li>
  );
}

const Open = ({ href, children }: { href: string; children: React.ReactNode }) => <Link href={href} className="btn-soft">{children}</Link>;

function Facts({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="grid gap-3 text-sm sm:grid-cols-2">
      {rows.map(([k, v]) => (
        <div key={k} className="min-w-0 rounded-2xl bg-canvas p-3">
          <dt className="label">{k}</dt>
          <dd className="break-words font-semibold">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

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
      <ul>
        {rows.map((c) => {
          const [label, cls] = OUTCOME[outcomeLabel(c.status, c.decisions, agent)];
          const roles = [...c.artifacts.map((a) => a.agentRole), ...(c._count.shots ? ["videographer"] : [])].map((x) => roleByAgent(x)?.label).filter(Boolean);
          const brief = Object.entries((c.clientBrief ?? {}) as Record<string, unknown>).filter(([, v]) => v != null && v !== "");
          return (
            <DocRow key={c.id} icon="folder_open" tone="bg-bad-soft text-red-700" title={product(c.clientBrief, c.id)} sub={`${label} · ${date(c.createdAt)}`}>
              <p><span className={`pill ${cls}`}>{label}</span></p>
              <Facts rows={[["Created", date(c.createdAt)], ["Shots", String(c._count.shots)], ["Agents", roles.join(" · ") || "—"], ...brief.map(([k, v]): [string, string] => [k, typeof v === "object" ? JSON.stringify(v) : String(v)])]} />
              <Open href={`/campaigns/${c.id}`}>Open campaign</Open>
            </DocRow>
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
    // Spend = CostEntry, the same ledger as the budget caps (cost.ts). Video rows (Seedance) belong to the Content Creator.
    const VIDEO = { provider: "byteplus" };
    const byAgent: Prisma.CostEntryWhereInput = !agent ? {} : agent === "videographer" ? VIDEO : { agentRole: agent };
    const spend = async (createdAt: Prisma.DateTimeFilter, campaignIds?: string[]) => {
      const scope = campaignIds ? { campaignId: { in: campaignIds } } : {};
      const c = await db.costEntry.aggregate({ _sum: { usd: true }, where: { createdAt, ...scope, ...byAgent } });
      return Number(c._sum.usd ?? 0);
    };
    return Promise.all(ranges.map(async (createdAt) => {
      const delivered = await db.campaign.findMany({ where: { status: { in: ["APPROVED", "PUBLISHED"] }, createdAt, ...(agent && workedOn(agent)) }, select: { id: true } });
      const [total, onDelivered, regen, video] = await Promise.all([
        spend(createdAt),
        delivered.length ? spend({}, delivered.map((d) => d.id)) : 0,
        withVideo ? db.costEntry.aggregate({ _sum: { usd: true }, where: { createdAt, reason: "regenerate", ...VIDEO } }) : null,
        withVideo ? db.costEntry.aggregate({ _sum: { usd: true }, where: { createdAt, ...VIDEO } }) : null,
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
  const usd = (n: number) => `US$${n.toFixed(2)}`;
  // Views/engagement need MetricSnapshot (not built). Impressions and plays are never shown (removed by Meta).
  const tiles = [
    { label: agent ? "Spend by this agent" : "Spend this month", v: usd(cur.spend), pv: usd(prev.spend), d: delta(cur.spend, prev.spend), upIsGood: false },
    { label: "Cost per approved video", v: cur.delivered ? usd(cur.perVideo) : "—", pv: prev.delivered ? usd(prev.perVideo) : "—", d: delta(cur.perVideo, prev.perVideo), upIsGood: false },
    { label: "Approved videos", v: String(cur.delivered), pv: String(prev.delivered), d: delta(cur.delivered, prev.delivered), upIsGood: true },
    ...(!agent || agent === "videographer" ? [{ label: "Regenerate share of video cost", v: `${Math.round(cur.regenShare * 100)}%`, pv: `${Math.round(prev.regenShare * 100)}%`, d: delta(cur.regenShare, prev.regenShare), upIsGood: false }] : []),
  ];
  return (
    <Section type="reports" total={tiles.length} page={page} qs={qs}>
      <ul className="grid grid-cols-2 gap-2 xl:grid-cols-4">
        {tiles.map((t) => {
          const good = t.d && t.d.dir !== "flat" && (t.d.dir === "up") === t.upIsGood;
          const tone = !t.d || t.d.dir === "flat" ? "bg-canvas text-ink-3" : good ? "bg-ok-soft text-emerald-700" : "bg-bad-soft text-red-700";
          const text = !t.d ? "No data last month" : t.d.dir === "flat" ? "Same as last month" : `${t.d.dir === "up" ? "+" : "-"}${t.d.pct == null ? "new" : `${Math.abs(t.d.pct)}%`} last month`;
          return (
            <li key={t.label}>
              <Modal
                title={t.label}
                className="block h-full w-full rounded-xl border border-line p-3 text-left hover:bg-canvas"
                trigger={
                  <>
                    <span className="block text-lg font-bold leading-tight">{t.v}</span>
                    <span className="block text-[11px] leading-tight text-ink-2">{t.label}</span>
                    <span className={`mt-1.5 inline-block rounded px-1 py-0.5 text-[9px] font-bold uppercase ${tone}`}>{text}</span>
                  </>
                }
              >
                <Facts rows={[["This month", t.v], ["Last month", t.pv], ["Change", text]]} />
                <p className="text-xs text-ink-3">Calendar months. Views and engagement appear once analytics metrics are pulled.</p>
              </Modal>
            </li>
          );
        })}
      </ul>
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
      <ul className="grid grid-cols-3 gap-2">
        {r.data.items.map((v) => (
          <Thumb key={v.id} title={v.title} badge={v.sub} media={<video src={v.url} preload="metadata" muted aria-hidden className="h-full w-full object-cover" />}>
            <video src={v.url} controls preload="none" className="mx-auto max-h-[60vh] rounded-2xl bg-black" />
            <Facts rows={[["Type", v.sub], ["Created", date(v.at)]]} />
            <div className="flex flex-wrap gap-2">
              <a href={v.url} target="_blank" rel="noreferrer" className="btn-soft">Open file</a>
              <Open href={`/campaigns/${v.campaignId}`}>Open campaign</Open>
            </div>
          </Thumb>
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
    <ul className="grid grid-cols-3 gap-2">
      {rows.map((a) => (
        <Thumb
          key={a.id}
          title={a.name}
          badge={a.name}
          media={
            a.imageUrls[0] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={a.imageUrls[0]} alt="" className="h-full w-full object-cover" />
            ) : (
              <span aria-hidden className="flex h-full w-full items-center justify-center text-ink-3"><span className="material-symbols-outlined">image</span></span>
            )
          }
        >
          {a.imageUrls.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {a.imageUrls.map((u) => <a key={u} href={u} target="_blank" rel="noreferrer"><img src={u} alt="" className="h-28 w-28 rounded-xl object-cover" /></a>)}
            </div>
          )}
          <p className="whitespace-pre-wrap text-sm text-ink-2">{a.description}</p>
          <Facts rows={[["Type", a.kind], ["Linked campaigns", String(a._count.campaigns)]]} />
          <Open href={tab}>Open in library</Open>
        </Thumb>
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
      <ul>
        {r.data[1].map((s) => {
          const pkg = s.promptPackage as PromptPackage | null;
          const title = `${product(s.campaign.clientBrief, s.campaignId)} · ${s.shotId}`;
          return (
            <DocRow key={s.id} icon="description" tone="bg-brand-soft text-brand" title={title} sub={pkg ? `${pkg.fileName} · ${pkg.prompt.split("\n")[0]}` : "Prompt package"}>
              {pkg && <Facts rows={[["File", pkg.fileName]]} />}
              {pkg && <pre className="whitespace-pre-wrap rounded-2xl bg-canvas p-4 text-sm">{pkg.prompt}</pre>}
              <Open href={`/campaigns/${s.campaignId}?tab=shots`}>Open shots</Open>
            </DocRow>
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
      <ul>
        {r.data[1].map((d) => {
          const target = d.targetAgent ? (roleByAgent(d.targetAgent)?.label ?? d.targetAgent) : null;
          return (
            <DocRow key={d.id} icon="sticky_note_2" tone="bg-amber-soft text-amber-800" title={d.notes ?? d.type} sub={`${d.type}${target ? ` → ${target}` : ""} · ${product(d.campaign.clientBrief, d.campaignId)}`}>
              <Facts rows={[["Decision", d.type], ["Aimed at", target ?? "—"], ["Campaign", product(d.campaign.clientBrief, d.campaignId)], ["Date", date(d.createdAt)]]} />
              <p className="whitespace-pre-wrap rounded-2xl bg-canvas p-4 text-sm">{d.notes}</p>
              <Open href={`/campaigns/${d.campaignId}?tab=decisions`}>Open decisions</Open>
            </DocRow>
          );
        })}
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
  return (
    <Section type="feedback" total={r.data[0]} page={page} qs={qs}>
      <ul>
        {r.data[1].map((f) => (
          <DocRow key={f.id} icon={f.sentiment === "positive" ? "thumb_up" : f.sentiment === "negative" ? "thumb_down" : "remove"} tone="bg-ok-soft text-emerald-700" title={f.text} sub={`${roleByAgent(f.agentRole)?.label ?? f.agentRole} · ${date(f.createdAt)}`}>
            <FeedbackList rows={[f]} showAgent />
          </DocRow>
        ))}
      </ul>
    </Section>
  );
}
