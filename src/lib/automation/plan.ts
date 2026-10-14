// Automation campaign planner: goal + plan settings → every post slot, fully specified (time per account, type,
// angles, pillar, CTA) before anything is generated. Deterministic and LLM-free: the same inputs and seed give the
// same plan. Times are "best times for the audience" (an even spread inside active hours with a little jitter so the
// grid is not rigid); nothing here tries to make automation look human. Pure; tested in plan.test.ts.
import type { ContentType, Cta } from "@/lib/agents/schemas";
import { addDays } from "@/lib/boards/agenda";
import type { Angles, ContentConfig } from "@/lib/content/config";
import { ctaPlan, isThreadType, pickAngles, pickType, topicEntry } from "@/lib/content/select";
import { zonedToIso } from "@/lib/publish";
import type { AutomationPlatform, Goal, PlanConfig } from "./config";

/** Seeded PRNG (mulberry32): uniform in [0, 1). */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 0 = Monday … 6 = Sunday, for a "YYYY-MM-DD" day. */
const weekday = (day: string) => (new Date(Date.parse(day)).getUTCDay() + 6) % 7;
const windowMinutes = (cfg: PlanConfig) => (cfg.activeHours[1] - cfg.activeHours[0]) * 60;

/**
 * Texts one day can hold: the per-day limit, and no more than fit in the active window with the minimum gap between
 * them (each account gets every text, so the gap binds per day).
 */
export const dayCapacity = (cfg: PlanConfig) => Math.min(cfg.maxPostsPerDay, Math.floor(windowMinutes(cfg) / cfg.minGapMinutes));

/** Days of the range that can carry posts (not a quiet weekday, weight above 0). */
export function planDays(goal: Pick<Goal, "startDate" | "endDate">, cfg: PlanConfig): string[] {
  const out: string[] = [];
  for (let d = goal.startDate; d <= goal.endDate; d = addDays(d, 1))
    if (!cfg.quietWeekdays.includes(weekday(d)) && cfg.weekdayWeights[weekday(d)] > 0) out.push(d);
  return out;
}

export type Capacity = { days: number; perDay: number; total: number; shortfall: number };

/** The feasibility check the form shows live and the server repeats: a shortfall blocks creating the campaign. */
export function capacity(goal: Pick<Goal, "startDate" | "endDate" | "targetPosts">, cfg: PlanConfig): Capacity {
  const days = goal.endDate >= goal.startDate ? planDays(goal, cfg).length : 0;
  const perDay = dayCapacity(cfg);
  const total = days * perDay;
  return { days, perDay, total, shortfall: Math.max(0, goal.targetPosts - total) };
}

/** Target posts from either a total or a rate (posts per day over the plan's posting days). */
export const targetFrom = (o: { mode: "total" | "rate"; total: number; perDay: number; days: number }) =>
  o.mode === "total" ? o.total : o.perDay * o.days;

/**
 * Spread `target` texts over days by weight, never above `cap` per day. Proportional shares (floored) first, then the
 * remainder one by one to the days with the largest leftover share; repeats while capped days push texts elsewhere.
 */
export function spread(weights: number[], target: number, cap: number): number[] {
  const alloc = weights.map(() => 0);
  let left = target;
  while (left > 0) {
    const open = weights.flatMap((w, i) => (w > 0 && alloc[i] < cap ? [i] : []));
    if (!open.length) break;
    const total = open.reduce((n, i) => n + weights[i], 0);
    const share = open.map((i) => ({ i, s: (left * weights[i]) / total }));
    let given = 0;
    for (const { i, s } of share) {
      const g = Math.min(Math.floor(s), cap - alloc[i]);
      alloc[i] += g;
      given += g;
    }
    left -= given;
    if (given) continue;
    // Every share is under 1: hand out singles by the largest share (ties: earlier day first).
    for (const { i } of share.sort((a, b) => b.s - a.s || a.i - b.i)) {
      if (!left) break;
      alloc[i]++;
      left--;
    }
  }
  return alloc;
}

