"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/", label: "Campaigns", icon: "grid_view" },
  { href: "/brief", label: "New Brief", icon: "auto_awesome" },
  { href: "/settings", label: "Settings", icon: "settings" },
];

export function NavLinks() {
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
          </Link>
        );
      })}
    </nav>
  );
}
