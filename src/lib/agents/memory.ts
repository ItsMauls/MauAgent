// Agent memory (episodic now; lessons/procedural from Stage 3). Pure helpers are unit-tested in memory.test.ts.
import { createHash } from "node:crypto";
import type { AgentMemory, MemoryLayer } from "@prisma/client";
import { db } from "@/lib/db";
import { AGENT_ROLES, ApprovalPackage, ClientBrief, CreativeBrief, InternalBrief, ProductionPlan, VisualDirection, type AgentRole } from "./schemas";

// ---------- Secret / PII redaction (every memory write goes through it) ----------

const R = "[redacted]";
const digits = (s: string) => s.replace(/\D/g, "").length;
const RULES: [RegExp, string | ((m: string, ...g: string[]) => string)][] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, R],
  [/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, R], // JWT
  [/\bBearer\s+[\w.~+/-]+=*/gi, `Bearer ${R}`],
  [/\/\/[^/\s:@]+:[^/\s@]+@/g, `//${R}@`], // credentials in URLs
  [/\b(password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|client[_-]?secret)\b\s*[:=]\s*\S+/gi, (_m, k) => `${k}=${R}`],
  [/\b(?:sk|pk|rk)[-_][A-Za-z0-9_-]{16,}/g, R], // sk-..., sk_live_...
  [/\bAKIA[0-9A-Z]{16}\b/g, R], // AWS access key
  [/\bAIza[0-9A-Za-z_-]{35}\b/g, R], // Google API key
  [/\bgh[pousr]_[A-Za-z0-9]{36,}\b/g, R], // GitHub token
  [/\bxox[abpr]-[\w-]+/g, R], // Slack token
  [/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, R], // email
  [/(?:\+\d|\b\d)[\d\s().-]{8,}\d\b/g, (m) => (digits(m) >= 9 ? R : m)], // phone, card, ID numbers (dates have < 9 digits)
  [/\b[A-Za-z0-9_-]{32,}\b/g, (m) => (/\d/.test(m) && /[A-Za-z]/.test(m) ? R : m)], // long opaque tokens
];

export function redact(text: string) {
  return RULES.reduce((t, [re, to]) => t.replace(re, to as string), text);
}

const MAX_CONTENT = 600;

export type MemoryInput = {
  role: string;
  layer: MemoryLayer;
  content: string;
  tags: string[];
  campaignId?: string;
  sourceArtifactIds?: string[];
  campaignIds?: string[];
  confidence?: number;
  idemKey?: string;
};

export const cleanMemoryText = (s: string) => redact(s).slice(0, MAX_CONTENT);

export const sanitizeMemory =(m: MemoryInput): MemoryInput => ({
  ...m,
  content: redact(m.content).slice(0, MAX_CONTENT),
  tags: m.tags.map(redact),
});

/** The only memory writer: redacts, caps the size, and is idempotent when an idemKey is given. */
export function writeMemory(m: MemoryInput) {
  const data = sanitizeMemory(m);
  return m.idemKey ? db.agentMemory.upsert({ where: { idemKey: m.idemKey }, create: data, update: {} }) : db.agentMemory.create({ data });
}

// ---------- Tags (relevance = overlap of brief keywords and platforms) ----------

const STOP = new Set(["with", "that", "this", "from", "their", "they", "your", "into", "about", "more", "than", "want", "make", "will", "have", "for", "and", "the", "yang", "untuk", "dengan", "dari"]);

export function briefTags(brief: Pick<ClientBrief, "product" | "audience" | "objective" | "platforms">) {
  const words = `${brief.product} ${brief.audience} ${brief.objective}`
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 4 && !STOP.has(w));
  return [...brief.platforms.map((p) => `platform:${p}`), ...new Set(words)].slice(0, 14);
}

// ---------- Retrieval (pure: rank + pack into a token budget) ----------

type Recallable = Pick<AgentMemory, "id" | "layer" | "content" | "tags" | "confidence" | "pinned" | "archivedAt" | "updatedAt">;

export const estTokens = (s: string) => Math.ceil(s.length / 4);
export const memoryLine = (m: Recallable) => `- (${m.layer}${m.pinned ? ", pinned" : ""}) ${m.content}`;

/**
 * Procedural first (always, while the budget allows), then lessons and episodes by score:
 * pinned, tag overlap, confidence, recency (90-day half-life-ish decay). Archived never.
 */
export function selectMemories<T extends Recallable>(mems: T[], tags: string[], budgetTokens: number, now = new Date()) {
  const want = new Set(tags);
  const score = (m: T) =>
    (m.pinned ? 100 : 0) +
    m.tags.filter((t) => want.has(t)).length * 2 +
    m.confidence * 3 +
    Math.exp(-(now.getTime() - m.updatedAt.getTime()) / (90 * 864e5));
  const byScore = (a: T, b: T) => score(b) - score(a);
  const live = mems.filter((m) => !m.archivedAt);
  const ordered = [
    ...live.filter((m) => m.layer === "procedural").sort(byScore),
    ...live.filter((m) => m.layer !== "procedural").sort(byScore),
  ];
  const picked: T[] = [];
  let used = 0;
  for (const m of ordered) {
    const t = estTokens(memoryLine(m));
    if (used + t > budgetTokens) continue;
    picked.push(m);
    used += t;
  }
  return picked;
}

