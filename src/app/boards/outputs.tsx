import type { ReactNode } from "react";
import { z } from "zod";
import { presignGet } from "@/lib/s3";
import { ApprovalPackage, CreativeBrief, InternalBrief, ProductionPlan, SocialPosts, VisualDirection } from "@/lib/agents/schemas";
import { CopyBlock } from "../ui";
import { PayloadView } from "./payload";
import { PostPreview } from "./post-preview";

// One readable view per agent output; the shape of the payload decides which. Unknown shapes fall back to PayloadView.

export type Who = { handle: string; avatarUrl: string | null } | null;

const Storyboard = z.object({
  character: z.string(), palette: z.array(z.string()), totalSec: z.number(), pdfKey: z.string().optional(),
  panels: z.array(z.object({ panel: z.number(), shotId: z.string(), startSec: z.number(), durationSec: z.number(), framing: z.string(), action: z.string(), setting: z.string(), lighting: z.string(), onScreenText: z.string(), voLine: z.string() })),
});
const Packages = z.object({ packages: z.array(z.object({ shotId: z.string(), durationSec: z.number(), prompt: z.string(), vo: z.string(), referenceNotes: z.string(), fileName: z.string(), tips: z.string() })) });
const RenderBundle = z.object({ finalCut: z.string(), clips: z.array(z.object({ file: z.string().optional(), assetVersion: z.number() })) });

const tc = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const box = "rounded-2xl bg-canvas p-4";

function Field({ k, children }: { k: string; children: ReactNode }) {
  return <div><p className="label !mb-0.5">{k}</p><div className="text-sm">{children}</div></div>;
}
const Chips = ({ items }: { items: string[] }) =>
  items.length ? <div className="flex flex-wrap gap-1.5">{items.map((x, i) => <span key={i} className="rounded-full bg-white px-2.5 py-1 text-xs">{x}</span>)}</div> : <span className="text-ink-3">-</span>;
const Raw = ({ payload }: { payload: unknown }) => (
  <details><summary className="cursor-pointer text-xs font-semibold text-ink-2">Raw JSON</summary><pre className="mt-2 max-h-80 overflow-auto rounded-xl bg-canvas p-3 text-xs">{JSON.stringify(payload, null, 2)}</pre></details>
);

/** Concept the Creative Director picked: chosenConcept is "title, with the reasoning". */
export const chosenConcept = (cb: CreativeBrief) => cb.conceptOptions.find((o) => cb.chosenConcept.includes(o.title)) ?? cb.conceptOptions[0];

function BriefView({ b }: { b: InternalBrief }) {
  return (
    <div className={`${box} space-y-3`}>
      <Field k="Problem">{b.problemStatement}</Field>
      <Field k="Insight">{b.insight}</Field>
      <Field k="Tone">{b.tone || "-"}</Field>
      <Field k="Mandatories"><Chips items={b.mandatories} /></Field>
      <Field k="Deliverables">
        {b.deliverables.length ? (
          <ul className="space-y-1">{b.deliverables.map((d, i) => <li key={i}><b>{d.platform}</b> · {d.format} · {d.durationSec}s</li>)}</ul>
        ) : "-"}
      </Field>
      <Field k="Trend references"><Chips items={b.trendRefs} /></Field>
    </div>
  );
}

function ConceptView({ cb }: { cb: CreativeBrief }) {
  const chosen = chosenConcept(cb);
  return (
    <div className="space-y-3">
      <div className={`${box} space-y-2`}>
        <Field k="Big idea">{cb.bigIdea}</Field>
        <div className="grid gap-3 sm:grid-cols-2"><Field k="Key message">{cb.keyMessage}</Field><Field k="CTA">{cb.cta}</Field></div>
      </div>
      <ul className="grid gap-3 md:grid-cols-3">
        {cb.conceptOptions.map((o) => (
          <li key={o.title} className={`space-y-2 rounded-2xl border p-4 text-sm ${o === chosen ? "border-brand bg-brand-soft ring-2 ring-brand/20" : "border-line bg-white"}`}>
            <p className="flex items-start justify-between gap-2 font-bold">{o.title}{o === chosen && <span className="pill shrink-0 border-blue-200 bg-white !py-0 text-brand">Picked</span>}</p>
            <p>{o.logline}</p>
            <p className="text-ink-2"><span className="font-semibold">Hook:</span> {o.hook}</p>
            <p className="text-ink-2"><span className="font-semibold">Why:</span> {o.whyItWorks}</p>
          </li>
        ))}
      </ul>
      <p className="text-sm text-ink-2"><span className="font-semibold">Reasoning:</span> {cb.chosenConcept}</p>
    </div>
  );
}

