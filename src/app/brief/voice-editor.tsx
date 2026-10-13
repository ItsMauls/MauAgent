"use client";
import { useActionState, useEffect, useState } from "react";
import { clearVoiceAction, saveVoiceAction } from "../boards/actions";

type State = { error?: string; savedAt?: number };

/** The editable writing voice: Save shows "Saving…", then a short "Saved" confirmation, or the error. */
export function VoiceEditor({ voice }: { voice: string }) {
  const [state, save, pending] = useActionState<State, FormData>(async (_, form) => {
    const r = await saveVoiceAction(form);
    return r.error ? { error: r.error } : { savedAt: Date.now() };
  }, {});
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!state.savedAt) return;
    setSaved(true);
    const t = setTimeout(() => setSaved(false), 2500);
    return () => clearTimeout(t);
  }, [state.savedAt]);

  return (
    <form action={save} className="space-y-2">
      <textarea name="voice" defaultValue={voice} rows={7} maxLength={1800} aria-label="Writing voice" className="input quiet-scroll text-xs" onChange={() => setSaved(false)} />
      <div className="grid grid-cols-2 gap-2">
        <button disabled={pending} className={`btn-soft justify-center transition-colors disabled:opacity-70 ${saved ? "!bg-emerald-100 !text-emerald-800" : ""}`}>
          <span className={`material-symbols-outlined ${pending ? "animate-spin" : saved ? "animate-bounce" : ""}`}>{pending ? "progress_activity" : saved ? "check_circle" : "save"}</span>
          {pending ? "Saving…" : saved ? "Saved" : "Save"}
        </button>
        <button formAction={clearVoiceAction} formNoValidate className="btn-soft justify-center"><span className="material-symbols-outlined">delete</span>Remove</button>
      </div>
      <p aria-live="polite" className={`text-xs ${state.error ? "text-red-600" : "text-emerald-700"}`}>
        {state.error ?? (saved ? "Writing voice saved." : "")}
      </p>
    </form>
  );
}
