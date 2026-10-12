"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { inngest } from "@/lib/inngest";
import { auth0 } from "@/lib/auth0";
import { profileCountry } from "@/lib/providers/apify-tiktok-trends";
import { ensureTrendSettings } from "@/lib/trends";

/** Country hints for the signed-in owner: session claim + CDN headers. Only the 2-letter code is used. */
async function countryCtx() {
  const [session, h] = await Promise.all([auth0.getSession(), headers()]);
  return { profileCountry: profileCountry(session?.user as Record<string, unknown> | undefined), header: (n: string) => h.get(n) };
}

/** First visit stores the owner's country (the scheduled sync reads only the stored row). */
export const loadTrendSettings = async () => ensureTrendSettings(await countryCtx());

export async function syncTrends() {
  await loadTrendSettings();
  await inngest.send({ name: "trends/run.requested", data: { trigger: "manual" } });
  revalidatePath("/trends");
}
