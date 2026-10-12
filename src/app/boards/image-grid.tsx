"use client";

import { useState } from "react";

/** Grid of labelled upload slots (one file input per view) with local previews. Empty slots are ignored on submit. */
export function ImageGrid({ views }: { views: readonly string[] }) {
  const [previews, setPreviews] = useState<Record<string, string>>({});
  return (
    <div className="grid grid-cols-[repeat(auto-fill,6.5rem)] gap-2">
      {views.map((v) => (
        <label key={v} className="group/slot relative flex aspect-square cursor-pointer flex-col items-center justify-center overflow-hidden rounded-xl border border-dashed border-line bg-canvas text-center text-[11px] font-semibold text-ink-2 hover:border-brand has-focus-visible:ring-2 has-focus-visible:ring-brand/40">
          <input
            type="file"
            name={`img:${v}`}
            accept="image/*"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              setPreviews((p) => ({ ...p, [v]: f ? URL.createObjectURL(f) : "" }));
            }}
          />
          {previews[v] ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previews[v]} alt={v} className="absolute inset-0 h-full w-full object-cover" />
          ) : (
            <span className="material-symbols-outlined text-ink-3">add_photo_alternate</span>
          )}
          <span className={`${previews[v] ? "absolute inset-x-0 bottom-0 bg-black/60 py-0.5 text-white" : "mt-1"}`}>{v}</span>
        </label>
      ))}
    </div>
  );
}
