import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { newState, stateMatches, upsertConnectedAccount } from "@/lib/accounts";
import * as instagram from "@/lib/providers/instagram";
import * as tiktok from "@/lib/providers/tiktok";

// One route per platform: without ?code/?error it starts the OAuth flow, otherwise it is the callback.
// Auth0 middleware already guards it, so only the logged-in owner can connect accounts.
const PROVIDERS = { instagram, tiktok };

export async function GET(req: NextRequest, { params }: { params: Promise<{ platform: string }> }) {
  const parsed = z.enum(["instagram", "tiktok"]).safeParse((await params).platform);
  const back = (q: Record<string, string>) => NextResponse.redirect(new URL(`/accounts?${new URLSearchParams(q)}`, req.url));
  if (!parsed.success) return back({ error: "Unknown platform" });
  const platform = parsed.data;
  const p = PROVIDERS[platform];
  const cookie = `oauth_state_${platform}`;
  const sp = req.nextUrl.searchParams;

  if (!sp.has("code") && !sp.has("error")) {
    if (!p.configured()) return back({ error: `${platform} app keys are not set` });
    const state = newState();
    const res = NextResponse.redirect(p.authUrl(state));
    res.cookies.set(cookie, state, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 600, path: `/api/oauth/${platform}` });
    return res;
  }

  const ok = stateMatches(req.cookies.get(cookie)?.value, sp.get("state"));
  let res: NextResponse;
  if (!ok) res = back({ error: "OAuth state mismatch, try connecting again" });
  else if (sp.get("error")) res = back({ error: sp.get("error_description") || sp.get("error")! });
  else {
    try {
      const account = await p.connect(sp.get("code")!);
      await upsertConnectedAccount(account);
      res = back({ connected: `${platform}:${account.handle}` });
    } catch (e) {
      res = back({ error: e instanceof Error ? e.message : "Connect failed" });
    }
  }
  res.cookies.delete({ name: cookie, path: `/api/oauth/${platform}` });
  return res;
}
