import { Suspense } from "react";
import { isDay } from "@/lib/boards/agenda";
import { getSettings } from "../actions";
import { AutoRefresh } from "../ui";
import { AgendaCard, CardSkeleton, IntegrationsCard } from "./cards";
import { SessionsCard, TeamCard } from "./team";

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
    <div className="space-y-6 pt-4">
      <AutoRefresh seconds={10} />
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Boards</h1>
        <p className="mt-2 text-ink-2">The agency office today: who is working on what, live sessions, results and the archive.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <Suspense fallback={<CardSkeleton />}>
            <AgendaCard day={isDay(sp.day) ? sp.day : undefined} tz={timezone} qs={qs} />
          </Suspense>
        </div>
        <div className="lg:col-span-7">
          <Suspense fallback={<CardSkeleton />}>
            <IntegrationsCard />
          </Suspense>
        </div>
        <div className="lg:col-span-12">
          <Suspense fallback={<CardSkeleton />}>
            <TeamCard agent={sp.agent} qs={qs} />
          </Suspense>
        </div>
        <div className="lg:col-span-5">
          <Suspense fallback={<CardSkeleton />}>
            <SessionsCard session={sp.session} qs={qs} />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
