// Buffer GraphQL API (developers.buffer.com, verified Oct 2026). One personal API key in BUFFER_API_KEY posts to every
// channel connected in Buffer: Instagram, TikTok and Threads. Asset URLs must be publicly reachable (use a presigned S3 URL).
const ENDPOINT = "https://api.buffer.com";

export type BufferService = "instagram" | "tiktok" | "threads";
export type BufferChannel = {
  id: string; name: string; displayName: string | null; service: string;
  isDisconnected: boolean; isLocked: boolean; isQueuePaused: boolean; timezone: string;
};

async function gql<T>(query: string): Promise<T> {
  const key = process.env.BUFFER_API_KEY;
  if (!key) throw new Error("Set BUFFER_API_KEY in .env");
  // The key only travels in this header, so it can never end up in an error string.
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`Buffer HTTP ${res.status}`);
  const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (json.errors?.length) throw new Error(`Buffer: ${json.errors[0].message}`);
  return json.data as T;
}

/** Channels of the key's first organization (a personal key normally has one). */
export async function bufferChannels(): Promise<BufferChannel[]> {
  const { account } = await gql<{ account: { organizations: { id: string }[] } }>(`{ account { organizations { id } } }`);
  const org = account.organizations[0]?.id;
  if (!org) throw new Error("Buffer: no organization on this key");
  const { channels } = await gql<{ channels: BufferChannel[] }>(
    `{ channels(input: { organizationId: ${JSON.stringify(org)} }) { id name displayName service isDisconnected isLocked isQueuePaused timezone } }`,
  );
  return channels;
}

export type BufferPost = {
  channelId: string;
  service: BufferService;
  text: string;
  videoUrl: string;
  /** Omit to post as soon as Buffer can (shareNow); set for a scheduled post. */
  dueAt?: Date;
};

/** Returns the Buffer post id. Instagram is posted as a Reel; the other services need no extra metadata. */
export async function bufferPublish(p: BufferPost): Promise<string> {
  const j = JSON.stringify;
  const meta = p.service === "instagram" ? `metadata: { instagram: { type: reel, shouldShareToFeed: true } }` : "";
  const when = p.dueAt ? `mode: customScheduled\n dueAt: ${j(p.dueAt.toISOString())}` : "mode: shareNow";
  const { createPost } = await gql<{ createPost: { post?: { id: string }; message?: string } }>(`mutation {
    createPost(input: {
      text: ${j(p.text)}
      channelId: ${j(p.channelId)}
      schedulingType: automatic
      ${when}
      assets: [{ video: { url: ${j(p.videoUrl)} } }]
      ${meta}
    }) {
      ... on PostActionSuccess { post { id } }
      ... on MutationError { message }
    }
  }`);
  if (!createPost.post) throw new Error(`Buffer: ${createPost.message ?? "post rejected"}`);
  return createPost.post.id;
}
