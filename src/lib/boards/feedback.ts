// Agent feedback: automatic from client decisions and QC, or written by the owner. Builders are pure (tested);
// writeFeedback is the one writer and also files the feedback as episodic memory for LLM roles.
import type { FeedbackSource, Sentiment } from "@prisma/client";
import { db } from "@/lib/db";
import { revisedRole, writeMemory } from "@/lib/agents/memory";
import { isAgentRole } from "@/lib/agents/persona";
import type { ApprovalPackage } from "@/lib/agents/schemas";

export type FeedbackInput = {
  agentRole: string; campaignId?: string; agentTaskId?: string; source: FeedbackSource; sentiment: Sentiment; text: string; idemKey?: string;
};

/** A revise note goes to the stage it was routed to; a regenerate goes to the Content Creator (videographer). */
export function decisionFeedback(d: { id: string; campaignId: string; type: string; targetAgent: string | null; notes: string | null; shotIds: string[] }): FeedbackInput | null {
  const role = revisedRole(d);
  if (!role) return null;
  const text = d.type === "regenerate" ? `Client asked to regenerate ${d.shotIds.join(", ") || "shots"}.${d.notes ? ` ${d.notes}` : ""}` : (d.notes ?? "Revision requested.");
  return { agentRole: role, campaignId: d.campaignId, source: "client_decision", sentiment: "negative", text, idemKey: `decision:${d.id}` };
}

/** QC judges the deliverable, which Post-production assembled: score ≥ 8 positive, < 6 negative. */
export function qcFeedback(campaignId: string, artifactId: string, pkg: Pick<ApprovalPackage, "selfScore" | "brandSafetyChecklist">): FeedbackInput {
  const flagged = pkg.brandSafetyChecklist.filter((c) => !c.ok);
  const sentiment: Sentiment = pkg.selfScore >= 8 && !flagged.length ? "positive" : pkg.selfScore < 6 || flagged.length ? "negative" : "neutral";
  const text = `QC score ${pkg.selfScore}/10.${flagged.length ? ` Flagged: ${flagged.map((c) => `${c.item}${c.note ? ` (${c.note})` : ""}`).join("; ")}.` : " No brand-safety flags."}`;
  return { agentRole: "postProduction", campaignId, source: "qc", sentiment, text, idemKey: `qc:${artifactId}` };
}

/** Idempotent per idemKey. Feeds the agent's episodic memory (redacted by writeMemory) when memory is on. */
export async function writeFeedback(f: FeedbackInput) {
  const row = f.idemKey
    ? await db.agentFeedback.upsert({ where: { idemKey: f.idemKey }, create: f, update: {} })
    : await db.agentFeedback.create({ data: f });
  const s = await db.setting.upsert({ where: { id: "default" }, create: {}, update: {} });
  if (s.memoryEnabled && isAgentRole(f.agentRole))
    await writeMemory({
      role: f.agentRole, layer: "episodic", tags: [`feedback:${f.source}`, `sentiment:${f.sentiment}`],
      content: `Feedback (${f.source.replace("_", " ")}, ${f.sentiment}): ${f.text}`,
      ...(f.campaignId && { campaignId: f.campaignId, campaignIds: [f.campaignId] }),
      idemKey: `feedback:${row.id}`,
    });
  return row;
}
