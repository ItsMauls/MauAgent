import { logger, task } from "@trigger.dev/sdk";

export const helloTask = task({
  id: "hello-task",
  run: async (payload: { name?: string }) => {
    logger.info("hello from Trigger.dev", { name: payload.name });
    return { message: `Hello, ${payload.name ?? "world"}` };
  },
});
