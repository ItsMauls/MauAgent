// Downloads the whole team discussion of a campaign as a Markdown file.
import { db } from "@/lib/db";
import { speakerLabel } from "@/lib/agents/profiles";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rows = await db.automationMessage.findMany({ where: { automationCampaignId: id }, orderBy: { createdAt: "asc" } });
  if (!rows.length) return new Response("No discussion yet", { status: 404 });
  const body = rows
    .map((m) => `**${speakerLabel(m.who)}**${m.slot !== null ? ` · post ${m.slot + 1}` : ""} · ${m.createdAt.toISOString()}\n\n${m.text}`)
    .join("\n\n---\n\n");
  return new Response(`# Team discussion\n\n${body}\n`, {
    headers: { "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": `attachment; filename="team-discussion-${id}.md"` },
  });
}
