// PLACEHOLDER prices — fill in from the official BytePlus ModelArk & Google AI pricing pages before use.
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const effectiveFrom = new Date("2026-01-01");

const rows = [
  // Seedance: USD per second of video. model = SEEDANCE_MODEL_DRAFT / _FINAL di .env.
  { provider: "byteplus", model: process.env.SEEDANCE_MODEL_DRAFT || "seedance-draft", unit: "second", unitPrice: 0 },
  { provider: "byteplus", model: process.env.SEEDANCE_MODEL_FINAL || "seedance-final", unit: "second", unitPrice: 0 },
  { provider: "google", model: "gemini-2.5-flash", unit: "1M_input_tokens", unitPrice: 0 },
  { provider: "google", model: "gemini-2.5-flash", unit: "1M_output_tokens", unitPrice: 0 },
];

async function main() {
  for (const r of rows)
    await db.priceBook.upsert({
      where: { provider_model_effectiveFrom: { provider: r.provider, model: r.model, effectiveFrom } },
      create: { ...r, effectiveFrom },
      update: {},
    });
  await db.setting.upsert({ where: { id: "default" }, create: {}, update: {} });
}

main().finally(() => db.$disconnect());