function VisualView({ v }: { v: VisualDirection }) {
  let t = 0;
  return (
    <div className="space-y-3">
      <div className={`${box} space-y-3`}>
        <Field k="Palette">
          <div className="flex flex-wrap gap-2">
            {v.palette.map((c) => <span key={c} className="flex items-center gap-1.5 text-xs"><span aria-hidden className="size-6 rounded-full border border-line" style={{ background: c }} />{c}</span>)}
          </div>
        </Field>
        <Field k="Character">{v.characterDescription}</Field>
        <Field k="Typography">{v.typography || "-"}</Field>
      </div>
      <ol className="space-y-2">
        {v.shotList.map((s) => {
          const start = t;
          t += s.durationSec;
          return (
            <li key={s.shotId} className="grid gap-x-4 gap-y-1 rounded-2xl border border-line bg-white p-3 text-sm sm:grid-cols-[6rem_1fr]">
              <p className="font-bold">{s.shotId}<span className="block text-xs font-normal text-ink-2">{tc(start)} · {s.durationSec}s</span></p>
              <div className="space-y-1">
                <p>{s.subject}</p>
                <p className="text-xs text-ink-2">{s.cameraMove} · {s.setting} · {s.lighting}</p>
                {s.onScreenText && <p className="text-xs"><span className="font-semibold">Text:</span> {s.onScreenText}</p>}
                {s.voLine && <p className="text-xs italic">“{s.voLine}”</p>}
              </div>
            </li>
          );
        })}
      </ol>
      {v.moodboardPrompts.length > 0 && <Field k="Moodboard prompts"><ul className="list-disc space-y-1 pl-5 text-ink-2">{v.moodboardPrompts.map((m, i) => <li key={i}>{m}</li>)}</ul></Field>}
    </div>
  );
}

async function StoryboardView({ sb }: { sb: z.infer<typeof Storyboard> }) {
  const pdfUrl = sb.pdfKey ? await presignGet(sb.pdfKey, 3600) : null;
  return (
    <div className="space-y-3">
      {pdfUrl && <a href={pdfUrl} target="_blank" rel="noreferrer" className="btn-soft">Download storyboard PDF</a>}
      <p className="text-sm text-ink-2">{sb.panels.length} panels · {sb.totalSec}s · {sb.character}</p>
      <ol className="grid gap-3 sm:grid-cols-2">
        {sb.panels.map((p) => (
          <li key={p.panel} className="space-y-1 rounded-2xl border border-line bg-white p-3 text-sm">
            <p className="flex justify-between font-bold">Panel {p.panel}<span className="text-xs font-normal text-ink-2">{tc(p.startSec)}–{tc(p.startSec + p.durationSec)}</span></p>
            <p>{p.action}</p>
            <p className="text-xs text-ink-2">{p.framing} · {p.setting} · {p.lighting}</p>
            {p.onScreenText && <p className="text-xs"><span className="font-semibold">Text:</span> {p.onScreenText}</p>}
            {p.voLine && <p className="text-xs italic">“{p.voLine}”</p>}
          </li>
        ))}
      </ol>
    </div>
  );
}

function PlanView({ p }: { p: ProductionPlan }) {
  return (
    <div className="space-y-3">
      <table className="w-full text-left text-sm">
        <thead className="text-xs text-ink-2"><tr><th className="py-1">Shot</th><th>Source</th><th>Resolution</th><th>Attempts</th><th className="text-right">Est. US$</th></tr></thead>
        <tbody className="divide-y divide-line">
          {p.shots.map((s) => (
            <tr key={s.shotId}><td className="py-1.5 font-semibold">{s.shotId}</td><td>{s.source.replace("_", " ")}</td><td>{s.resolution}</td><td>{s.maxAttempts}</td><td className="text-right">{s.estCostUsd.toFixed(2)}</td></tr>
          ))}
        </tbody>
        <tfoot><tr className="border-t border-line font-bold"><td className="py-1.5" colSpan={4}>Total</td><td className="text-right">{p.estCostUsd.toFixed(2)}</td></tr></tfoot>
      </table>
      <div className="grid gap-3 sm:grid-cols-2"><Field k="Timeline">{p.timeline}</Field><Field k="Approvals needed"><Chips items={p.approvalsNeeded} /></Field></div>
    </div>
  );
}

