-- CreateEnum
CREATE TYPE "FeedbackSource" AS ENUM ('client_decision', 'qc', 'metrics', 'owner_note');

-- CreateEnum
CREATE TYPE "Sentiment" AS ENUM ('positive', 'neutral', 'negative');

-- CreateTable
CREATE TABLE "AgentFeedback" (
    "id" TEXT NOT NULL,
    "agentRole" TEXT NOT NULL,
    "campaignId" TEXT,
    "agentTaskId" TEXT,
    "source" "FeedbackSource" NOT NULL,
    "sentiment" "Sentiment" NOT NULL,
    "text" TEXT NOT NULL,
    "idemKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AgentFeedback_idemKey_key" ON "AgentFeedback"("idemKey");

-- CreateIndex
CREATE INDEX "AgentFeedback_agentRole_createdAt_idx" ON "AgentFeedback"("agentRole", "createdAt");

-- CreateIndex
CREATE INDEX "AgentFeedback_campaignId_idx" ON "AgentFeedback"("campaignId");
