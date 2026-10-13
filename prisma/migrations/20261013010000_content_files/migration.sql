-- Facts and personal stories are replaced by uploaded context files; the AI now names its own sources.
DROP TABLE "ContentSource";
DROP TYPE "ContentSourceKind";

CREATE TYPE "ContentFileKind" AS ENUM ('text', 'image');

CREATE TABLE "ContentFile" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "kind" "ContentFileKind" NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentFile_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "PublishJob" ADD COLUMN "sourceNote" TEXT, ADD COLUMN "sourceConfidence" TEXT;
