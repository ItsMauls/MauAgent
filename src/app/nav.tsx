"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Item = { href: string; label: string; icon: string };

// Items are added in the stage that builds their page (no links to pages that don't exist yet).
const groups: { title: string | null; items: Item[] }[] = [
  {
    title: "Operations",
    items: [
      { href: "/", label: "Campaigns", icon: "grid_view" },
      { href: "/brief", label: "New Brief", icon: "auto_awesome" },
      { href: "/approval", label: "Approval", icon: "fact_check" },
      { href: "/pipeline", label: "Pipeline", icon: "view_kanban" },
    ],
  },
  { title: "Social Media Specialist", items: [{ href: "/accounts", label: "Accounts", icon: "group" }] },
  { title: null, items: [{ href: "/settings", label: "Settings", icon: "settings" }] },
];

export function NavLinks({ approvalCount }: { approvalCount: number }) {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="flex flex-col gap-4">
      {groups.map((g, gi) => (
        <section key={gi} aria-labelledby={g.title ? `nav-group-${gi}` : undefined} className="flex flex-col gap-1">
          {g.title && (
            <h2 id={`nav-group-${gi}`} className="px-4 pb-1 text-[11px] font-bold uppercase tracking-[0.06em] text-ink-3">
              {g.title}
            </h2>
          )}
          {g.items.map((i) => {
            const active = i.href === "/" ? path === "/" || path.startsWith("/campaigns") : path.startsWith(i.href);
            return (
              <Link
                key={i.href}
                href={i.href}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-3 rounded-full px-4 py-2.5 text-sm font-semibold transition ${
                  active ? "bg-brand text-white shadow-sm" : "text-ink-2 hover:bg-brand-soft hover:text-ink"
                }`}
              >
                <span className="material-symbols-outlined">{i.icon}</span>
                {i.label}
                {i.href === "/approval" && approvalCount > 0 && (
                  <span aria-label={`${approvalCount} waiting`} className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-bold ${active ? "bg-white text-brand" : "bg-amber-soft text-amber-800"}`}>
                    {approvalCount}
                  </span>
                )}
              </Link>
            );
          })}
        </section>
      ))}
    </nav>
  );
}
