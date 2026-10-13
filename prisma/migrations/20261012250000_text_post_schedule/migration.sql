-- Text posts (X, Threads) scheduled from a Socmed Specialist task have no campaign and no video.
-- Dropping NOT NULL rewrites no rows, and both new columns are nullable or defaulted, so existing jobs are untouched.
ALTER TABLE "PublishJob" ALTER COLUMN "campaignId" DROP NOT NULL;

-- Thread parts after `caption` (which is part 1). Empty = a single post.
ALTER TABLE "PublishJob" ADD COLUMN "thread" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "PublishJob" ADD COLUMN "agentTaskId" TEXT;

CREATE INDEX "PublishJob_agentTaskId_idx" ON "PublishJob"("agentTaskId");

ALTER TABLE "PublishJob" ADD CONSTRAINT "PublishJob_agentTaskId_fkey" FOREIGN KEY ("agentTaskId") REFERENCES "AgentTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;
