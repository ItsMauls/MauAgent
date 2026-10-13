-- Topic bank and personal stories for content-typed text posts.
CREATE TYPE "ContentSourceKind" AS ENUM ('topic', 'story');

CREATE TABLE "ContentSource" (
    "id" TEXT NOT NULL,
    "kind" "ContentSourceKind" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "sourceNote" TEXT,
    "sourceYear" INTEGER,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentSource_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ContentSource_kind_archivedAt_idx" ON "ContentSource"("kind", "archivedAt");
