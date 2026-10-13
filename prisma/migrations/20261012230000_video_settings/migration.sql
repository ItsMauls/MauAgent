ALTER TABLE "AiSettings" ADD COLUMN "videoProviders" TEXT NOT NULL DEFAULT 'byteplus,magichour',
ADD COLUMN "videoModels" JSONB NOT NULL DEFAULT '{}';
