// The agent's fictional profile (config/agent-profiles.md) in a modal, opened from its avatar or name. Display only:
// none of this goes into a prompt.
import type { ReactNode } from "react";
import { profileOf } from "@/lib/agents/profiles";
import { Modal } from "./modal";

const List = ({ title, items }: { title: string; items: ReactNode[] }) => (
  <section>
    <h3 className="label">{title}</h3>
    <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">{items.map((x, i) => <li key={i}>{x}</li>)}</ul>
  </section>
);

/** Wraps `trigger` (avatar and/or name) in a button that opens the profile. Roles without a profile render the trigger as is. */
export function ProfileModal({ agentRole, trigger, className = "" }: { agentRole: string; trigger: ReactNode; className?: string }) {
  const p = profileOf(agentRole);
  if (!p) return <span className={className}>{trigger}</span>;
  return (
    <Modal title={`${p.name} · ${p.role}`} label={`Profile of ${p.name}, ${p.role}`} className={`text-left ${className}`} trigger={trigger}>
      <p className="pill w-fit border-amber-200 bg-amber-soft text-xs text-amber-800">Fictional profile</p>
      <section>
        <h3 className="label">Background</h3>
        <p className="mt-1 text-sm">{p.background}</p>
      </section>
      <List title="Character" items={p.personality} />
      <List title="Education" items={p.education.map((e) => `${e.level}, ${e.institution}${e.major ? `: ${e.major}` : ""}${e.period ? ` (${e.period})` : ""}`)} />
      <List title="Work experience" items={p.workExperience.map((w) => <><span className="font-semibold">{w.title}</span>, {w.company} ({w.period}). {w.description}</>)} />
      <List title="Skills" items={p.skills} />
      <List title="Responsibilities" items={p.responsibilities} />
    </Modal>
  );
}
