-- CreateTable
CREATE TABLE "AgentMessage" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "agentRole" TEXT NOT NULL,
    "toRole" TEXT,
    "kind" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentMessage_campaignId_createdAt_idx" ON "AgentMessage"("campaignId", "createdAt");

-- AddForeignKey
ALTER TABLE "AgentMessage" ADD CONSTRAINT "AgentMessage_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
