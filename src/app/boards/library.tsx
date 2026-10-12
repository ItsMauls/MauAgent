import Link from "next/link";
import { db } from "@/lib/db";
import { deleteCreativeAsset, linkCreativeAsset, saveCreativeAsset } from "../actions";

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

/** AI Content Creator library (was /creator). Content Creator shows every kind; Talent Manager only characters. */
export async function CreatorLibrary({ kinds = ["character", "location", "style"] }: { kinds?: Kind[] }) {
  const [assets, campaigns] = await Promise.all([
    db.creativeAsset.findMany({ where: { kind: { in: kinds } }, orderBy: { createdAt: "desc" }, include: { campaigns: { select: { id: true } } } }),
    db.campaign.findMany({ orderBy: { createdAt: "desc" }, select: { id: true, clientBrief: true, status: true } }),
  ]);
  const name = (c: (typeof campaigns)[number]) => (c.clientBrief as { product?: string }).product ?? c.id;
  const byId = new Map(campaigns.map((c) => [c.id, c]));
  const styleNames = new Set(assets.filter((a) => a.kind === "style").map((a) => a.name));
  const shown = KINDS.filter((k) => kinds.includes(k.v));

  return (
    <div className="space-y-6">
      <p className="max-w-3xl text-ink-2">
        Design characters, locations and video styles once, then link them to any upcoming or existing campaign. The Art Director must use the linked items in the shot list and generation prompts.
      </p>

      <div className="grid items-start gap-6 lg:grid-cols-12">
        <form action={saveCreativeAsset} className="card space-y-4 p-6 lg:col-span-5">
          <h2 className="text-lg font-bold">Add to library</h2>
          <fieldset>
            <legend className="label">Type</legend>
            <div className="flex flex-wrap gap-2">
              {shown.map((k, i) => (
                <label key={k.v} className="pill cursor-pointer border-line bg-white px-3.5 py-2 text-ink-2 has-checked:border-brand has-checked:bg-brand-soft has-checked:text-brand has-focus-visible:ring-2 has-focus-visible:ring-brand/40">
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
          <label className="block">
            <span className="label">Description</span>
            <textarea name="description" required maxLength={1500} rows={4} placeholder="e.g. Orange tabby cat, round glasses, green apron with a coffee bean logo, cheerful and clumsy" className="input" />
          </label>
          <label className="block">
            <span className="label">Reference image URLs (optional, one per line)</span>
            <textarea name="imageUrls" rows={2} placeholder="https://…" className="input font-mono" />
          </label>
          <button className="btn-primary w-full">
            <span className="material-symbols-outlined">add</span>Save
          </button>
        </form>

        {kinds.includes("style") && <div className="card p-6 lg:col-span-7">
          <h2 className="text-lg font-bold">Quick-add a video style</h2>
          <p className="text-sm text-ink-2">Presets you can link straight away. Add your own style with the form for anything else.</p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {STYLE_PRESETS.map((p) => (
              <form key={p.name} action={saveCreativeAsset}>
                <input type="hidden" name="kind" value="style" />
                <input type="hidden" name="name" value={p.name} />
                <input type="hidden" name="description" value={p.description} />
                <button disabled={styleNames.has(p.name)} className="w-full rounded-2xl border border-line bg-canvas p-3 text-left transition hover:border-brand disabled:cursor-default disabled:opacity-50 disabled:hover:border-line">
                  <span className="flex items-center gap-1.5 text-sm font-bold">
                    <span className="material-symbols-outlined !text-[16px] text-brand">{styleNames.has(p.name) ? "check" : "add"}</span>
                    {p.name}
                  </span>
                  <span className="mt-0.5 line-clamp-2 block text-xs text-ink-2">{p.description}</span>
                </button>
              </form>
            ))}
          </div>
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
              <ul className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {list.map((a) => {
                  const linked = new Set(a.campaigns.map((c) => c.id));
                  const free = campaigns.filter((c) => !linked.has(c.id));
                  return (
                    <li key={a.id} className="card flex flex-col gap-3 p-5">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="font-bold">{a.name}</h3>
                        <form action={deleteCreativeAsset}>
                          <input type="hidden" name="id" value={a.id} />
                          <button aria-label={`Delete ${a.name}`} className="text-ink-3 hover:text-red-700">
                            <span className="material-symbols-outlined !text-[18px]">delete</span>
                          </button>
                        </form>
                      </div>
                      <p className="whitespace-pre-wrap text-sm text-ink-2">{a.description}</p>
                      {a.imageUrls.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {a.imageUrls.map((u) => (
                            // eslint-disable-next-line @next/next/no-img-element
                            <a key={u} href={u} target="_blank" rel="noreferrer"><img src={u} alt="" className="h-16 w-16 rounded-xl object-cover" /></a>
                          ))}
                        </div>
                      )}
                      <div className="mt-auto border-t border-line pt-3">
                        <p className="label">Linked campaigns</p>
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
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
