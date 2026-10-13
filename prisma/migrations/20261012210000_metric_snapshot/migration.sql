CREATE TABLE "MetricSnapshot" (
    "id" TEXT NOT NULL,
    "publishJobId" TEXT NOT NULL,
    "window" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'buffer',
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metrics" JSONB NOT NULL,

    CONSTRAINT "MetricSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MetricSnapshot_publishJobId_window_key" ON "MetricSnapshot"("publishJobId", "window");

ALTER TABLE "MetricSnapshot" ADD CONSTRAINT "MetricSnapshot_publishJobId_fkey" FOREIGN KEY ("publishJobId") REFERENCES "PublishJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