export function memoryBlock(mems: Recallable[]) {
  if (!mems.length) return "";
  return `\n\nYour experience from past campaigns (guidance only; if it conflicts with the client brief, brand kit or budget cap, those win):\n${mems.map(memoryLine).join("\n")}`;
}

/** Memory block for a chat or a non-pipeline role (no campaign run to audit). "" when memory is off or empty. */
export async function roleMemoryBlock(role: string) {
  const s = await db.setting.upsert({ where: { id: "default" }, create: {}, update: {} });
  if (!s.memoryEnabled) return "";
  const mems = await db.agentMemory.findMany({ where: { role, archivedAt: null }, orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }], take: 300 });
  return memoryBlock(selectMemories(mems, [], s.memoryTokenBudget));
}

/** Owner instructions given in chat: procedural memory, idempotent per text so repeating an instruction adds nothing. */
export const rememberFromChat = (role: string, notes: string[]) =>
  Promise.all(notes.map((content) =>
    writeMemory({ role, layer: "procedural", content, tags: ["owner-chat"], confidence: 1, idemKey: `chat:${role}:${createHash("sha1").update(content.trim().toLowerCase()).digest("hex")}` }),
  ));

export type MemoryCtx ={ runId: string; campaignId: string; brief: ClientBrief };

/** Recall for one agent call and record which memories were used on this run. Returns "" when memory is off. */
export async function recallMemory(role: AgentRole, ctx: MemoryCtx) {
  const s = await db.setting.upsert({ where: { id: "default" }, create: {}, update: {} });
  if (!s.memoryEnabled) return "";
  // ponytail: newest 300 per role scored in memory; move scoring to SQL if a role holds thousands.
  const mems = await db.agentMemory.findMany({
    where: { role, archivedAt: null },
    orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
    take: 300,
  });
  const picked = selectMemories(mems, briefTags(ctx.brief), s.memoryTokenBudget);
  const memoryIds = picked.map((m) => m.id);
  await db.agentMemoryUse.upsert({
    where: { runId_role: { runId: ctx.runId, role } },
    create: { runId: ctx.runId, campaignId: ctx.campaignId, role, memoryIds },
    update: { memoryIds },
  });
  return memoryBlock(picked);
}

// ---------- Episodes (pure: built from artifacts + client decisions, no LLM) ----------

type DecisionRow = { type: string; targetAgent: string | null; notes: string | null };

/** Roles a client revision was aimed at. Regenerate = new footage = Videographer. */
export const revisedRole = (d: DecisionRow) =>
  d.type === "revise" ? d.targetAgent : d.type === "regenerate" ? "videographer" : null;

export type EpisodeInput = {
  brief: ClientBrief;
  artifacts: Partial<Record<string, { id: string; payload: unknown }>>;
  decisions: DecisionRow[];
  shots: { source: string; versions: number }[];
};

const cut = (s: string, n = 140) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function roleSummary(role: AgentRole, a: EpisodeInput): string | null {
  const p = (r: string) => a.artifacts[r]?.payload;
  switch (role) {
    case "accountManager": {
      const x = InternalBrief.safeParse(p(role));
      return x.success ? `Internal brief: insight "${cut(x.data.insight)}"; tone ${cut(x.data.tone, 60)}; ${x.data.mandatories.length} mandatories.` : null;
    }
    case "creativeDirector": {
      const x = CreativeBrief.safeParse(p(role));
      if (!x.success) return null;
      const chosen = x.data.conceptOptions.find((o) => x.data.chosenConcept.includes(o.title)) ?? x.data.conceptOptions[0];
      const others = x.data.conceptOptions.filter((o) => o !== chosen).map((o) => `"${o.title}"`).join(", ");
      return `Chose "${chosen.title}" over ${others}. Hook: "${cut(chosen.hook)}". Key message: "${cut(x.data.keyMessage)}".`;
    }
    case "artDirector": {
      const x = VisualDirection.safeParse(p(role));
      if (!x.success) return null;
      const sec = x.data.shotList.reduce((s, sh) => s + sh.durationSec, 0);
      return `${x.data.shotList.length} shots, ${sec}s total; palette ${x.data.palette.slice(0, 4).join(", ")}; character: ${cut(x.data.characterDescription, 100)}.`;
    }
    case "producer": {
      const x = ProductionPlan.safeParse(p(role));
      if (!x.success) return null;
      const src = [...new Set(x.data.shots.map((s) => s.source))].join(" + ");
      return `${x.data.shots.length} shots via ${src}; estimate US$${x.data.estCostUsd.toFixed(2)}.`;
    }
    case "videographer": {
      if (!a.shots.length) return null;
      const takes = a.shots.reduce((s, x) => s + x.versions, 0);
      const src = [...new Set(a.shots.map((s) => s.source))].join(" + ");
      return `${a.shots.length} shots via ${src}; ${takes} takes in total.`;
    }
    case "postProduction": {
      const clips = (p(role) as { clips?: unknown[] } | undefined)?.clips;
      return Array.isArray(clips) ? `Final cut from ${clips.length} clips.` : null;
    }
    case "socmedSpecialist":
    case "postQc":
      return null; // text posts are not campaign artifacts; their memory comes from owner chat and feedback
    case "accountTeam": {
      const x = ApprovalPackage.safeParse(p(role));
      if (!x.success) return null;
      const flagged = x.data.brandSafetyChecklist.filter((c) => !c.ok).map((c) => cut(c.item, 40));
      return `QC self score ${x.data.selfScore}/10; ${flagged.length ? `flagged: ${flagged.join(", ")}` : "no brand-safety flags"}.`;
    }
  }
}

