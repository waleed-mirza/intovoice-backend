import type { PrismaClient } from "@prisma/client";

/** No heartbeat for this long while still "live" → treat as abandoned. */
const STALE_HEARTBEAT_MS = 90 * 1000;

/** Grace period after start before requiring a host heartbeat. */
const GRACE_WITHOUT_HEARTBEAT_MS = 2 * 60 * 1000;

/** Hard cap — no broadcast stays live longer than this. */
const MAX_LIVE_DURATION_MS = 12 * 60 * 60 * 1000;

/**
 * Marks abandoned or expired broadcasts as ended.
 * Covers hosts who left before auto-end, crashed, or lost network without calling /end.
 */
export async function cleanupStaleLiveStreams(prisma: PrismaClient): Promise<number> {
  const now = Date.now();
  const staleHeartbeatCutoff = new Date(now - STALE_HEARTBEAT_MS);
  const graceCutoff = new Date(now - GRACE_WITHOUT_HEARTBEAT_MS);
  const maxDurationCutoff = new Date(now - MAX_LIVE_DURATION_MS);

  const result = await prisma.liveStream.updateMany({
    where: {
      status: "live",
      OR: [
        { startedAt: { lt: maxDurationCutoff } },
        {
          lastHeartbeatAt: null,
          startedAt: { lt: graceCutoff },
        },
        {
          lastHeartbeatAt: { lt: staleHeartbeatCutoff },
        },
      ],
    },
    data: {
      status: "ended",
      endedAt: new Date(),
    },
  });

  return result.count;
}
