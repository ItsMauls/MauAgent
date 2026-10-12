// Deterministic cost math (never an LLM). Pure functions are unit-tested in cost.test.ts.
import { db } from "@/lib/db";

type PriceRow = { provider: string; model: string; unit: string; unitPrice: unknown; effectiveFrom: Date };

/** PriceBook lookup: the newest row with effectiveFrom <= at. No price = 0 (placeholder seed). */
export function latestPrice(rows: PriceRow[], provider: string, model: string, unit: string, at = new Date()) {
  const row = rows
    .filter((r) => r.provider === provider && r.model === model && r.unit === unit && r.effectiveFrom <= at)
    .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime())[0];
  return Number(row?.unitPrice ?? 0);
}

const round = (n: number) => Math.round(n * 10000) / 10000;

export type RegenEstimate = {
  n: number;
  model: string;
  seconds: number;
  addUsd: number;
  totalUsd: number;
  capUsd: number;
  overCap: boolean;
};

/** Regenerating API shots costs duration × price per second; manual shots cost 0 (counted as attempts). */
export function estimateRegenerate(o: {
  shots: { source: string; durationSec: number }[];
  pricePerSec: number;
  model: string;
  spentUsd: number;
  capUsd: number;
}): RegenEstimate {
  const seconds = o.shots.filter((s) => s.source === "seedance_api").reduce((a, s) => a + s.durationSec, 0);
  const addUsd = round(seconds * o.pricePerSec);
  const totalUsd = round(o.spentUsd + addUsd);
  return { n: o.shots.length, model: o.model, seconds, addUsd, totalUsd, capUsd: o.capUsd, overCap: totalUsd > o.capUsd };
}

/** Budget gate: blocks when the estimate pushes the campaign or the month over its cap. */
export function budgetGate(o: { estUsd: number; spentUsd: number; capUsd: number; monthSpentUsd: number; monthCapUsd: number }) {
  const reasons: string[] = [];
  const total = round(o.spentUsd + o.estUsd);
  const month = round(o.monthSpentUsd + o.estUsd);
  if (total > o.capUsd) reasons.push(`Campaign total US$${total.toFixed(2)} exceeds the campaign cap US$${o.capUsd.toFixed(2)}.`);
  if (month > o.monthCapUsd) reasons.push(`Monthly total US$${month.toFixed(2)} exceeds the monthly cap US$${o.monthCapUsd.toFixed(2)}.`);
  return { blocked: reasons.length > 0, reasons, totalUsd: total, monthUsd: month };
}

const sum = (xs: { _sum: { usd?: unknown; costUsd?: unknown } }[]) =>
  xs.reduce((a, x) => a + Number(x._sum.usd ?? x._sum.costUsd ?? 0), 0);

/** Spent = CostEntry (video etc.) + Artifact cost (LLM). */
export async function campaignSpent(campaignId: string) {
  return sum(
    await Promise.all([
      db.costEntry.aggregate({ _sum: { usd: true }, where: { campaignId } }),
      db.artifact.aggregate({ _sum: { costUsd: true }, where: { campaignId } }),
    ]),
  );
}

export async function monthSpent(now = new Date()) {
  const gte = new Date(now.getFullYear(), now.getMonth(), 1);
  return sum(
    await Promise.all([
      db.costEntry.aggregate({ _sum: { usd: true }, where: { createdAt: { gte } } }),
      db.artifact.aggregate({ _sum: { costUsd: true }, where: { createdAt: { gte } } }),
    ]),
  );
}

/** Price per second of the draft video model (the one regenerate uses). */
export async function videoPricePerSec(model: string) {
  return latestPrice(await db.priceBook.findMany({ where: { provider: "byteplus", unit: "second" } }), "byteplus", model, "second");
}
