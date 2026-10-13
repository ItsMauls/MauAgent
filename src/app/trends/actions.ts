"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { inngest } from "@/lib/inngest";
import { auth0 } from "@/lib/auth0";
import { db } from "@/lib/db";
import { COUNTRY_CODES, VIDEO_COUNTRY_CODES, profileCountry } from "@/lib/providers/apify-tiktok-trends";
import { ensureTrendSettings } from "@/lib/trends";

/** Country hints for the signed-in owner: session claim + CDN headers. Only the 2-letter code is used. */
async function countryCtx() {
  const [session, h] = await Promise.all([auth0.getSession(), headers()]);
  return { profileCountry: profileCountry(session?.user as Record<string, unknown> | undefined), header: (n: string) => h.get(n) };
}

/** First visit stores the owner's country (the scheduled sync reads only the stored row). */
export const loadTrendSettings = async () => ensureTrendSettings(await countryCtx());

/** Regional setting: stores the country; Top videos uses it when TikTok has a video feed there, else the previous video country. */
export async function setTrendCountry(code: string) {
  const s = await loadTrendSettings();
  if (!COUNTRY_CODES.includes(code)) throw new Error("Unknown country.");
  await db.trendSourceSettings.update({
    where: { id: s.id },
    data: { countryCode: code, videoCountry: VIDEO_COUNTRY_CODES.includes(code) ? code : s.videoCountry },
  });
  revalidatePath("/trends", "layout");
}

export async function syncTrends() {
  await loadTrendSettings();
  await inngest.send({ name: "trends/run.requested", data: { trigger: "manual" } });
  revalidatePath("/trends", "layout");
}
