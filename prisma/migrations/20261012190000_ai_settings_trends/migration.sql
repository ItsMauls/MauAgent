-- CreateEnum
CREATE TYPE "ReasoningEffort" AS ENUM ('off', 'low', 'medium', 'high');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CostReason" ADD VALUE 'trend';
ALTER TYPE "CostReason" ADD VALUE 'test';

-- DropForeignKey
ALTER TABLE "CostEntry" DROP CONSTRAINT "CostEntry_campaignId_fkey";

-- AlterTable
ALTER TABLE "CostEntry" ADD COLUMN     "agentRole" TEXT,
ADD COLUMN     "keyLabel" TEXT,
ADD COLUMN     "output" JSONB,
ADD COLUMN     "tokensIn" INTEGER,
ADD COLUMN     "tokensOut" INTEGER,
ADD COLUMN     "tokensReasoning" INTEGER,
ALTER COLUMN "campaignId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "AiSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "brandKitId" TEXT,
    "defaultModel" TEXT,
    "reasoningEffort" "ReasoningEffort" NOT NULL DEFAULT 'low',
    "maxOutputTokens" INTEGER NOT NULL DEFAULT 4096,
    "temperature" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "perAgentOverrides" JSONB NOT NULL DEFAULT '{"creativeDirector":{"reasoningEffort":"medium"},"accountTeam":{"reasoningEffort":"low"},"router":{"reasoningEffort":"off"}}',
    "monthlyBudgetUsd" DECIMAL(10,2) NOT NULL DEFAULT 40,
    "maxCostPerCallUsd" DECIMAL(10,4) NOT NULL DEFAULT 0.5,
    "monthlyTokenCap" INTEGER NOT NULL DEFAULT 5000000,
    "enableFallbackKey" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "AiSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrendSourceSettings" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'apify_tiktok',
    "brandKitId" TEXT,
    "trendType" TEXT NOT NULL DEFAULT 'hashtags',
    "maxItems" INTEGER NOT NULL DEFAULT 20,
    "countryCode" TEXT NOT NULL,
    "hashtagPeriod" TEXT NOT NULL DEFAULT '7',
    "industryId" TEXT NOT NULL DEFAULT '',
    "videoCountry" TEXT NOT NULL,
    "videoPeriod" TEXT NOT NULL DEFAULT '7',
    "videoContentTag" TEXT NOT NULL DEFAULT '',
    "videoOrderBy" TEXT NOT NULL DEFAULT '1',
    "videoOrganicOnly" BOOLEAN NOT NULL DEFAULT false,
    "saveMedia" BOOLEAN NOT NULL DEFAULT false,
    "useApifyProxy" BOOLEAN NOT NULL DEFAULT true,
    "scheduleCron" TEXT NOT NULL DEFAULT '0 6 * * *',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "cacheHours" INTEGER NOT NULL DEFAULT 20,
    "monthlyRunCap" INTEGER NOT NULL DEFAULT 60,
    "maxCostPerRunUsd" DECIMAL(10,4) NOT NULL DEFAULT 0.5,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrendSourceSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrendRun" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'apify_tiktok',
    "idemKey" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "apifyRunId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "itemCount" INTEGER,
    "durationMs" INTEGER,
    "usd" DECIMAL(10,4),
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "TrendRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrendSignal" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "trendType" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "outlierScore" DOUBLE PRECISION NOT NULL,
    "hook" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "audio" TEXT,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "capturedDay" DATE NOT NULL,
    "rawPayload" JSONB NOT NULL,

    CONSTRAINT "TrendSignal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TrendSourceSettings_source_brandKitId_key" ON "TrendSourceSettings"("source", "brandKitId");

-- CreateIndex
CREATE UNIQUE INDEX "TrendRun_idemKey_key" ON "TrendRun"("idemKey");

-- CreateIndex
CREATE INDEX "TrendRun_source_status_startedAt_idx" ON "TrendRun"("source", "status", "startedAt");

-- CreateIndex
CREATE INDEX "TrendSignal_capturedAt_outlierScore_idx" ON "TrendSignal"("capturedAt", "outlierScore");

-- CreateIndex
CREATE UNIQUE INDEX "TrendSignal_source_externalId_capturedDay_key" ON "TrendSignal"("source", "externalId", "capturedDay");

-- CreateIndex
CREATE INDEX "CostEntry_provider_createdAt_idx" ON "CostEntry"("provider", "createdAt");

-- AddForeignKey
ALTER TABLE "CostEntry" ADD CONSTRAINT "CostEntry_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: LLM cost used to live only on Artifact.costUsd. CostEntry is now the single ledger, so copy it once.
INSERT INTO "CostEntry" ("id", "campaignId", "step", "provider", "model", "agentRole", "units", "unitPrice", "usd", "reason", "idemKey", "createdAt")
SELECT 'bf_' || a."id", a."campaignId", a."agentRole", 'google', 'unknown', a."agentRole", 0, 0, a."costUsd", 'initial', 'artifact:' || a."id", a."createdAt"
FROM "Artifact" a
WHERE a."costUsd" > 0
ON CONFLICT ("idemKey") DO NOTHING;
