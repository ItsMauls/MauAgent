ALTER TABLE "AiSettings" ADD COLUMN "imageProviders" TEXT NOT NULL DEFAULT 'magichour,modelark,openrouter',
ADD COLUMN "imageModels" JSONB NOT NULL DEFAULT '{}';
