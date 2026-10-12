-- CreateTable
CREATE TABLE "AgentProfile" (
    "id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "persona" JSONB NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AgentProfile_role_version_key" ON "AgentProfile"("role", "version");
