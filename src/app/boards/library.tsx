import Link from "next/link";
import { db } from "@/lib/db";
import { deleteCreativeAsset, linkCreativeAsset, saveCreativeAsset } from "../actions";
import { ASSET_FIELDS, IMAGE_VIEWS, viewLabel } from "@/lib/creativeFields";
import { ImageGrid } from "./image-grid";
import { MultiSelect } from "./multi-select";
import { setTalentLock } from "./actions";

const KINDS = [
  { v: "character", t: "Characters", icon: "face", hint: "Who appears: look, outfit, age, personality. Reused word for word in every shot." },
  { v: "location", t: "Locations", icon: "location_on", hint: "Where it happens: place, time of day, props, atmosphere." },
  { v: "style", t: "Video styles", icon: "style", hint: "How it looks: 8-bit, 2D animation, live action, …" },
] as const;

const STYLE_PRESETS = [
  { name: "8-bit pixel art", description: "Retro 8-bit pixel art video game look, chunky pixels, limited 16-color palette, side-scrolling framing, chiptune energy" },
  { name: "2D animation", description: "Flat 2D cartoon animation, clean bold outlines, cel shading, smooth expressive character motion, bright saturated colors" },
  { name: "3D cartoon", description: "Stylized 3D animated film look, soft global illumination, rounded friendly shapes, playful exaggerated expressions" },
  { name: "Anime", description: "Japanese anime style, detailed backgrounds, dramatic lighting, expressive eyes, dynamic camera angles" },
  { name: "Claymation", description: "Stop-motion claymation look, handmade plasticine textures, visible fingerprints, slightly choppy frame rate" },
  { name: "Live action", description: "Photorealistic live-action footage, natural lighting, shallow depth of field, handheld social-media feel" },
];

type Kind = (typeof KINDS)[number]["v"];

// Literal class names (Tailwind can't see interpolated ones): show a kind's blocks only while its radio is checked.
const SHOW_GRID: Record<Kind, string> = {
  character: "hidden group-has-[input[value=character]:checked]:grid",
  location: "hidden group-has-[input[value=location]:checked]:grid",
  style: "hidden group-has-[input[value=style]:checked]:grid",
};
const SHOW_BLOCK: Record<Kind, string> = {
  character: "hidden group-has-[input[value=character]:checked]:block",
  location: "hidden group-has-[input[value=location]:checked]:block",
  style: "hidden group-has-[input[value=style]:checked]:block",
};

