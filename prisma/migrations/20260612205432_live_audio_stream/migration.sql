-- AlterTable
ALTER TABLE "LiveStream" ADD COLUMN     "lastHeartbeatAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "LiveStream_status_lastHeartbeatAt_idx" ON "LiveStream"("status", "lastHeartbeatAt");
