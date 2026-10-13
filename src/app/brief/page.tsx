import Link from "next/link";
import { db } from "@/lib/db";
import { createCampaign, getSettings } from "../actions";
import { AUDIENCES, Chips, Field, TextBrief } from "./text-brief";
import { ContentContext } from "./sources";
import { getPersona } from "@/lib/agents/persona";
import { AGENT_ROLES, type AgentRole } from "@/lib/agents/schemas";

export const dynamic = "force-dynamic";

const GOALS = [
  "Brand awareness",
  "Launch a new product / menu",
  "Drive voucher conversion (e.g. Buy 1 Get 1)",
  "Increase sales / orders",
  "App installs / sign-ups",
  "Store visits / foot traffic",
  "Grow followers & engagement",
  "Collect leads / reservations",
];

const KPIS = [
  { v: "Awareness: max reach & views", t: "Awareness", d: "Max reach & views", icon: "visibility" },
  { v: "Engagement: shares & saves", t: "Engagement", d: "Shares & saves", icon: "favorite" },
  { v: "Conversion: link / app clicks", t: "Conversion", d: "Link / app clicks", icon: "shopping_bag" },
];

const PLATFORMS = [
  { v: "instagram", t: "Instagram Reels", icon: "play_circle" },
  { v: "tiktok", t: "TikTok (FYP & Ads)", icon: "music_note" },
];

const SOURCES = [
  { v: "seedance_api", t: "Seedance API (automatic)", d: "Renders every shot from the script prompts. Costs API credits.", tag: "Recommended" },
  { v: "manual_upload", t: "Manual upload", d: "You upload raw footage per shot; agents handle cut, pacing, subtitles and grading." },
];

// What each role does in the pipeline (order = AGENT_ROLES order).
const ROLE_INFO: Record<AgentRole, { title: string; job: string; icon: string }> = {
  accountManager: { title: "Account Manager", job: "Turns your brief into a sharp internal brief, KPI and deliverables.", icon: "assignment" },
  creativeDirector: { title: "Creative Director", job: "Pitches 3 concepts, picks the big idea and the 3-second hook.", icon: "lightbulb" },
  artDirector: { title: "Art Director", job: "Shot list, palette, lighting and on-screen type.", icon: "palette" },
  producer: { title: "Producer", job: "Prices every shot and keeps the plan inside your budget cap.", icon: "payments" },
  videographer: { title: "Videographer", job: "Writes generation prompts and renders the 9:16 shots.", icon: "videocam" },
  postProduction: { title: "Post-production", job: "Cuts, paces, subtitles and mixes the final edit.", icon: "movie_edit" },
  accountTeam: { title: "Account Team (QA)", job: "Brand-safety check, captions, hashtags and a self score.", icon: "verified" },
};

const KIT_ICON = { character: "face", location: "location_on", style: "style" };

const TIPS = [
  "Name the product and its one standout benefit",
  "Add the offer in numbers (e.g. B1G1 until 31 Oct)",
  "Describe the audience's habit, not just their age",
  "State the tone you want (casual, premium, playful)",
  "Keep it to max 3 key messages for a 20–30s video",
];

