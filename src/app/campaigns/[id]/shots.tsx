import type { PromptPackage } from "@/lib/agents/schemas";
import { restoreShotAsset } from "../../actions";
import { CopyBlock, RestoreButton, UploadSlot } from "../../ui";
import { SourcePill } from "../../pills";

// Shot cards shared by the campaign detail tabs and the Content Creator execution queue on Boards.

export const Empty = ({ icon, text }: { icon: string; text: string }) => (
  <div className="py-10 text-center text-ink-2">
    <span className="material-symbols-outlined !text-[32px] text-ink-3">{icon}</span>
    <p className="mx-auto mt-2 max-w-md text-sm">{text}</p>
  </div>
);

export type ShotRow = {
  id: string; shotId: string; source: string; status: string; maxAttempts: number; promptPackage: unknown;
  assets: { id: string; version: number; origin: string; durationSec: number | null; hasAudio: boolean | null; validation: unknown; createdAt: Date }[];
};

export function ShotsTab({ shots }: { shots: ShotRow[] }) {
  if (!shots.length) return <Empty icon="movie" text="No shots yet. The Producer creates one slot per shot from the Art Director's shot list." />;
  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-2">Generate in this order. Each card is ready to copy into the Gemini/Seedance app.</p>
      {shots.map((s, i) => {
        const pkg = s.promptPackage as PromptPackage | null;
        return (
          <article key={s.id} className="rounded-2xl bg-canvas p-5">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand text-xs font-bold text-white">{i + 1}</span>
              <h3 className="font-semibold">{s.shotId}</h3>
              <SourcePill source={s.source} />
              <span className="pill border-line bg-white text-ink-2">{s.status}</span>
              {pkg && <span className="ml-auto text-xs text-ink-2">{pkg.durationSec}s</span>}
            </div>
            {pkg ? (
              <>
                <CopyBlock label="Final prompt" text={pkg.prompt} />
                <CopyBlock label="Dialogue / VO" text={pkg.vo} />
                <CopyBlock label="File name" text={pkg.fileName} />
                <CopyBlock label="Reference notes" text={pkg.referenceNotes} />
                <p className="mb-3 text-sm text-ink-2">{pkg.tips}</p>
                <CopyBlock
                  label="Whole card"
                  text={`${pkg.prompt}\n\nDialogue: ${pkg.vo}\n\nReferences: ${pkg.referenceNotes}\nFile name: ${pkg.fileName}\nOrder: ${i + 1} of ${shots.length}`}
                />
              </>
            ) : (
              <p className="text-sm text-ink-2">No prompt package for this shot.</p>
            )}
          </article>
        );
      })}
    </div>
  );
}

export function AssetsTab({ shots }: { shots: ShotRow[] }) {
  if (!shots.length) return <Empty icon="cloud_upload" text="No upload slots yet." />;
  return (
    <div className="space-y-4">
      {shots.map((s) => {
        const uploads = s.assets.filter((a) => a.origin === "upload").length;
        return (
          <article key={s.id} className="rounded-2xl bg-canvas p-5">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h3 className="font-semibold">{s.shotId}</h3>
              <SourcePill source={s.source} />
              <span className="pill border-line bg-white text-ink-2">{s.status}</span>
              <span className="ml-auto text-xs text-ink-2">Uploads {uploads}/{s.maxAttempts}</span>
            </div>
            {s.status !== "ready" && (s.source === "manual_upload" || s.status === "failed") && <UploadSlot shotDbId={s.id} />}
            {s.assets.length > 0 && (
              <table className="mt-3 w-full text-left text-sm">
                <caption className="sr-only">Version history for {s.shotId}</caption>
                <thead className="text-[11px] font-bold uppercase tracking-[0.06em] text-ink-2">
                  <tr><th className="py-2">Version</th><th>Origin</th><th>Duration</th><th>Audio</th><th>Validation</th><th /></tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {s.assets.map((a, i) => {
                    const v = a.validation as { ok?: boolean; errors?: string[]; restoredFrom?: number } | null;
                    return (
                      <tr key={a.id} className="align-top">
                        <td className="py-2">v{a.version}{i === 0 && " (latest)"}</td>
                        <td>{a.origin}{v?.restoredFrom ? ` · restored from v${v.restoredFrom}` : ""}</td>
                        <td>{a.durationSec?.toFixed(1) ?? "—"}s</td>
                        <td>{a.hasAudio == null ? "—" : a.hasAudio ? "yes" : "no"}</td>
                        <td className={v?.ok ? "text-emerald-700" : "text-red-700"}>{v?.ok ? "Passed" : v?.errors?.join(" ") || "Failed"}</td>
                        <td className="text-right">
                          {i > 0 && v?.ok && <RestoreButton label="Restore" action={restoreShotAsset.bind(null, a.id)} />}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </article>
        );
      })}
      <p className="text-xs text-ink-2">A restored clip is used the next time the final cut is rendered (e.g. after a post-production revision).</p>
    </div>
  );
}


/** Top-level keys whose value differs between two versions (cheap, readable diff). */
export function ChangedKeys({ a, b }: { a: unknown; b: unknown }) {
  const o1 = (a ?? {}) as Record<string, unknown>, o2 = (b ?? {}) as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(o1), ...Object.keys(o2)])].filter((k) => JSON.stringify(o1[k]) !== JSON.stringify(o2[k]));
  return <p className="mt-3 text-sm text-ink-2">Changed fields: {keys.length ? keys.join(", ") : "none"}</p>;
}

