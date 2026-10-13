"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/** "Sync now": sends the sync, then refreshes the page every 5 s while a sync is running (or just requested). */
export function SyncButton({ action, syncing }: { action: () => Promise<unknown>; syncing: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [until, setUntil] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!syncing && Date.now() >= until) return;
    const t = setInterval(() => router.refresh(), 5000);
    const stop = !syncing ? setTimeout(() => clearInterval(t), Math.max(until - Date.now(), 0)) : undefined;
    return () => { clearInterval(t); clearTimeout(stop); };
  }, [syncing, until, router]);

  return (
    <span className="inline-flex flex-col items-end">
      <button
        type="button"
        disabled={pending || syncing}
        className="btn-primary px-3!"
        title="Sync now"
        aria-label="Sync now"
        onClick={() =>
          start(async () => {
            setError(null);
            try {
              await action();
              setUntil(Date.now() + 45_000);
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            }
          })
        }
      >
        <span className={`material-symbols-outlined ${pending || syncing ? "animate-spin" : ""}`}>sync</span>
      </button>
      {error && <span className="mt-1 text-xs text-bad">{error}</span>}
    </span>
  );
}
