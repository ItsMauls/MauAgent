CREATE TYPE "AccountStatus" AS ENUM ('connected', 'needs_reauth', 'disabled', 'missing');
CREATE TYPE "PublishMode" AS ENUM ('queue', 'scheduled', 'draft', 'now');

ALTER TABLE "SocialAccount"
  ADD COLUMN "status" "AccountStatus" NOT NULL DEFAULT 'connected',
  ADD COLUMN "isDefaultForPlatform" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "lastSyncedAt" TIMESTAMP(3),
  ADD COLUMN "avatarUrl" TEXT;

-- Channels already deactivated because they left Buffer keep that meaning.
UPDATE "SocialAccount" SET "status" = 'missing' WHERE "publisher" = 'buffer' AND "active" = false AND "lastError" = 'Channel no longer linked in Buffer';

ALTER TABLE "PublishJob"
  ADD COLUMN "mode" "PublishMode" NOT NULL DEFAULT 'now',
  ADD COLUMN "attempt" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "lastPolledAt" TIMESTAMP(3);

-- Old jobs: a due time meant "scheduled", none meant "post now" (the column default).
UPDATE "PublishJob" SET "mode" = 'scheduled' WHERE "scheduledAt" IS NOT NULL;
