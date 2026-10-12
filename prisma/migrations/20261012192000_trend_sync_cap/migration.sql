-- One sync is 4 actor runs (hashtags + videos, 7 and 30 days): daily = ~120 runs a month.
ALTER TABLE "TrendSourceSettings" ALTER COLUMN "monthlyRunCap" SET DEFAULT 150;
UPDATE "TrendSourceSettings" SET "monthlyRunCap" = 150 WHERE "monthlyRunCap" = 60;