export default async function BriefPage({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  const text = (await searchParams).mode === "text";
  const [s, personas, kit] = await Promise.all([
    getSettings(),
    Promise.all(AGENT_ROLES.map(getPersona)),
    db.creativeAsset.findMany({ orderBy: [{ kind: "asc" }, { name: "asc" }], select: { id: true, kind: true, name: true } }),
  ]);
  return (
    <div className="pt-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/campaigns" className="pill border-transparent bg-white text-ink-2 hover:text-ink">
          <span className="material-symbols-outlined !text-[16px]">arrow_back</span>Back to campaigns
        </Link>
        <span className="pill border-transparent bg-brand-soft uppercase tracking-wide text-brand">Multi-agent production cycle</span>
      </div>
      <h1 className="mt-3 text-4xl font-bold tracking-tight">
        Create a new <span className="relative z-0 text-brand">campaign brief<span className="absolute inset-x-0 -bottom-1 -z-10 h-2 rounded-full bg-amber-soft" /></span>
      </h1>
      <p className="mt-2 max-w-3xl text-ink-2">
        {text
          ? "The Socmed Specialist writes a batch of text posts for X and Threads. You then pick the days and times, send them to Buffer as drafts, and schedule them."
          : "Fill in the brief below. Seven AI agents will turn it into concepts, a shot list and a vertical 9:16 video, then hand it to you for approval."}
      </p>

      <nav aria-label="Brief type" className="mt-5 flex flex-wrap gap-2">
        {[
          { href: "/brief", on: !text, t: "Video campaign", icon: "movie" },
          { href: "/brief?mode=text", on: text, t: "Text posts (X, Threads)", icon: "article" },
        ].map((m) => (
          <Link
            key={m.href}
            href={m.href}
            aria-current={m.on ? "page" : undefined}
            className={`pill px-4 py-2.5 text-sm font-semibold ${m.on ? "border-brand bg-brand text-white" : "border-line bg-white text-ink-2 hover:border-brand/40"}`}
          >
            <span className="material-symbols-outlined !text-[18px]">{m.icon}</span>{m.t}
          </Link>
        ))}
      </nav>

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-12">
        {text ? (
          <>
            <div className="lg:col-span-8"><TextBrief /></div>
            <aside className="lg:sticky lg:top-20 lg:col-span-4"><ContentContext writingVoice={s.writingVoice} /></aside>
          </>
        ) : (
        <form action={createCampaign} className="card space-y-10 p-6 sm:p-8 lg:col-span-8">
          <Section n="01" tone="bg-brand-soft text-brand" title="Campaign basics" sub="Read first by the Account Manager to frame everything else." required>
            <Field label="Product / business" hint="Brand & offer">
              <div className="relative">
                <Icon name="storefront" />
                <input name="product" required placeholder="e.g. Fore Coffee – Butterscotch Sea Salt Latte" className="input pl-11" />
              </div>
            </Field>
            <Chips label="Business goals" hint="Pick one or more" name="goals" options={GOALS} />
            <Field label="Goal details (optional)" hint="Offer, period, area">
              <textarea name="objective" rows={2} placeholder="e.g. Push the B1G1 voucher in the app, Jabodetabek stores, 1–31 Oct" className="input" />
            </Field>
            <Chips label="Target audience" hint="Pick one or more" name="audiences" options={AUDIENCES} />
            <Field label="Audience details (optional)" hint="Habits, interests, where they hang out">
              <textarea name="audience" rows={2} placeholder="e.g. Urban 20–32 y.o. who hunt aesthetic coffee spots on TikTok & Reels" className="input" />
            </Field>
            <fieldset>
              <legend className="label">Primary KPI</legend>
              <div className="grid gap-2 sm:grid-cols-3">
                {KPIS.map((k, i) => (
                  <label key={k.v} className="flex cursor-pointer items-center gap-3 rounded-2xl border border-line bg-canvas p-3 transition hover:bg-brand-soft has-checked:border-brand has-checked:bg-brand has-checked:text-white has-focus-visible:ring-2 has-focus-visible:ring-brand/40">
                    <input type="radio" name="kpi" value={k.v} defaultChecked={i === 1} required className="sr-only" />
                    <span className="material-symbols-outlined">{k.icon}</span>
                    <span className="leading-tight">
                      <span className="block text-sm font-semibold">{k.t}</span>
                      <span className="block text-xs opacity-80">{k.d}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          </Section>

          <Section n="02" tone="bg-agent-soft text-agent" title="Content specs & distribution" sub="Format, visual engine and mood references.">
            <fieldset>
              <legend className="label">Target platforms · aspect ratio 9:16</legend>
              <div className="flex flex-wrap gap-2">
                {PLATFORMS.map((p) => (
                  <label key={p.v} className="group pill cursor-pointer border-line bg-white px-4 py-2.5 text-sm text-ink-2 has-checked:border-brand has-checked:bg-brand has-checked:text-white has-focus-visible:ring-2 has-focus-visible:ring-brand/40">
                    <input type="checkbox" name="platforms" value={p.v} defaultChecked className="sr-only" />
                    <span className="material-symbols-outlined !text-[18px]">{p.icon}</span>
                    {p.t} (9:16)
                    <span className="material-symbols-outlined hidden !text-[16px] group-has-checked:inline">check</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="label">Video visual source</legend>
              <div className="grid gap-2 rounded-2xl bg-canvas p-1.5 md:grid-cols-2">
                {SOURCES.map((o) => (
                  <label key={o.v} className="flex cursor-pointer items-start gap-3 rounded-xl p-3.5 transition hover:bg-white/60 has-checked:bg-white has-checked:shadow-card">
                    <input type="radio" name="defaultSource" value={o.v} defaultChecked={s.defaultVideoSource === o.v} required className="mt-1 accent-brand" />
                    <span>
                      <span className="flex flex-wrap items-center gap-1.5 text-sm font-bold">
                        {o.t}
                        {o.tag && <span className="rounded-full bg-agent-soft px-2 py-0.5 text-[10px] font-bold text-agent">{o.tag}</span>}
                      </span>
                      <span className="mt-1 block text-sm text-ink-2">{o.d}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="mb-1.5 flex w-full items-center justify-between gap-2">
                <span className="label mb-0">Creative kit (optional)</span>
                <Link href="/boards/content-creator?tab=library" className="text-[11px] font-semibold text-brand">Manage in the Content Creator library →</Link>
              </legend>
              {kit.length ? (
                <div className="flex flex-wrap gap-2">
                  {kit.map((a) => (
                    <label key={a.id} className="group pill cursor-pointer border-line bg-white px-3.5 py-2 text-ink-2 hover:border-brand/40 has-checked:border-brand has-checked:bg-brand-soft has-checked:text-brand has-focus-visible:ring-2 has-focus-visible:ring-brand/40">
                      <input type="checkbox" name="creativeAssetIds" value={a.id} className="sr-only" />
                      <span className="material-symbols-outlined !text-[14px]">{KIT_ICON[a.kind]}</span>
                      {a.name}
                    </label>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-ink-2">No characters, locations or video styles yet. Create them in the AI Content Creator.</p>
              )}
            </fieldset>
            <Field label="Visual references / mood URLs (optional)" hint="One link per line">
              <textarea name="references" rows={3} placeholder={"https://tiktok.com/@brand/video/…\nhttps://instagram.com/reel/…"} className="input font-mono" />
            </Field>
          </Section>

          <Section n="03" tone="bg-amber-soft text-amber-800" title="Budget cap & schedule" sub="Protects AI and rendering spend; sets the campaign window.">
            <div className="grid gap-5 sm:grid-cols-3">
              <Field label="Budget cap (USD)" hint="Per campaign">
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 font-bold text-ink-2">$</span>
                  <input name="budgetCapUsd" type="number" step="0.01" min="0.01" defaultValue={String(s.campaignBudgetUsd)} required className="input pl-8 text-lg font-semibold" />
                </div>
              </Field>
              <Field label="Campaign start">
                <input name="startDate" type="date" className="input" />
              </Field>
              <Field label="Campaign end">
                <input name="deadline" type="date" className="input" />
              </Field>
            </div>
            <p className="flex items-center gap-1.5 text-xs text-ink-2">
              <span className="material-symbols-outlined !text-[16px] text-amber-700">shield</span>
              The Producer stops and asks you before any estimate goes over this cap.
            </p>
          </Section>

          <div className="-mx-6 -mb-6 flex flex-col items-center justify-between gap-4 rounded-b-3xl bg-canvas/70 p-6 sm:-mx-8 sm:-mb-8 sm:flex-row sm:p-8">
            <p className="text-sm text-ink-2">Pick at least one goal or write the goal details, and the same for the audience.</p>
            <button className="btn-primary w-full px-8 py-3 shadow-[0_4px_14px_rgba(37,99,235,0.3)] sm:w-auto">
              <span className="material-symbols-outlined">rocket_launch</span>Submit brief & run agents
            </button>
          </div>
        </form>
        )}

        {!text && <aside className="space-y-4 lg:sticky lg:top-20 lg:col-span-4">
          <div className="rounded-3xl bg-amber-soft/70 p-6">
            <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-amber-900">
              <span className="material-symbols-outlined text-amber-700">tips_and_updates</span>Effective prompt tips
            </p>
            <ul className="mt-3 space-y-1.5">
              {TIPS.map((t) => (
                <li key={t} className="flex gap-2 rounded-xl bg-white/80 px-3 py-2 text-xs font-medium">
                  <span className="font-bold text-amber-700">✓</span>{t}
                </li>
              ))}
            </ul>
          </div>

          <div className="card p-6">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="text-lg font-bold">How the agents work</h2>
                <p className="text-sm text-ink-2">The automatic cycle after you submit</p>
              </div>
              <span className="material-symbols-outlined text-brand">hub</span>
            </div>
            <ol className="relative mt-5 space-y-4 before:absolute before:bottom-4 before:left-[15px] before:top-4 before:w-0.5 before:bg-line">
              {AGENT_ROLES.map((role, i) => {
                const r = ROLE_INFO[role];
                const p = personas[i].persona;
                return (
                  <li key={role} className="relative flex gap-3">
                    <span className="z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand ring-4 ring-white">
                      <span className="material-symbols-outlined !text-[18px]">{r.icon}</span>
                    </span>
                    <details className="group min-w-0 flex-1">
                      <summary className="cursor-pointer list-none">
                        <span className="flex flex-wrap items-center gap-1.5 text-sm font-bold">
                          {p.nickname}
                          <span className="rounded-full bg-canvas px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-2">{r.title}</span>
                          <span className="material-symbols-outlined !text-[16px] text-ink-3 transition group-open:rotate-180">expand_more</span>
                        </span>
                        <span className="mt-0.5 block text-xs text-ink-2">{r.job}</span>
                      </summary>
                      <div className="mt-2 space-y-1 rounded-xl bg-canvas p-3 text-xs text-ink-2">
                        <p><b className="text-ink">Character:</b> {p.communicationStyle}</p>
                        <p><b className="text-ink">Strong at:</b> {p.strengths.join("; ")}</p>
                        <p><b className="text-ink">Always asks:</b> “{p.signatureQuestions[0]}”</p>
                      </div>
                    </details>
                  </li>
                );
              })}
              <li className="relative flex gap-3">
                <span className="z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-700 text-white ring-4 ring-white">
                  <span className="material-symbols-outlined !text-[18px]">person</span>
                </span>
                <div>
                  <p className="text-sm font-bold">You: human approval</p>
                  <p className="mt-0.5 text-xs text-ink-2">Review the final cut, approve in one click, or send targeted revisions.</p>
                </div>
              </li>
            </ol>
          </div>
        </aside>}
      </div>
    </div>
  );
}

function Section({ n, tone, title, sub, required, children }: { n: string; tone: string; title: string; sub: string; required?: boolean; children: React.ReactNode }) {
  return (
    <section className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold ${tone}`}>{n}</span>
          <div>
            <h2 className="text-lg font-bold">{title}</h2>
            <p className="text-sm text-ink-2">{sub}</p>
          </div>
        </div>
        {required && <span className="shrink-0 rounded-full bg-brand-soft px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-brand">Required</span>}
      </div>
      {children}
    </section>
  );
}

const Icon = ({ name }: { name: string }) => (
  <span className="material-symbols-outlined pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 !text-[18px] text-ink-3">{name}</span>
);
