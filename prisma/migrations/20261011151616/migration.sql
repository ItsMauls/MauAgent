-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFTING', 'AWAITING_VIDEO_UPLOAD', 'POST_PRODUCTION', 'AWAITING_APPROVAL', 'REVISING', 'REGENERATING', 'APPROVED', 'PUBLISHING', 'PUBLISHED', 'REJECTED', 'EXPIRED', 'FAILED');

-- CreateEnum
CREATE TYPE "VideoSource" AS ENUM ('seedance_api', 'manual_upload');

-- CreateEnum
CREATE TYPE "AssetOrigin" AS ENUM ('seedance', 'upload');

-- CreateEnum
CREATE TYPE "DecisionType" AS ENUM ('approve', 'revise', 'regenerate', 'reject');

-- CreateEnum
CREATE TYPE "CostReason" AS ENUM ('initial', 'revision', 'regenerate');

-- CreateTable
CREATE TABLE "BrandKit" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "logoUrl" TEXT,
    "palette" JSONB,
    "fonts" JSONB,
    "voiceId" TEXT,
    "styleNotes" TEXT,

    CONSTRAINT "BrandKit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "campaignBudgetUsd" DECIMAL(10,2) NOT NULL DEFAULT 20,
    "monthlyBudgetUsd" DECIMAL(10,2) NOT NULL DEFAULT 300,
    "defaultVideoSource" "VideoSource" NOT NULL DEFAULT 'manual_upload',

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "brandKitId" TEXT,
    "clientBrief" JSONB NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFTING',
    "budgetCapUsd" DECIMAL(10,2) NOT NULL,
    "defaultSource" "VideoSource" NOT NULL,
    "finalCutKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Run" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "inngestRunId" TEXT,
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "Run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Step" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "agentRole" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "Step_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Artifact" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "agentRole" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "costUsd" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "runId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Artifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shot" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "shotId" TEXT NOT NULL,
    "source" "VideoSource" NOT NULL,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "promptPackage" JSONB,

    CONSTRAINT "Shot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShotAsset" (
    "id" TEXT NOT NULL,
    "shotId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "s3Key" TEXT NOT NULL,
    "durationSec" DOUBLE PRECISION,
    "hasAudio" BOOLEAN,
    "validation" JSONB,
    "origin" "AssetOrigin" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShotAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Decision" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "type" "DecisionType" NOT NULL,
    "notes" TEXT,
    "targetAgent" TEXT,
    "shotIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Decision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostEntry" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "units" DECIMAL(12,4) NOT NULL,
    "unitPrice" DECIMAL(12,6) NOT NULL,
    "usd" DECIMAL(10,4) NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "reason" "CostReason" NOT NULL DEFAULT 'initial',
    "idemKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CostEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceBook" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "unitPrice" DECIMAL(12,6) NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceBook_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Artifact_campaignId_agentRole_version_key" ON "Artifact"("campaignId", "agentRole", "version");

-- CreateIndex
CREATE UNIQUE INDEX "Shot_campaignId_shotId_key" ON "Shot"("campaignId", "shotId");

-- CreateIndex
CREATE UNIQUE INDEX "ShotAsset_shotId_version_key" ON "ShotAsset"("shotId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "CostEntry_idemKey_key" ON "CostEntry"("idemKey");

-- CreateIndex
CREATE UNIQUE INDEX "PriceBook_provider_model_effectiveFrom_key" ON "PriceBook"("provider", "model", "effectiveFrom");

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_brandKitId_fkey" FOREIGN KEY ("brandKitId") REFERENCES "BrandKit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Run" ADD CONSTRAINT "Run_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Step" ADD CONSTRAINT "Step_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Artifact" ADD CONSTRAINT "Artifact_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shot" ADD CONSTRAINT "Shot_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShotAsset" ADD CONSTRAINT "ShotAsset_shotId_fkey" FOREIGN KEY ("shotId") REFERENCES "Shot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostEntry" ADD CONSTRAINT "CostEntry_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
