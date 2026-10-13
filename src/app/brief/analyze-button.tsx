"use client";

import { useFormStatus } from "react-dom";

/** Submit button of a form whose server action takes a while (reading files, an AI call): spins while it runs. */
export function AnalyzeButton({ label, pendingLabel = "Analyzing…", icon = "auto_awesome", className = "btn-primary" }: { label: string; pendingLabel?: string; icon?: string; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <button disabled={pending} className={`${className} disabled:opacity-70`}>
      <span className={`material-symbols-outlined ${pending ? "animate-spin" : ""}`}>{pending ? "progress_activity" : icon}</span>
      {pending ? pendingLabel : label}
    </button>
  );
}
