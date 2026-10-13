import { createTextPosts } from "../boards/actions";
import { trendTopics } from "@/lib/content/trendTopics";
import { ContentTypes } from "./sources";
import { SuggestDetails } from "./suggest-details";
import { TrendBubbles } from "./trend-bubbles";

export const AUDIENCES = [
  "Gen Z (18–24)",
  "Millennials (25–40)",
  "Students",
  "Office workers",
  "Young parents / families",
  "Urban professionals",
  "Foodies & café hunters",
  "Deal / promo seekers",
  "Local neighborhood",
];

const POST_COUNTS = [3, 6, 10, 14, 20];

// Goals for account content, which is not always selling something.
const TEXT_GOALS = [
  "Engagement (replies, likes, reposts)",
  "Grow followers",
  "Start conversations / build a community",
  "Brand awareness",
  "Position as an expert / authority",
  "Entertain / go viral",
  "Drive traffic to a link",
  "Promote a product or offer",
];

const TEXT_PLATFORMS = [
  { v: "twitter", t: "X", icon: "tag" },
  { v: "threads", t: "Threads", icon: "alternate_email" },
];

/** The text-post brief: the form that makes the Socmed Specialist write a batch. Shown on /brief?mode=text and in the Publishing "New post" dialog. The writing voice and context files live in the sidebar (sources.tsx). */
export async function TextBrief() {
  const trends = await trendTopics();
  return (
        <div className="space-y-6">
        <form action={createTextPosts} className="card space-y-6 p-6 sm:p-8">
          <div>
            <Field label="Topic: what to post about" hint={<SuggestDetails goalOptions={TEXT_GOALS} audienceOptions={AUDIENCES} />}>
              <textarea name="topic" required rows={2} maxLength={500} placeholder="e.g. Nice hangout spots in Blok M, Jakarta" className="input" />
            </Field>
            <TrendBubbles topics={trends} />
          </div>
          <Field label="Account / brand (optional)" hint="Leave empty for a general account">
            <input name="brand" maxLength={200} placeholder="e.g. @mauai.edu" className="input" />
          </Field>
          <Chips label="Goals" hint="Pick one or more" name="goals" options={TEXT_GOALS} />
          <Field label="Goal details (optional)" hint="Tone, call to action, period">
            <textarea name="objective" rows={2} maxLength={800} placeholder="e.g. Ask people to reply with their own favourite spot" className="input" />
          </Field>
          <Chips label="Target audience" hint="Pick one or more" name="audiences" options={AUDIENCES} />
          <Field label="Audience details (optional)" hint="Habits, interests, where they hang out">
            <textarea name="audience" rows={2} maxLength={300} placeholder="e.g. Urban 20–32 y.o. who hunt aesthetic coffee spots" className="input" />
          </Field>
          <ContentTypes />
          <fieldset>
            <legend className="label">Target platforms</legend>
            <div className="flex flex-wrap gap-2">
              {TEXT_PLATFORMS.map((p) => (
                <label key={p.v} className="group pill cursor-pointer border-line bg-white px-4 py-2.5 text-sm text-ink-2 has-checked:border-brand has-checked:bg-brand has-checked:text-white has-focus-visible:ring-2 has-focus-visible:ring-brand/40">
                  <input type="checkbox" name="platforms" value={p.v} defaultChecked className="sr-only" />
                  <span className="material-symbols-outlined !text-[18px]">{p.icon}</span>{p.t}
                </label>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-ink-3">Limits: X 280 characters, Threads 500. Pick both and each post is kept inside the stricter one.</p>
          </fieldset>
          <fieldset>
            <legend className="label">How many posts</legend>
            <div className="flex flex-wrap gap-2">
              {POST_COUNTS.map((n) => (
                <label key={n} className="pill cursor-pointer border-line bg-white px-4 py-2.5 text-sm text-ink-2 has-checked:border-brand has-checked:bg-brand has-checked:text-white has-focus-visible:ring-2 has-focus-visible:ring-brand/40">
                  <input type="radio" name="count" value={n} defaultChecked={n === 6} required className="sr-only" />{n} posts
                </label>
              ))}
            </div>
          </fieldset>
          <div className="-mx-6 -mb-6 flex flex-col items-center justify-between gap-4 rounded-b-3xl bg-canvas/70 p-6 sm:-mx-8 sm:-mb-8 sm:flex-row sm:p-8">
            <p className="text-sm text-ink-2">Nothing is posted yet. You review and schedule on the next page.</p>
            <button className="btn-primary w-full px-8 py-3 sm:w-auto">
              <span className="material-symbols-outlined">edit_note</span>Write the posts
            </button>
          </div>
        </form>
        </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <span className="label mb-0">{label}</span>
        {hint && <span className="text-[11px] text-ink-3">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

export function Chips({ label, hint, name, options }: { label: string; hint: string; name: string; options: string[] }) {
  return (
    <fieldset>
      <legend className="mb-1.5 flex w-full items-center justify-between gap-2">
        <span className="label mb-0">{label}</span>
        <span className="text-[11px] text-ink-3">{hint}</span>
      </legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <label key={o} className="group pill cursor-pointer border-line bg-white px-3.5 py-2 text-ink-2 hover:border-brand/40 has-checked:border-brand has-checked:bg-brand-soft has-checked:text-brand has-focus-visible:ring-2 has-focus-visible:ring-brand/40">
            <input type="checkbox" name={name} value={o} className="sr-only" />
            <span className="material-symbols-outlined hidden !text-[14px] group-has-checked:inline">check</span>
            {o}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
