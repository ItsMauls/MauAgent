import { db } from "@/lib/db";
import { contentSetup } from "@/lib/content/config";
import { ACCEPT, MAX_FILE_BYTES } from "@/lib/content/context";
import { addContextFiles, analyzeVoiceAction, clearVoiceAction, removeContextFile, saveVoiceAction } from "../boards/actions";
import { AnalyzeButton } from "./analyze-button";
import { ContextTabs } from "./context-tabs";

/** What the owner should know about a type before picking it. */
const NOTE: Record<string, { icon: string; text: string; warn?: boolean }> = {
  required: { icon: "fact_check", text: "AI names a source + confidence for you to check", warn: true },
  strict: { icon: "fact_check", text: "AI names a source, year + confidence to check", warn: true },
  story: { icon: "visibility", text: "Always reviewed before it can post", warn: true },
};

/**
 * Content-type picker in the text brief: same multi-pick as Goals and Audience, shown as cards. Types that state facts
 * say the owner will see the AI's source and confidence on the draft.
 */
export function ContentTypes({ weeklyThreadCap }: { weeklyThreadCap?: number }) {
  const { config } = contentSetup();
  const types = Object.entries(config.types).filter(([, c]) => c.weight > 0);
  return (
    <fieldset>
      <legend className="mb-1.5 flex w-full items-center justify-between gap-2">
        <span className="label mb-0">Content types</span>
        <span className="text-[11px] text-ink-3">Pick any, or none for a balanced mix</span>
      </legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {types.map(([key, c]) => {
          const note = NOTE[c.source] ?? (c.thread ? { icon: "event_repeat", text: `Max ${weeklyThreadCap ?? config.weeklyThreadCap} per week` } : null);
          return (
            <label
              key={key}
              className="group relative flex cursor-pointer items-start gap-3 rounded-2xl border border-line bg-white p-3 transition hover:border-brand/40 hover:shadow-sm has-checked:border-brand has-checked:bg-brand-soft/50 has-checked:ring-1 has-checked:ring-brand has-focus-visible:ring-2 has-focus-visible:ring-brand/40"
            >
              <input type="checkbox" name="types" value={key} className="sr-only" />
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-canvas text-ink-2 transition group-has-checked:bg-brand group-has-checked:text-white">
                <span className="material-symbols-outlined !text-[20px]">{c.icon}</span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-ink">{c.label}</span>
                <span className="block text-xs leading-snug text-ink-2">{c.blurb}</span>
              </span>
              {note && <span title={note.text} className="material-symbols-outlined !text-[20px] text-ink-3 group-has-checked:hidden">help</span>}
              <span className="material-symbols-outlined hidden !text-[20px] text-brand group-has-checked:inline">check_circle</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

const size = (b: number) => (b < 1024 ? `${b} B` : b < 1_048_576 ? `${Math.round(b / 1024)} KB` : `${(b / 1_048_576).toFixed(1)} MB`);

/**
 * Sidebar of the text brief, in two tabs so it stays compact: the context files (notes and pictures that give the AI a
 * picture of the account or topic) and the writing voice. Every batch reads both as background.
 */
export async function ContentContext({ writingVoice }: { writingVoice: string | null }) {
  const files = await db.contentFile.findMany({ orderBy: { createdAt: "desc" }, take: 40, select: { id: true, name: true, kind: true, sizeBytes: true, content: true } });
  return (
    <section id="material" className="card scroll-mt-24 space-y-4 p-5">
      <div>
        <h2 className="font-bold">Context for the AI</h2>
        <p className="text-xs text-ink-2">Background every batch reads to understand your account, topic and how you write.</p>
      </div>
      <ContextTabs
        tabs={[
          {
            key: "files", label: "Files", badge: files.length ? <span className="rounded-full bg-brand-soft px-1.5 text-[10px] text-brand">{files.length}</span> : null,
            panel: <FilesPanel files={files} />,
          },
          {
            key: "voice", label: "Writing voice", badge: <span className={`size-1.5 rounded-full ${writingVoice ? "bg-emerald-500" : "bg-line"}`} title={writingVoice ? "Active" : "Not set"} />,
            panel: <VoicePanel writingVoice={writingVoice} />,
          },
        ]}
      />
    </section>
  );
}

type FileRow = { id: string; name: string; kind: "text" | "image"; sizeBytes: number; content: string };

function FilesPanel({ files }: { files: FileRow[] }) {
  return (
    <>
      <form action={addContextFiles} className="space-y-2">
        <input
          type="file" name="files" multiple required accept={ACCEPT} aria-label="Context files"
          className="input text-sm file:mr-3 file:rounded-full file:border-0 file:bg-brand-soft file:px-3 file:py-1 file:text-xs file:font-semibold file:text-brand"
        />
        <p className="text-[11px] text-ink-3">
          Notes: .md .txt .csv .json .html. Pictures: .png .jpg .webp .gif, described once by AI. Up to {MAX_FILE_BYTES / 1_000_000} MB each. PDF and Word are not read yet.
        </p>
        <AnalyzeButton label="Add to context" pendingLabel="Reading files…" icon="upload_file" className="btn-soft w-full justify-center" />
      </form>

      {!files.length ? (
        <p className="text-xs text-ink-3">Nothing uploaded yet. Posts are written from the topic alone.</p>
      ) : (
        <ul className="quiet-scroll max-h-72 space-y-1.5 overflow-y-auto pr-1">
          {files.map((f) => (
            <li key={f.id} className="flex items-start gap-2.5 rounded-xl border border-line bg-white p-2.5 text-xs">
              <span className="material-symbols-outlined mt-0.5 !text-[18px] text-ink-3">{f.kind === "image" ? "image" : "description"}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-ink">{f.name}</p>
                <p className="line-clamp-2 text-ink-2">{f.content}</p>
                <p className="mt-0.5 text-ink-3">{f.kind === "image" ? "Picture" : "Note"} · {size(f.sizeBytes)}</p>
              </div>
              <form action={removeContextFile.bind(null, f.id)}>
                <button aria-label={`Remove ${f.name}`} title="Remove" className="grid size-6 place-items-center rounded-full text-ink-3 hover:bg-bad-soft hover:text-red-700">
                  <span className="material-symbols-outlined !text-[16px]">close</span>
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** The style guide the AI learned from the owner's own chats and posts; editable, and re-learnable from new files. */
function VoicePanel({ writingVoice }: { writingVoice: string | null }) {
  return (
    <>
      <p className="text-xs text-ink-2">
        {writingVoice
          ? "Every batch is written in this style. Edit it freely, or upload newer files to learn it again."
          : "Upload your chat exports or posts and the AI learns how you write. Optional: without it the posts follow the audience."}
      </p>
      {writingVoice && (
        <form action={saveVoiceAction} className="space-y-2">
          <textarea name="voice" defaultValue={writingVoice} rows={7} maxLength={1800} aria-label="Writing voice" className="input quiet-scroll text-xs" />
          <div className="grid grid-cols-2 gap-2">
            <button className="btn-soft justify-center"><span className="material-symbols-outlined">save</span>Save</button>
            <button formAction={clearVoiceAction} formNoValidate className="btn-soft justify-center"><span className="material-symbols-outlined">delete</span>Remove</button>
          </div>
        </form>
      )}
      <form action={analyzeVoiceAction} className="space-y-2">
        <input type="file" name="files" multiple required accept=".txt,.md,.js,.json,.csv" aria-label="Chats and posts" className="input text-sm file:mr-3 file:rounded-full file:border-0 file:bg-brand-soft file:px-3 file:py-1 file:text-xs file:font-semibold file:text-brand" />
        <p className="text-[11px] text-ink-3">WhatsApp export (.txt), Telegram export (result.json), X archive (tweets.js), or plain text and Markdown.</p>
        <AnalyzeButton label={writingVoice ? "Learn again" : "Analyze my writing"} className="btn-soft w-full justify-center" />
      </form>
    </>
  );
}
