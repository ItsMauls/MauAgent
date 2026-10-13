// Buffer GraphQL API (developers.buffer.com, verified Oct 2026; see DECISIONS.md "Buffer connections").
import { bufferEnv } from "@/lib/ai/env";
import { bufferRequest, BufferValidationError, type BufferDeps } from "./client";
import { CHANNELS, CREATE_POST, EDIT_POST, ORGANIZATIONS, POST } from "./queries";
import { ChannelsData, CreatePostData, EditPostData, OrganizationsData, PostData, type BufferChannel } from "./schemas";
import { editInput, postInput, scheduleInput, type PostBody } from "./mapper";

export type { BufferChannel, BufferPostInfo } from "./schemas";
export * from "./mapper";
export * from "./client";

/** The configured organization, else the key's first one. */
export async function bufferOrganizationId(deps: BufferDeps = {}): Promise<string> {
  const configured = bufferEnv(deps.env).BUFFER_ORGANIZATION_ID;
  if (configured) return configured;
  const { account } = await bufferRequest(ORGANIZATIONS, {}, OrganizationsData, deps);
  const id = account.organizations[0]?.id;
  if (!id) throw new BufferValidationError("Buffer: no organization on this key");
  return id;
}

export async function bufferOrgChannels(deps: BufferDeps = {}): Promise<{ organizationId: string; channels: BufferChannel[] }> {
  const organizationId = await bufferOrganizationId(deps);
  return { organizationId, channels: (await bufferRequest(CHANNELS, { organizationId }, ChannelsData, deps)).channels };
}

export const bufferChannels = async (deps: BufferDeps = {}) => (await bufferOrgChannels(deps)).channels;

export type BufferPost = PostBody;

/** Returns the Buffer post id. Never retried automatically: the caller records the id before anything can repeat it. */
export async function bufferPublish(p: BufferPost, deps: BufferDeps = {}): Promise<string> {
  const { createPost } = await bufferRequest(CREATE_POST, { input: postInput(p) }, CreatePostData, { ...deps, mutation: true });
  if (!createPost.post) throw new BufferValidationError(`Buffer: ${createPost.message ?? "post rejected"}`);
  return createPost.post.id;
}

/** Turns one of our Buffer drafts into a scheduled post. Safe to repeat: editing a scheduled post is a no-op change. */
export async function bufferSchedule(p: Parameters<typeof scheduleInput>[0], deps: BufferDeps = {}): Promise<string> {
  const { editPost } = await bufferRequest(EDIT_POST, { input: scheduleInput(p) }, EditPostData, { ...deps, mutation: true });
  if (!editPost.post) throw new BufferValidationError(`Buffer: ${editPost.message ?? "post rejected"}`);
  return editPost.post.status;
}

/** Edits a post Buffer holds (text, thread, time, draft / queue / now). Returns Buffer's new status. */
export async function bufferEdit(p: Parameters<typeof editInput>[0], deps: BufferDeps = {}): Promise<string> {
  const { editPost } = await bufferRequest(EDIT_POST, { input: editInput(p) }, EditPostData, { ...deps, mutation: true });
  if (!editPost.post) throw new BufferValidationError(`Buffer: ${editPost.message ?? "post rejected"}`);
  return editPost.post.status;
}

export async function bufferPost(id: string, deps: BufferDeps = {}) {
  return (await bufferRequest(POST, { id }, PostData, deps)).post;
}
