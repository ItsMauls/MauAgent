import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { NavLinks } from "./nav";
import { db } from "@/lib/db";
import { QUEUE_STATUSES } from "./pills";

const jakarta = Plus_Jakarta_Sans({ variable: "--font-jakarta", subsets: ["latin"], weight: ["400", "500", "600", "700"] });

export const metadata: Metadata = {
  title: "MauAgent",
  description: "Multi-agent AI creative agency",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const approvalCount = await db.campaign.count({ where: { status: { in: [...QUEUE_STATUSES] } } });
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
            <NavLinks approvalCount={approvalCount} />
          </div>
          <a href="/auth/logout" className="flex items-center gap-3 rounded-full px-4 py-2 text-sm font-semibold text-bad transition hover:bg-bad-soft">
            <span className="material-symbols-outlined">logout</span>Log out
          </a>
        </aside>
        <div className="md:pl-60">
          <header className="sticky top-0 z-40 flex h-16 items-center justify-between gap-4 bg-canvas/80 px-6 backdrop-blur-xl md:px-8">
            <span className="text-sm font-semibold text-ink-2 md:hidden">MauAgent</span>
            <span className="max-md:hidden" />
            <Link href="/brief" className="btn-primary shadow-[0_4px_14px_rgba(37,99,235,0.3)]">
              <span className="material-symbols-outlined">add</span>New Brief
            </Link>
          </header>
          <main className="mx-auto max-w-6xl px-6 pb-16 md:px-8">{children}</main>
        </div>
      </body>
    </html>
  );
}
