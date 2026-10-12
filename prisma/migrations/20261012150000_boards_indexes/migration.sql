-- CreateIndex
CREATE INDEX "Artifact_agentRole_createdAt_idx" ON "Artifact"("agentRole", "createdAt");

-- CreateIndex
CREATE INDEX "Campaign_status_idx" ON "Campaign"("status");

-- CreateIndex
CREATE INDEX "Run_campaignId_status_idx" ON "Run"("campaignId", "status");

-- CreateIndex
CREATE INDEX "Step_runId_idx" ON "Step"("runId");

-- CreateIndex
CREATE INDEX "Step_agentRole_status_idx" ON "Step"("agentRole", "status");
