// The agent's fictional profile (config/agent-profiles.md) in a modal, opened from its avatar or name. Display only:
// none of this goes into a prompt.
import type { ReactNode } from "react";
import { profileOf, VOICES } from "@/lib/agents/profiles";
import { RoleAvatar } from "./cards";
import { Modal } from "./modal";

/** A collapsible section (native <details>, no client JS). */
const Fold = ({ title, icon, open, children }: { title: string; icon: string; open?: boolean; children: ReactNode }) => (
  <details open={open} className="group rounded-2xl border border-line bg-white open:bg-canvas/40">
    <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-bold marker:hidden [&::-webkit-details-marker]:hidden">
      <span className="material-symbols-outlined !text-[18px] text-brand">{icon}</span>{title}
      <span className="material-symbols-outlined ml-auto !text-[18px] text-ink-3 transition group-open:rotate-180">expand_more</span>
    </summary>
    <div className="px-4 pb-4 text-sm">{children}</div>
  </details>
);

const Chips = ({ items }: { items: string[] }) => (
  <ul className="flex flex-wrap gap-1.5">
    {items.map((x) => <li key={x} className="rounded-full border border-line bg-white px-2.5 py-1 text-xs font-semibold text-ink-2">{x}</li>)}
  </ul>
);

/** The profile sections (also the Info tab of the agent detail). Null when the role has no profile. */
export function ProfileBody({ agentRole }: { agentRole: string }) {
  const p = profileOf(agentRole);
  const v = VOICES[agentRole];
  if (!p) return null;
  return (
    <div className="space-y-2">
      <Fold title="Background" icon="person" open><p>{p.background}</p></Fold>
      <Fold title="Character" icon="psychology" open><Chips items={p.personality} /></Fold>
      {v && (
        <Fold title="How they talk" icon="record_voice_over">
          <p><span className="capitalize">{v.rhythm}</span>. Feedback: {v.feedbackStyle}.</p>
          <p className="mt-2 rounded-xl bg-white p-3 italic">&ldquo;{v.sample}&rdquo;</p>
        </Fold>
      )}
      <Fold title="Responsibilities" icon="task_alt">
        <ul className="space-y-1.5">
          {p.responsibilities.map((r) => (
            <li key={r} className="flex gap-2"><span className="material-symbols-outlined !text-[18px] text-ok">check_circle</span>{r}</li>
          ))}
        </ul>
      </Fold>
      <Fold title="Skills" icon="bolt"><Chips items={p.skills} /></Fold>
      <Fold title="Work experience" icon="work_history">
        <ol className="space-y-3 border-l-2 border-line pl-4">
          {p.workExperience.map((w) => (
            <li key={`${w.company}${w.period}`} className="relative">
              <span className="absolute -left-[1.4rem] top-1.5 size-2.5 rounded-full bg-brand" />
              <p className="font-semibold">{w.title} <span className="font-normal text-ink-2">· {w.company}</span></p>
              <p className="text-xs text-ink-3">{w.period}</p>
              <p className="mt-0.5 text-ink-2">{w.description}</p>
            </li>
          ))}
        </ol>
      </Fold>
      <Fold title="Education" icon="school">
        <ul className="space-y-2">
          {p.education.map((e) => (
            <li key={`${e.institution}${e.level}`}>
              <p className="font-semibold">{e.level} · {e.institution}</p>
              <p className="text-ink-2">{[e.major, e.period].filter(Boolean).join(" · ")}</p>
            </li>
          ))}
        </ul>
      </Fold>
      <Fold title="Style" icon="checkroom"><p>{p.styleAndOutfit}</p></Fold>
    </div>
  );
}

/** Wraps `trigger` (avatar and/or name) in a button that opens the profile. Roles without a profile render the trigger as is. */
export function ProfileModal({ agentRole, trigger, className = "" }: { agentRole: string; trigger: ReactNode; className?: string }) {
  const p = profileOf(agentRole);
  if (!p) return <span className={className}>{trigger}</span>;
  return (
    <Modal title={`${p.name} · ${p.role}`} label={`Profile of ${p.name}, ${p.role}`} className={`text-left ${className}`} trigger={trigger}>
      <div className="flex items-center gap-4">
        <RoleAvatar role={agentRole} className="size-28 shrink-0" />
      </div>
      <ProfileBody agentRole={agentRole} />
    </Modal>
  );
}
