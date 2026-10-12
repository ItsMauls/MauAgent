import { Suspense } from "react";
import { isDay } from "@/lib/boards/agenda";
import { getSettings } from "../actions";
import { AutoRefresh } from "../ui";
import { AgendaCard, CardSkeleton } from "./cards";
import { SessionsCard } from "./team";
import { ArchiveCard } from "./archive";

export const dynamic = "force-dynamic";

type Search = Record<string, string | undefined>;

export default async function BoardsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const { timezone } = await getSettings();
  // Link builder that keeps the other cards' params (day, filters, pages) when one card changes its own.
  const qs = (p: Search) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ...p })) if (v) u.set(k, v);
    const s = u.toString();
    return s ? `/boards?${s}` : "/boards";
  };

  return (
    <div className="flex flex-col gap-3 pt-2">
      <AutoRefresh seconds={10} quiet />
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h1 className="text-2xl font-bold tracking-tight">Boards</h1>
        <p className="text-sm text-ink-2">The agency office today: live sessions, results and the archive.</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <Suspense fallback={<CardSkeleton className="h-full" />}>
            <AgendaCard day={isDay(sp.day) ? sp.day : undefined} tz={timezone} qs={qs} />
          </Suspense>
        </div>
        <div className="lg:col-span-7">
          <Suspense fallback={<CardSkeleton className="h-full" />}>
            <SessionsCard />
          </Suspense>
        </div>
      </div>
      {/* Fixed height: a little page scroll is fine, the archive scrolls inside itself beyond that. */}
      <div className="lg:h-[36rem]">
        <Suspense fallback={<CardSkeleton className="h-full" />}>
          <ArchiveCard q={sp.q?.trim() || undefined} agent={sp.agent} sp={sp} qs={qs} />
        </Suspense>
      </div>
    </div>
  );
}
