"use server";
import { revalidatePath } from "next/cache";
import { createAutomationCampaign } from "@/lib/automation/store";

/** Creates the campaign and its whole plan (status draft). Infeasible goals and over-limit targets throw. */
export async function createAutomation(raw: unknown) {
  const c = await createAutomationCampaign(raw);
  revalidatePath("/campaigns/automation");
  return { id: c.id };
}
