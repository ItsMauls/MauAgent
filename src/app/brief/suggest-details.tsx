"use client";
import { useState, useTransition } from "react";
import { suggestBriefAction } from "../boards/actions";

/** Drafts the goal and audience details from the topic (and the picked chips) into the form's text boxes. */
export function SuggestDetails({ goalOptions, audienceOptions }: { goalOptions: string[]; audienceOptions: string[] }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  return (
    <span className="flex flex-wrap items-center justify-end gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={(e) => {
          const form = e.currentTarget.form;
          if (!form) return;
          const box = (name: string) => form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement | null;
          const picked = (name: string) => new FormData(form).getAll(name).map(String);
          setError("");
          start(async () => {
            const r = await suggestBriefAction({ topic: box("topic")?.value ?? "", brand: box("brand")?.value, goals: picked("goals"), audiences: picked("audiences"), goalOptions, audienceOptions });
            if ("error" in r) return setError(r.error ?? "Something went wrong");
            box("objective")!.value = r.objective;
            box("audience")!.value = r.audience;
            // Tick the suggested chips (picks the owner already made stay ticked).
            for (const [name, values] of [["goals", r.goals], ["audiences", r.audiences]] as const)
              form.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`).forEach((c) => { if (values.includes(c.value)) c.checked = true; });
          });
        }}
        className="pill border-brand/30 bg-brand-soft px-3 py-1.5 text-xs font-semibold text-brand hover:border-brand disabled:opacity-70"
      >
        <span className={`material-symbols-outlined !text-[16px] ${pending ? "animate-spin" : ""}`}>{pending ? "progress_activity" : "auto_awesome"}</span>
        {pending ? "Writing…" : "Fill goal & audience details from topic"}
      </button>
      {error && <span role="alert" className="order-first text-xs text-red-600">{error}</span>}
    </span>
  );
}
