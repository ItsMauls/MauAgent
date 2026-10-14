import Link from "next/link";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { MODE_LABEL, NO_TARGET_NOTE, fmtZoned } from "@/lib/publish";
import { RetryPublishButton } from "../../ui";

const STATUS = { draft: "Waiting", scheduled: "Scheduled in Buffer", publishing: "Sending", published: "Sent", failed: "Failed" } as const;

/** Per-channel publish status. Failed channels never hide the others; Retry makes a new attempt when Buffer never accepted the post. */
export async function PublicationTab({ campaignId, status }: { campaignId: string; status: string }) {
  const [jobs, settings] = await Promise.all([
    db.publishJob.findMany({ where: { campaignId }, orderBy: [{ createdAt: "desc" }], select: { id: true, platform: true, status: true, mode: true, attempt: true, scheduledAt: true, postId: true, error: true, permalink: true, socialAccount: { select: { handle: true } } } }),
    getSettings(),
  ]);
  if (!jobs.length)
    return (
      <p className="rounded-2xl bg-canvas p-6 text-sm text-ink-2">
        {status === "APPROVED" ? NO_TARGET_NOTE : "Nothing published yet."}{" "}
        {status === "APPROVED" && <Link href="/boards/feature/publishing" className="font-semibold text-brand">Schedule & publishing →</Link>}
      </p>
    );
  return (
    <ul className="space-y-3">
      {jobs.map((j) => (
        <li key={j.id} className="flex flex-wrap items-center gap-3 rounded-2xl bg-canvas p-4 text-sm">
          <span className="font-semibold">{j.platform} @{j.socialAccount.handle}</span>
          <span className={`pill ${j.status === "failed" ? "border-red-200 bg-bad-soft text-red-800" : j.status === "published" ? "border-emerald-200 bg-ok-soft text-emerald-800" : "border-line bg-white text-ink-2"}`}>{STATUS[j.status]}</span>
          <span className="text-ink-2">{MODE_LABEL[j.mode]}{j.scheduledAt ? ` · ${fmtZoned(j.scheduledAt, settings.timezone)}` : ""}{j.attempt > 1 ? ` · attempt ${j.attempt}` : ""}</span>
          {j.permalink && <a href={j.permalink} target="_blank" rel="noreferrer" className="font-semibold text-brand">Open post</a>}
          {j.status === "failed" && !j.postId && j.error !== "Cancelled" && <RetryPublishButton jobId={j.id} />}
          {j.error && <p className="basis-full text-red-700">{j.error}</p>}
        </li>
      ))}
    </ul>
  );
}
