import { httpJson, redirectUri, type ConnectedAccount, type TokenSet } from "@/lib/accounts";

// Instagram API with Instagram Login (verified against developers.facebook.com, Oct 2026).
// Long-lived token: 60 days, refreshable once ≥24 h old. Graph version from env.
const GRAPH = () => `https://graph.instagram.com/${process.env.IG_GRAPH_VERSION || "v25.0"}`;
const SCOPES = ["instagram_business_basic", "instagram_business_content_publish"];

export const configured = () => !!(process.env.IG_APP_ID && process.env.IG_APP_SECRET);

export function authUrl(state: string) {
  const q = new URLSearchParams({
    client_id: process.env.IG_APP_ID!, redirect_uri: redirectUri("instagram"), response_type: "code", scope: SCOPES.join(","), state,
  });
  return `https://www.instagram.com/oauth/authorize?${q}`;
}

type Long = { access_token: string; expires_in: number };
const toTokens = (t: Long): TokenSet => ({ accessToken: t.access_token, expiresAt: new Date(Date.now() + t.expires_in * 1000) });
// Some responses are wrapped in { data: [ … ] }.
const unwrap = <T>(r: T | { data: T[] }) => ("data" in (r as object) ? (r as { data: T[] }).data[0] : (r as T));

export async function connect(code: string): Promise<ConnectedAccount> {
  const short = unwrap(
    await httpJson<{ access_token: string; permissions?: string } | { data: { access_token: string; permissions?: string }[] }>(
      "https://api.instagram.com/oauth/access_token",
      {
        method: "POST",
        body: new URLSearchParams({
          client_id: process.env.IG_APP_ID!, client_secret: process.env.IG_APP_SECRET!, grant_type: "authorization_code",
          redirect_uri: redirectUri("instagram"), code: code.replace(/#_$/, ""),
        }),
      },
    ),
  );
  const long = await httpJson<Long>(
    `https://graph.instagram.com/access_token?${new URLSearchParams({ grant_type: "ig_exchange_token", client_secret: process.env.IG_APP_SECRET!, access_token: short.access_token })}`,
  );
  const me = unwrap(
    await httpJson<{ user_id: string; username: string; account_type?: string } | { data: { user_id: string; username: string; account_type?: string }[] }>(
      `${GRAPH()}/me?${new URLSearchParams({ fields: "user_id,username,account_type", access_token: long.access_token })}`,
    ),
  );
  return {
    platform: "instagram", platformUserId: String(me.user_id), handle: me.username, accountType: me.account_type,
    ...toTokens(long), scopes: short.permissions?.split(",") ?? SCOPES,
  };
}

export async function refresh(accessToken: string): Promise<TokenSet> {
  return toTokens(
    await httpJson<Long>(`https://graph.instagram.com/refresh_access_token?${new URLSearchParams({ grant_type: "ig_refresh_token", access_token: accessToken })}`),
  );
}

/** Posts published in the last 24 h vs the allowed total (currently 50 per the reference). */
export async function publishingLimit(igUserId: string, accessToken: string) {
  const r = await httpJson<{ data: { quota_usage: number; config?: { quota_total: number } }[] }>(
    `${GRAPH()}/${igUserId}/content_publishing_limit?${new URLSearchParams({ fields: "quota_usage,config", access_token: accessToken })}`,
  );
  return { usage: r.data[0]?.quota_usage ?? 0, total: r.data[0]?.config?.quota_total ?? null };
}
