import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest";
import { campaignPipeline } from "@/lib/workflows/campaignPipeline";
import { agentEpisodes } from "@/lib/workflows/agentEpisodes";
import { accountsRefresh } from "@/lib/workflows/accountsRefresh";

// Post-production (FFmpeg) runs inside this request; raise the limit when deploying to serverless.
export const maxDuration = 300;

export const { GET, POST, PUT } = serve({ client: inngest, functions: [campaignPipeline, agentEpisodes, accountsRefresh] });
