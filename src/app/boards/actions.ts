"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { inngest } from "@/lib/inngest";
import { getSettings } from "@/lib/settings";
import { ClientBrief, SocialPosts } from "@/lib/agents/schemas";
import { contentSetup } from "@/lib/content/config";
import { classify, describeImage, extractText, MAX_FILES } from "@/lib/content/context";
import { generatePosts, type BatchInput } from "@/lib/content/generate";
import { scheduleProblem } from "@/lib/content/validate";
import { analyzeVoice, suggestBriefDetails } from "@/lib/agents";
import { ROLES, roleBySlug } from "@/lib/boards/roles";
import { writeFeedback } from "@/lib/boards/feedback";
import { estimateTask, refIds, taskGate, TASKS } from "@/lib/boards/tasks";
import { CHAINS, FLOWS, flowInputs, taskHref, type FlowSlug } from "@/lib/boards/flows";
import { MODES } from "@/lib/publish";
import { createScheduleJobs, updatePostJob } from "@/lib/publishPlan";
import { ownMessages } from "@/lib/voiceSamples";
import { saveTaskResult } from "@/lib/workflows/agentTask";
import { getPersona, isAgentRole, personaSystem } from "@/lib/agents/persona";
import { buildPersonaBlock } from "@/lib/agents/profiles";
import { cleanMemoryText, rememberFromChat, roleMemoryBlock } from "@/lib/agents/memory";
import { generateStructured } from "@/lib/ai/generate";

function taskDef(slug: string) {
  const role = roleBySlug(z.string().parse(slug));
  const def = role && TASKS[role.agentRole];
  if (!role || !def) throw new Error("This role has no direct task");
  return { role, def };
}

const ThenRole = z.enum(Object.keys(CHAINS) as [string, ...string[]]).optional();

/** Deterministic estimate + monthly-cap check shown before a task runs. Re-done in requestTask and in Inngest. */
export async function estimateTaskAction(slug: string, raw: unknown, thenRole?: string) {
  const { role, def } = taskDef(slug);
  const input = def.input.parse(raw);
  // Referenced artifacts, or for a campaign pick (QC) the latest output of each role in that campaign.
  const ids = refIds(input);
  const refs = await db.artifact.findMany({
    where: { OR: [{ id: { in: ids } }, { campaignId: { in: ids } }] },
    orderBy: { version: "desc" }, distinct: ["campaignId", "agentRole"], select: { payload: true },
  });
  const then = ThenRole.parse(thenRole);
  const s = await getSettings();
  // ponytail: the chained tasks' reference (this task's output) does not exist yet, so they are estimated without it; the worker gate re-checks the cap.
  const chained = then ? await Promise.all(CHAINS[then]("pending", { defaultVideoSource: s.defaultVideoSource }).map((c) => estimateTask(c.agentRole, c.input))) : [];
  const estUsd = await estimateTask(role.agentRole, input, refs.reduce((n, r) => n + JSON.stringify(r.payload).length, 0)) + chained.reduce((n, x) => n + x, 0);
  const gate = await taskGate(estUsd, Number(s.monthlyBudgetUsd));
  return { estUsd, monthUsd: gate.monthUsd, monthCapUsd: Number(s.monthlyBudgetUsd), blocked: gate.blocked, reasons: gate.reasons };
}

export async function requestTask(slug: string, raw: unknown, confirmOverCap: boolean, thenRole?: string) {
  const { role, def } = taskDef(slug);
  const input = def.input.parse(raw);
  const est = await estimateTaskAction(slug, input, thenRole);
  // The cap is enforced here, not only in the UI: over cap needs the explicit confirmation.
  if (est.blocked && !z.boolean().parse(confirmOverCap)) throw new Error(`${est.reasons.join(" ")} Confirm to run anyway.`);
  const t = await db.agentTask.create({
    data: { agentRole: role.agentRole, input: input as object, estUsd: est.estUsd, confirmedOverCap: est.blocked && confirmOverCap, thenRole: ThenRole.parse(thenRole) },
  });
  await inngest.send({ id: `${t.id}:${t.attempt}`, name: "agent/task.requested", data: { taskId: t.id } });
  revalidatePath("/boards", "layout");
  return t.id;
}

// ---------- Multi-agent features: several roles on one pick (Production pack, Final delivery) ----------

const FlowSlugSchema = z.enum(Object.keys(FLOWS) as [FlowSlug, ...FlowSlug[]]);

