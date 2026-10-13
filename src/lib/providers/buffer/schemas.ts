import { z } from "zod";

export const OrganizationsData = z.object({ account: z.object({ organizations: z.array(z.object({ id: z.string() })) }) });

export const BufferChannelSchema = z.object({
  id: z.string(), name: z.string(), displayName: z.string().nullable(), service: z.string(),
  isDisconnected: z.boolean(), isLocked: z.boolean(), isQueuePaused: z.boolean(), timezone: z.string(),
  avatar: z.string().nullable().optional(),
});
export type BufferChannel = z.infer<typeof BufferChannelSchema>;
export const ChannelsData = z.object({ channels: z.array(BufferChannelSchema) });

// createPost answers with a union: a post, or a MutationError carrying only a message.
export const CreatePostData = z.object({ createPost: z.object({ post: z.object({ id: z.string() }).optional(), message: z.string().optional() }) });

export const PostStatusSchema = z.enum(["draft", "error", "needs_approval", "scheduled", "sending", "sent"]);

// editPost answers with the same union as createPost, and reports the post's new status and time.
export const EditPostData = z.object({
  editPost: z.object({ post: z.object({ id: z.string(), status: PostStatusSchema, dueAt: z.string().nullable().optional() }).optional(), message: z.string().optional() }),
});
export const PostData = z.object({
  post: z.object({
    id: z.string(), status: PostStatusSchema, dueAt: z.string().nullable().optional(), sentAt: z.string().nullable().optional(),
    externalLink: z.string().nullable().optional(),
    error: z.object({ message: z.string() }).nullable().optional(),
    metrics: z.array(z.object({ type: z.string(), name: z.string(), value: z.number(), unit: z.string() })).nullable().optional(),
    metricsUpdatedAt: z.string().nullable().optional(),
  }),
});
export type BufferPostInfo = z.infer<typeof PostData>["post"];
