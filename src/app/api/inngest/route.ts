import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest";
import { campaignPipeline } from "@/lib/workflows/campaignPipeline";
import { agentEpisodes } from "@/lib/workflows/agentEpisodes";
import { accountsRefresh } from "@/lib/workflows/accountsRefresh";
import { integrationsHealth } from "@/lib/workflows/integrationsHealth";
import { publishJob } from "@/lib/workflows/publishJob";
import { agentTask } from "@/lib/workflows/agentTask";
import { trendScout } from "@/lib/workflows/trendScout";
import { bufferSync } from "@/lib/workflows/bufferSync";
import { bufferMetrics } from "@/lib/workflows/bufferMetrics";
import { scheduleApply } from "@/lib/workflows/scheduleApply";
import { bufferPostsSync } from "@/lib/workflows/bufferPostsSync";

// Post-production (FFmpeg) runs inside this request; raise the limit when deploying to serverless.
export const maxDuration = 300;

export const { GET, POST, PUT } = serve({ client: inngest, functions: [campaignPipeline, agentEpisodes, accountsRefresh, integrationsHealth, agentTask, trendScout, publishJob, bufferSync, bufferMetrics, scheduleApply, bufferPostsSync] });