async function flowSteps(slug: string, pickId: string) {
  const s = await getSettings();
  return flowInputs(FlowSlugSchema.parse(slug), z.string().min(1, "Pick one first").parse(pickId), { defaultVideoSource: s.defaultVideoSource });
}

/** Sum of each role's estimate; the cap check is on the total. */
export async function estimateFlow(slug: string, pickId: string) {
  const ests = await Promise.all((await flowSteps(slug, pickId)).map((st) => estimateTaskAction(st.slug, st.input)));
  const estUsd = ests.reduce((n, e) => n + e.estUsd, 0);
  const s = await getSettings();
  const gate = await taskGate(estUsd, Number(s.monthlyBudgetUsd));
  return { estUsd, monthUsd: gate.monthUsd, monthCapUsd: Number(s.monthlyBudgetUsd), blocked: gate.blocked, reasons: gate.reasons };
}

/** One task per role, each through requestTask (its own estimate, cap gate and Inngest event). */
export async function runFlow(slug: string, pickId: string, confirmOverCap: boolean) {
  for (const st of await flowSteps(slug, pickId)) await requestTask(st.slug, st.input, confirmOverCap);
}

/** /brief in text-post mode (and the Text posts feature): a Socmed Specialist task, then open its result in the feature. */
export async function createTextPosts(form: FormData) {
  // Chips + optional free text collapse into the single string the agent reads, as in createCampaign.
  const merge = (chips: string, detail: string) =>
    [form.getAll(chips).map(String).join("; "), String(form.get(detail) ?? "").trim()].filter(Boolean).join(". ");
  const objective = merge("goals", "objective");
  const audience = merge("audiences", "audience");
  if (!objective) throw new Error("Pick at least one business goal or describe the goal");
  if (!audience) throw new Error("Pick at least one target audience or describe the audience");
  const opt = (k: string) => String(form.get(k) ?? "").trim() || undefined;
  const cta = opt("cta");
  const hashtags = opt("hashtags");
  const input = {
    topic: form.get("topic"), objective, brand: opt("brand"), audience,
    platforms: form.getAll("platforms"), count: Number(form.get("count")), types: form.getAll("types"),
    length: opt("length"), cta, offer: cta === "promo" ? opt("offer") : undefined, linkUrl: opt("linkUrl"), mediaType: opt("mediaType"),
    hashtags, customTags: hashtags === "custom" ? opt("customTags") : undefined, avoid: opt("avoid"),
  };
  // Validate before the paid image description, so a bad field fails fast.
  TASKS.socmedSpecialist.input.parse(input);
  const imageNote = await describeBriefImage(form.get("imageFile"), opt("imageUrl"));
  const id = await requestTask("socmed-specialist", { ...input, imageNote }, false);
  redirect(taskHref("socmedSpecialist", id));
}

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

/** What the brief's image shows (an upload wins over a URL), described once by the vision model; undefined = no image. */
async function describeBriefImage(file: FormDataEntryValue | null, url?: string) {
  if (file instanceof File && file.size > 0) {
    const c = classify(file.name, file.size);
    if (c.kind !== "image") throw new Error(c.kind === "unsupported" ? c.reason : `${file.name}: not a picture`);
    return describeImage(file.name, c.mime, new Uint8Array(await file.arrayBuffer()), { step: "brief-image" });
  }
  if (!url) return undefined;
  const u = z.url({ protocol: /^https$/, error: "The image URL must start with https://" }).parse(url);
  const res = await fetch(u, { signal: AbortSignal.timeout(10_000) }).catch(() => null);
  const mime = res?.headers.get("content-type")?.split(";")[0].trim() ?? "";
  if (!res?.ok || !IMAGE_TYPES.includes(mime)) throw new Error("The image URL did not return a PNG, JPG, WebP or GIF picture");
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > MAX_FILE_BYTES) throw new Error("The image is larger than 10 MB");
  return describeImage(u.split("/").pop() || "image", mime, bytes, { step: "brief-image" });
}

const BriefHelperInput = z.object({
  topic: z.string().trim().min(3, "Write the topic first").max(500),
  brand: z.string().trim().max(200).optional(),
  goals: z.array(z.string().max(200)).max(20),
  audiences: z.array(z.string().max(200)).max(20),
  /** The chip options on the form, so the model can pick the ones that fit. */
  goalOptions: z.array(z.string().max(200)).max(20),
  audienceOptions: z.array(z.string().max(200)).max(20),
});

