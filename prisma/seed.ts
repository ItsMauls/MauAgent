// PLACEHOLDER prices — fill in from the official BytePlus ModelArk & Google AI pricing pages before use.
import { PrismaClient } from "@prisma/client";
import { DEFAULT_PERSONAS } from "../src/lib/agents/persona";

const db = new PrismaClient();
const effectiveFrom = new Date("2026-01-01");

const rows = [
  // Seedance: USD per second of video. model = SEEDANCE_MODEL_DRAFT / _FINAL di .env.
  { provider: "byteplus", model: process.env.SEEDANCE_MODEL_DRAFT || "seedance-draft", unit: "second", unitPrice: 0 },
  { provider: "byteplus", model: process.env.SEEDANCE_MODEL_FINAL || "seedance-final", unit: "second", unitPrice: 0 },
  // LLM prices are not kept here: OpenRouter returns the real cost per call (usage.cost) and /models has the price list.
  // Apify TikTok Trends actor (pay per event, FREE tier, read from the actor's pricingInfos on 12 Oct 2026).
  { provider: "apify", model: "tiktok-trends", unit: "actor_start", unitPrice: 0.025 },
  { provider: "apify", model: "tiktok-trends", unit: "item", unitPrice: 0.0015 },
];

async function main() {
  for (const r of rows)
    await db.priceBook.upsert({
      where: { provider_model_unit_effectiveFrom: { provider: r.provider, model: r.model, unit: r.unit, effectiveFrom } },
      create: { ...r, effectiveFrom },
      update: {},
    });
  await db.setting.upsert({ where: { id: "default" }, create: {}, update: {} });
  // Persona v1 only for roles without a profile, so owner edits are never overwritten.
  for (const [role, persona] of Object.entries(DEFAULT_PERSONAS))
    if (!(await db.agentProfile.count({ where: { role } })))
      await db.agentProfile.create({ data: { role, version: 1, persona, note: "Default persona" } });
}

main().finally(() => db.$disconnect());
