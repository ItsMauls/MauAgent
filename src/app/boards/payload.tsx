import type { ReactNode } from "react";

const title = (k: string) => k.replace(/([A-Z])/g, " $1").replace(/[_-]+/g, " ").replace(/^./, (c) => c.toUpperCase());
const scalar = (v: unknown): v is string | number | boolean | null => v === null || typeof v !== "object";

function Value({ v, depth }: { v: unknown; depth: number }): ReactNode {
  if (v === null || v === undefined || v === "") return <span className="text-ink-3">-</span>;
  if (typeof v === "boolean") return <span className="pill border-line bg-white !py-0.5">{v ? "yes" : "no"}</span>;
  if (scalar(v)) return <span className="whitespace-pre-wrap break-words">{String(v)}</span>;
  if (Array.isArray(v)) {
    if (!v.length) return <span className="text-ink-3">-</span>;
    if (v.every(scalar))
      return <div className="flex flex-wrap gap-1.5">{v.map((x, i) => <span key={i} className="rounded-full bg-white px-2.5 py-1 text-xs">{String(x)}</span>)}</div>;
    return (
      <ol className="space-y-2">
        {v.map((x, i) => (
          <li key={i} className="rounded-xl bg-white p-3"><span className="label !mb-1">#{i + 1}</span><Value v={x} depth={depth + 1} /></li>
        ))}
      </ol>
    );
  }
  const entries = Object.entries(v as Record<string, unknown>);
  if (!entries.length) return <span className="text-ink-3">-</span>;
  return (
    <dl className={depth ? "space-y-2" : "space-y-3"}>
      {entries.map(([k, x]) => (
        <div key={k}>
          <dt className="label !mb-0.5">{title(k)}</dt>
          <dd className="text-sm text-ink"><Value v={x} depth={depth + 1} /></dd>
        </div>
      ))}
    </dl>
  );
}

/** Agent output as readable labelled fields; the raw JSON stays one click away. */
export function PayloadView({ payload }: { payload: unknown }) {
  return (
    <div className="space-y-3">
      <div className="rounded-2xl bg-canvas p-4"><Value v={payload} depth={0} /></div>
      <details>
        <summary className="cursor-pointer text-xs font-semibold text-ink-2">Raw JSON</summary>
        <pre className="mt-2 max-h-80 overflow-auto rounded-xl bg-canvas p-3 text-xs">{JSON.stringify(payload, null, 2)}</pre>
      </details>
    </div>
  );
}