/** "Fill from topic" in the text brief. Returns the error as data: a thrown message is hidden in production. */
export async function suggestBriefAction(raw: z.input<typeof BriefHelperInput>) {
  const input = BriefHelperInput.safeParse(raw);
  if (!input.success) return { error: input.error.issues[0].message };
  try {
    const { objective, audience, goals, audiences } = await suggestBriefDetails(input.data, { step: "brief-helper" });
    return { objective, audience, goals, audiences };
  } catch (e) {
    return { error: `Could not write the details: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}` };
  }
}

// ---------- Writing voice: learn how the owner writes from their own chats and posts ----------

const MAX_FILE_BYTES = 10_000_000; // a long WhatsApp export is a few MB

/** Reads the uploaded archives once (own messages only) and saves the style guide. Later batches reuse it, so they cost nothing extra. */
export async function analyzeVoiceAction(form: FormData) {
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) throw new Error("Upload at least one file");
  if (files.some((f) => f.size > MAX_FILE_BYTES)) throw new Error("A file is larger than 10 MB");
  const samples = z.string().trim().min(80, "Not enough of your own writing found in these files").parse(
    ownMessages(await Promise.all(files.map(async (f) => ({ name: f.name, text: await f.text() })))),
  );
  const { payload } = await analyzeVoice(samples);
  // Some models write "␣" where a line break belongs; the guide is meant to be a readable bulleted list.
  // Others drop the backslash of "\n" and leave a bare "n" before the next bullet, or join bullets with spaces.
  const voice = payload.voice.replace(/␣+/g, "\n").replace(/([.!?)'"])n- /g, "$1\n- ").replace(/ {2,}- /g, "\n- ").replace(/\n{3,}/g, "\n\n").trim();
  await db.setting.upsert({ where: { id: "default" }, create: { writingVoice: voice }, update: { writingVoice: voice } });
  revalidatePath("/brief");
}

/** The owner edits the style guide by hand. Returns the error as data, so the editor can show it (and its success). */
export async function saveVoiceAction(form: FormData): Promise<{ error?: string }> {
  const voice = z.string().trim().min(1, "The writing voice is empty: remove it instead").max(1800).safeParse(form.get("voice"));
  if (!voice.success) return { error: voice.error.issues[0].message };
  await db.setting.upsert({ where: { id: "default" }, create: { writingVoice: voice.data }, update: { writingVoice: voice.data } });
  revalidatePath("/brief");
  return {};
}

export async function clearVoiceAction() {
  await db.setting.updateMany({ where: { id: "default" }, data: { writingVoice: null } });
  revalidatePath("/brief");
}

// ---------- Context files: notes and pictures that give the AI a picture of the account or topic ----------

/**
 * Reads each uploaded file: text is stored as it is, a picture is described once by the vision model. Good files are
 * saved even when others fail; the failures are reported together at the end.
 */
export async function addContextFiles(form: FormData) {
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) throw new Error("Choose at least one file");
  if ((await db.contentFile.count()) + files.length > MAX_FILES) throw new Error(`At most ${MAX_FILES} context files: remove some first`);
  const failed: string[] = [];
  for (const f of files) {
    const c = classify(f.name, f.size);
    if (c.kind === "unsupported") { failed.push(c.reason); continue; }
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const content = c.kind === "image" ? await describeImage(f.name, c.mime, bytes) : extractText(f.name, bytes);
      if (!content) { failed.push(`${f.name}: no readable text found`); continue; }
      await db.contentFile.create({ data: { name: f.name.slice(0, 200), mime: c.mime, kind: c.kind, sizeBytes: f.size, content } });
    } catch (e) {
      failed.push(`${f.name}: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`);
    }
  }
  revalidatePath("/brief");
  if (failed.length) throw new Error(`Not added: ${failed.join(" · ")}`);
}

export async function removeContextFile(id: string) {
  await db.contentFile.deleteMany({ where: { id: z.string().min(1).parse(id) } });
  revalidatePath("/brief");
}

