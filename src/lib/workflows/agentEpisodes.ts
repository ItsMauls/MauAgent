import { z } from "zod";
import { inngest } from "@/lib/inngest";
import { writeEpisodes } from "@/lib/agents/memory";

/** After client approval: one episodic memory per agent role. No LLM, so no cost; idempotent via idemKey. */
export const agentEpisodes = inngest.createFunction(
  { id: "agent-episodes", retries: 3 },
  { event: "campaign/approved" },
  async ({ event, step }) => {
    const { campaignId } = z.object({ campaignId: z.string() }).parse(event.data);
    return step.run("write-episodes", () => writeEpisodes(campaignId));
  },
);
