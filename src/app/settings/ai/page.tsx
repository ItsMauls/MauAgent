import Link from "next/link";
import { db } from "@/lib/db";
import { keyStatus } from "@/lib/ai/env";
import { EFFORTS } from "@/lib/ai/effort";
import { AI_ROLES, AI_ROLE_LABEL, AiOverrides, IMAGE_PROVIDERS, IMAGE_PROVIDER_LABEL, ImageModels, MAX_OUTPUT_TOKENS, VIDEO_PROVIDERS, VIDEO_PROVIDER_LABEL, VideoModels, getAiSettings, parseImageProviders, parseVideoProviders } from "@/lib/ai/settings";
import { PROVIDER } from "@/lib/ai/generate";
import { saveAiSettings, saveImageSettings } from "../actions";
import { TestConnection } from "../forms";

export const dynamic = "force-dynamic";

const EFFORT_LABEL = { off: "Off", low: "Low", medium: "Medium", high: "High" };
const IMAGE_MODEL_HINT = { magichour: "default, seedream-v4, nano-banana-2", modelark: "seedream-5-0-260128", openrouter: "google/gemini-2.5-flash-image" };
const VIDEO_MODEL_HINT = { byteplus: "SEEDANCE_MODEL_DRAFT from .env", magichour: "default, kling-3.0, seedance-2.0, veo3.1" };

function Status({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`pill ${ok ? "border-emerald-200 bg-ok-soft text-emerald-800" : "border-line bg-canvas text-ink-2"}`}>
      <span className="material-symbols-outlined !text-[14px]">{ok ? "check_circle" : "radio_button_unchecked"}</span>
      {label}: {ok ? "configured" : "not set"}
    </span>
  );
}