export function buildEpisodes(a: EpisodeInput) {
  const tags = briefTags(a.brief);
  const head = `${cut(a.brief.product, 60)} for ${cut(a.brief.audience, 60)} on ${a.brief.platforms.join("/")}.`;
  return AGENT_ROLES.flatMap((role) => {
    const summary = roleSummary(role, a);
    if (!summary) return [];
    const revs = a.decisions.filter((d) => revisedRole(d) === role);
    const notes = revs.map((d) => d.notes).filter(Boolean).map((n) => `"${cut(n!, 100)}"`);
    const outcome = revs.length
      ? `Approved after ${revs.length} client revision(s) aimed at this role${notes.length ? `: ${notes.join("; ")}` : ""}.`
      : "Approved with no revision aimed at this role.";
    return [{ role, content: `${head} ${summary} ${outcome}`, tags, sourceArtifactIds: a.artifacts[role] ? [a.artifacts[role]!.id] : [] }];
  });
}

/** Writes one episode per role for an approved campaign. Idempotent (idemKey), never overwrites owner edits. */
export async function writeEpisodes(campaignId: string) {
  const s = await db.setting.upsert({ where: { id: "default" }, create: {}, update: {} });
  if (!s.memoryEnabled) return { written: 0 };
  const c = await db.campaign.findUniqueOrThrow({
    where: { id: campaignId },
    include: {
      artifacts: { orderBy: { version: "desc" } },
      decisions: true,
      shots: { include: { _count: { select: { assets: true } } } },
    },
  });
  const artifacts: EpisodeInput["artifacts"] = {};
  for (const x of c.artifacts) artifacts[x.agentRole] ??= { id: x.id, payload: x.payload }; // latest version per role
  const episodes = buildEpisodes({
    brief: ClientBrief.parse(c.clientBrief),
    artifacts,
    decisions: c.decisions,
    shots: c.shots.map((x) => ({ source: x.source, versions: x._count.assets })),
  });
  for (const e of episodes)
    await writeMemory({ ...e, layer: "episodic", campaignId, campaignIds: [campaignId], idemKey: `episode:${campaignId}:${e.role}` });
  return { written: episodes.length };
}

// ---------- Experience + seniority (deterministic, computed on read) ----------

export const LEVELS = [
  { level: "Lead", delivered: 75, firstPassRate: 0.8 },
  { level: "Senior", delivered: 30, firstPassRate: 0.7 },
  { level: "Mid", delivered: 10, firstPassRate: 0.5 },
] as const;

export function seniority(delivered: number, firstPassRate: number) {
  return LEVELS.find((l) => delivered >= l.delivered && firstPassRate >= l.firstPassRate)?.level ?? "Junior";
}

export type ExperienceRow = { status: string; roles: string[]; revisedRoles: string[] };

export function experience(role: string, rows: ExperienceRow[]) {
  const worked = rows.filter((r) => r.roles.includes(role));
  const delivered = worked.filter((r) => r.status === "APPROVED" || r.status === "PUBLISHED");
  const firstPass = delivered.filter((r) => !r.revisedRoles.includes(role)).length;
  const firstPassRate = delivered.length ? firstPass / delivered.length : 0;
  return {
    campaigns: worked.length,
    delivered: delivered.length,
    published: worked.filter((r) => r.status === "PUBLISHED").length,
    firstPassRate,
    level: seniority(delivered.length, firstPassRate),
  };
}

export async function agentExperience() {
  const cs = await db.campaign.findMany({
    select: {
      status: true,
      artifacts: { select: { agentRole: true }, distinct: ["agentRole"] },
      decisions: { select: { type: true, targetAgent: true, notes: true } },
      _count: { select: { shots: true } },
    },
  });
  const rows: ExperienceRow[] = cs.map((c) => ({
    status: c.status,
    roles: [...c.artifacts.map((a) => a.agentRole), ...(c._count.shots ? ["videographer"] : [])],
    revisedRoles: c.decisions.map(revisedRole).filter((r): r is string => !!r),
  }));
  return Object.fromEntries(AGENT_ROLES.map((r) => [r, experience(r, rows)])) as Record<AgentRole, ReturnType<typeof experience>>;
}
