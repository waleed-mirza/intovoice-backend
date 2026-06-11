import { Router } from "express";
import { createNotification } from "../notification";
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

// GET /voice/live/active
router.get("/active", async (req: any, res: any) => {
  try {
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
