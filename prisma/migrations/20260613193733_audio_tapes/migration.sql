-- AlterTable
ALTER TABLE "VoiceComment" ADD COLUMN     "tapeId" TEXT,
ALTER COLUMN "postId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "Tape" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stationId" TEXT,
    "caption" TEXT NOT NULL,
    "thumbnailURL" TEXT NOT NULL,
    "audioURL" TEXT NOT NULL,
    "duration" INTEGER NOT NULL,
    "likes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tape_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Tape_userId_idx" ON "Tape"("userId");

-- CreateIndex
CREATE INDEX "Tape_stationId_idx" ON "Tape"("stationId");

-- CreateIndex
CREATE INDEX "Tape_createdAt_idx" ON "Tape"("createdAt");

-- CreateIndex
CREATE INDEX "VoiceComment_tapeId_idx" ON "VoiceComment"("tapeId");

-- AddForeignKey
ALTER TABLE "Tape" ADD CONSTRAINT "Tape_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tape" ADD CONSTRAINT "Tape_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoiceComment" ADD CONSTRAINT "VoiceComment_tapeId_fkey" FOREIGN KEY ("tapeId") REFERENCES "Tape"("id") ON DELETE CASCADE ON UPDATE CASCADE;