function PackagesView({ packages }: { packages: z.infer<typeof Packages>["packages"] }) {
  return (
    <ol className="space-y-3">
      {packages.map((p, i) => (
        <li key={p.shotId} className={box}>
          <p className="mb-2 flex items-center gap-2 font-semibold">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand text-xs font-bold text-white">{i + 1}</span>{p.shotId}
            <span className="ml-auto text-xs font-normal text-ink-2">{p.durationSec}s</span>
          </p>
          <CopyBlock label="Prompt" text={p.prompt} />
          <CopyBlock label="Dialogue / VO" text={p.vo} />
          <p className="text-xs text-ink-2">{p.referenceNotes} · {p.fileName}</p>
        </li>
      ))}
    </ol>
  );
}

/** QC package: score, captions, hashtags, checklist. Shared with /approval; `children` add pills next to the score. */
export function ApprovalSummary({ pkg, children }: { pkg: ApprovalPackage; children?: ReactNode }) {
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <span className="pill border-blue-200 bg-brand-soft text-brand-dark">Self score {pkg.selfScore}/10</span>
        {children}
      </div>
      {pkg.captionPerPlatform.map((p) => (
        <div key={p.platform}>
          <p className="label">{p.platform} caption</p>
          <p className="whitespace-pre-wrap">{p.caption}</p>
        </div>
      ))}
      <p className="text-brand">{pkg.hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ")}</p>
      <div>
        <p className="label">Brand-safety checklist</p>
        <ul className="space-y-1">
          {pkg.brandSafetyChecklist.map((b) => (
            <li key={b.item} className="flex gap-2">
              <span className={`material-symbols-outlined !text-[18px] ${b.ok ? "text-ok" : "text-bad"}`} aria-label={b.ok ? "OK" : "Issue"}>
                {b.ok ? "check_circle" : "error"}
              </span>
              <span><b>{b.item}</b>{b.note ? ` — ${b.note}` : ""}</span>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

async function CutView({ r }: { r: z.infer<typeof RenderBundle> }) {
  const url = await presignGet(r.finalCut, 3600);
  return (
    <div className="flex flex-wrap items-start gap-4">
      <video src={url} controls preload="metadata" aria-label="Final cut" className="aspect-[9/16] w-56 rounded-3xl bg-black" />
      <p className="text-sm text-ink-2">{r.clips.length} clips · {r.clips.map((c) => `${c.file ?? "clip"} v${c.assetVersion}`).join(", ")}</p>
    </div>
  );
}

/** An agent output in the view that fits its shape, raw JSON one click away. */
export function OutputView({ payload, who = null }: { payload: unknown; who?: Who }) {
  const posts = SocialPosts.safeParse(payload).data;
  if (posts) return <PostPreview posts={posts.posts} who={who} />;
  const view = (() => {
    const cb = CreativeBrief.safeParse(payload).data;
    if (cb) return <ConceptView cb={cb} />;
    const vd = VisualDirection.safeParse(payload).data;
    if (vd) return <VisualView v={vd} />;
    const ib = InternalBrief.safeParse(payload).data;
    if (ib) return <BriefView b={ib} />;
    const sb = Storyboard.safeParse(payload).data;
    if (sb) return <StoryboardView sb={sb} />;
    const plan = ProductionPlan.safeParse(payload).data;
    if (plan) return <PlanView p={plan} />;
    const pk = Packages.safeParse(payload).data;
    if (pk) return <PackagesView packages={pk.packages} />;
    const qc = ApprovalPackage.safeParse(payload).data;
    if (qc) return <div className="space-y-4 text-sm"><ApprovalSummary pkg={qc} /></div>;
    const cut = RenderBundle.safeParse(payload).data;
    if (cut) return <CutView r={cut} />;
    return null;
  })();
  if (!view) return <PayloadView payload={payload} />;
  return <div className="space-y-3">{view}<Raw payload={payload} /></div>;
}
