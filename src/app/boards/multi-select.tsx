"use client";

import { useState } from "react";

/** Dropdown with checkboxes. Submits one `name` value per ticked option (read with FormData.getAll). */
export function MultiSelect({ name, label, options }: { name: string; label: string; options: readonly string[] }) {
  const [picked, setPicked] = useState<string[]>([]);
  return (
    <details className="relative">
      <summary className="input flex cursor-pointer list-none items-center justify-between gap-2">
        <span className={`truncate ${picked.length ? "" : "text-ink-3"}`}>{picked.length ? picked.join(", ") : `Select ${label.toLowerCase()}…`}</span>
        <span className="material-symbols-outlined !text-[18px] text-ink-3" aria-hidden>expand_more</span>
      </summary>
      <div className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-2xl border border-line bg-white p-2 shadow-lg">
        {options.map((o) => (
          <label key={o} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-xs hover:bg-brand-soft">
            <input
              type="checkbox"
              name={name}
              value={o}
              onChange={(e) => setPicked((p) => (e.target.checked ? [...p, o] : p.filter((x) => x !== o)))}
            />
            {o}
          </label>
        ))}
      </div>
    </details>
  );
}
