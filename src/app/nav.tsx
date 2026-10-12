"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/", label: "Campaigns", icon: "grid_view" },
  { href: "/brief", label: "New Brief", icon: "auto_awesome" },
  { href: "/approval", label: "Approval", icon: "fact_check" },
  { href: "/settings", label: "Settings", icon: "settings" },
];

export function NavLinks({ approvalCount }: { approvalCount: number }) {
  const path = usePathname();
  return (
    <nav className="flex flex-col gap-1">
      {items.map((i) => {
        const active = i.href === "/" ? path === "/" || path.startsWith("/campaigns") : path.startsWith(i.href);
        return (
          <Link
            key={i.href}
            href={i.href}
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
    </nav>
  );
}
