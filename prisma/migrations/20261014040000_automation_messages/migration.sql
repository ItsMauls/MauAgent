-- CreateTable
CREATE TABLE "AutomationMessage" (
    "id" TEXT NOT NULL,
    "automationCampaignId" TEXT NOT NULL,
    "slot" INTEGER,
    "who" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutomationMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AutomationMessage_automationCampaignId_createdAt_idx" ON "AutomationMessage"("automationCampaignId", "createdAt");

-- AddForeignKey
ALTER TABLE "AutomationMessage" ADD CONSTRAINT "AutomationMessage_automationCampaignId_fkey" FOREIGN KEY ("automationCampaignId") REFERENCES "AutomationCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