/** New attempt of a failed task (same input). Event id taskId:attempt keeps each attempt idempotent. */
export async function retryTask(taskId: string) {
  const t = await db.agentTask.findUniqueOrThrow({ where: { id: z.string().parse(taskId) } });
  if (t.status !== "FAILED") throw new Error("Only a failed task can be retried");
  const next = await db.agentTask.update({ where: { id: t.id }, data: { status: "QUEUED", attempt: { increment: 1 }, error: null } });
  await inngest.send({ id: `${t.id}:${next.attempt}`, name: "agent/task.requested", data: { taskId: t.id } });
  revalidatePath("/boards", "layout");
}

const ChatTurns = z.array(z.object({ from: z.enum(["owner", "agent"]), text: z.string().trim().min(1).max(2000) })).min(1).max(30);

/** One chat reply from an agent: its persona, its expertise (role blurb) and the memories it has, through the same capped, logged LLM entry point as every task. Lasting instructions from the owner are saved as procedural memory. */
export async function chatWithAgent(slug: string, raw: unknown) {
  const role = roleBySlug(z.string().parse(slug));
  if (!role || !isAgentRole(role.agentRole)) throw new Error("This agent cannot chat");
  const turns = ChatTurns.parse(raw);
  if (turns.at(-1)!.from !== "owner") throw new Error("The last message must be yours");
  const [{ persona }, memory, s] = await Promise.all([getPersona(role.agentRole), roleMemoryBlock(role.agentRole), getSettings()]);
  const system = `${personaSystem(role.agentRole, persona)}

${buildPersonaBlock(role.agentRole)}

You are chatting directly with the agency owner. Your expertise: ${role.label}, ${role.blurb} Answer from that expertise and from your experience below; if something is outside it, say so and name the agent who owns it. Reply in the language the owner writes in. Be concise and concrete, and never invent past campaigns or results.
When the owner tells you how to work from now on (a rule, a preference, a correction), acknowledge that you will apply it and put it in "remember" as one short standalone instruction (max 5, in English, no secrets). Leave "remember" empty for questions and small talk.${memory}`;
  const transcript = turns.map((t) => `${t.from === "owner" ? "Owner" : "You"}: ${t.text}`).join("\n");
  const prompt = `Conversation so far:\n${transcript}\n\nWrite your next reply to the owner's last message.`;
  const { payload } = await generateStructured(role.agentRole, prompt, z.object({ reply: z.string().min(1).max(4000), remember: z.array(z.string().trim().min(1).max(400)).max(5) }), { system, step: `chat:${role.agentRole}` });
  const saved = s.memoryEnabled ? payload.remember : [];
  if (saved.length) await rememberFromChat(role.agentRole, saved);
  return { reply: payload.reply, saved };
}

/** Owner edits to one memory. Edits are redacted like every write; "remove" archives (never recalled again), it does not delete. */
export async function editMemory(id: string, form: FormData) {
  const content = cleanMemoryText(z.string().trim().min(1).parse(form.get("content")));
  await db.agentMemory.update({ where: { id: z.string().min(1).parse(id) }, data: { content } });
  revalidatePath("/boards", "layout");
}

export async function pinMemory(id: string, pinned: boolean) {
  await db.agentMemory.update({ where: { id: z.string().min(1).parse(id) }, data: { pinned } });
  revalidatePath("/boards", "layout");
}

export async function removeMemory(id: string) {
  await db.agentMemory.update({ where: { id: z.string().min(1).parse(id) }, data: { archivedAt: new Date() } });
  revalidatePath("/boards", "layout");
}

/**
 * Delete a text-post batch (scrap it while queued, remove it when done or failed) with its output. A running batch
 * cannot be removed, and neither can one with posts in Buffer: those are managed in Publishing, so nothing is orphaned there.
 */
export async function deleteBatch(taskId: string) {
  const id = z.string().min(1).parse(taskId);
  const t = await db.agentTask.findUniqueOrThrow({ where: { id }, select: { agentRole: true, status: true } });
  if (t.agentRole !== "socmedSpecialist") throw new Error("Only a text-post batch can be deleted here");
  if (t.status === "RUNNING") throw new Error("This batch is being written right now: wait until it finishes");
  if (await db.publishJob.count({ where: { agentTaskId: id } })) throw new Error("This batch has posts in Publishing: remove or publish those first");
  await db.$transaction([db.artifact.deleteMany({ where: { agentTaskId: id } }), db.agentTask.delete({ where: { id } })]);
  revalidatePath("/boards", "layout");
}

