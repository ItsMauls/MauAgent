"use client";
// New automation campaign: one page. The feasibility check and the cost estimate update live from the same pure
// planner functions the server runs again on submit (the server is the one that blocks). Most answers are chosen from
// options; they all reach the Account Manager's brief, the planner, the writers and QC.
import { useRouter } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { AUDIENCE_TRAITS, DEFAULT_FORCE_REVIEW, OBJECTIVES, PAY_AS_YOU_GO, PERSONA_MAX, PLATFORM_LABEL, TONES, type Tone } from "@/lib/automation/config";
import type { Patch } from "@/lib/automation/assistant";
import { capacity, planDays, targetFrom } from "@/lib/automation/plan";
import { ErrorText, useAction } from "../../../ui";
import { assistFill, createAutomation } from "../actions";
import { CampaignFlow, type FlowState, type FlowStep } from "../[id]/flow";
import { NumInput } from "../num-input";

type Account = { id: string; platform: string; handle: string };
type TypeOption = { id: string; label: string; blurb: string; icon: string };

const CTA = { none: "None", ask_reply: "Ask to reply", ask_repost: "Ask to repost", ask_follow: "Ask to follow", visit_link: "Visit link", promo: "Promo" };
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const TONE_LABEL: Record<Tone, string> = { casual: "Casual", witty: "Witty", professional: "Professional", inspiring: "Inspiring", educational: "Educational", bold: "Bold and opinionated", warm: "Warm and friendly", straightforward: "Straightforward", storytelling: "Storytelling" };
const LENGTHS = [["auto", "Auto", "The type decides"], ["short", "Short", "1-2 sentences"], ["medium", "Medium", "2-4 sentences"], ["long", "Long", "4-7 sentences or a thread"]] as const;
const HASHTAGS = [["", "Auto", "The writer decides within the platform limit"], ["none", "None", "No hashtags"], ["minimal", "Minimal", "One or two, only when natural"], ["trending", "Trending", "Use current topics"], ["custom", "Custom", "Your own tags"]] as const;
const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (d: string, n: number) => new Date(Date.parse(d) + n * 86_400_000).toISOString().slice(0, 10);
const usd = (n: number) => `US$${n.toFixed(n < 1 ? 4 : 2)}`;
const num = (v: string) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

/** A group of options: multi-select chips, or a single choice when `single` is set. */
function Chips<T extends string>({ options, value, onChange, single, max }: { options: readonly (readonly [T, string])[]; value: T[]; onChange: (v: T[]) => void; single?: boolean; max?: number }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(([v, label]) => {
        const on = value.includes(v);
        const blocked = !on && !single && max !== undefined && value.length >= max;
        return (
          <label key={v} className={`pill cursor-pointer ${on ? "border-brand bg-brand-soft text-brand" : "border-line"} ${blocked ? "opacity-40" : ""}`}>
            <input type={single ? "radio" : "checkbox"} className="sr-only" checked={on} disabled={blocked} onChange={() => onChange(single ? [v] : toggle(value, v))} />
            {label}
          </label>
        );
      })}
    </div>
  );
}

/** Large choice cards, one per option: icon, title and a one-line description. */
function Cards<T extends string>({ options, value, onChange, multi }: { options: { id: T; title: string; text: string; icon?: string }[]; value: T[]; onChange: (v: T[]) => void; multi?: boolean }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {options.map((o) => {
        const on = value.includes(o.id);
        return (
          <label key={o.id} className={`flex cursor-pointer gap-3 rounded-2xl border p-3 transition ${on ? "border-brand bg-brand-soft" : "border-line bg-white hover:bg-canvas"}`}>
            <input type={multi ? "checkbox" : "radio"} className="sr-only" checked={on} onChange={() => onChange(multi ? toggle(value, o.id) : [o.id])} />
            {o.icon && <span className={`material-symbols-outlined ${on ? "text-brand" : "text-ink-3"}`}>{o.icon}</span>}
            <span className="min-w-0"><b className="block text-sm">{o.title}</b><span className="text-xs text-ink-2">{o.text}</span></span>
          </label>
        );
      })}
    </div>
  );
}