/** AI Content Creator library (was /creator). Content Creator shows every kind; Talent Manager only characters. */
export async function CreatorLibrary({ kinds = ["character", "location", "style"], intro = true }: { kinds?: Kind[]; intro?: boolean }) {
  const [assets, campaigns] = await Promise.all([
    db.creativeAsset.findMany({ where: { kind: { in: kinds } }, orderBy: { createdAt: "desc" }, include: { campaigns: { select: { id: true } } } }),
    db.campaign.findMany({ orderBy: { createdAt: "desc" }, select: { id: true, clientBrief: true, status: true } }),
  ]);
  const name = (c: (typeof campaigns)[number]) => (c.clientBrief as { product?: string }).product ?? c.id;
  const byId = new Map(campaigns.map((c) => [c.id, c]));
  const styleNames = new Set(assets.filter((a) => a.kind === "style").map((a) => a.name));
  const shown = KINDS.filter((k) => kinds.includes(k.v));

  return (
    <div className="space-y-4">
      {intro && <p className="max-w-3xl text-sm text-ink-2">
        Design characters, locations and video styles once, then link them to any upcoming or existing campaign. The Art Director must use the linked items in the shot list and generation prompts.
      </p>}

      <div className="card space-y-4 p-4">
        <form id="add-asset" action={saveCreativeAsset} className="group scroll-mt-24 space-y-2.5 text-xs [&_.input]:px-3 [&_.input]:py-1.5 [&_.input]:text-xs [&_.label]:mb-1 [&_.label]:text-[10px] [&_.btn-primary]:py-2">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-base font-bold"><span className="material-symbols-outlined text-brand">add_circle</span>Add to library</h2>
            <span className="rounded-full bg-canvas px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-ink-2">New</span>
          </div>
          <fieldset>
            <legend className="label">Type</legend>
            <div className="grid grid-cols-3 gap-2">
              {shown.map((k, i) => (
                <label key={k.v} className="pill cursor-pointer justify-center border-transparent bg-canvas px-2 py-1.5 text-ink-2 hover:bg-brand-soft has-checked:border-brand has-checked:bg-brand-soft has-checked:text-brand has-focus-visible:ring-2 has-focus-visible:ring-brand/40">
                  <input type="radio" name="kind" value={k.v} defaultChecked={i === 0} required className="sr-only" />
                  <span className="material-symbols-outlined !text-[16px]">{k.icon}</span>
                  {k.t.replace(/s$/, "")}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="block">
            <span className="label">Name</span>
            <input name="name" required maxLength={80} placeholder="e.g. Kopi the barista cat" className="input" />
          </label>
          {shown.map((k) => (
            <div key={k.v} className={`${SHOW_GRID[k.v]} gap-2 rounded-2xl bg-canvas p-2.5 sm:grid-cols-2`}>
              {ASSET_FIELDS[k.v].filter((x) => "main" in x).map((x) => (
                <div key={x.key}>
                  <span className="label">{x.label}</span>
                  <MultiSelect name={`f_${k.v}_${x.key}`} label={x.label} options={x.options} />
                </div>
              ))}
            </div>
          ))}
          <label className="block">
            <span className="label">Notes</span>
            <textarea name="description" maxLength={800} rows={2} placeholder="Anything else the Art Director must respect" className="input" />
          </label>
          {shown.map((k) => (
            <details key={k.v} className={`${SHOW_BLOCK[k.v]} rounded-2xl border border-line p-2.5`}>
              <summary className="cursor-pointer text-xs font-semibold text-ink-2">Additional details</summary>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {ASSET_FIELDS[k.v].filter((x) => !("main" in x)).map((x) => (
                  <div key={x.key}>
                    <span className="label">{x.label}</span>
                    <MultiSelect name={`f_${k.v}_${x.key}`} label={x.label} options={x.options} />
                  </div>
                ))}
              </div>
            </details>
          ))}
          {shown.map((k) => (
            <div key={k.v} className={SHOW_BLOCK[k.v]}>
              <p className="label">Reference images{k.v === "character" ? " (360° turnaround)" : ""}</p>
              <ImageGrid views={IMAGE_VIEWS[k.v]} />
            </div>
          ))}
          {campaigns.length > 0 && (
            <fieldset>
              <legend className="label">For campaign (optional, link later from any card)</legend>
              <div className="flex max-h-32 flex-col gap-1 overflow-y-auto">
                {campaigns.map((c) => (
                  <label key={c.id} className="flex items-center gap-2">
                    <input type="checkbox" name="campaignId" value={c.id} />
                    {name(c)} <span className="text-xs text-ink-3">{c.status.toLowerCase().replace(/_/g, " ")}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          <button className="btn-primary w-full">
            <span className="material-symbols-outlined">add</span>Save
          </button>
        </form>

        {kinds.includes("style") && <div className="border-t border-line pt-4">
          <h2 className="flex items-center gap-2 text-lg font-bold"><span className="material-symbols-outlined text-agent">auto_fix_high</span>Quick-add a video style</h2>
          <p className="text-sm text-ink-2">Presets you can link straight away. Add your own style with the form for anything else.</p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {STYLE_PRESETS.map((p) => (
              <form key={p.name} action={saveCreativeAsset}>
                <input type="hidden" name="kind" value="style" />
                <input type="hidden" name="name" value={p.name} />
                <input type="hidden" name="description" value={p.description} />
                <button disabled={styleNames.has(p.name)} className="w-full rounded-2xl bg-canvas p-3 text-left transition hover:bg-brand-soft disabled:cursor-default disabled:opacity-60 disabled:hover:bg-canvas">
                  <span className="flex items-center gap-1.5 text-sm font-bold">
                    <span className="material-symbols-outlined !text-[16px] text-brand">{styleNames.has(p.name) ? "check" : "add"}</span>
                    {p.name}
                  </span>
                  <span className="mt-0.5 line-clamp-2 block text-xs text-ink-2">{p.description}</span>
                </button>
              </form>
            ))}
          </div>
          <p className="mt-4 flex items-start gap-2 rounded-2xl bg-canvas p-3.5 text-sm text-ink-2">
            <span aria-hidden>💡</span>
            <span><b className="text-ink">Art Director tip:</b> lock one character and one video style across a campaign to keep every shot consistent.</span>
          </p>
        </div>}
      </div>

      {shown.map((k) => {
        const list = assets.filter((a) => a.kind === k.v);
        return (
          <section key={k.v}>
            <h2 className="flex items-center gap-2 text-xl font-semibold">
              <span className="material-symbols-outlined text-brand">{k.icon}</span>
              {k.t} <span className="text-sm font-normal text-ink-3">({list.length})</span>
            </h2>
            <p className="text-sm text-ink-2">{k.hint}</p>
            {!list.length ? (
              <p className="card mt-3 p-6 text-center text-sm text-ink-2">Nothing here yet.</p>
            ) : (
              <ul className="mt-2 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {list.map((a) => {
                  const linked = new Set(a.campaigns.map((c) => c.id));
                  const free = campaigns.filter((c) => !linked.has(c.id));
                  return (
                    <li key={a.id} className="card flex flex-col gap-2 p-4 transition-shadow hover:shadow-float">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="font-bold">{a.name}</h3>
                        {a.kind === "character" && (
                          <form action={setTalentLock} className="ml-auto">
                            <input type="hidden" name="id" value={a.id} />
                            <input type="hidden" name="lock" value={a.lockedAt ? "0" : "1"} />
                            <button className={`pill ${a.lockedAt ? "border-transparent bg-brand-soft text-brand" : "border-transparent bg-canvas text-ink-2 hover:bg-brand-soft"}`}>
                              <span className="material-symbols-outlined !text-[14px]">{a.lockedAt ? "lock" : "lock_open"}</span>
                              {a.lockedAt ? "Locked · unlock" : "Lock as ready"}
                            </button>
                          </form>
                        )}
                        <form action={deleteCreativeAsset}>
                          <input type="hidden" name="id" value={a.id} />
                          <button aria-label={`Delete ${a.name}`} className="text-ink-3 hover:text-red-700">
                            <span className="material-symbols-outlined !text-[18px]">delete</span>
                          </button>
                        </form>
                      </div>
                      <p className="whitespace-pre-wrap text-sm text-ink-2">{a.description}</p>
                      {a.imageUrls.length > 0 && (
                        <div className="grid grid-cols-4 gap-2">
                          {a.imageUrls.map((u) => (
                            <a key={u} href={u} target="_blank" rel="noreferrer" className="relative block aspect-square overflow-hidden rounded-xl">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={u} alt={viewLabel(u)} className="h-full w-full object-cover" />
                              {viewLabel(u) && <span className="absolute inset-x-0 bottom-0 truncate bg-black/60 px-1 text-center text-[10px] font-semibold text-white">{viewLabel(u)}</span>}
                            </a>
                          ))}
                        </div>
                      )}
                      <div className="-mx-4 -mb-4 mt-auto flex flex-col gap-1 rounded-b-3xl bg-canvas p-3">
                        <p className="label mb-0!">Linked campaigns</p>
                        <div className="flex flex-wrap gap-1.5">
                          {[...linked].map((id) => (
                            <form key={id} action={linkCreativeAsset} className="pill border-brand/30 bg-brand-soft text-brand">
                              <input type="hidden" name="id" value={a.id} />
                              <input type="hidden" name="campaignId" value={id} />
                              <Link href={`/campaigns/${id}`} className="hover:underline">{byId.get(id) ? name(byId.get(id)!) : id}</Link>
                              <button name="unlink" value="1" aria-label="Unlink" className="hover:text-red-700">
                                <span className="material-symbols-outlined !text-[14px]">close</span>
                              </button>
                            </form>
                          ))}
                          {!linked.size && <span className="text-xs text-ink-3">Not linked yet</span>}
                        </div>
                        {free.length > 0 && (
                          <form action={linkCreativeAsset} className="mt-2 flex gap-2">
                            <input type="hidden" name="id" value={a.id} />
                            <select name="campaignId" required aria-label="Campaign to link" className="input py-1.5 text-sm">
                              {free.map((c) => (
                                <option key={c.id} value={c.id}>{name(c)} · {c.status.toLowerCase().replace(/_/g, " ")}</option>
                              ))}
                            </select>
                            <button className="btn-primary shrink-0 px-3 py-1.5 text-sm">Link</button>
                          </form>
                        )}
                      </div>
                    </li>
                  );
                })}
                <li>
                  <a href="#add-asset" className="flex h-full min-h-48 flex-col items-center justify-center gap-2 rounded-3xl border-2 border-dashed border-line p-6 text-center text-ink-2 transition hover:border-brand hover:text-brand">
                    <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-soft text-brand"><span className="material-symbols-outlined">add</span></span>
                    <span className="font-semibold">Add {k.t.toLowerCase().replace(/s$/, "")}</span>
                  </a>
                </li>
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
