export const ORGANIZATIONS = `query { account { organizations { id } } }`;

export const CHANNELS = `query Channels($organizationId: OrganizationId!) {
  channels(input: { organizationId: $organizationId }) { id name displayName service isDisconnected isLocked isQueuePaused timezone avatar }
}`;

export const CREATE_POST = `mutation CreatePost($input: CreatePostInput!) {
  createPost(input: $input) {
    ... on PostActionSuccess { post { id } }
    ... on MutationError { message }
  }
}`;

// Turns a draft into a scheduled post. editPost REPLACES, it does not merge: without `text` Buffer answers
// "Post must have either text or media", so the text (and a thread's metadata) must travel with it. Verified
// live on 12 Oct 2026, see DECISIONS.md "Buffer Posts scheduler".
export const EDIT_POST = `mutation EditPost($input: EditPostInput!) {
  editPost(input: $input) {
    ... on PostActionSuccess { post { id status dueAt } }
    ... on MutationError { message }
  }
}`;

// Read-only: status, permalink, failure text and (personal key only) metrics.
export const POST = `query Post($id: PostId!) {
  post(input: { id: $id }) { id status dueAt sentAt externalLink error { message } metrics { type name value unit } metricsUpdatedAt }
}`;
