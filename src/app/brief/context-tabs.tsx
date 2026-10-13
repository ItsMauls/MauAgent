"use client";

import { useState, type ReactNode } from "react";

/** Two or more panels behind small tabs. Panels are server-rendered; hidden ones stay mounted so a half-filled form survives a tab switch. */
export function ContextTabs({ tabs }: { tabs: { key: string; label: string; badge?: ReactNode; panel: ReactNode }[] }) {
  const [sel, setSel] = useState(tabs[0].key);
  return (
    <div className="space-y-4">
      <div role="tablist" className="grid grid-cols-2 gap-1 rounded-xl bg-canvas p-1 text-sm font-semibold">
        {tabs.map((t) => (
          <button
            key={t.key} type="button" role="tab" id={`ctx-tab-${t.key}`} aria-selected={sel === t.key} aria-controls={`ctx-panel-${t.key}`}
            onClick={() => setSel(t.key)}
            className="flex items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-ink-2 aria-selected:bg-white aria-selected:text-brand aria-selected:shadow-sm focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            {t.label}{t.badge}
          </button>
        ))}
      </div>
      {tabs.map((t) => (
        <div key={t.key} role="tabpanel" id={`ctx-panel-${t.key}`} aria-labelledby={`ctx-tab-${t.key}`} hidden={sel !== t.key} className="space-y-4">
          {t.panel}
        </div>
      ))}
    </div>
  );
}
