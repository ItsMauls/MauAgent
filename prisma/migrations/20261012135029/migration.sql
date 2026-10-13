-- DropForeignKey
ALTER TABLE "PublishJob" DROP CONSTRAINT "PublishJob_campaignId_fkey";

-- AddForeignKey
ALTER TABLE "PublishJob" ADD CONSTRAINT "PublishJob_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;
