"use client";
// New automation campaign: one page. The feasibility check and the cost estimate update live from the same pure
// planner functions the server runs again on submit (the server is the one that blocks).
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { DEFAULT_FORCE_REVIEW } from "@/lib/automation/config";
import { capacity, planDays, targetFrom } from "@/lib/automation/plan";
import { ErrorText, useAction } from "../../../ui";
import { createAutomation } from "../actions";

type Account = { id: string; platform: string; handle: string };
const CTA = { none: "None", ask_reply: "Ask to reply", ask_repost: "Ask to repost", ask_follow: "Ask to follow", visit_link: "Visit link", promo: "Promo" };
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (d: string, n: number) => new Date(Date.parse(d) + n * 86_400_000).toISOString().slice(0, 10);
const usd = (n: number) => `US$${n.toFixed(n < 1 ? 4 : 2)}`;

export function AutomationForm(p: { accounts: Account[]; maxPosts: number; perPostUsd: number | null; types: { id: string; label: string }[]; defaultCapUsd: number }) {
  const router = useRouter();
  const { pending, error, run } = useAction();
  const [name, setName] = useState("");
  const [accountIds, setAccountIds] = useState<string[]>(p.accounts.map((a) => a.id));
  const [startDate, setStart] = useState(plusDays(today(), 1));
  const [endDate, setEnd] = useState(plusDays(today(), 30));
  const [mode, setMode] = useState<"total" | "rate">("total");
  const [total, setTotal] = useState(60);
  const [perDay, setPerDay] = useState(2);
  const [pillars, setPillars] = useState("");
  const [audience, setAudience] = useState("");
  const [objective, setObjective] = useState("");
  const [language, setLanguage] = useState<"auto" | "id" | "en">("auto");
  const [cta, setCta] = useState<keyof typeof CTA>("none");
  const [linkUrl, setLinkUrl] = useState("");
  const [kpiMetric, setKpiMetric] = useState<"" | "reach" | "clicks" | "followers">("");
  const [kpiValue, setKpiValue] = useState(0);
  const [maxPostsPerDay, setMaxPerDay] = useState(4);
  const [hours, setHours] = useState<[number, number]>([8, 22]);
  const [minGapMinutes, setGap] = useState(90);
  const [quiet, setQuiet] = useState<number[]>([]);
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
  const problem = !live
    ? "Check the dates and the active hours"
    : live.targetPosts < 1 || live.targetPosts > p.maxPosts
      ? `The target must be between 1 and ${p.maxPosts} posts`
      : live.shortfall
        ? `${live.shortfall} posts short: the plan holds ${live.total} (${live.days} days × ${live.perDay} per day). Lengthen the range, raise posts per day or lower the target.`
        : !accountIds.length ? "Pick at least one account" : !pillars.trim() ? "Add at least one pillar" : !audience.trim() ? "Describe the audience" : null;
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const submit = () =>
    run(async () => {
      const { id } = await createAutomation({
        name,
        goal: {
          accountIds, startDate, endDate, audience, objective, language, cta,
          pillars: pillars.split("\n").map((s) => s.trim()).filter(Boolean),
          ...(linkUrl.trim() && { linkUrl: linkUrl.trim() }),
          ...(kpiMetric && { kpiTarget: { metric: kpiMetric, value: kpiValue } }),
        },
        target: { mode, total, perDay },
        planConfig, budgetCapUsd, warnAtPct,
        reviewPolicy: { mode: reviewMode, forceReviewTypes },
        qcConfig: { minConfidence, maxRetries: 2, borderline: 0.1 },
        generationConfig: { variantsPerPost, horizonDays, chunkSize: 8, pilotSize: 10 },
      });
      router.push(`/campaigns/automation/${id}`);
    });

  const num = (v: string) => (Number.isFinite(Number(v)) ? Number(v) : 0);

  return (
    <form className="grid gap-6 lg:grid-cols-[1fr_20rem]" onSubmit={(e) => { e.preventDefault(); if (!problem) submit(); }}>
      <div className="space-y-6">
        <section className="card space-y-4 p-6">
          <h2 className="text-lg font-bold">Goal</h2>
          <label className="block"><span className="label">Name</span><input className="input" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} placeholder="November coffee series" /></label>
          <fieldset>
            <legend className="label">Accounts (each text is posted to every account picked)</legend>
            <div className="flex flex-wrap gap-2">
              {p.accounts.map((a) => (
                <label key={a.id} className={`pill cursor-pointer ${accountIds.includes(a.id) ? "border-brand bg-brand-soft text-brand" : "border-line"}`}>
                  <input type="checkbox" className="sr-only" checked={accountIds.includes(a.id)} onChange={() => setAccountIds(toggle(accountIds, a.id))} />
                  {a.platform === "twitter" ? "X" : "Threads"} @{a.handle}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <label><span className="label">Start date</span><input type="date" className="input" required value={startDate} onChange={(e) => setStart(e.target.value)} /></label>
            <label><span className="label">End date</span><input type="date" className="input" required value={endDate} min={startDate} onChange={(e) => setEnd(e.target.value)} /></label>
          </div>
          <fieldset>
            <legend className="label">How many posts</legend>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <label className="flex items-center gap-2"><input type="radio" checked={mode === "total"} onChange={() => setMode("total")} /> Total</label>
              <input type="number" aria-label="Total posts" className="input w-28" min={1} max={p.maxPosts} disabled={mode !== "total"} value={total} onChange={(e) => setTotal(num(e.target.value))} />
              <label className="ml-4 flex items-center gap-2"><input type="radio" checked={mode === "rate"} onChange={() => setMode("rate")} /> Per day</label>
              <input type="number" aria-label="Posts per day" className="input w-24" min={1} max={24} disabled={mode !== "rate"} value={perDay} onChange={(e) => setPerDay(num(e.target.value))} />
              {live && <span className="text-ink-2">= {live.targetPosts} posts over {live.days} posting days</span>}
            </div>
          </fieldset>
          <label className="block"><span className="label">Pillars / topics (one per line)</span><textarea className="input min-h-24" value={pillars} onChange={(e) => setPillars(e.target.value)} placeholder={"kopi susu lokal\nkerja dari kafe\nhidup di Jakarta"} /></label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label><span className="label">Audience</span><input className="input" required value={audience} onChange={(e) => setAudience(e.target.value)} placeholder="Young professionals in Jakarta" /></label>
            <label><span className="label">Objective (optional)</span><input className="input" value={objective} onChange={(e) => setObjective(e.target.value)} placeholder="Grow followers who care about coffee" /></label>
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
            <label><span className="label">KPI target (optional)</span>
              <select className="input" value={kpiMetric} onChange={(e) => setKpiMetric(e.target.value as typeof kpiMetric)}>
                <option value="">None</option><option value="reach">Reach</option><option value="clicks">Clicks</option><option value="followers">New followers</option>
              </select>
            </label>
            {kpiMetric && <label><span className="label">Target value</span><input type="number" min={0} className="input" value={kpiValue} onChange={(e) => setKpiValue(num(e.target.value))} /></label>}
          </div>
        </section>

        <section className="card space-y-4 p-6">
          <h2 className="text-lg font-bold">Schedule</h2>
          <div className="grid gap-4 sm:grid-cols-4">
            <label><span className="label">Max per day</span><input type="number" min={1} max={24} className="input" value={maxPostsPerDay} onChange={(e) => setMaxPerDay(num(e.target.value))} /></label>
            <label><span className="label">Active from (hour)</span><input type="number" min={0} max={23} className="input" value={hours[0]} onChange={(e) => setHours([num(e.target.value), hours[1]])} /></label>
            <label><span className="label">Active until (hour)</span><input type="number" min={1} max={24} className="input" value={hours[1]} onChange={(e) => setHours([hours[0], num(e.target.value)])} /></label>
            <label><span className="label">Min gap (minutes)</span><input type="number" min={5} max={720} className="input" value={minGapMinutes} onChange={(e) => setGap(num(e.target.value))} /></label>
          </div>
          <fieldset>
            <legend className="label">Quiet days (no posts)</legend>
            <div className="flex flex-wrap gap-2">
              {WEEKDAYS.map((d, i) => (
                <label key={d} className={`pill cursor-pointer ${quiet.includes(i) ? "border-brand bg-brand-soft text-brand" : "border-line"}`}>
                  <input type="checkbox" className="sr-only" checked={quiet.includes(i)} onChange={() => setQuiet(toggle(quiet, i))} />{d}
                </label>
              ))}
            </div>
          </fieldset>
          <p className="text-xs text-ink-3">Posts are spread evenly over the active hours of your audience, with a small random offset per account.</p>
        </section>

        <section className="card space-y-4 p-6">
          <h2 className="text-lg font-bold">Quality and review</h2>
          <fieldset className="space-y-2 text-sm">
            <legend className="label">Review policy</legend>
            <label className="flex gap-2"><input type="radio" checked={reviewMode === "qc_auto"} onChange={() => setReviewMode("qc_auto")} /> <span><b>QC auto-approve</b>: posts that pass every rule with high QC confidence are approved automatically; the rest wait for you.</span></label>
            <label className="flex gap-2"><input type="radio" checked={reviewMode === "manual_all"} onChange={() => setReviewMode("manual_all")} /> <span><b>Review everything</b>: QC still checks every post, but you approve each one.</span></label>
          </fieldset>
          <fieldset>
            <legend className="label">Always reviewed by you</legend>
            <div className="flex flex-wrap gap-2">
              {p.types.map((t) => (
                <label key={t.id} className={`pill cursor-pointer ${forceReviewTypes.includes(t.id) ? "border-brand bg-brand-soft text-brand" : "border-line"}`}>
                  <input type="checkbox" className="sr-only" checked={forceReviewTypes.includes(t.id)} onChange={() => setForce(toggle(forceReviewTypes, t.id))} />{t.label}
                </label>
              ))}
            </div>
            <p className="mt-2 text-xs text-ink-3">
              Trade-off: educational and story posts state facts or events whose sources nobody verifies, and cheaper models invent specifics.
              Removing them saves review time but lets unchecked claims publish. Posts that may name a real person are always reviewed.
            </p>
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-3">
            <label><span className="label">QC threshold: {Math.round(minConfidence * 100)}%</span><input type="range" min={0.5} max={1} step={0.05} className="w-full" value={minConfidence} onChange={(e) => setMinConf(num(e.target.value))} /></label>
            <label><span className="label">Variants per post</span><select className="input" value={variantsPerPost} onChange={(e) => setVariants(num(e.target.value))}>{[1, 2, 3].map((n) => <option key={n}>{n}</option>)}</select></label>
            <label><span className="label">Generate ahead (days)</span><input type="number" min={1} max={30} className="input" value={horizonDays} onChange={(e) => setHorizon(num(e.target.value))} /></label>
          </div>
        </section>

        <section className="card space-y-4 p-6">
          <h2 className="text-lg font-bold">Budget</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <label><span className="label">Campaign cap (US$)</span><input type="number" min={0.01} step={0.01} className="input" value={budgetCapUsd} onChange={(e) => setBudget(num(e.target.value))} /></label>
            <label><span className="label">Warn at (% of cap)</span><input type="number" min={1} max={99} className="input" value={warnAtPct} onChange={(e) => setWarn(num(e.target.value))} /></label>
          </div>
          <p className="text-xs text-ink-3">Generation pauses automatically at 100%. The monthly caps in Settings still apply first.</p>
        </section>
      </div>

      <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
        <section className="card space-y-3 p-6 text-sm" aria-live="polite">
          <h2 className="text-lg font-bold">Check</h2>
          {live && (
            <dl className="grid grid-cols-2 gap-y-1">
              <dt className="text-ink-2">Target</dt><dd className="text-right font-semibold">{live.targetPosts} posts</dd>
              <dt className="text-ink-2">Posting days</dt><dd className="text-right">{live.days}</dd>
              <dt className="text-ink-2">Per day (max)</dt><dd className="text-right">{live.perDay}</dd>
              <dt className="text-ink-2">Plan holds</dt><dd className="text-right">{live.total}</dd>
              <dt className="text-ink-2">Buffer posts</dt><dd className="text-right">{live.targetPosts * accountIds.length}</dd>
              <dt className="text-ink-2">Estimated cost</dt>
              <dd className={`text-right font-semibold ${est != null && est > budgetCapUsd ? "text-red-700" : ""}`}>{est == null ? "unknown" : usd(est)}</dd>
            </dl>
          )}
          <p className="text-xs text-ink-3">
            {p.perPostUsd == null ? "Model prices could not be read (no AI key?)." : `Estimate: ${usd(p.perPostUsd)} per post (upper bound from model prices).`} The pilot measures the real cost.
          </p>
          {est != null && est > budgetCapUsd && <p className="text-xs font-medium text-amber-700">The estimate is above the cap: generation will pause when the cap is reached.</p>}
          {problem && <p role="status" className="rounded-xl bg-amber-soft p-3 text-xs font-medium text-amber-800">{problem}</p>}
          <button className="btn-primary w-full" disabled={!!problem || pending}>{pending ? "Planning…" : "Create campaign and plan"}</button>
          <ErrorText error={error} />
          <p className="text-xs text-ink-3">Creating only plans the posts. Nothing is generated or spent until you start the pilot.</p>
        </section>
      </aside>
    </form>
  );
}
