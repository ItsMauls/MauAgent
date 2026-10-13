import { getSettings } from "@/lib/settings";
import { targetAccounts, targetOptions } from "@/lib/publishPlan";
import { DecisionButtons } from "../ui";

/** Decision buttons plus, when Buffer channels are enabled, the publish target picker behind Approve. */
export async function ApprovalDecision({ c }: { c: { id: string; clientBrief: unknown; approvalPackage: unknown; shots: { shotId: string; source: string }[] } }) {
  const [accounts, settings] = await Promise.all([targetAccounts().catch(() => []), getSettings()]);
  const platforms = (c.clientBrief as { platforms?: string[] }).platforms ?? [];
  return (
    <DecisionButtons
      campaignId={c.id}
      shots={c.shots.map((s) => ({ shotId: s.shotId, source: s.source }))}
      publish={accounts.length ? { ...targetOptions(accounts, c.approvalPackage, platforms), timezone: settings.timezone } : undefined}
    />
  );
}
