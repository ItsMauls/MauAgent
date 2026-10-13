"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

/** Button that opens a native <dialog> (focus trap, Esc and backdrop come from the platform). Children are server-rendered. */
export function Modal({ trigger, className, label, title, onToggle, children }: { trigger: ReactNode; className?: string; label?: string; title: string; onToggle?: (open: boolean) => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button type="button" aria-label={label} onClick={() => { ref.current?.showModal(); onToggle?.(true); }} className={className}>{trigger}</button>
      <dialog
        ref={ref}
        aria-label={title}
        onClose={() => onToggle?.(false)}
        onClick={(e) => e.target === ref.current && ref.current.close()}
        className="m-auto max-h-[85vh] w-[min(92vw,44rem)] overflow-hidden rounded-3xl border border-line bg-white p-0 text-ink shadow-float backdrop:bg-ink/40 open:flex open:flex-col"
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line bg-white px-6 py-4">
          <h2 className="truncate text-lg font-bold">{title}</h2>
          <button type="button" aria-label="Close" onClick={() => ref.current?.close()} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-canvas hover:bg-brand-soft">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <div className="quiet-scroll min-h-0 flex-1 space-y-4 overflow-y-auto p-6">{children}</div>
      </dialog>
    </>
  );
}

/** Dialog that is open on mount and returns to `closeHref` when dismissed (Esc, backdrop or X). Children are server-rendered. */
export function RouteDialog({ title, closeHref, children }: { title: string; closeHref: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label={title}
      onClose={() => router.replace(closeHref, { scroll: false })}
      onClick={(e) => e.target === ref.current && ref.current.close()}
      className="m-auto h-[88vh] w-[min(94vw,64rem)] overflow-hidden rounded-3xl border border-line bg-canvas p-0 text-ink shadow-float backdrop:bg-ink/40 open:flex open:flex-col"
    >
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line bg-white px-6 py-4">
        <h2 className="truncate text-lg font-bold">{title}</h2>
        <button type="button" aria-label="Close" onClick={() => ref.current?.close()} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-canvas hover:bg-brand-soft">
          <span className="material-symbols-outlined">close</span>
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col p-6">{children}</div>
    </dialog>
  );
}

/** Row of circles; the picked one shows its panel underneath. */
export function CircleSelect({ items }: { items: { key: string; label: string; circle: ReactNode; panel: ReactNode }[] }) {
  const [sel, setSel] = useState(items[0]?.key);
  const cur = items.find((i) => i.key === sel) ?? items[0];
  if (!cur) return null;
  return (
    <div>
      <ul className="flex flex-wrap gap-3">
        {items.map((i) => (
          <li key={i.key}>
            <button type="button" aria-pressed={i.key === cur.key} onClick={() => setSel(i.key)} className="group flex w-20 flex-col items-center gap-1.5 text-center">
              {i.circle}
              <span className="w-full truncate text-xs font-semibold text-ink-2 group-aria-pressed:text-brand">{i.label}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-4">{cur.panel}</div>
    </div>
  );
}

type Slide = { key: string; title: string; body: ReactNode; detail: ReactNode };

/** Sessions carousel: auto-advances, pauses on hover/focus or while the modal is open, dots to jump. One slide = no slider UI. */
export function SessionSlider({ slides, shared, ms = 6000 }: { slides: Slide[]; shared: ReactNode; ms?: number }) {
  const [i, setI] = useState(0);
  const [hold, setHold] = useState(false);
  const [open, setOpen] = useState(false);
  const n = slides.length;
  const idx = Math.min(i, n - 1);

  useEffect(() => {
    if (n < 2 || hold || open || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => setI((x) => (x + 1) % n), ms);
    return () => clearInterval(t);
  }, [n, hold, open, ms]);

  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-3"
      onMouseEnter={() => setHold(true)}
      onMouseLeave={() => setHold(false)}
      onFocus={() => setHold(true)}
      onBlur={() => setHold(false)}
    >
      <div className="overflow-hidden">
        <div className="flex transition-transform duration-500 motion-reduce:transition-none" style={{ transform: `translateX(-${idx * 100}%)` }}>
          {slides.map((s, k) => (
            <div key={s.key} aria-hidden={k !== idx} inert={k !== idx} className="w-full shrink-0">{s.body}</div>
          ))}
        </div>
      </div>

      {n > 1 && (
        <div role="group" aria-label="Choose session" className="flex justify-center gap-1.5">
          {slides.map((s, k) => (
            <button key={s.key} type="button" aria-label={s.title} aria-current={k === idx} onClick={() => setI(k)}
              className={`h-2 rounded-full transition-all ${k === idx ? "w-6 bg-brand" : "w-2 bg-line hover:bg-ink-3"}`} />
          ))}
        </div>
      )}

      <Modal
        title={`${slides[idx].title} · session`}
        onToggle={setOpen}
        className="btn-primary mt-auto w-full py-3.5 text-base"
        trigger={<>Join Now<span className="material-symbols-outlined">videocam</span></>}
      >
        {slides[idx].detail}
        {shared}
      </Modal>
    </div>
  );
}
