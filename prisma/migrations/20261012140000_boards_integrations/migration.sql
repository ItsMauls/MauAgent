-- AlterTable
ALTER TABLE "Setting" ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'Asia/Jakarta';

-- CreateTable
CREATE TABLE "IntegrationStatus" (
    "id" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "summary" TEXT,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntegrationStatus_pkey" PRIMARY KEY ("id")
);
