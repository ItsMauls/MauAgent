import { NextResponse } from "next/server";
import { triggerHello } from "@/lib/workflow/trigger";

// Dev-only smoke test for Trigger.dev (still behind the Auth0 middleware).
export async function POST() {
  if (process.env.NODE_ENV === "production") return new NextResponse(null, { status: 404 });
  return NextResponse.json(await triggerHello("MauAgent"));
}
