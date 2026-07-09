import { Router } from "express";
import { createNotification } from "../notification";
import { cleanupStaleLiveStreams } from "../../services/cleanupStaleLiveStreams";
import { MAX_LIVE_DURATION_MS } from "../../services/liveLimits";
import { generateLiveToken } from "../../services/zegoToken";

const router = Router();

const liveInclude = {
  user: {
    select: {
      id: true,
      name: true,
      username: true,
      profileImg: true,
    },
  },
  station: {
    select: {
      id: true,
      name: true,
      handle: true,
      avatarURL: true,
    },
  },
};

const isPastMaxLiveDuration = (startedAt: Date) =>
  Date.now() - new Date(startedAt).getTime() >= MAX_LIVE_DURATION_MS;

const endStreamIfExpired = async (prisma: any, stream: any) => {
  if (stream.status !== "live" || !isPastMaxLiveDuration(stream.startedAt)) {
    return null;
  }

  return prisma.liveStream.update({
    where: { id: stream.id },
    data: { status: "ended", endedAt: new Date() },
    include: liveInclude,
  });
};

const formatLiveStream = (stream: any) => ({
  id: stream.id,
  title: stream.title,
  description: stream.description,
  roomId: stream.roomId,
  streamId: stream.streamId,
  status: stream.status,
  startedAt: stream.startedAt,
  endedAt: stream.endedAt,
  user: stream.user,
  station: stream.station,
});

const notifyStationSubscribers = async (
  prisma: any,
  streamerId: string,
  streamerName: string,
  liveStream: any
) => {
  const subscriptions = await prisma.voiceSubscription.findMany({
    where: {
      station: { userId: streamerId },
    },
    select: { userId: true },
    distinct: ["userId"],
  });

  const content = JSON.stringify({
    liveStreamId: liveStream.id,
    title: liveStream.title,
    stationId: liveStream.stationId,
    stationName: liveStream.station?.name,
  });

  await Promise.all(
    subscriptions.map((sub: { userId: string }) =>
      createNotification(prisma, {
        senderName: streamerName,
        senderId: streamerId,
        receiverId: sub.userId,
        type: "voice_live",
        content,
      })
    )
  );
};

const runStaleCleanup = async (prisma: any) => {
  try {
    await cleanupStaleLiveStreams(prisma);
  } catch (error: any) {
    console.log("Stale live cleanup failed:", error.message);
  }
};

// GET /voice/live/active
router.get("/active", async (req: any, res: any) => {
  try {
    await runStaleCleanup(req.prisma);

    const { page = 1, limit = 20 } = req.query;
    const pageNum = parseInt(page as string, 10) || 1;
    const limitNum = Math.min(parseInt(limit as string, 10) || 20, 50);
    const skip = (pageNum - 1) * limitNum;

    const where = { status: "live" };

    const total = await req.prisma.liveStream.count({ where });
    const streams = await req.prisma.liveStream.findMany({
      where,
      include: liveInclude,
      orderBy: { startedAt: "desc" },
      skip,
      take: limitNum,
    });

    res.status(200).json({
      result: streams.map(formatLiveStream),
      pagination: {
        currentPage: pageNum,
        totalPages: Math.ceil(total / limitNum),
        total,
        hasMore: skip + limitNum < total,
      },
    });
  } catch (error: any) {
    console.log(error.message);
    res.status(500).json({ message: error.message });
  }
});

// GET /voice/live/my-active
router.get("/my-active", async (req: any, res: any) => {
  try {
    await runStaleCleanup(req.prisma);

    const stream = await req.prisma.liveStream.findFirst({
      where: { userId: req.userId, status: "live" },
      include: liveInclude,
    });

    res.status(200).json({ result: stream ? formatLiveStream(stream) : null });
  } catch (error: any) {
    console.log(error.message);
    res.status(500).json({ message: error.message });
  }
});

// GET /voice/live/:id/token?role=host|audience
router.get("/:id/token", async (req: any, res: any) => {
  try {
    await runStaleCleanup(req.prisma);

    const role = (req.query.role as string) || "audience";
    if (role !== "host" && role !== "audience") {
      return res.status(400).json({ message: "role must be host or audience" });
    }

    const stream = await req.prisma.liveStream.findUnique({
      where: { id: req.params.id },
    });

    if (!stream) {
      return res.status(404).json({ message: "Live stream not found" });
    }

    if (stream.status !== "live") {
      return res.status(410).json({ message: "This broadcast has ended" });
    }

    const expired = await endStreamIfExpired(req.prisma, stream);
    if (expired) {
      return res.status(410).json({
        message: "This broadcast has ended",
        result: formatLiveStream(expired),
      });
    }

    if (role === "host" && stream.userId !== req.userId) {
      return res.status(403).json({ message: "Only the host can request a host token" });
    }

    const tokenData = generateLiveToken(req.userId, stream.roomId, role);

    res.status(200).json({
      result: {
        ...tokenData,
        roomId: stream.roomId,
        streamId: stream.streamId,
        role,
      },
    });
  } catch (error: any) {
    console.log(error.message);
    res.status(500).json({ message: error.message });
  }
});

// GET /voice/live/:id
router.get("/:id", async (req: any, res: any) => {
  try {
    await runStaleCleanup(req.prisma);

    const stream = await req.prisma.liveStream.findUnique({
      where: { id: req.params.id },
      include: liveInclude,
    });

    if (!stream) {
      return res.status(404).json({ message: "Live stream not found" });
    }

    if (stream.status !== "live") {
      return res.status(410).json({
        message: "This broadcast has ended",
        result: formatLiveStream(stream),
      });
    }

    const expired = await endStreamIfExpired(req.prisma, stream);
    if (expired) {
      return res.status(410).json({
        message: "This broadcast has ended",
        result: formatLiveStream(expired),
      });
    }

    res.status(200).json({ result: formatLiveStream(stream) });
  } catch (error: any) {
    console.log(error.message);
    res.status(500).json({ message: error.message });
  }
});

