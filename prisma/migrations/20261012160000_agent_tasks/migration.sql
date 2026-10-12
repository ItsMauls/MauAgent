-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('QUEUED', 'RUNNING', 'WAITING', 'DONE', 'FAILED');

-- DropForeignKey
ALTER TABLE "Artifact" DROP CONSTRAINT "Artifact_campaignId_fkey";

-- AlterTable
ALTER TABLE "Artifact" ADD COLUMN     "agentTaskId" TEXT,
ALTER COLUMN "campaignId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "AgentTask" (
    "id" TEXT NOT NULL,
    "agentRole" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "status" "TaskStatus" NOT NULL DEFAULT 'QUEUED',
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "artifactId" TEXT,
    "campaignId" TEXT,
    "requestedByRole" TEXT,
    "estUsd" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "costUsd" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "confirmedOverCap" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AgentTask_artifactId_key" ON "AgentTask"("artifactId");

-- CreateIndex
CREATE INDEX "AgentTask_agentRole_status_idx" ON "AgentTask"("agentRole", "status");

-- CreateIndex
CREATE INDEX "Artifact_agentTaskId_idx" ON "Artifact"("agentTaskId");

-- AddForeignKey
ALTER TABLE "Artifact" ADD CONSTRAINT "Artifact_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;