/** Scrap a task that has not started: the row is deleted, and the worker skips an event whose task is no longer queued. */
export async function scrapTask(taskId: string) {
  const { count } = await db.agentTask.deleteMany({ where: { id: z.string().parse(taskId), status: "QUEUED" } });
  if (!count) throw new Error("Only a queued task can be scrapped");
  revalidatePath("/boards", "layout");
}

/** Artifacts to copy into the new campaign: the task output and, recursively, the artifacts its input pointed at. */
async function seedChain(artifactId: string) {
  const out: { id: string; agentRole: string; payload: unknown; agentTaskId: string | null }[] = [];
  const queue = [artifactId];
  while (queue.length && out.length < 10) {
    const a = await db.artifact.findUnique({ where: { id: queue.shift()! }, select: { id: true, agentRole: true, payload: true, agentTaskId: true } });
    if (!a || out.some((x) => x.agentRole === a.agentRole)) continue;
    out.push(a);
    if (a.agentTaskId) {
      const t = await db.agentTask.findUnique({ where: { id: a.agentTaskId }, select: { input: true } });
      queue.push(...refIds(t?.input));
    }
  }
  return out;
}

/**
 * "Send to flow": a new campaign whose earlier stages are the task's artifacts (copied, cost 0, so nothing is
 * billed twice), started at the next stage. The normal brief → pipeline path is untouched.
 */
export async function sendTaskToFlow(taskId: string, form: FormData) {
  const t = await db.agentTask.findUniqueOrThrow({ where: { id: z.string().parse(taskId) } });
  const def = TASKS[t.agentRole];
  if (t.status !== "DONE" || !t.artifactId || !def?.next) throw new Error("This task's output cannot start a campaign");
  if (t.campaignId) redirect(`/campaigns/${t.campaignId}`);

  const brief = ClientBrief.parse({
    objective: form.get("objective"),
    product: form.get("product"),
    audience: form.get("audience"),
    platforms: form.getAll("platforms"),
    budgetCapUsd: Number(form.get("budgetCapUsd")),
    defaultSource: form.get("defaultSource"),
  });
  const chain = await seedChain(t.artifactId);
  const input = (t.input ?? {}) as { characterIds?: string[]; locationIds?: string[]; styleIds?: string[] };
  const kit = [...(input.characterIds ?? []), ...(input.locationIds ?? []), ...(input.styleIds ?? [])];

  const c = await db.$transaction(async (tx) => {
    const c = await tx.campaign.create({
      data: {
        clientBrief: brief, budgetCapUsd: brief.budgetCapUsd, defaultSource: brief.defaultSource,
        creativeAssets: { connect: kit.map((id) => ({ id })) },
      },
    });
    for (const a of chain)
      await tx.artifact.create({ data: { campaignId: c.id, agentRole: a.agentRole, version: 1, payload: a.payload as object, costUsd: 0, agentTaskId: a.agentTaskId } });
    await tx.agentTask.update({ where: { id: t.id }, data: { campaignId: c.id } });
    return c;
  });
  await inngest.send({ name: "campaign/brief.submitted", data: { campaignId: c.id, from: def.next } });
  redirect(`/campaigns/${c.id}`);
}

// ---------- Socmed Specialist: schedule the generated posts through Buffer ----------

const SchedulePlan = z.object({
  accountIds: z.array(z.string().min(1)).min(1, "Pick at least one channel"),
  items: z
    .array(z.object({
      text: z.string().trim().min(1), thread: z.array(z.string().trim().min(1)).default([]), dueAtUtc: z.iso.datetime(),
      // Which generated post and variant this is (the approval gate reads the stored post).
      slot: z.number().int().min(0), variant: z.number().int().min(0).default(0),
    }))
    .min(1, "The schedule has no filled slots")
    .max(200),
});

/**
 * Step 1 of two: create our rows, then let `publish-job` put each one in Buffer as a draft. Only a row without a
 * Buffer post id gets an event, so pressing the button again never creates a second post.
 */
