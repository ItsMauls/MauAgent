import { createCampaign, getSettings } from "../actions";
import { SourceToggle } from "../ui";

export const dynamic = "force-dynamic";

export default async function BriefPage() {
  const s = await getSettings();
  return (
    <div className="mx-auto max-w-2xl pt-4">
      <h1 className="text-3xl font-bold tracking-tight">
        <mark className="rounded-lg bg-amber-soft px-2.5 py-0.5">New brief</mark>
      </h1>
      <p className="mt-2 text-ink-2">Describe what the campaign needs, and 7 AI agents will handle the rest.</p>
      <form action={createCampaign} className="card mt-6 space-y-5 p-8">
        <Field label="Business objective" name="objective" textarea required />
        <Field label="Product / business" name="product" required />
        <Field label="Target audience" name="audience" textarea required />
        <Field label="KPI" name="kpi" />
        <fieldset>
          <legend className="label">Platform</legend>
          <div className="flex gap-2">
            {[["instagram", "Instagram"], ["tiktok", "TikTok"]].map(([v, t]) => (
              <label key={v} className="cursor-pointer">
                <input type="checkbox" name="platforms" value={v} defaultChecked className="peer sr-only" />
                <span className="pill border-line bg-white px-4 py-2 text-ink-2 peer-checked:border-brand peer-checked:bg-brand-soft peer-checked:text-brand">{t}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Budget cap (USD)" name="budgetCapUsd" type="number" step="0.01" min="0.01" defaultValue={String(s.campaignBudgetUsd)} required />
          <Field label="Deadline" name="deadline" type="date" />
        </div>
        <Field label="References (one link per line)" name="references" textarea />
        <SourceToggle name="defaultSource" defaultValue={s.defaultVideoSource} />
        <button className="btn-primary w-full">
          <span className="material-symbols-outlined">send</span>Submit brief
        </button>
      </form>
    </div>
  );
}

function Field({ label, name, textarea, ...rest }: { label: string; name: string; textarea?: boolean } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {textarea ? <textarea name={name} required={rest.required} rows={3} className="input" /> : <input name={name} {...rest} className="input" />}
    </label>
  );
}
