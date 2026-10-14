// Boards agenda: pure date helpers + item building. Days are "YYYY-MM-DD" strings in the owner's time zone.

import { taskHref } from "./flows";

const DAY_MS = 86_400_000;
export const DECISION_TIMEOUT_MS = 7 * DAY_MS; // waitForEvent timeout of the approval and budget gates

/** Calendar day of an instant in a time zone ("en-CA" formats as YYYY-MM-DD). */
export const dayKey = (d: Date, tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

export const isDay = (s: string | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));

/** Shift a day string by n days (calendar arithmetic in UTC, so no DST drift). */
export const addDays = (day: string, n: number) => new Date(Date.parse(day) + n * DAY_MS).toISOString().slice(0, 10);

/** Monday-first month grid for the month containing `day`; null = padding cell. */
export function monthGrid(day: string) {
  const [y, m] = day.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const pad = (first.getUTCDay() + 6) % 7;
  const cells: (string | null)[] = [...Array(pad).fill(null)];
  for (let d = 1; d <= days; d++) cells.push(`${day.slice(0, 7)}-${String(d).padStart(2, "0")}`);
  return { title: first.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }), cells };
}

export function countdown(ms: number) {
  if (ms <= 0) return "overdue";
  const d = Math.floor(ms / DAY_MS);
  const h = Math.floor((ms % DAY_MS) / 3_600_000);
  return d ? `${d}d ${h}h left` : `${h}h ${Math.floor((ms % 3_600_000) / 60_000)}m left`;
}

export type AgendaKind = "publish" | "deadline" | "approval" | "budget";
export type AgendaItem = { kind: AgendaKind; day: string; at: Date | null; title: string; href: string };

type Input = {
  jobs: { campaignId: string | null; agentTaskId?: string | null; platform: string; scheduledAt: Date | null; handle: string }[];
  campaigns: { id: string; status: string; product: string; deadline: string; gateStartedAt: Date | null }[];
};

/** Every dated item; the card filters one day and marks the month grid. */
export function agendaItems(i: Input, tz: string): AgendaItem[] {
  const items: AgendaItem[] = [];
  for (const j of i.jobs)
    if (j.scheduledAt)
      items.push({
        kind: "publish", day: dayKey(j.scheduledAt, tz), at: j.scheduledAt, title: `Publish to ${j.platform} @${j.handle}`,
        // A text post has no campaign: its schedule lives on the task that generated it.
        href: j.campaignId ? `/campaigns/${j.campaignId}?tab=publication` : taskHref("socmedSpecialist", j.agentTaskId),
      });
  for (const c of i.campaigns) {
    if (isDay(c.deadline)) items.push({ kind: "deadline", day: c.deadline, at: null, title: `Deadline: ${c.product}`, href: `/campaigns/${c.id}` });
    const gate = c.status === "AWAITING_APPROVAL" ? "approval" : c.status === "AWAITING_BUDGET" ? "budget" : null;
    if (gate && c.gateStartedAt) {
      const at = new Date(c.gateStartedAt.getTime() + DECISION_TIMEOUT_MS);
      items.push({ kind: gate, day: dayKey(at, tz), at, title: `${gate === "approval" ? "Approval" : "Budget decision"} expires: ${c.product}`, href: `/campaigns/${c.id}` });
    }
  }
  return items.sort((a, b) => (a.at?.getTime() ?? 0) - (b.at?.getTime() ?? 0));
}
