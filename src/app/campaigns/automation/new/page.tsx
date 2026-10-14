import Link from "next/link";
import { automationEnv } from "@/lib/ai/env";
import { automationAccounts, estimatePostUsd } from "@/lib/automation/store";
import { contentSetup } from "@/lib/content/config";
import { getSettings } from "@/lib/settings";
import { AutomationForm } from "./form";

export const dynamic = "force-dynamic";

export default async function NewAutomationPage() {
  const [accounts, perPostUsd, settings] = await Promise.all([automationAccounts(), estimatePostUsd(), getSettings()]);
  const types = Object.entries(contentSetup().config.types).flatMap(([t, c]) => (c && c.weight > 0 ? [{ id: t, label: c.label }] : []));
  return (
    <div className="space-y-6 pt-2">
      <Link href="/campaigns/automation" className="inline-flex items-center gap-1 text-sm font-semibold text-brand">
        <span className="material-symbols-outlined !text-[18px]">arrow_back</span> Automation campaigns
      </Link>
      <div>
        <h1 className="text-3xl font-bold tracking-tight">New automation campaign</h1>
        <p className="mt-1 text-ink-2">
          Text posts for X and Threads over a date range. Every post is checked by the Post QC agent; confident posts are approved
          automatically, the rest wait for you. Times are in {settings.timezone}.
        </p>
      </div>
      {accounts.length ? (
        <AutomationForm accounts={accounts} maxPosts={automationEnv().AUTOMATION_MAX_POSTS} perPostUsd={perPostUsd} types={types} defaultCapUsd={Number(settings.campaignBudgetUsd)} />
      ) : (
        <section className="card p-8 text-ink-2">
          No active X or Threads channel. <Link href="/connections" className="font-semibold text-brand">Enable one in Connections →</Link>
        </section>
      )}
    </div>
  );
}
