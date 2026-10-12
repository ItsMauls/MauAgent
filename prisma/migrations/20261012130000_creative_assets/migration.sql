-- CreateEnum
CREATE TYPE "CreativeKind" AS ENUM ('character', 'location', 'style');

-- CreateTable
CREATE TABLE "CreativeAsset" (
    "id" TEXT NOT NULL,
    "kind" "CreativeKind" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "imageUrls" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreativeAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_CampaignToCreativeAsset" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_CampaignToCreativeAsset_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_CampaignToCreativeAsset_B_index" ON "_CampaignToCreativeAsset"("B");

-- AddForeignKey
ALTER TABLE "_CampaignToCreativeAsset" ADD CONSTRAINT "_CampaignToCreativeAsset_A_fkey" FOREIGN KEY ("A") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_CampaignToCreativeAsset" ADD CONSTRAINT "_CampaignToCreativeAsset_B_fkey" FOREIGN KEY ("B") REFERENCES "CreativeAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