const Section = ({ n, title, hint, children }: { n: number; title: string; hint?: string; children: ReactNode }) => (
  <section className="card space-y-4 p-6">
    <div>
      <h2 className="flex items-center gap-2 text-lg font-bold"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-soft text-xs text-brand">{n}</span>{title}</h2>
      {hint && <p className="mt-1 text-sm text-ink-2">{hint}</p>}
    </div>
    {children}
  </section>
);

export function AutomationForm(p: { accounts: Account[]; maxPosts: number; perPostUsd: number | null; types: TypeOption[]; defaultCapUsd: number }) {
  const router = useRouter();
  const { pending, error, run } = useAction();
  // AI Agent Assistant: the plain-words description, the persona file, and how the last extraction went.
  const [brief, setBrief] = useState("");
  const [persona, setPersona] = useState("");
  const [personaFile, setPersonaFile] = useState("");
  const [personaNote, setPersonaNote] = useState("");
  const [assist, setAssist] = useState<{ state: "idle" | "working" | "done" | "error"; note?: string; notes?: string[] }>({ state: "idle" });
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"personal" | "brand">("personal");
  const [brandName, setBrandName] = useState("");
  const [brandOffer, setBrandOffer] = useState("");
  const [brandVoice, setBrandVoice] = useState("");
  const [accountIds, setAccountIds] = useState<string[]>(p.accounts.map((a) => a.id));
  const [startDate, setStart] = useState(plusDays(today(), 1));
  const [endDate, setEnd] = useState(plusDays(today(), 30));
  const [mode, setMode] = useState<"total" | "rate">("total");
  const [total, setTotal] = useState(60);
  const [perDay, setPerDay] = useState(2);
  const [pillars, setPillars] = useState("");
  const [objectives, setObjectives] = useState<string[]>([]);
  const [objective, setObjective] = useState("");
  const [traits, setTraits] = useState<string[]>([]);
  const [audience, setAudience] = useState("");
  const [language, setLanguage] = useState<"auto" | "id" | "en">("auto");
  const [tones, setTones] = useState<Tone[]>([]);
  const [types, setTypes] = useState<string[]>([]);
  const [length, setLength] = useState<"auto" | "short" | "medium" | "long">("auto");
  const [hashtags, setHashtags] = useState("");
  const [customTags, setCustomTags] = useState("");
  const [avoid, setAvoid] = useState("");
  const [cta, setCta] = useState<keyof typeof CTA>("none");
  const [linkUrl, setLinkUrl] = useState("");
  const [kpiMetric, setKpiMetric] = useState<"" | "reach" | "clicks" | "followers">("");
  const [kpiValue, setKpiValue] = useState(0);
  const [maxPostsPerDay, setMaxPerDay] = useState(4);
  const [hours, setHours] = useState<[number, number]>([8, 22]);
  const [minGapMinutes, setGap] = useState(90);
  const [quiet, setQuiet] = useState<number[]>([]);
  const [payg, setPayg] = useState(false);
  const [budgetCapUsd, setBudget] = useState(p.defaultCapUsd || 20);
  const [warnAtPct, setWarn] = useState(80);
  const [reviewMode, setReviewMode] = useState<"qc_auto" | "manual_all">("qc_auto");
  const [forceReviewTypes, setForce] = useState<string[]>(DEFAULT_FORCE_REVIEW.filter((t) => p.types.some((x) => x.id === t)));
  const [minConfidence, setMinConf] = useState(0.8);
  const [variantsPerPost, setVariants] = useState(3);
  const [horizonDays, setHorizon] = useState(10);

  const planConfig = { maxPostsPerDay, activeHours: hours, quietWeekdays: quiet, weekdayWeights: [1, 1, 1, 1, 1, 1, 1], minGapMinutes, jitterMinutes: 20 };
  const live = useMemo(() => {
    const valid = /^\d{4}-\d{2}-\d{2}$/.test(startDate) && /^\d{4}-\d{2}-\d{2}$/.test(endDate) && endDate >= startDate && hours[1] > hours[0];
    if (!valid) return null;
    const days = planDays({ startDate, endDate }, planConfig).length;
    const targetPosts = targetFrom({ mode, total, perDay, days });
    return { targetPosts, ...capacity({ startDate, endDate, targetPosts }, planConfig) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startDate, endDate, mode, total, perDay, maxPostsPerDay, hours, minGapMinutes, quiet]);
  const est = live && p.perPostUsd != null ? live.targetPosts * p.perPostUsd : null;
  const overCap = est != null && !payg && est > budgetCapUsd;
  // The goal as the agents read it: the chips and the free text are joined into the two fields the team already uses.
  const objectiveText = [objectives.length ? `Goals: ${objectives.join("; ")}.` : "", objective.trim()].filter(Boolean).join(" ");
  const audienceText = [audience.trim(), ...traits].filter(Boolean).join(", ");
  const problem = !live
    ? "Check the dates and the active hours"
    : live.targetPosts < 1 || live.targetPosts > p.maxPosts
      ? `The target must be between 1 and ${p.maxPosts} posts`
      : live.shortfall
        ? `${live.shortfall} posts short: the plan holds ${live.total} (${live.days} days × ${live.perDay} per day). Lengthen the range, raise posts per day or lower the target.`
        : kind === "brand" && !brandName.trim() ? "Name the brand"
          : !payg && !(budgetCapUsd > 0) ? "Set a campaign cap above 0, or choose pay as you go"
          : !accountIds.length ? "Pick at least one account" : !pillars.trim() ? "Add at least one pillar" : !audienceText ? "Describe the audience or pick who it is for" : null;

  const submit = () =>
    run(async () => {
      const { id } = await createAutomation({
        name,
        goal: {
          kind, accountIds, startDate, endDate, audience: audienceText, objective: objectiveText, language, cta, tones, types, length, avoid,
          ...(persona.trim() && { persona: persona.trim().slice(0, PERSONA_MAX) }),
          pillars: pillars.split("\n").map((s) => s.trim()).filter(Boolean),
          ...(kind === "brand" && { brandName: brandName.trim(), ...(brandOffer.trim() && { brandOffer: brandOffer.trim() }), ...(brandVoice.trim() && { brandVoice: brandVoice.trim() }) }),
          ...(hashtags && { hashtags, ...(hashtags === "custom" && customTags.trim() && { customTags: customTags.trim() }) }),
          ...(linkUrl.trim() && { linkUrl: linkUrl.trim() }),
          ...(kpiMetric && { kpiTarget: { metric: kpiMetric, value: kpiValue } }),
        },
        target: { mode, total, perDay },
        planConfig, budgetCapUsd: payg ? PAY_AS_YOU_GO : budgetCapUsd, warnAtPct,
        reviewPolicy: { mode: reviewMode, forceReviewTypes },
        qcConfig: { minConfidence, maxRetries: 2, borderline: 0.1 },
        generationConfig: { variantsPerPost, horizonDays, chunkSize: 8, pilotSize: 10 },
      });
      router.push(`/campaigns/automation/${id}`);
    });

  /** Sets every point of the form from the assistant's normalised answer (all sections, down to the budget). */
  const applyPatch = (x: Patch) => {
    setName(x.name); setKind(x.kind); setBrandName(x.brandName); setBrandOffer(x.brandOffer); setBrandVoice(x.brandVoice); setAccountIds(x.accountIds);
    setObjectives(x.objectives); setObjective(x.objective); setTraits(x.traits); setAudience(x.audience); setPillars(x.pillars.join("\n"));
    setLanguage(x.language); setTones(x.tones as Tone[]); setTypes(x.types); setLength(x.length as typeof length); setHashtags(x.hashtags); setCustomTags(x.customTags);
    setCta(x.cta as keyof typeof CTA); setLinkUrl(x.linkUrl); setAvoid(x.avoid);
    setStart(x.startDate); setEnd(x.endDate); setMode("total"); setTotal(x.total);
    setMaxPerDay(x.maxPostsPerDay); setHours(x.hours); setGap(x.minGapMinutes); setQuiet(x.quiet);
    setKpiMetric(x.kpiMetric as typeof kpiMetric); setKpiValue(x.kpiValue);
    setReviewMode(x.reviewMode); setForce(x.forceReviewTypes); setMinConf(x.minConfidence); setVariants(x.variants); setHorizon(x.horizonDays);
    setPayg(x.payg); if (!x.payg) setBudget(x.budgetCapUsd); setWarn(x.warnAtPct);
    return 8;
  };
  const runAssist = async () => {
    setAssist({ state: "working" });
    try {
      const { patch, notes } = await assistFill({ text: brief.trim() || "No description: use the attached account persona file.", persona: persona || undefined });
      applyPatch(patch);
      setAssist({ state: "done", note: "Every section is filled. Check it below, then create the campaign.", notes });
    } catch (e) {
      setAssist({ state: "error", note: e instanceof Error ? e.message : String(e) });
    }
  };
  const onPersonaFile = async (file?: File) => {
    if (!file) return;
    if (file.size > 200_000) return setPersonaNote("That file is over 200 KB. Use a shorter persona.");
    const text = (await file.text()).trim();
    if (!text) return setPersonaNote("The file is empty.");
    setPersona(text.slice(0, PERSONA_MAX));
    setPersonaFile(file.name);
    setPersonaNote(text.length > PERSONA_MAX ? `Only the first ${PERSONA_MAX.toLocaleString("en-US")} characters are used.` : "");
  };
  const flow: FlowStep[] = [
    {
      role: "AI Agent Assistant", slug: "account-manager", icon: "auto_awesome", does: "Reads your description and fills the form.",
      state: ({ idle: "waiting", working: "active", done: "done", error: "failed" } as const)[assist.state] as FlowState,
      note: assist.state === "idle" ? "Optional: describe the campaign above" : assist.state === "working" ? "Reading your description…" : assist.note,
    },
    {
      role: "Planner (code, no LLM)", icon: "event_note", does: "Fixes every slot before writing.", state: problem ? "waiting" : "done",
      note: problem ? `Needs: ${problem}` : `${live!.targetPosts} texts ready to plan`,
    },
    { role: "Account Manager", slug: "account-manager", icon: "handshake", does: "Expands your command into a detailed brief.", state: "waiting", note: "Starts when you press Start pilot" },
    {
      role: "Socmed Specialist", slug: "socmed-specialist", icon: "campaign", does: "Writes each post.", state: "waiting",
      note: persona ? `Writes in the voice of ${personaFile}` : kind === "brand" ? "Writes in the brand's voice" : "Writes in your voice",
    },
    { role: "Post QC", slug: "post-qc", icon: "rule", does: "Checks every post.", state: "waiting", note: reviewMode === "qc_auto" ? "Approves confident posts" : "Checks, you approve each" },
    { role: "You (review)", icon: "fact_check", does: "Approve what QC is unsure about.", state: "waiting", note: "Every pilot post comes to you" },
  ];

  return (
    <div className="space-y-6">
    <section className="card space-y-2 border-brand/30 bg-brand-soft/40 p-3">
      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand text-white"><span className="material-symbols-outlined !text-[16px]">auto_awesome</span></span>
        <h2 className="text-sm font-bold">AI Agent Assistant</h2>
        <p className="hidden truncate text-xs text-ink-2 sm:block">Describe the campaign and it fills the form. You review before anything is created.</p>
      </div>
      <textarea
        className="input min-h-14 !py-2 text-sm" rows={2} aria-label="Describe your campaign" value={brief} maxLength={4000} onChange={(e) => setBrief(e.target.value)}
        placeholder="e.g. 30 days for my coffee shop Kopi Senja on X and Threads, 3 posts a day, friendly and witty, for young professionals in Jakarta. No spending cap."
      />
      <div className="flex flex-wrap items-center gap-2">
        <label className="btn-soft cursor-pointer !px-3 !py-1.5 text-xs">
          <span className="material-symbols-outlined !text-[16px]">upload_file</span>{personaFile ? "Replace persona" : "Persona (.md)"}
          <input type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" className="sr-only" onChange={(e) => { void onPersonaFile(e.target.files?.[0]); e.target.value = ""; }} />
        </label>
        {personaFile && (
          <span className="pill border-brand/30 bg-brand-soft text-brand">
            <span className="material-symbols-outlined !text-[14px]">description</span>{personaFile} · {persona.length.toLocaleString("en-US")}
            <button type="button" aria-label="Remove persona file" className="ml-1" onClick={() => { setPersona(""); setPersonaFile(""); setPersonaNote(""); }}>
              <span className="material-symbols-outlined !text-[14px]">close</span>
            </button>
          </span>
        )}
        <button type="button" className="btn-primary ml-auto !px-4 !py-1.5 text-xs" disabled={assist.state === "working" || (!brief.trim() && !persona)} onClick={runAssist}>
          <span className="material-symbols-outlined !text-[16px]">magic_button</span>{assist.state === "working" ? "Reading…" : "Fill the form"}
        </button>
      </div>
      {personaNote && <p role="status" className="text-xs text-amber-700">{personaNote}</p>}
      {assist.note && assist.state !== "working" && <p role="status" className={`text-xs font-medium ${assist.state === "error" ? "text-red-700" : "text-emerald-700"}`}>{assist.note}</p>}
      {assist.notes && assist.notes.length > 0 && (
        <details className="text-xs" open>
          <summary className="cursor-pointer font-semibold text-ink-2">What the assistant chose for you ({assist.notes.length})</summary>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-ink-2">{assist.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
        </details>
      )}
    </section>
    <form className="grid gap-6 lg:grid-cols-[1fr_17rem]" onSubmit={(e) => { e.preventDefault(); if (!problem) submit(); }}>
      <div className="space-y-6">
        <Section n={1} title="Who is posting" hint="This sets the voice: a person speaks as “I”, a brand speaks as “we”.">
          <label className="block"><span className="label">Campaign name</span><input className="input" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} placeholder="November coffee series" /></label>
          <Cards
            value={[kind]} onChange={([k]) => setKind(k)}
            options={[
              { id: "personal", title: "Personal", icon: "person", text: "Your own account. First person, written in your writing voice." },
              { id: "brand", title: "Brand", icon: "storefront", text: "A business or project. Speaks as “we”, in the brand's voice, not yours." },
            ]}
          />
          {kind === "brand" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <label><span className="label">Brand name</span><input className="input" required maxLength={80} value={brandName} onChange={(e) => setBrandName(e.target.value)} placeholder="Kopi Senja" /></label>
              <label><span className="label">What it offers (optional)</span><input className="input" maxLength={300} value={brandOffer} onChange={(e) => setBrandOffer(e.target.value)} placeholder="Single-origin coffee and a co-working corner" /></label>
              <label className="sm:col-span-2"><span className="label">Brand voice (optional)</span><textarea className="input min-h-20" maxLength={500} value={brandVoice} onChange={(e) => setBrandVoice(e.target.value)} placeholder="Friendly neighbourhood barista, never salesy, a little cheeky" /></label>
            </div>
          )}
          <fieldset>
            <legend className="label">Accounts (each text is posted to every account picked)</legend>
            <div className="flex flex-wrap gap-2">
              {p.accounts.map((a) => (
                <label key={a.id} className={`pill cursor-pointer ${accountIds.includes(a.id) ? "border-brand bg-brand-soft text-brand" : "border-line"}`}>
                  <input type="checkbox" className="sr-only" checked={accountIds.includes(a.id)} onChange={() => setAccountIds(toggle(accountIds, a.id))} />
                  {PLATFORM_LABEL[a.platform] ?? a.platform} @{a.handle}
                </label>
              ))}
            </div>
          </fieldset>
        </Section>

        <Section n={2} title="Goal and audience" hint="Pick what applies. The Account Manager turns these into the brief every writer follows.">
          <fieldset><legend className="label">What should the posts achieve</legend><Chips options={[...OBJECTIVES].map((o) => [o, o] as const)} value={objectives} onChange={setObjectives} /></fieldset>
          <label className="block"><span className="label">Anything else about the goal (optional)</span><input className="input" value={objective} onChange={(e) => setObjective(e.target.value)} placeholder="Get people to try our new cold brew" /></label>
          <fieldset><legend className="label">Who is the audience</legend><Chips options={[...AUDIENCE_TRAITS].map((o) => [o, o] as const)} value={traits} onChange={setTraits} /></fieldset>
          <label className="block"><span className="label">Describe them in your own words{traits.length ? " (optional)" : ""}</span><input className="input" value={audience} onChange={(e) => setAudience(e.target.value)} placeholder="Office workers in Jakarta who buy coffee every day" /></label>
          <label className="block"><span className="label">Pillars / topics (one per line)</span><textarea className="input min-h-24" value={pillars} onChange={(e) => setPillars(e.target.value)} placeholder={"kopi susu lokal\nkerja dari kafe\nhidup di Jakarta"} /></label>
        </Section>

        <Section n={3} title="Style" hint="How the posts should read and look.">
          <fieldset><legend className="label">Tone (up to 4)</legend><Chips options={TONES.map((t) => [t, TONE_LABEL[t]] as const)} value={tones} onChange={setTones} max={4} /></fieldset>
          <fieldset>
            <legend className="label">Content types{types.length ? "" : " (none picked = the weighted mix of all)"}</legend>
            <Cards multi value={types} onChange={setTypes} options={p.types.map((t) => ({ id: t.id, title: t.label, text: t.blurb, icon: t.icon }))} />
            <p className="mt-2 text-xs text-ink-3">Picking a single type repeats it; with two or more the anti-repeat rule still holds. Types that state facts show the AI&apos;s source for you to check.</p>
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <fieldset>
              <legend className="label">Post length</legend>
              <Cards value={[length]} onChange={([l]) => setLength(l)} options={LENGTHS.map(([id, title, text]) => ({ id, title, text }))} />
            </fieldset>
            <fieldset>
              <legend className="label">Hashtags</legend>
              <Cards value={[hashtags]} onChange={([h]) => setHashtags(h)} options={HASHTAGS.map(([id, title, text]) => ({ id, title, text }))} />
              {hashtags === "custom" && <input className="input mt-2" value={customTags} onChange={(e) => setCustomTags(e.target.value)} placeholder="#kopi #kerjaremote" aria-label="Custom hashtags" />}
            </fieldset>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label><span className="label">Language</span>
              <select className="input" value={language} onChange={(e) => setLanguage(e.target.value as typeof language)}>
                <option value="auto">Follow the audience / topic</option><option value="id">Indonesian</option><option value="en">English</option>
              </select>
            </label>
            <label><span className="label">Call to action (spread, never in every post)</span>
              <select className="input" value={cta} onChange={(e) => setCta(e.target.value as keyof typeof CTA)}>
                {Object.entries(CTA).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
              </select>
            </label>
            {cta === "visit_link" && <label className="sm:col-span-2"><span className="label">Link</span><input type="url" className="input" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://" /></label>}
          </div>
          <label className="block"><span className="label">Never mention (optional, comma or line separated)</span><textarea className="input min-h-16" maxLength={500} value={avoid} onChange={(e) => setAvoid(e.target.value)} placeholder="politik, kompetitor, harga" /></label>
        </Section>

        <Section n={4} title="Volume and schedule">
          <div className="grid gap-4 sm:grid-cols-2">
            <label><span className="label">Start date</span><input type="date" className="input" required value={startDate} onChange={(e) => setStart(e.target.value)} /></label>
            <label><span className="label">End date</span><input type="date" className="input" required value={endDate} min={startDate} onChange={(e) => setEnd(e.target.value)} /></label>
          </div>
          <fieldset>
            <legend className="label">How many posts</legend>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <label className="flex items-center gap-2"><input type="radio" checked={mode === "total"} onChange={() => setMode("total")} /> Total</label>
              <NumInput aria-label="Total posts" className="input w-28" min={1} max={p.maxPosts} disabled={mode !== "total"} value={total} onChange={(n) => setTotal(n)} />
              <label className="ml-4 flex items-center gap-2"><input type="radio" checked={mode === "rate"} onChange={() => setMode("rate")} /> Per day</label>
              <NumInput aria-label="Posts per day" className="input w-24" min={1} max={24} disabled={mode !== "rate"} value={perDay} onChange={(n) => setPerDay(n)} />
              {live && <span className="text-ink-2">= {live.targetPosts} posts over {live.days} posting days</span>}
            </div>
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-4">
            <label><span className="label">Max per day</span><NumInput min={1} max={24} className="input" value={maxPostsPerDay} onChange={(n) => setMaxPerDay(n)} /></label>
            <label><span className="label">Active from (hour)</span><NumInput min={0} max={23} className="input" value={hours[0]} onChange={(n) => setHours([n, hours[1]])} /></label>
            <label><span className="label">Active until (hour)</span><NumInput min={1} max={24} className="input" value={hours[1]} onChange={(n) => setHours([hours[0], n])} /></label>
            <label><span className="label">Min gap (minutes)</span><NumInput min={5} max={720} className="input" value={minGapMinutes} onChange={(n) => setGap(n)} /></label>
          </div>
          <fieldset>
            <legend className="label">Quiet days (no posts)</legend>
            <Chips options={WEEKDAYS.map((d, i) => [String(i), d] as const)} value={quiet.map(String)} onChange={(v) => setQuiet(v.map(Number))} />
          </fieldset>
          <label className="block sm:w-1/2"><span className="label">KPI target (optional)</span>
            <select className="input" value={kpiMetric} onChange={(e) => setKpiMetric(e.target.value as typeof kpiMetric)}>
              <option value="">None</option><option value="reach">Reach</option><option value="clicks">Clicks</option><option value="followers">New followers</option>
            </select>
          </label>
          {kpiMetric && <label className="block sm:w-1/2"><span className="label">Target value</span><NumInput min={0} className="input" value={kpiValue} onChange={(n) => setKpiValue(n)} /></label>}
          <p className="text-xs text-ink-3">Posts are spread evenly over the active hours of your audience, with a small random offset per account.</p>
        </Section>

        <Section n={5} title="Quality and review">
          <Cards
            value={[reviewMode]} onChange={([m]) => setReviewMode(m)}
            options={[
              { id: "qc_auto", title: "QC auto-approve", icon: "verified", text: "Posts that pass every rule with high QC confidence are approved automatically; the rest wait for you." },
              { id: "manual_all", title: "Review everything", icon: "visibility", text: "QC still checks every post, but you approve each one." },
            ]}
          />
          <fieldset>
            <legend className="label">Always reviewed by you</legend>
            <Chips options={p.types.map((t) => [t.id, t.label] as const)} value={forceReviewTypes} onChange={setForce} />
            <p className="mt-2 text-xs text-ink-3">
              Trade-off: educational and story posts state facts or events whose sources nobody verifies, and cheaper models invent specifics.
              Removing them saves review time but lets unchecked claims publish. Posts that may name a real person are always reviewed.
            </p>
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-3">
            <label><span className="label">QC threshold: {Math.round(minConfidence * 100)}%</span><input type="range" min={0.5} max={1} step={0.05} className="w-full" value={minConfidence} onChange={(e) => setMinConf(num(e.target.value))} /></label>
            <label><span className="label">Variants per post</span><select className="input" value={variantsPerPost} onChange={(e) => setVariants(num(e.target.value))}>{[1, 2, 3].map((n) => <option key={n}>{n}</option>)}</select></label>
            <label><span className="label">Generate ahead (days)</span><NumInput min={1} max={30} className="input" value={horizonDays} onChange={(n) => setHorizon(n)} /></label>
          </div>
        </Section>

        <Section n={6} title="Budget">
          <Cards
            value={[payg ? "payg" : "cap"]} onChange={([m]) => setPayg(m === "payg")}
            options={[
              { id: "cap", title: "Fixed cap", icon: "savings", text: "Stop generating when the campaign has spent this much." },
              { id: "payg", title: "Pay as you go", icon: "payments", text: "No campaign cap: spend what the posts cost, watched as it goes." },
            ]}
          />
          {payg ? (
            <p className="rounded-xl bg-canvas p-3 text-xs text-ink-2">
              You pay for what is generated, with no limit for this campaign. The monthly caps in Settings (all providers) and Settings → AI
              are still checked before every post and pause the campaign when reached. The pilot shows the real cost per post before you scale up.
            </p>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <label><span className="label">Campaign cap (US$)</span><NumInput min={0.01} step={0.01} className="input" value={budgetCapUsd} onChange={(n) => setBudget(n)} /></label>
                <label><span className="label">Warn at (% of cap)</span><NumInput min={1} max={99} className="input" value={warnAtPct} onChange={(n) => setWarn(n)} /></label>
              </div>
              <p className="text-xs text-ink-3">Generation pauses automatically at 100%. The monthly caps in Settings still apply first.</p>
            </>
          )}
        </Section>
      </div>

      {/* Sits below the sticky top bar (4rem) and scrolls inside itself when both cards are taller than the screen. */}
      <aside className="-m-1 space-y-3 p-1 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:self-start lg:overflow-y-auto">
        <section className="card space-y-2 p-3 text-xs" aria-live="polite" aria-label="Check">
          <h2 className="text-sm font-bold">Check</h2>
          {live && (
            <dl className="grid grid-cols-2 gap-y-0.5">
              <dt className="text-ink-2">Account</dt><dd className="text-right">{kind === "brand" ? brandName || "Brand" : "Personal"}</dd>
              <dt className="text-ink-2">Target</dt><dd className="text-right font-semibold">{live.targetPosts} posts</dd>
              <dt className="text-ink-2">Posting days</dt><dd className="text-right">{live.days}</dd>
              <dt className="text-ink-2">Per day (max)</dt><dd className="text-right">{live.perDay}</dd>
              <dt className="text-ink-2">Plan holds</dt><dd className="text-right">{live.total}</dd>
              <dt className="text-ink-2">Buffer posts</dt><dd className="text-right">{live.targetPosts * accountIds.length}</dd>
              <dt className="text-ink-2">Estimated cost</dt>
              <dd className={`text-right font-semibold ${overCap ? "text-red-700" : ""}`}>{est == null ? "unknown" : usd(est)}</dd>
            </dl>
          )}
          <p className="text-[11px] text-ink-3">
            {p.perPostUsd == null ? "Model prices could not be read (no AI key?)." : `About ${usd(p.perPostUsd)} per post (upper bound).`} The pilot measures the real cost.
          </p>
          {overCap && <p className="text-[11px] font-medium text-amber-700">Above the cap: generation will pause when the cap is reached.</p>}
          {problem && <p role="status" className="rounded-lg bg-amber-soft p-2 text-[11px] font-medium text-amber-800">{problem}</p>}
          <button className="btn-primary w-full !py-1.5 text-xs" disabled={!!problem || pending}>{pending ? "Planning…" : "Create campaign and plan"}</button>
          <ErrorText error={error} />
          <p className="text-[11px] text-ink-3">Nothing is generated or spent until you start the pilot.</p>
        </section>
        <section className="card space-y-2 p-3 text-xs" aria-label="Workflow agents">
          <h2 className="text-sm font-bold">Workflow agents</h2>
          <CampaignFlow steps={flow} compact />
        </section>
      </aside>
    </form>
    </div>
  );
}
