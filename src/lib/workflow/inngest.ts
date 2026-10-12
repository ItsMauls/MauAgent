import { inngest } from "@/lib/inngest";
import type { WorkflowClient } from "./client";

export const inngestWorkflow: WorkflowClient = {
  async startCampaign(campaignId, from) {
    await inngest.send({ name: "campaign/brief.submitted", data: { campaignId, ...(from ? { from } : {}) } });
  },
  async sendDecision(campaignId, decision) {
    await inngest.send({ name: "campaign/client.decision", data: { campaignId, ...decision } });
  },
  async completeUpload(campaignId) {
    await inngest.send({ name: "campaign/assets.complete", data: { campaignId } });
  },
  async requestAgentTask(taskId, attempt) {
    await inngest.send({ id: `${taskId}:${attempt}`, name: "agent/task.requested", data: { taskId } });
  },
};