export async function pushDrafts(taskId: string, raw: z.input<typeof SchedulePlan>) {
  const t = await db.agentTask.findUniqueOrThrow({ where: { id: z.string().parse(taskId) }, select: { id: true, agentRole: true, status: true, artifactId: true } });
  if (t.agentRole !== "socmedSpecialist" || t.status !== "DONE" || !t.artifactId) throw new Error("This task has no posts to schedule");
  const plan = SchedulePlan.parse(raw);
  // Unapproved posts and variants the checks rejected never reach Buffer, whatever the client sent.
  const { posts } = SocialPosts.parse((await db.artifact.findUniqueOrThrow({ where: { id: t.artifactId }, select: { payload: true } })).payload);
  const problem = plan.items.map((i) => scheduleProblem(posts, i, contentSetup().banned)).find(Boolean);
  if (problem) throw new Error(problem);
  // The source and confidence come from the stored post, so the draft carries what the AI said, not what the client sent.
  const items = plan.items.map((i) => {
    const v = i.variant === 0 ? posts[i.slot] : posts[i.slot].alternatives[i.variant - 1];
    return { ...i, sourceNote: v.sourceNote ?? null, sourceConfidence: v.sourceNote ? (v.confidence ?? null) : null };
  });
  const jobs = await createScheduleJobs(t.id, plan.accountIds, items);
  const pending = jobs.filter((j) => !j.postId);
  // Buffer calls cost no dollars, so they are never a CostEntry; the quota use is logged instead.
  console.log(JSON.stringify({ at: "buffer", step: "draft.push", taskId: t.id, posts: jobs.length, calls: pending.length }));
  if (pending.length) await inngest.send(pending.map((j) => ({ name: "publish/job", data: { jobId: j.id } })));
  revalidatePath("/boards", "layout");
  return { total: jobs.length, sent: pending.length };
}

/** The posts artifact of a finished Socmed Specialist task. */
async function postsOf(taskId: string) {
  const t = await db.agentTask.findUniqueOrThrow({ where: { id: z.string().parse(taskId) }, select: { id: true, agentRole: true, status: true, artifactId: true, input: true } });
  if (t.agentRole !== "socmedSpecialist" || t.status !== "DONE" || !t.artifactId) throw new Error("This task has no posts");
  const a = await db.artifact.findUniqueOrThrow({ where: { id: t.artifactId }, select: { id: true, payload: true } });
  return { task: t, artifactId: a.id, data: SocialPosts.parse(a.payload) };
}

/** Approve (ready to schedule), reject (out of the queue) or reset one post of a batch. */
export async function setPostDecision(taskId: string, slot: number, decision: "approved" | "rejected" | null) {
  const { artifactId, data } = await postsOf(taskId);
  const i = z.number().int().min(0).max(data.posts.length - 1).parse(slot);
  data.posts[i].decision = z.enum(["approved", "rejected"]).nullable().parse(decision);
  await db.artifact.update({ where: { id: artifactId }, data: { payload: data } });
  revalidatePath("/boards", "layout");
}

/**
 * Writes one post of a batch again from the same brief, its content type and CTA, avoiding the other posts. The
 * monthly cap is checked like a task. ponytail: runs inline (about 20-60 s); move it to Inngest if the server action
 * time limit bites.
 */
export async function regeneratePost(taskId: string, slot: number) {
  const { task, artifactId, data } = await postsOf(taskId);
  const i = z.number().int().min(0).max(data.posts.length - 1).parse(slot);
  const old = data.posts[i];
  const input = TASKS.socmedSpecialist.input.parse(task.input) as BatchInput;
  const one: BatchInput = {
    ...input, count: 1, types: old.type ? [old.type] : input.types, cta: old.cta ?? "none",
    siblings: data.posts.flatMap((p, k) => (k === i ? [] : [[p.text, ...p.thread].join("\n")])),
  };
  const estUsd = await estimateTask("socmedSpecialist", one);
  const gate = await taskGate(estUsd, Number((await getSettings()).monthlyBudgetUsd));
  if (gate.blocked) throw new Error(gate.reasons.join(" "));
  const { payload } = await generatePosts(one, { step: "regenerate-post" });
  data.posts[i] = { ...payload.posts[0], decision: null };
  await db.artifact.update({ where: { id: artifactId }, data: { payload: data } });
  revalidatePath("/boards", "layout");
  return data.posts[i];
}

/** Step 2 of two: the drafts Buffer already holds become scheduled posts. Deliberately a separate confirmation. */
export async function applySchedule(taskId: string) {
  const id = z.string().parse(taskId);
  const ready = await db.publishJob.count({ where: { agentTaskId: id, mode: "draft", postId: { not: null } } });
  if (!ready) throw new Error("No Buffer draft to schedule yet: send the drafts first");
  await inngest.send({ name: "schedule/apply", data: { taskId: id } });
  revalidatePath("/boards", "layout");
  return { scheduling: ready };
}

