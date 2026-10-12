import { concurrencyLimit } from "@trigger.dev/sdk";

// One shared limit per provider, to avoid rate limits and cost spikes. Totals from env.
const n = (key: string, def: number) => Number(process.env[key]) || def;

export const videoLimit = concurrencyLimit({ name: "video", total: n("TRIGGER_CONCURRENCY_VIDEO", 2) });
export const elevenlabsLimit = concurrencyLimit({ name: "elevenlabs", total: n("TRIGGER_CONCURRENCY_ELEVENLABS", 2) });
export const vidiqLimit = concurrencyLimit({ name: "vidiq", total: n("TRIGGER_CONCURRENCY_VIDIQ", 1) });
export const geminiLlmLimit = concurrencyLimit({ name: "gemini-llm", total: n("TRIGGER_CONCURRENCY_GEMINI_LLM", 5) });
export const ffmpegRenderLimit = concurrencyLimit({ name: "ffmpeg-render", total: n("TRIGGER_CONCURRENCY_FFMPEG_RENDER", 1) });
