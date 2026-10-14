// The team's live discussion on a campaign: the Account Manager briefs, the Socmed Specialist drafts, the checks and
// Post QC answer. The real pipeline log as chat bubbles, newest last, like the text-post conversation on Boards.
// Each agent is named with its role and opens its profile; the rule checks speak as the neutral system.
import { db } from "@/lib/db";
import { profileOf, speakerLabel } from "@/lib/agents/profiles";
import { initials, RoleAvatar } from "../../../boards/cards";
import { ProfileModal } from "../../../boards/profile";
import { characterFeedback } from "../actions";

const WHO = {
  accountManager: { side: "left", tone: "bg-white" },
  socmedSpecialist: { side: "left", tone: "bg-white" },
  qc: { side: "right", tone: "bg-canvas" },
  postQc: { side: "right", tone: "bg-brand-soft" },
} as const;
type Who = keyof typeof WHO;
const COLORS = ["bg-sky-100 text-sky-800", "bg-rose-100 text-rose-800", "bg-emerald-100 text-emerald-800", "bg-violet-100 text-violet-800", "bg-amber-100 text-amber-800"];

const time = (d: Date) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

/** Photo when there is one; the initials in the agent's colour show through when the photo is missing. */
function Avatar({ role }: { role: string }) {
  const p = profileOf(role)!;
  return (
    <span className={`relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${COLORS[p.workflowPosition % COLORS.length]}`}>
      {initials(p.name)}
      <RoleAvatar role={role} className="absolute inset-0 h-8 w-8" />
    </span>
  );
}

const REASONS = [["too_faint", "Character too faint"], ["overdone", "Character overdone"]] as const;

export async function Discussion({ id, live, limit = 60 }: { id: string; live: boolean; limit?: number }) {
  const rows = (await db.automationMessage.findMany({ where: { automationCampaignId: id }, orderBy: { createdAt: "desc" }, take: limit })).reverse();
  if (!rows.length && !live) return null;
  const sent = new Set((await db.agentFeedback.findMany({
    where: { idemKey: { in: rows.flatMap((m) => REASONS.map(([r]) => `voicefb:${m.id}:${r}`)) } }, select: { idemKey: true },
  })).map((f) => f.idemKey));
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
          const who = (m.who in WHO ? m.who : "qc") as Who;
          const w = WHO[who];
          const agent = who !== "qc" && profileOf(who) ? who : null;
          return (
            <li key={m.id} className={`group flex items-start gap-2.5 ${w.side === "right" ? "flex-row-reverse" : ""}`}>
              {agent ? <ProfileModal agentRole={agent} className="shrink-0 rounded-full" trigger={<Avatar role={agent} />} /> : (
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand"><span className="material-symbols-outlined !text-[18px]">rule</span></span>
              )}
              <div className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm ${w.tone}`}>
                <div className="flex flex-wrap items-center gap-x-1 text-[11px] font-bold text-ink-2">
                  {agent ? <ProfileModal agentRole={agent} className="hover:underline" trigger={speakerLabel(agent)} /> : speakerLabel("qc")}
                  {m.slot !== null && <span className="font-normal text-ink-3"> · post {m.slot + 1}</span>}<span className="font-normal text-ink-3"> · {time(m.createdAt)}</span>
                  {agent && (
                    <details className="relative ml-auto font-normal">
                      <summary aria-label={`Feedback on how ${speakerLabel(agent)} sounds`} className="material-symbols-outlined cursor-pointer list-none !text-[16px] text-ink-3 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 group-has-[details[open]]:opacity-100 hover:text-red-700">thumb_down</summary>
                      <div className="absolute right-0 z-10 mt-1 flex gap-1.5 rounded-2xl border border-line bg-white p-2 shadow-float">
                        {REASONS.map(([r, label]) => sent.has(`voicefb:${m.id}:${r}`)
                          ? <span key={r} className="pill whitespace-nowrap border-brand bg-brand-soft text-brand">{label} ✓</span>
                          : <form key={r} action={characterFeedback.bind(null, m.id, r)}><button className="pill whitespace-nowrap border-line bg-white text-ink-2 hover:border-brand hover:text-brand">{label}</button></form>)}
                      </div>
                    </details>
                  )}
                </div>
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