// ---------- Publishing page: edit X / Threads posts ----------

const PostDraft = z.object({
  text: z.string().trim().min(1, "The post is empty"),
  thread: z.array(z.string().trim().min(1)).default([]),
  mode: z.enum(MODES),
  dueAt: z.iso.datetime().optional(),
});

/** Edit a post that has not gone out: text, thread, time or draft / queue / now. */
export async function updateTextPost(jobId: string, raw: z.input<typeof PostDraft>) {
  const id = z.string().min(1).parse(jobId);
  const { hasPostId } = await updatePostJob(id, PostDraft.parse(raw));
  // Not in Buffer yet: (re)send it. Already there: only the status check has to catch up.
  await inngest.send(hasPostId ? { name: "buffer/posts.sync.requested", data: {} } : { name: "publish/job", data: { jobId: id } });
  revalidatePath("/boards", "layout");
}

// ---------- Talent hand-off: Content Creator → Talent Manager ----------

/** Content Creator asks the Talent Manager for a new talent, with the content that needs it. */
export async function requestTalent(form: FormData) {
  const input = z.object({
    request: z.string().trim().min(1).max(1500),
    campaignId: z.string().min(1).optional(),
  }).parse({ request: form.get("request"), campaignId: form.get("campaignId") || undefined });
  const c = input.campaignId ? await db.campaign.findUnique({ where: { id: input.campaignId }, select: { clientBrief: true } }) : null;
  await db.agentTask.create({
    data: {
      agentRole: "talentManager", status: "WAITING", requestedByRole: "videographer",
      input: { ...input, ...(c && { product: (c.clientBrief as { product?: string }).product }) },
    },
  });
  revalidatePath("/boards", "layout");
}

/** Talent Manager answers a request with a new or existing character. It is ready once the owner locks it. */
export async function fulfilTalent(taskId: string, form: FormData) {
  const t = await db.agentTask.findUniqueOrThrow({ where: { id: z.string().parse(taskId) } });
  if (t.agentRole !== "talentManager" || t.status !== "WAITING") throw new Error("This request is not open");
  const existing = z.string().optional().parse(form.get("creativeAssetId") || undefined);
  const id = existing ?? (await db.creativeAsset.create({
    data: {
      kind: "character",
      name: z.string().trim().min(1).max(80).parse(form.get("name")),
      description: z.string().trim().min(1).max(1500).parse(form.get("description")),
      imageUrls: z.array(z.url({ protocol: /^https?$/ })).max(6).parse(String(form.get("imageUrls") ?? "").split("\n").map((s) => s.trim()).filter(Boolean)),
    },
  })).id;
  await db.agentTask.update({ where: { id: t.id }, data: { input: { ...(t.input as object), creativeAssetId: id } } });
  revalidatePath("/boards", "layout");
}

/** Owner locks (or unlocks) a talent. Locking completes the requests it answers: the hand-off result is recorded. */
export async function setTalentLock(form: FormData) {
  const id = z.string().min(1).parse(form.get("id"));
  const lock = form.get("lock") === "1";
  const a = await db.creativeAsset.update({ where: { id }, data: { lockedAt: lock ? new Date() : null } });
  if (lock) {
    const open = await db.agentTask.findMany({ where: { agentRole: "talentManager", status: "WAITING", input: { path: ["creativeAssetId"], equals: id } } });
    for (const t of open) await saveTaskResult(t.id, "talentManager", { creativeAssetId: a.id, name: a.name, description: a.description, imageUrls: a.imageUrls }, 0);
  }
  revalidatePath("/boards", "layout");
}

// ---------- Feedback ----------

/** Owner feedback (thumbs + comment) aimed at one agent, from Boards or the campaign page. */
export async function addFeedback(form: FormData) {
  const f = z.object({
    agentRole: z.string().refine((r) => ROLES.some((x) => x.agentRole === r), "Unknown agent"),
    campaignId: z.string().min(1).optional(),
    sentiment: z.enum(["positive", "neutral", "negative"]),
    text: z.string().trim().min(1).max(500),
  }).parse({
    agentRole: form.get("agentRole"), campaignId: form.get("campaignId") || undefined, sentiment: form.get("sentiment"), text: form.get("text"),
  });
  await writeFeedback({ ...f, source: "owner_note" });
  revalidatePath("/", "layout");
}
