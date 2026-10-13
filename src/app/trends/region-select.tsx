"use client";

import { useTransition } from "react";

/** Regional setting: saves the country on change. Data for the new region appears after the next sync. */
export function RegionSelect({ value, options, action }: { value: string; options: readonly (readonly [string, string])[]; action: (code: string) => Promise<unknown> }) {
  const [pending, start] = useTransition();
  return (
    <label className="inline-flex items-center gap-2 rounded-full border border-line bg-white px-3 py-1.5 text-sm text-ink-2">
      <span className="material-symbols-outlined !text-[18px] text-ink-3">public</span>
      <select
        value={value}
        disabled={pending}
        aria-label="Region"
        className="bg-transparent font-medium text-ink outline-none"
        onChange={(e) => start(() => void action(e.target.value))}
      >
        {options.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
      </select>
    </label>
  );
}
