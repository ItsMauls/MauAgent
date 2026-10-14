-- A direct task can hand its output to the next agent automatically (Concept feature: Account Manager → Creative Director).
ALTER TABLE "AgentTask" ADD COLUMN "thenRole" TEXT;
