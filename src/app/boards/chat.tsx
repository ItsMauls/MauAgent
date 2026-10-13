"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { chatWithAgent } from "./actions";

type Turn = { from: "owner" | "agent"; text: string };

/** Chat with one agent. The conversation lives in this component only; the server reads the persona and memory on every message. */
export function AgentChat({ slug, name, initials }: { slug: string; name: string; initials: string }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => end.current?.scrollIntoView({ block: "end" }), [turns, pending]);

  const send = () => {
    const t = text.trim();
    if (!t || pending) return;
    const next = [...turns, { from: "owner" as const, text: t }];
    setTurns(next);
    setText("");
    setError(null);
    start(async () => {
      try {
        const reply = await chatWithAgent(slug, next);
        setTurns([...next, { from: "agent", text: reply }]);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  };

  return (
    <div className="flex h-full min-h-80 flex-col gap-3">
      <div className="quiet-scroll min-h-0 flex-1 space-y-3 overflow-y-auto pr-1" aria-live="polite">
        {!turns.length && (
          <p className="py-10 text-center text-sm text-ink-2">
            Ask {name} anything within their expertise. Replies use their persona and what they remember from past campaigns.
          </p>
        )}
        {turns.map((m, i) => (
          <div key={i} className={`flex items-end gap-2 ${m.from === "owner" ? "flex-row-reverse" : ""}`}>
            {m.from === "agent" && <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-full bg-agent-soft text-xs font-bold text-violet-700">{initials}</span>}
            <p className={`max-w-[80%] whitespace-pre-wrap break-words rounded-2xl px-4 py-2.5 text-sm ${m.from === "owner" ? "rounded-br-md bg-brand text-white" : "rounded-bl-md bg-canvas"}`}>{m.text}</p>
          </div>
        ))}
        {pending && <p className="text-xs text-ink-3">{name} is typing…</p>}
        <div ref={end} />
      </div>
      {error && <p role="alert" className="shrink-0 rounded-xl bg-bad-soft p-2.5 text-xs text-red-800">{error}</p>}
      <form onSubmit={(e) => { e.preventDefault(); send(); }} className="flex shrink-0 items-end gap-2">
        <textarea
          value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={2000} placeholder={`Message ${name}…`} aria-label={`Message ${name}`}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          className="input min-w-0 flex-1 resize-none"
        />
        <button disabled={pending || !text.trim()} aria-label="Send" className="flex size-11 shrink-0 items-center justify-center rounded-full bg-brand text-white hover:bg-brand-dark disabled:opacity-50">
          <span className="material-symbols-outlined">send</span>
        </button>
      </form>
    </div>
  );
}
