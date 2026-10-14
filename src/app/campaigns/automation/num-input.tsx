"use client";
import { useState } from "react";

/**
 * A number field you can clear and retype. It keeps what you type as text (so "" is allowed while editing) and reports
 * a number to the form only when the text is a valid one. On blur an empty or out-of-range value snaps back into
 * [min, max], so the form never holds a stale number behind an empty box.
 */
export function NumInput({ value, onChange, min = 0, max, step, className = "input", ...rest }: {
  value: number; onChange: (n: number) => void; min?: number; max?: number; step?: number; className?: string; disabled?: boolean; "aria-label"?: string;
}) {
  const [text, setText] = useState(String(value));
  // The form can set the value from outside (the AI assistant): show it. Typing reports the value first, so it is not reformatted.
  const [seen, setSeen] = useState(value);
  if (value !== seen) { setSeen(value); setText(String(value)); }
  const clamp = (n: number) => Math.min(max ?? Infinity, Math.max(min, n));
  return (
    <input
      {...rest} type="number" inputMode="decimal" className={className} min={min} max={max} step={step} value={text}
      onChange={(e) => {
        const t = e.target.value;
        setText(t);
        if (t !== "" && Number.isFinite(Number(t))) { setSeen(Number(t)); onChange(Number(t)); }
      }}
      onBlur={() => {
        const n = text === "" || !Number.isFinite(Number(text)) ? min : clamp(Number(text));
        setText(String(n));
        setSeen(n);
        onChange(n);
      }}
    />
  );
}
