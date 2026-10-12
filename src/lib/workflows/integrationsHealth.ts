import { HeadBucketCommand } from "@aws-sdk/client-s3";
import { inngest } from "@/lib/inngest";
import { db } from "@/lib/db";
import { s3 } from "@/lib/s3";

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 200);

/** Free checks only. Results are cached in IntegrationStatus; Boards never calls a provider while rendering. */
const CHECKS: Record<string, () => Promise<string>> = {
  s3: async () => {
    await s3.send(new HeadBucketCommand({ Bucket: process.env.S3_BUCKET ?? "mauagent" }));
    return "Bucket reachable";
  },
  gemini: async () => {
    const key = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    if (!key) throw new Error("No API key");
    // Listing models is free. Key goes in a header so it can never end up in an error string.
    const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", { headers: { "x-goog-api-key": key } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return "API key valid";
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