function Meter({ label, used, cap, fmt }: { label: string; used: number; cap: number; fmt: (n: number) => string }) {
  const pct = cap > 0 ? Math.min(100, (used / cap) * 100) : 100;
  return (
    <div>
      <div className="flex justify-between text-sm">
        <span className="font-semibold">{label}</span>
        <span className="text-ink-2">{fmt(used)} of {fmt(cap)}</span>
      </div>
      <div className="mt-1 h-2 rounded-full bg-line">
        <div className={`h-2 rounded-full ${pct >= 90 ? "bg-bad" : "bg-brand"}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default async function AiSettingsPage() {
  const now = new Date();
  const [s, usage] = await Promise.all([
    getAiSettings(),
    db.costEntry.aggregate({
      _sum: { usd: true, tokensIn: true, tokensOut: true, tokensReasoning: true },
      _count: true,
      where: { provider: PROVIDER, createdAt: { gte: new Date(now.getFullYear(), now.getMonth(), 1) } },
    }),
  ]);
  const keys = keyStatus();
  const parsed = AiOverrides.safeParse(s.perAgentOverrides);
  const ov = parsed.success ? parsed.data : {};
  const imgOrder = parseImageProviders(s.imageProviders);
  const imgModels = ImageModels.catch({}).parse(s.imageModels);
  const vidOrder = parseVideoProviders(s.videoProviders);
  const vidModels = VideoModels.catch({}).parse(s.videoModels);
  const activeModel = s.defaultModel || keys.aiModel || "—";
  const tokens = (usage._sum.tokensIn ?? 0) + (usage._sum.tokensOut ?? 0);

  return (
    <div className="max-w-3xl pt-4">
      <Link href="/settings" className="text-sm text-ink-2 hover:text-brand">← Settings</Link>
      <h1 className="mt-2 text-3xl font-bold tracking-tight">AI model</h1>
      <p className="mt-2 text-ink-2">Every agent calls the model through OpenRouter with these settings. Changes apply within 30 seconds, no restart.</p>

      <section className="card mt-6 space-y-4 p-6">
        <div className="flex flex-wrap gap-2">
          <Status ok={keys.aiPrimary} label="Primary key" />
          <Status ok={keys.aiFallback} label="Fallback key" />
        </div>
        <p className="text-sm text-ink-2">
          Active model: <code className="font-semibold text-ink">{activeModel}</code>
          {!s.defaultModel && " (from AI_MODEL in .env)"}. Keys live in <code>.env</code> only and are never shown here.
        </p>
        <TestConnection />
      </section>

      <section className="card mt-6 space-y-4 p-6">
        <h2 className="text-lg font-semibold">This month</h2>
        <Meter label="LLM spend" used={Number(usage._sum.usd ?? 0)} cap={Number(s.monthlyBudgetUsd)} fmt={(n) => `US$${n.toFixed(2)}`} />
        <Meter label="Tokens (in + out)" used={tokens} cap={s.monthlyTokenCap} fmt={(n) => n.toLocaleString("en-US")} />
        <p className="text-xs text-ink-3">
          {usage._count} calls · {(usage._sum.tokensReasoning ?? 0).toLocaleString("en-US")} reasoning tokens. Free (<code>:free</code>) models cost US$0 but still count tokens and are rate-limited by OpenRouter.
        </p>
      </section>

      <form action={saveImageSettings} className="card mt-6 space-y-4 p-6">
        <h2 className="text-lg font-semibold">Image and video generation</h2>
        <p className="text-sm text-ink-2">
          Pick which platform generates images and video. If the first one fails (trial used up, rate limit, no key), the next one is tried. Keys live in <code>.env</code>
          (<code>MAGIC_HOUR_API_KEY</code>, <code>ARK_API_KEY</code>, <code>AI_API_KEY</code>). Magic Hour ignores reference images, so character views may look less consistent.
        </p>
        <div className="grid gap-4 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <label key={i} className="block">
              <span className="label">{i === 0 ? "Preferred" : `Fallback ${i}`}</span>
              <select name={`order.${i}`} defaultValue={imgOrder[i] ?? ""} className="input mt-1 w-full">
                <option value="">Off</option>
                {IMAGE_PROVIDERS.map((p) => <option key={p} value={p}>{IMAGE_PROVIDER_LABEL[p]}</option>)}
              </select>
            </label>
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          {IMAGE_PROVIDERS.map((p) => (
            <label key={p} className="block">
              <span className="label">{IMAGE_PROVIDER_LABEL[p]} model (empty = default)</span>
              <input name={`model.${p}`} defaultValue={imgModels[p] ?? ""} placeholder={IMAGE_MODEL_HINT[p]} className="input mt-1 w-full" />
            </label>
          ))}
        </div>
        <h3 className="pt-2 font-semibold">Video</h3>
        <div className="grid gap-4 sm:grid-cols-3">
          {[0, 1].map((i) => (
            <label key={i} className="block">
              <span className="label">{i === 0 ? "Preferred" : "Fallback"}</span>
              <select name={`vorder.${i}`} defaultValue={vidOrder[i] ?? ""} className="input mt-1 w-full">
                <option value="">Off</option>
                {VIDEO_PROVIDERS.map((p) => <option key={p} value={p}>{VIDEO_PROVIDER_LABEL[p]}</option>)}
              </select>
            </label>
          ))}
          {VIDEO_PROVIDERS.map((p) => (
            <label key={p} className="block">
              <span className="label">{VIDEO_PROVIDER_LABEL[p]} model</span>
              <input name={`vmodel.${p}`} defaultValue={vidModels[p] ?? ""} placeholder={VIDEO_MODEL_HINT[p]} className="input mt-1 w-full" />
            </label>
          ))}
        </div>
        <p className="text-xs text-ink-3">Fallback applies when a video task cannot be created (trial used up, no key). A task that fails while rendering leaves the shot open for manual upload.</p>
        <button className="btn-primary w-full">
          <span className="material-symbols-outlined">save</span>Save media settings
        </button>
      </form>

      <form action={saveAiSettings} className="card mt-6 space-y-5 p-6">
        <h2 className="text-lg font-semibold">Defaults for every agent</h2>
        <label className="block">
          <span className="label">Model (empty = AI_MODEL from .env)</span>
          <input name="defaultModel" defaultValue={s.defaultModel ?? ""} placeholder={keys.aiModel ?? "provider/model"} className="input mt-1 w-full" />
        </label>
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="block">
            <span className="label">Reasoning effort</span>
            <select name="reasoningEffort" defaultValue={s.reasoningEffort} className="input mt-1 w-full">
              {EFFORTS.map((e) => <option key={e} value={e}>{EFFORT_LABEL[e]}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="label">Max output tokens</span>
            <input name="maxOutputTokens" type="number" min={MAX_OUTPUT_TOKENS.min} max={MAX_OUTPUT_TOKENS.max} defaultValue={s.maxOutputTokens} className="input mt-1 w-full" />
          </label>
          <label className="block">
            <span className="label">Temperature</span>
            <input name="temperature" type="number" min={0} max={2} step={0.1} defaultValue={s.temperature} className="input mt-1 w-full" />
          </label>
        </div>
        <p className="rounded-lg bg-amber-soft p-3 text-sm text-amber-900">
          Higher effort = more reasoning tokens = higher cost and slower replies. Reasoning tokens count against max output tokens.
          A model that does not support a level gets the closest lower one (Nemotron 3 Super supports low and medium only).
        </p>

        <h2 className="pt-2 text-lg font-semibold">Per-agent overrides</h2>
        <p className="text-sm text-ink-2">Empty = use the defaults above. The Producer has no LLM (its estimate is deterministic code).</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-ink-2">
              <tr><th className="py-2 pr-3">Agent</th><th className="pr-3">Model</th><th className="pr-3">Effort</th><th>Max tokens</th></tr>
            </thead>
            <tbody>
              {AI_ROLES.map((role) => (
                <tr key={role} className="border-t border-line">
                  <td className="py-2 pr-3 font-semibold whitespace-nowrap">{AI_ROLE_LABEL[role]}</td>
                  <td className="pr-3"><input name={`${role}.model`} defaultValue={ov[role]?.model ?? ""} placeholder="default" className="input w-full min-w-40" /></td>
                  <td className="pr-3">
                    <select name={`${role}.reasoningEffort`} defaultValue={ov[role]?.reasoningEffort ?? ""} className="input w-full">
                      <option value="">default</option>
                      {EFFORTS.map((e) => <option key={e} value={e}>{EFFORT_LABEL[e]}</option>)}
                    </select>
                  </td>
                  <td><input name={`${role}.maxOutputTokens`} type="number" min={MAX_OUTPUT_TOKENS.min} max={MAX_OUTPUT_TOKENS.max} defaultValue={ov[role]?.maxOutputTokens ?? ""} placeholder="default" className="input w-28" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h2 className="pt-2 text-lg font-semibold">Cost guards (enforced on every call)</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="block">
            <span className="label">LLM budget per month (USD)</span>
            <input name="monthlyBudgetUsd" type="number" min={0} step={1} defaultValue={String(s.monthlyBudgetUsd)} className="input mt-1 w-full" />
          </label>
          <label className="block">
            <span className="label">Max cost per call (USD)</span>
            <input name="maxCostPerCallUsd" type="number" min={0} step={0.01} defaultValue={String(s.maxCostPerCallUsd)} className="input mt-1 w-full" />
          </label>
          <label className="block">
            <span className="label">Token cap per month</span>
            <input name="monthlyTokenCap" type="number" min={0} step={1000} defaultValue={s.monthlyTokenCap} className="input mt-1 w-full" />
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="enableFallbackKey" defaultChecked={s.enableFallbackKey} />
          Use the fallback key when the primary key is rate-limited, out of credit, rejected or the provider fails
        </label>
        <button className="btn-primary w-full">
          <span className="material-symbols-outlined">save</span>Save
        </button>
      </form>
    </div>
  );
}