export class PlanInfeasible extends Error {
  constructor(public shortfall: number, cap: Capacity) {
    super(`The plan holds ${cap.total} posts (${cap.days} days × ${cap.perDay} per day): ${shortfall} short. Lengthen the range, raise posts per day or lower the target.`);
  }
}

export type PlanAccount = { id: string; platform: AutomationPlatform };

export type PlannedPost = {
  slot: number;
  socialAccountId: string;
  platform: PlanAccount["platform"];
  contentType: ContentType;
  angles: string[];
  pillar: string;
  topicSeed: string;
  cta: Cta | null;
  scheduledAt: Date;
  localTime: string;
};

const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

export function buildPlan(o: {
  goal: Goal;
  cfg: PlanConfig;
  accounts: PlanAccount[];
  tz: string;
  seed: number;
  content: ContentConfig;
  angles: Angles;
  variants: number;
  /** Type history before the plan (most recent last) and threads posted in the last 7 days. */
  history?: { recent: string[]; threadsThisWeek: number };
}): PlannedPost[] {
  const { goal, cfg } = o;
  const cap = capacity(goal, cfg);
  if (cap.shortfall) throw new PlanInfeasible(cap.shortfall, cap);
  if (!o.accounts.length) throw new Error("Pick at least one account");
  const rand = rng(o.seed);
  const days = planDays(goal, cfg);
  const perDay = spread(days.map((d) => cfg.weekdayWeights[weekday(d)]), goal.targetPosts, cap.perDay);
  const ctas = ctaPlan(goal.targetPosts, goal.cta);
  const pillars = [...goal.pillars];
  for (let i = pillars.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pillars[i], pillars[j]] = [pillars[j], pillars[i]];
  }

  const recent = [...(o.history?.recent ?? [])];
  // Threads by plan day, for the rolling 7-day cap. Earlier threads count as posted the day before the plan starts.
  const threadDays: number[] = Array(o.history?.threadsThisWeek ?? 0).fill(-1);
  const planAngles: string[] = [];
  const start = cfg.activeHours[0] * 60;
  const out: PlannedPost[] = [];
  let slot = 0;

  days.forEach((day, di) => {
    const k = perDay[di];
    if (!k) return;
    // k equal whole-minute segments; a text sits in the middle of its segment, each account ± its own jitter, kept
    // small enough that neighbours stay minGapMinutes apart (segment ≥ minGap because k ≤ dayCapacity).
    const seg = Math.floor(windowMinutes(cfg) / k);
    const jitter = Math.max(0, Math.min(cfg.jitterMinutes, Math.floor((seg - cfg.minGapMinutes) / 2)));
    for (let s = 0; s < k; s++, slot++) {
      const threadsThisWeek = threadDays.filter((d) => d > di - 7).length;
      const type = pickType(o.content, { recent, threadsThisWeek }, rand);
      if (!type) throw new Error("No content type is allowed for this slot: check the weights in content-types.yaml");
      recent.push(type);
      if (isThreadType(o.content, type)) threadDays.push(di);
      const pillar = pillars[slot % pillars.length];
      const list = topicEntry(o.angles, pillar)?.angles[type] ?? [];
      const angles = pickAngles(list, o.variants, new Set(), o.angles.historySize ? planAngles.slice(-o.angles.historySize) : [], rand);
      planAngles.push(...angles);
      const centre = start + s * seg + Math.floor(seg / 2);
      for (const a of o.accounts) {
        const minute = centre + Math.round((rand() * 2 - 1) * jitter);
        out.push({
          slot, socialAccountId: a.id, platform: a.platform, contentType: type, angles, pillar, topicSeed: pillar,
          cta: ctas[slot], scheduledAt: new Date(zonedToIso(`${day}T${hhmm(minute)}`, o.tz)), localTime: `${day} ${hhmm(minute)}`,
        });
      }
    }
  });
  return out;
}