// POST /voice/live/start
router.post("/start", async (req: any, res: any) => {
  try {
    const { title, description, stationId } = req.body;

    if (!title || typeof title !== "string" || !title.trim()) {
      return res.status(400).json({ message: "title is required" });
    }

    const trimmedTitle = title.trim().slice(0, 80);
    const trimmedDescription =
      typeof description === "string" ? description.trim().slice(0, 300) : null;

    if (stationId) {
      const station = await req.prisma.station.findUnique({
        where: { id: stationId },
      });
      if (!station) {
        return res.status(404).json({ message: "Station not found" });
      }
      if (station.userId !== req.userId) {
        return res.status(403).json({ message: "You do not own this station" });
      }
    }

    await req.prisma.liveStream.updateMany({
      where: { userId: req.userId, status: "live" },
      data: { status: "ended", endedAt: new Date() },
    });

    const draft = await req.prisma.liveStream.create({
      data: {
        userId: req.userId,
        stationId: stationId || null,
        title: trimmedTitle,
        description: trimmedDescription || null,
        roomId: "pending",
        streamId: "pending",
        status: "live",
        lastHeartbeatAt: new Date(),
      },
    });

    const liveStream = await req.prisma.liveStream.update({
      where: { id: draft.id },
      data: {
        roomId: `live_${draft.id}`,
        streamId: `stream_${draft.id}`,
      },
      include: liveInclude,
    });

    const user = await req.prisma.user.findUnique({
      where: { id: req.userId },
      select: { name: true },
    });

    await notifyStationSubscribers(
      req.prisma,
      req.userId,
      user?.name || "Someone",
      liveStream
    );

    res.status(201).json({ result: formatLiveStream(liveStream) });
  } catch (error: any) {
    console.log(error.message);
    res.status(500).json({ message: error.message });
  }
});

// POST /voice/live/:id/listener-profiles — host batch lookup for listener avatars
router.post("/:id/listener-profiles", async (req: any, res: any) => {
  try {
    const { userIds } = req.body;
    if (!Array.isArray(userIds) || userIds.length === 0) {
      return res.status(200).json({ result: [] });
    }

    const stream = await req.prisma.liveStream.findUnique({
      where: { id: req.params.id },
    });

    if (!stream) {
      return res.status(404).json({ message: "Live stream not found" });
    }

    if (stream.userId !== req.userId) {
      return res.status(403).json({ message: "Only the host can view listener profiles" });
    }

    if (stream.status !== "live") {
      return res.status(410).json({ message: "This broadcast has ended" });
    }

    const ids = [
      ...new Set(
        userIds.filter(
          (id: unknown): id is string =>
            typeof id === "string" && id.trim().length > 0 && id !== stream.userId
        )
      ),
    ].slice(0, 50);

    if (ids.length === 0) {
      return res.status(200).json({ result: [] });
    }

    const users = await req.prisma.user.findMany({
      where: {
        id: { in: ids },
        isDeleted: false,
      },
      select: {
        id: true,
        name: true,
        username: true,
        profileImg: true,
      },
    });

    res.status(200).json({ result: users });
  } catch (error: any) {
    console.log(error.message);
    res.status(500).json({ message: error.message });
  }
});

// POST /voice/live/:id/heartbeat — host keeps broadcast alive on the server
router.post("/:id/heartbeat", async (req: any, res: any) => {
  try {
    const stream = await req.prisma.liveStream.findUnique({
      where: { id: req.params.id },
    });

    if (!stream) {
      return res.status(404).json({ message: "Live stream not found" });
    }

    if (stream.userId !== req.userId) {
      return res.status(403).json({ message: "Only the host can send heartbeats" });
    }

    if (stream.status !== "live") {
      return res.status(410).json({ message: "This broadcast has ended" });
    }

    const expired = await endStreamIfExpired(req.prisma, stream);
    if (expired) {
      return res.status(410).json({
        message: "This broadcast has reached the 59-minute limit",
        result: formatLiveStream(expired),
      });
    }

    const updated = await req.prisma.liveStream.update({
      where: { id: stream.id },
      data: { lastHeartbeatAt: new Date() },
      include: liveInclude,
    });

    res.status(200).json({ result: formatLiveStream(updated) });
  } catch (error: any) {
    console.log(error.message);
    res.status(500).json({ message: error.message });
  }
});

// POST /voice/live/:id/end
router.post("/:id/end", async (req: any, res: any) => {
  try {
    const stream = await req.prisma.liveStream.findUnique({
      where: { id: req.params.id },
    });

    if (!stream) {
      return res.status(404).json({ message: "Live stream not found" });
    }

    if (stream.userId !== req.userId) {
      return res.status(403).json({ message: "Only the host can end this broadcast" });
    }

    if (stream.status === "ended") {
      return res.status(200).json({ result: formatLiveStream(stream) });
    }

    const ended = await req.prisma.liveStream.update({
      where: { id: stream.id },
      data: { status: "ended", endedAt: new Date() },
      include: liveInclude,
    });

    res.status(200).json({ result: formatLiveStream(ended) });
  } catch (error: any) {
    console.log(error.message);
    res.status(500).json({ message: error.message });
  }
});

export default router;
