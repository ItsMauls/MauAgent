"use client";

import { useState } from "react";
import { MODES, MODE_LABEL, targetSummary, zonedToIso, type PublishTarget } from "@/lib/publish";

export type TargetAccount = { id: string; platform: string; handle: string; isDefaultForPlatform: boolean };
export type TargetOptions = {
  accounts: TargetAccount[];
  captions: Record<string, string>; // platform → caption from the approval package
  hashtags: string[];
  platforms: string[]; // platforms in the brief: their default channels start selected
  timezone: string;
};

/** State for the target picker: which channels, how (mode / time), and the caption per platform. */
export function usePublishTargets(o: TargetOptions) {
  const [picked, setPicked] = useState<string[]>(() => o.accounts.filter((a) => a.isDefaultForPlatform && o.platforms.includes(a.platform)).map((a) => a.id));
  const [mode, setMode] = useState<(typeof MODES)[number]>("queue");
  const [due, setDue] = useState("");
  const [captions, setCaptions] = useState(o.captions);
  const [tags, setTags] = useState(o.hashtags.join(" "));
  const [confirmNow, setConfirmNow] = useState(false);

  const chosen = o.accounts.filter((a) => picked.includes(a.id));
  const hashtags = tags.split(/[\s,]+/).filter(Boolean).map((h) => h.replace(/^#/, ""));
  const targets: PublishTarget[] = chosen.map((a) => ({
    accountId: a.id, mode, caption: captions[a.platform] ?? "", hashtags,
    ...(mode === "scheduled" && due ? { dueAt: zonedToIso(due, o.timezone) } : {}),
  }));
  const label = (a: TargetAccount) => ({ platform: a.platform[0].toUpperCase() + a.platform.slice(1), handle: a.handle });
  const summary = targetSummary(chosen.map(label), mode, due);
  const ready = !chosen.length || ((mode !== "scheduled" || !!due) && (mode !== "now" || confirmNow));
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  return { o, picked, toggle, mode, setMode, due, setDue, captions, setCaptions, tags, setTags, confirmNow, setConfirmNow, chosen, targets, summary, ready };
}
export type PublishTargetsState = ReturnType<typeof usePublishTargets>;

const PILL = "pill border-line bg-white px-4 py-2 text-ink-2 peer-checked:border-brand peer-checked:bg-brand-soft peer-checked:text-brand peer-focus-visible:ring-2 peer-focus-visible:ring-brand";

export function PublishTargetsPanel({ s }: { s: PublishTargetsState }) {
  const platforms = [...new Set(s.chosen.map((a) => a.platform))];
  return (
    <div className="space-y-4">
      <fieldset>
        <legend className="label">Publish to</legend>
        <div className="flex flex-wrap gap-2">
          {s.o.accounts.map((a) => (
            <label key={a.id} className="cursor-pointer">
              <input type="checkbox" checked={s.picked.includes(a.id)} onChange={() => s.toggle(a.id)} className="peer sr-only" />
              <span className={PILL}>{a.platform} @{a.handle}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {s.chosen.length > 0 && (
        <>
          <fieldset>
            <legend className="label">How</legend>
            <div className="flex flex-wrap items-center gap-2">
              {MODES.map((m) => (
                <label key={m} className="cursor-pointer">
                  <input type="radio" name="publish-mode" checked={s.mode === m} onChange={() => s.setMode(m)} className="peer sr-only" />
                  <span className={PILL}>{MODE_LABEL[m]}</span>
                </label>
              ))}
              {s.mode === "scheduled" && (
                <label className="flex items-center gap-2 text-sm">
                  <input type="datetime-local" value={s.due} onChange={(e) => s.setDue(e.target.value)} required className="input w-auto" />
                  <span className="text-ink-2">{s.o.timezone}</span>
                </label>
              )}
            </div>
          </fieldset>
          {platforms.map((p) => (
            <label key={p} className="block">
              <span className="label">Caption · {p}</span>
              <textarea value={s.captions[p] ?? ""} onChange={(e) => s.setCaptions({ ...s.captions, [p]: e.target.value })} rows={3} maxLength={2200} className="input" />
            </label>
          ))}
          <label className="block">
            <span className="label">Hashtags (space separated)</span>
            <input value={s.tags} onChange={(e) => s.setTags(e.target.value)} className="input" />
          </label>
          {s.mode === "now" && (
            <label className="flex items-center gap-2 text-sm font-medium text-red-800">
              <input type="checkbox" checked={s.confirmNow} onChange={(e) => s.setConfirmNow(e.target.checked)} />
              I understand this posts to the live accounts right away.
            </label>
          )}
        </>
      )}
      <p role="status" className="rounded-xl bg-white p-3 text-sm font-semibold">{s.summary}</p>
    </div>
  );
}
