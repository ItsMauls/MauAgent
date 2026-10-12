import { AuthError, httpJson, redirectUri, type ConnectedAccount, type TokenSet } from "@/lib/accounts";

// TikTok Login Kit for Web v2 (verified against developers.tiktok.com, Oct 2026). No PKCE for web apps.
// Access token 24 h, refresh token 365 d; a refresh may return a new refresh token.
const SCOPES = ["user.info.basic", "video.upload"];
const TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/";

export const configured = () => !!(process.env.TIKTOK_CLIENT_KEY && process.env.TIKTOK_CLIENT_SECRET);

export function authUrl(state: string) {
  const q = new URLSearchParams({
    client_key: process.env.TIKTOK_CLIENT_KEY!, response_type: "code", scope: SCOPES.join(","), redirect_uri: redirectUri("tiktok"), state,
  });
  return `https://www.tiktok.com/v2/auth/authorize/?${q}`;
}

type Token = {
  open_id: string; scope: string; access_token: string; expires_in: number; refresh_token: string; refresh_expires_in: number;
  error?: string; error_description?: string;
};

async function token(params: Record<string, string>): Promise<Token> {
  const t = await httpJson<Token>(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_key: process.env.TIKTOK_CLIENT_KEY!, client_secret: process.env.TIKTOK_CLIENT_SECRET!, ...params }),
  });
  // TikTok can answer 200 with an error body (e.g. invalid_grant for a revoked refresh token).
  if (t.error) throw new AuthError(`open.tiktokapis.com: ${t.error} ${t.error_description ?? ""}`.trim());
  return t;
}

const toTokens = (t: Token): TokenSet => ({
  accessToken: t.access_token,
  refreshToken: t.refresh_token,
  expiresAt: new Date(Date.now() + t.expires_in * 1000),
  refreshExpiresAt: new Date(Date.now() + t.refresh_expires_in * 1000),
  scopes: t.scope.split(","),
});

export async function connect(code: string): Promise<ConnectedAccount> {
  const t = await token({ grant_type: "authorization_code", code, redirect_uri: redirectUri("tiktok") });
  // display_name needs only user.info.basic; @username would need user.info.profile (extra app review).
  const info = await httpJson<{ data: { user: { open_id: string; display_name?: string } } }>(
    "https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name",
    { headers: { Authorization: `Bearer ${t.access_token}` } },
  );
  return { platform: "tiktok", platformUserId: t.open_id, handle: info.data.user.display_name || t.open_id, ...toTokens(t) };
}

export async function refresh(refreshToken: string) {
  return toTokens(await token({ grant_type: "refresh_token", refresh_token: refreshToken }));
}
