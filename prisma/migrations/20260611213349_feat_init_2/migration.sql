-- CreateTable
CREATE TABLE "LiveStream" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stationId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "roomId" TEXT NOT NULL,
    "streamId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'live',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "LiveStream_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LiveStream_roomId_key" ON "LiveStream"("roomId");

-- CreateIndex
CREATE UNIQUE INDEX "LiveStream_streamId_key" ON "LiveStream"("streamId");

-- CreateIndex
CREATE INDEX "LiveStream_status_startedAt_idx" ON "LiveStream"("status", "startedAt");

-- CreateIndex
CREATE INDEX "LiveStream_userId_status_idx" ON "LiveStream"("userId", "status");

-- AddForeignKey
ALTER TABLE "LiveStream" ADD CONSTRAINT "LiveStream_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveStream" ADD CONSTRAINT "LiveStream_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station"("id") ON DELETE SET NULL ON UPDATE CASCADE;
