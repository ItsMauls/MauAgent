import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { NavLinks } from "./nav";
import { db } from "@/lib/db";
import { auth0 } from "@/lib/auth0";
import { QUEUE_STATUSES, StatusPill } from "./pills";
import { boardSnapshot, roleBadges } from "@/lib/boards/snapshot";

const jakarta = Plus_Jakarta_Sans({ variable: "--font-jakarta", subsets: ["latin"], weight: ["400", "500", "600", "700"] });

export const metadata: Metadata = {
  title: "MauAgent",
  description: "Multi-agent AI creative agency",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const [approvalCount, alerts, session, snapshot] = await Promise.all([
    db.campaign.count({ where: { status: { in: [...QUEUE_STATUSES] } } }),
    // Notifications = campaigns that need the user right now (queue + permanent failures).
    db.campaign.findMany({
      where: { status: { in: [...QUEUE_STATUSES, "FAILED"] } },
      orderBy: { createdAt: "desc" },
      take: 6,
      select: { id: true, status: true, clientBrief: true },
    }),
    auth0.getSession(),
    // Sidebar status dots must never break the shell.
    boardSnapshot().catch(() => null),
  ]);
  const user = session?.user;
  return (
    <html lang="en">
      <head>
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap" />
      </head>
      <body className={`${jakarta.variable} antialiased`}>
        <aside className="fixed left-0 top-0 z-50 flex h-screen w-60 flex-col justify-between gap-4 overflow-y-auto border-r border-line bg-white p-5 shadow-card max-md:hidden">
          <div className="space-y-6">
            <Link href="/" className="flex items-center gap-2 px-1">
              <span className="material-symbols-outlined text-brand">auto_awesome</span>
              <span className="text-lg font-bold tracking-tight">MauAgent</span>
              <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-brand">AI OS</span>
            </Link>
            <NavLinks approvalCount={approvalCount} roles={snapshot ? roleBadges(snapshot) : undefined} />
          </div>
        </aside>
        <div className="md:pl-60">
          <header className="sticky top-0 z-40 flex h-16 items-center justify-between gap-4 bg-canvas/80 px-6 backdrop-blur-xl md:px-8">
            <form action="/" role="search" className="relative min-w-0 flex-1">
              <span className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3">search</span>
              <input name="q" type="search" aria-label="Search campaigns" placeholder="Search campaigns…" className="input rounded-full pl-10" />
            </form>
            <div className="flex items-center gap-3">
              <Link href="/brief" className="btn-primary shadow-[0_4px_14px_rgba(37,99,235,0.3)]">
                <span className="material-symbols-outlined">add</span><span className="max-sm:hidden">New Brief</span>
              </Link>
              <details className="relative">
                <summary aria-label={`Notifications (${alerts.length})`} className="relative flex h-10 w-10 cursor-pointer list-none items-center justify-center rounded-full bg-white shadow-card hover:bg-brand-soft">
                  <span className="material-symbols-outlined">notifications</span>
                  {alerts.length > 0 && <span className="absolute right-2 top-2 h-2.5 w-2.5 rounded-full border-2 border-white bg-bad" />}
                </summary>
                <div className="card absolute right-0 mt-2 w-80 p-2">
                  <p className="px-3 py-2 text-[11px] font-bold uppercase tracking-[0.06em] text-ink-2">Needs your attention</p>
                  {!alerts.length && <p className="px-3 pb-3 text-sm text-ink-2">All caught up.</p>}
                  {alerts.map((a) => (
                    <Link key={a.id} href={`/campaigns/${a.id}`} className="flex items-center justify-between gap-2 rounded-2xl px-3 py-2 text-sm hover:bg-canvas">
                      <span className="truncate font-semibold">{(a.clientBrief as { product?: string }).product ?? "—"}</span>
                      <StatusPill status={a.status} />
                    </Link>
                  ))}
                </div>
              </details>
              <details className="relative">
                <summary aria-label="Account menu" className="flex cursor-pointer list-none items-center gap-2.5 rounded-full py-1 pl-1 pr-2 hover:bg-white">
                  {user?.picture ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={user.picture} alt="" className="h-10 w-10 rounded-full object-cover" />
                  ) : (
                    <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-soft text-xs font-bold text-brand">
                      {(user?.name ?? user?.email ?? "?").slice(0, 2).toUpperCase()}
                    </span>
                  )}
                  <span className="leading-tight max-sm:hidden">
                    <span className="block text-sm font-semibold">{user?.name ?? user?.email ?? "Account"}</span>
                    {user?.email && user.email !== user.name && <span className="block text-xs text-ink-2">{user.email}</span>}
                  </span>
                  <span className="material-symbols-outlined text-ink-3" aria-hidden>expand_more</span>
                </summary>
                <div className="card absolute right-0 mt-2 flex w-56 flex-col gap-1 p-2 text-sm font-semibold">
                  <Link href="/accounts" className="flex items-center gap-3 rounded-full px-4 py-2 text-ink-2 hover:bg-brand-soft hover:text-ink">
                    <span className="material-symbols-outlined">group</span>Social accounts
                  </Link>
                  <Link href="/settings" className="flex items-center gap-3 rounded-full px-4 py-2 text-ink-2 hover:bg-brand-soft hover:text-ink">
                    <span className="material-symbols-outlined">settings</span>Settings
                  </Link>
                  <a href="/auth/logout" className="flex items-center gap-3 rounded-full px-4 py-2 text-bad hover:bg-bad-soft">
                    <span className="material-symbols-outlined">logout</span>Log out
                  </a>
                </div>
              </details>
            </div>
          </header>
          <main className="mx-auto max-w-6xl px-6 pb-16 md:px-8">{children}</main>
        </div>
      </body>
    </html>
  );
}
