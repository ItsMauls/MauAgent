"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { FEATURES } from "./boards/feature/features";
import type { AgentState } from "@/lib/boards/status";

type Item = { href: string; label: string; icon: string; children?: Item[] };

const feat = (keep: (f: (typeof FEATURES)[number]) => boolean): Item[] => FEATURES.filter(keep).map((f) => ({ href: `/boards/feature/${f.slug}`, label: f.label, icon: f.icon }));

// Items are added in the stage that builds their page (no links to pages that don't exist yet). Boards is the home page.
const items: Item[] = [
  {
    href: "/boards",
    label: "Boards",
    icon: "dashboard",
    children: [{ href: "/boards/roles", label: "Agent Roles", icon: "account_tree" }, ...feat((f) => f.slug === "library")],
  },
  {
    href: "/campaigns",
    label: "Campaigns",
    icon: "grid_view",
    children: [
      { href: "/approval", label: "Approval", icon: "fact_check" },
      ...feat((f) => f.slug !== "library"),
    ],
  },
  { href: "/brief", label: "Briefs", icon: "auto_awesome" },
  { href: "/trends", label: "Trends", icon: "trending_up" },
  { href: "/analytics", label: "Analytics", icon: "monitoring" },
  { href: "/connections", label: "Connections", icon: "hub" },
];

export type RoleBadge = { state: AgentState; active: number };
const DOT: Record<AgentState, string> = { busy: "bg-ok", waiting: "bg-amber-400", idle: "bg-ink-3" };
// Accounts, Settings and Log out live in the account menu in the top bar (layout.tsx).

export function NavLinks({ approvalCount, roles = {}, connectionAlert = false }: { approvalCount: number; roles?: Record<string, RoleBadge>; connectionAlert?: boolean }) {
  const path = usePathname();
  const isActive = (href: string) =>
    href === "/campaigns" ? path === "/campaigns" || path.startsWith("/campaigns/")
      : href === "/boards" ? path === "/boards"
        : path.startsWith(href);
  const inSection = (i: Item) => isActive(i.href) || !!i.children?.some((c) => isActive(c.href));

  // Submenus stay closed until their menu is clicked; the section you are in opens on navigation.
  const [open, setOpen] = useState<string | null>(() => items.find(inSection)?.href ?? null);
  useEffect(() => {
    const current = items.find(inSection);
    if (current?.children) setOpen(current.href);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  const link = (i: Item, child = false) => {
    const active = isActive(i.href);
    const badge = roles[i.href.replace("/boards/", "")];
    const expanded = open === i.href;
    return (
      <Link
        key={i.href}
        href={i.href}
        aria-current={active ? "page" : undefined}
        aria-expanded={i.children ? expanded : undefined}
        onClick={() => i.children && setOpen(expanded && active ? null : i.href)}
        className={`flex items-center gap-3 rounded-full px-4 text-sm font-semibold transition ${child ? "py-2.5" : "py-3"} ${
          active ? "bg-brand text-white shadow-sm" : "text-ink-2 hover:bg-brand-soft hover:text-ink"
        }`}
      >
        <span className="material-symbols-outlined">{i.icon}</span>
        <span className="truncate">{i.label}</span>
        {badge && (
          <span className="ml-auto flex items-center gap-1.5" aria-label={`${badge.state}, ${badge.active} active`}>
            {badge.active > 0 && <span className={`text-[11px] font-bold ${active ? "text-white" : "text-ink-2"}`}>{badge.active}</span>}
            <span className={`h-2 w-2 rounded-full ${DOT[badge.state]}`} />
          </span>
        )}
        {i.href === "/connections" && connectionAlert && <span role="img" aria-label="A connection needs attention" className="ml-auto h-2.5 w-2.5 rounded-full bg-amber-400" />}
        {i.href === "/approval" && approvalCount > 0 && (
          <span aria-label={`${approvalCount} waiting`} className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-bold ${active ? "bg-white text-brand" : "bg-amber-soft text-amber-800"}`}>
            {approvalCount}
          </span>
        )}
        {i.children && (
          <span className={`material-symbols-outlined ml-auto !text-[18px] transition-transform ${expanded ? "rotate-180" : ""}`} aria-hidden>
            expand_more
          </span>
        )}
      </Link>
    );
  };

  return (
    <nav aria-label="Main" className="flex flex-col gap-1.5">
      {items.map((i) => (
        <div key={i.href} className="flex flex-col gap-1">
          {link(i)}
          {i.children && open === i.href && (
            <div className="ml-6 flex flex-col gap-1 border-l border-line pl-2">{i.children.map((c) => link(c, true))}</div>
          )}
        </div>
      ))}
    </nav>
  );
}
