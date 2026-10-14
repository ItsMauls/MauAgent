-- CreateEnum
CREATE TYPE "AutomationStatus" AS ENUM ('draft', 'piloting', 'awaiting_scale', 'running', 'paused', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "AutomationPause" AS ENUM ('manual', 'budget', 'kill_switch', 'quota');

-- CreateEnum
CREATE TYPE "CampaignPostStatus" AS ENUM ('planned', 'generating', 'qc', 'needs_review', 'approved', 'scheduled', 'published', 'failed', 'rejected', 'skipped', 'cancelled');

-- CreateEnum
CREATE TYPE "ApprovalSource" AS ENUM ('human', 'qc_auto');

-- AlterTable
ALTER TABLE "CostEntry" ADD COLUMN     "automationCampaignId" TEXT;

-- CreateTable
CREATE TABLE "AutomationCampaign" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "AutomationStatus" NOT NULL DEFAULT 'draft',
    "pauseReason" "AutomationPause",
    "goal" JSONB NOT NULL,
    "budgetCapUsd" DECIMAL(10,2) NOT NULL,
    "warnAtPct" INTEGER NOT NULL DEFAULT 80,
    "planConfig" JSONB NOT NULL,
    "reviewPolicy" JSONB NOT NULL,
    "qcConfig" JSONB NOT NULL,
    "generationConfig" JSONB NOT NULL,
    "seed" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignPost" (
    "id" TEXT NOT NULL,
    "automationCampaignId" TEXT NOT NULL,
    "slot" INTEGER NOT NULL,
    "platform" "Platform" NOT NULL,
    "socialAccountId" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "angles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "pillar" TEXT,
    "topicSeed" TEXT NOT NULL,
    "cta" TEXT,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "localTime" TEXT NOT NULL,
    "pilot" BOOLEAN NOT NULL DEFAULT false,
    "status" "CampaignPostStatus" NOT NULL DEFAULT 'planned',
    "text" TEXT,
    "thread" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "variants" JSONB,
    "sourceNote" TEXT,
    "qcReport" JSONB,
    "confidence" DOUBLE PRECISION,
    "approvalSource" "ApprovalSource",
    "approvalPolicySnapshot" JSONB,
    "approvedAt" TIMESTAMP(3),
    "humanDecision" TEXT,
    "qcAgreed" BOOLEAN,
    "publishJobId" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "failureReason" TEXT,
    "costUsd" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignPost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AutomationCampaign_status_idx" ON "AutomationCampaign"("status");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignPost_publishJobId_key" ON "CampaignPost"("publishJobId");

-- CreateIndex
CREATE INDEX "CampaignPost_automationCampaignId_status_idx" ON "CampaignPost"("automationCampaignId", "status");

-- CreateIndex
CREATE INDEX "CampaignPost_automationCampaignId_scheduledAt_idx" ON "CampaignPost"("automationCampaignId", "scheduledAt");

-- CreateIndex
CREATE INDEX "CampaignPost_socialAccountId_scheduledAt_idx" ON "CampaignPost"("socialAccountId", "scheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignPost_automationCampaignId_slot_socialAccountId_key" ON "CampaignPost"("automationCampaignId", "slot", "socialAccountId");

-- CreateIndex
CREATE INDEX "CostEntry_automationCampaignId_createdAt_idx" ON "CostEntry"("automationCampaignId", "createdAt");

-- AddForeignKey
ALTER TABLE "CostEntry" ADD CONSTRAINT "CostEntry_automationCampaignId_fkey" FOREIGN KEY ("automationCampaignId") REFERENCES "AutomationCampaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignPost" ADD CONSTRAINT "CampaignPost_automationCampaignId_fkey" FOREIGN KEY ("automationCampaignId") REFERENCES "AutomationCampaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignPost" ADD CONSTRAINT "CampaignPost_socialAccountId_fkey" FOREIGN KEY ("socialAccountId") REFERENCES "SocialAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignPost" ADD CONSTRAINT "CampaignPost_publishJobId_fkey" FOREIGN KEY ("publishJobId") REFERENCES "PublishJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;
