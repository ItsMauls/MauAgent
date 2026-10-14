// The team's live discussion on a campaign: the Account Manager briefs, the Socmed Specialist drafts, the checks and
// Post QC answer. The real pipeline log as chat bubbles, newest last, like the text-post conversation on Boards.
import { db } from "@/lib/db";
import { RoleAvatar } from "../../../boards/cards";

export const WHO = {
  accountManager: { name: "Account Manager", role: "accountManager", side: "left", tone: "bg-white" },
  socmedSpecialist: { name: "Socmed Specialist", role: "socmedSpecialist", side: "left", tone: "bg-white" },
  qc: { name: "Rule and quality checks", role: "accountTeam", side: "right", tone: "bg-canvas" },
  postQc: { name: "Post QC", role: null, side: "right", tone: "bg-brand-soft" },
} as const;
type Who = keyof typeof WHO;

const time = (d: Date) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

export async function Discussion({ id, live, limit = 60 }: { id: string; live: boolean; limit?: number }) {
  const rows = (await db.automationMessage.findMany({ where: { automationCampaignId: id }, orderBy: { createdAt: "desc" }, take: limit })).reverse();
  if (!rows.length && !live) return null;
  return (
    <div className="card bg-white p-5">
      <h2 className="label flex items-center gap-2">
        Team discussion
        {live && <span className="pill border-blue-200 bg-brand-soft text-brand-dark"><span className="flicker h-2 w-2 rounded-full bg-brand" />Live</span>}
        {rows.length > 0 && <a href={`/campaigns/automation/${id}/discussion`} download className="ml-auto text-sm font-medium normal-case tracking-normal text-brand hover:underline">Download</a>}
      </h2>
      <ol aria-label="Team discussion" className="quiet-scroll max-h-[min(28rem,calc(100vh-14rem))] space-y-3 overflow-y-auto rounded-2xl border border-line bg-canvas p-4">
        {!rows.length && <li className="text-sm text-ink-2">The agents are about to start talking…</li>}
        {rows.map((m) => {
          const w = WHO[(m.who in WHO ? m.who : "qc") as Who];
          return (
            <li key={m.id} className={`flex items-start gap-2.5 ${w.side === "right" ? "flex-row-reverse" : ""}`}>
              {w.role ? <RoleAvatar role={w.role} className="h-8 w-8 shrink-0" /> : (
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand"><span className="material-symbols-outlined !text-[18px]">rule</span></span>
              )}
              <div className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm ${w.tone}`}>
                <p className="text-[11px] font-bold text-ink-2">
                  {w.name}{m.slot !== null && <span className="font-normal text-ink-3"> · post {m.slot + 1}</span>}<span className="font-normal text-ink-3"> · {time(m.createdAt)}</span>
                </p>
                <p className="whitespace-pre-line">{m.text}</p>
              </div>
            </li>
          );
        })}
      </ol>
      <p className="mt-1 text-xs text-ink-3">The real pipeline log, not a made-up story. Showing the latest {limit} lines.</p>
    </div>
  );
}
