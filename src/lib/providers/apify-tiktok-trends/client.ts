import { ApifyClient } from "apify-client";
import { apifyEnv } from "@/lib/ai/env";

let client: ApifyClient | null = null;

/** The one ApifyClient. Token from env only (throws a clear "Set APIFY_API_TOKEN" error when missing). */
export function apify() {
  client ??= new ApifyClient({ token: apifyEnv().APIFY_API_TOKEN });
  return client;
}

export const actorId = () => apifyEnv().APIFY_TIKTOK_TRENDS_ACTOR_ID;
