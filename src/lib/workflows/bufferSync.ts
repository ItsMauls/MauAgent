import { inngest } from "@/lib/inngest";
import { syncBufferAccounts } from "@/lib/bufferAccounts";

/** Channel sync every 6 hours and on demand. Read-only against Buffer; the Connections page never calls Buffer itself. */
export const bufferSync = inngest.createFunction(
  { id: "buffer-channels-sync", retries: 1 },
  [{ cron: "0 */6 * * *" }, { event: "buffer/channels.sync.requested" }],
  async ({ step }) => step.run("sync", () => syncBufferAccounts()),
);
