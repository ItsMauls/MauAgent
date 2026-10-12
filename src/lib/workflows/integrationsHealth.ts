import { HeadBucketCommand } from "@aws-sdk/client-s3";
import { inngest } from "@/lib/inngest";
import { db } from "@/lib/db";
import { s3 } from "@/lib/s3";
import { aiEnv, apifyEnv } from "@/lib/ai/env";
import { bufferChannels } from "@/lib/providers/buffer";
import { syncBufferAccounts } from "@/lib/bufferAccounts";

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 200);

/** Free checks only. Results are cached in IntegrationStatus; Boards never calls a provider while rendering. */
const CHECKS: Record<string, () => Promise<string>> = {
  s3: async () => {
    await s3.send(new HeadBucketCommand({ Bucket: process.env.S3_BUCKET ?? "mauagent" }));
    return "Bucket reachable";
  },
  // Both checks are free and send the secret in a header only, so it can never end up in an error string.
  openrouter: async () => {
    const env = aiEnv();
    const res = await fetch(`${env.AI_BASE_URL}/key`, { headers: { Authorization: `Bearer ${env.AI_API_KEY}` } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return `API key valid · model ${env.AI_MODEL}`;
  },
  apify: async () => {
    const res = await fetch("https://api.apify.com/v2/users/me", { headers: { Authorization: `Bearer ${apifyEnv().APIFY_API_TOKEN}` } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return "API token valid";
  },
  buffer: async () => {
    const wanted = ["instagram", "tiktok", "threads"];
    await syncBufferAccounts(); // keeps channel state fresh daily
    const have = new Set((await bufferChannels()).map((c) => c.service));
    const missing = wanted.filter((s) => !have.has(s));
    if (missing.length) throw new Error(`Connect in Buffer: ${missing.join(", ")}`);
    return "API key valid · Instagram, TikTok, Threads channels";
  },
};

export const integrationsHealth = inngest.createFunction(
  { id: "integrations-health", retries: 1 },
  [{ cron: "TZ=Asia/Jakarta 10 3 * * *" }, { event: "integrations/check" }],
  async ({ step }) => {
    for (const [id, check] of Object.entries(CHECKS))
      await step.run(`check-${id}`, async () => {
        const r = await check().then((summary) => ({ ok: true, summary }), (e) => ({ ok: false, summary: msg(e) }));
        await db.integrationStatus.upsert({ where: { id }, create: { id, ...r }, update: { ...r, checkedAt: new Date() } });
        return r;
      });
  },
);
