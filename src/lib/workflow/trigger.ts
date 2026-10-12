import { tasks } from "@trigger.dev/sdk";
import type { WorkflowClient } from "./client";
import type { helloTask } from "@/trigger/hello";

// The only app-side file that imports the Trigger.dev SDK (type-only import of task code).
export async function triggerHello(name?: string) {
  const handle = await tasks.trigger<typeof helloTask>("hello-task", { name });
  return { runId: handle.id };
}

const notYet = (m: string) => async (): Promise<never> => {
  throw new Error(`WorkflowClient.${m} on Trigger.dev is not implemented until Phase 2`);
};

export const triggerWorkflow: WorkflowClient = {
  startCampaign: notYet("startCampaign"),
  sendDecision: notYet("sendDecision"),
  completeUpload: notYet("completeUpload"),
  requestAgentTask: notYet("requestAgentTask"),
};
