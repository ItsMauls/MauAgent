import { contentSetup } from "@/lib/content/config";
import { HASHTAG_MAX, Note } from "@/lib/agents/schemas";
import { Modal } from "./modal";
import { RoleAvatar } from "./cards";

const NAME = { socmedSpecialist: "Socmed Specialist", qc: "QC" } as const;
const ROLE = { socmedSpecialist: "socmedSpecialist", qc: "accountTeam" } as const;

/** The Specialist / QC conversation of a batch as chat bubbles: drafts, rule checks, judge scores and what was kept. */
export function Conversation({ notes }: { notes: unknown }) {
  const list = Note.array().safeParse(notes).data ?? [];
  if (!list.length) return null;
  return (
    <ol aria-label="Socmed Specialist and QC conversation" className="quiet-scroll max-h-96 space-y-3 overflow-y-auto rounded-2xl bg-canvas p-4">
      {list.map((n, k) => (
        <li key={k} className={`flex items-start gap-2.5 ${n.who === "qc" ? "flex-row-reverse" : ""}`}>
          <RoleAvatar role={ROLE[n.who]} className="h-8 w-8 shrink-0" />
          <div className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm ${n.who === "qc" ? "bg-brand-soft" : "bg-white"}`}>
            <p className="text-[11px] font-bold text-ink-2">{NAME[n.who]}{n.post !== undefined && <span className="font-normal text-ink-3"> · post {n.post + 1}</span>}</p>
            <p className="whitespace-pre-line">{n.text}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

const Rules = ({ title, items }: { title: string; items: string[] }) => (
  <section className="space-y-1.5">
    <h3 className="text-sm font-bold">{title}</h3>
    <ul className="list-disc space-y-1 pl-5 text-sm text-ink-2">{items.map((t) => <li key={t}>{t}</li>)}</ul>
  </section>
);

/** Info button: what happens while posts are written, and what is not allowed. Read from the same config the checks use. */
export function GenerationInfo({ className = "btn-soft" }: { className?: string }) {
  const { config: c, banned: b } = contentSetup();
  const list = (xs: string[]) => (xs.length ? xs.join(", ") : "none");
  return (
    <Modal title="How posts are written and checked" label="How posts are written and checked" className={className} trigger={<><span className="material-symbols-outlined !text-[18px]">info</span>Info</>}>
      <Rules title="What happens while a batch is written" items={[
        `The Socmed Specialist picks a content type and an angle for each post, researches facts when the type needs them, and writes ${c.variants} variants in your voice.`,
        "QC runs the rule checks on every variant, then a separate quality judge scores what is left (made-up words, claims outside the research, persona, sounds human).",
        `If every variant fails, the reasons go back to the Specialist for a rewrite, up to ${c.maxAttempts} attempts per post. A post that never passes is skipped with the reason.`,
        "The best variant is kept; the others stay as alternatives. Rejected variants can never be scheduled, and nothing is scheduled until you approve it.",
        "The conversation you see is the real pipeline log (drafts, rule results, judge scores, the pick), not a made-up story.",
      ]} />
      <Rules title="Rejected automatically" items={[
        "Over the platform limit (X 280, Threads 500 characters) in any part.",
        "An em dash, more than 1 emoji per part, or mixing gue/lo with aku/kamu.",
        `More hashtags than allowed (X ${HASHTAG_MAX.twitter}, Threads ${HASHTAG_MAX.threads}), or any when the brief says none.`,
        "Wrong format for the type: thread markers and numbering, sentence limits, poll options (2-4), a statistic without its number, source and year.",
        `Too similar to a recent post (${Math.round(c.similarity.threshold * 100)}% word overlap in the last ${c.similarity.lookbackDays} days).`,
        "In one batch: the same opening or closing emoji as another post, more than 2 question hooks, too many wkwk/haha.",
        "Anything under 'Avoid / forbidden topics' in your brief, and made-up words or sentences that do not connect (judge).",
        `Banned words and clichés: ${list(b.reject)}.`,
        `Template openers: ${list(b.openers)}.`,
      ]} />
      <Rules title="Sent to you for review" items={[
        `Judge score below ${c.judge.minScore}/10, a claim not found in the research, or a weak persona fit.`,
        "A number or fact without a source, a low-confidence claim, or text trimmed by more than 20% to fit.",
        "A possible real person or brand outside the research, or a different language from the topic.",
        `Flagged phrases: ${list(b.review)}.`,
      ]} />
      <Rules title="Topics refused before writing" items={[`A topic containing: ${list(b.sensitiveTopics)}.`]} />
    </Modal>
  );
}
