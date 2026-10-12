import Link from "next/link";
import { getSettings, saveSettings } from "../actions";
import { BudgetField, SourceToggle } from "../ui";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const s = await getSettings();
  return (
    <div className="mx-auto max-w-xl pt-4">
      <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
      <p className="mt-2 text-ink-2">Default cost limits and video source for new campaigns.</p>
      <form action={saveSettings} className="card mt-6 space-y-5 p-8">
        <BudgetField label="Default budget per campaign (USD)" name="campaignBudgetUsd" defaultValue={String(s.campaignBudgetUsd)} max={100} step={1} />
        <BudgetField label="Budget per month (USD)" name="monthlyBudgetUsd" defaultValue={String(s.monthlyBudgetUsd)} max={1000} step={10} />
        <SourceToggle name="defaultVideoSource" defaultValue={s.defaultVideoSource} />
        <button className="btn-primary w-full">
          <span className="material-symbols-outlined">save</span>Save
        </button>
      </form>
      <Link href="/accounts" className="card mt-6 flex items-center gap-3 p-6 hover:border-brand">
        <span className="material-symbols-outlined text-brand">group</span>
        <span className="flex-1">
          <span className="block font-semibold">Connected accounts</span>
          <span className="text-sm text-ink-2">Instagram and TikTok accounts, tokens, publisher and quota.</span>
        </span>
        <span className="material-symbols-outlined text-ink-3">chevron_right</span>
      </Link>
    </div>
  );
}
