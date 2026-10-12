import Link from "next/link";
import { notFound } from "next/navigation";
import { ROLES } from "@/lib/boards/roles";
import { CreatorLibrary } from "../../library";
import { ArtifactsPanel, ResultsPanel, Schedule } from "../../workspace";
import { AutoRefresh } from "../../../ui";
import { FEATURES } from "../features";

export const dynamic = "force-dynamic";

type Search = Record<string, string | undefined>;

export default async function FeaturePage({ params, searchParams }: { params: Promise<{ feature: string }>; searchParams: Promise<Search> }) {
  const [{ feature }, sp] = await Promise.all([params, searchParams]);
  const f = FEATURES.find((x) => x.slug === feature);
  if (!f) notFound();

  // Role-specific features share one page: a pill row picks which agent's data to show.
  const roles = f.perRole ? ROLES : [];
  const role = roles.find((r) => r.slug === sp.role) ?? roles[0];

  return (
    <div className="space-y-6 pt-4">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">{f.label}</h1>
        <p className="text-sm text-ink-2">{f.blurb}</p>
      </header>

      {roles.length > 0 && (
        <nav aria-label="Agent" className="flex flex-wrap gap-2">
          {roles.map((r) => (
            <Link
              key={r.slug}
              href={`/boards/feature/${feature}?role=${r.slug}`}
              aria-current={r === role ? "page" : undefined}
              className={`rounded-full px-4 py-2 text-sm font-semibold transition ${r === role ? "bg-brand text-white" : "bg-white text-ink-2 hover:bg-brand-soft"}`}
            >
              {r.label}
            </Link>
          ))}
        </nav>
      )}

      <section className={feature === "library" ? "" : "card p-6"}>
        {feature === "artifacts" && role && <><ArtifactsPanel role={role} q={sp.q?.trim() || undefined} a={sp.a} b={sp.b} /><div className="mt-8 border-t border-line pt-6"><ResultsPanel role={role} /></div></>}
        {feature === "publishing" && <Schedule />}
        {feature === "library" && <><AutoRefresh seconds={10} quiet /><CreatorLibrary intro={false} /></>}
      </section>
    </div>
  );
}
