-- CreateEnum
CREATE TYPE "MemoryLayer" AS ENUM ('episodic', 'lesson', 'procedural');

-- AlterTable
ALTER TABLE "Setting" ADD COLUMN     "memoryEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "memoryTokenBudget" INTEGER NOT NULL DEFAULT 800;

-- CreateTable
CREATE TABLE "AgentMemory" (
    "id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "layer" "MemoryLayer" NOT NULL,
    "content" TEXT NOT NULL,
    "tags" TEXT[],
    "campaignId" TEXT,
    "sourceArtifactIds" TEXT[],
    "campaignIds" TEXT[],
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "idemKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentMemory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentMemoryUse" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "memoryIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentMemoryUse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AgentMemory_idemKey_key" ON "AgentMemory"("idemKey");

-- CreateIndex
CREATE INDEX "AgentMemory_role_layer_idx" ON "AgentMemory"("role", "layer");

-- CreateIndex
CREATE UNIQUE INDEX "AgentMemoryUse_runId_role_key" ON "AgentMemoryUse"("runId", "role");

