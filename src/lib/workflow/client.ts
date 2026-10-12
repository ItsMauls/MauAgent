import { inngestWorkflow } from "./inngest";
import { triggerWorkflow } from "./trigger";

/** Engine-agnostic entry points; the app never imports Inngest or Trigger.dev for these flows directly. */
export interface WorkflowClient {
  startCampaign(campaignId: string, from?: unknown): Promise<void>;
  sendDecision(campaignId: string, decision: { decisionId: string } & Record<string, unknown>): Promise<void>;
  completeUpload(campaignId: string): Promise<void>;
  requestAgentTask(taskId: string, attempt: number): Promise<void>;
}

/** WORKFLOW_ENGINE=inngest|trigger (default inngest until parity is proven). */
export function getWorkflowClient(): WorkflowClient {
  return process.env.WORKFLOW_ENGINE === "trigger" ? triggerWorkflow : inngestWorkflow;
}
