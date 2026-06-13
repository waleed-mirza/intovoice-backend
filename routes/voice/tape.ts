import { Router } from "express";
import verifyToken from "../../middlewares/verifyToken";
import { deleteObject } from "../../middlewares/AWSConfig";
import { deleteTapeS3Assets, deleteCommentTreeS3Assets } from "../../services/s3Cleanup";
import { createNotification } from "../notification";
import {
  notifyVoiceTapeLike,
  notifyVoiceTapeComment,
  notifyVoiceTapeNew,
} from "../../services/pushNotificationService";
import {
  MAX_COMMENT_TEXT_LENGTH,
  prepareCommentText,
} from "../../services/commentText";

const router = Router();

const MAX_TAPE_DURATION_SECONDS = 59;
const MAX_CAPTION_LENGTH = 500;

const tapeInclude = {
  user: {
    select: { id: true, name: true, profileImg: true, username: true },
  },
  station: {
    select: { id: true, name: true, handle: true, avatarURL: true, userId: true },
  },
  _count: {
    select: { comments: true },
  },
};

function formatTape(tape: any, userId?: string) {
  return {
    ...tape,
    likeCount: tape.likes?.length ?? 0,
    commentCount: tape._count?.comments ?? 0,
    isLiked: userId ? tape.likes?.includes(userId) : false,
    isOwner: userId ? tape.userId === userId : false,
  };
}

async function getTapeSubscriptionState(
  prisma: any,
  tape: { stationId: string | null },
  userId?: string
) {
  if (!userId || !tape.stationId) return false;
  const sub = await prisma.voiceSubscription.findUnique({
    where: {
      userId_stationId: { userId, stationId: tape.stationId },
    },
  });
  return !!sub;
}

async function notifySubscribersOfNewTape(
  prisma: any,
  stationId: string,
  stationName: string,
  tapeId: string,
  caption: string
) {
  try {
    const subscriptions = await prisma.voiceSubscription.findMany({
      where: { stationId },
      select: { userId: true },
    });

    const BATCH_SIZE = 50;
    for (let i = 0; i < subscriptions.length; i += BATCH_SIZE) {
      const batch = subscriptions.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map(async (sub: { userId: string }) => {
          await createNotification(prisma, {
            senderName: stationName,
            senderId: stationId,
            receiverId: sub.userId,
            type: "voice_tape_new",
            content: tapeId,
          });
          await notifyVoiceTapeNew(
            prisma,
            sub.userId,
            stationId,
            stationName,
            tapeId,
            caption
          );
        })
      );
    }
  } catch (error) {
    console.error("Error notifying subscribers of new tape:", error);
  }
}

// Chronological feed
router.get("/feed", async (req: any, res: any) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const pageNum = parseInt(page as string) || 1;
    const limitNum = Math.min(parseInt(limit as string) || 10, 50);
    const skip = (pageNum - 1) * limitNum;

    const totalTapes = await req.prisma.tape.count();

    const tapes = await req.prisma.tape.findMany({
      skip,
      take: limitNum,
      orderBy: { createdAt: "desc" },
      include: tapeInclude,
    });

    const formatted = await Promise.all(
      tapes.map(async (tape: any) => {
        const base = formatTape(tape, req.userId);
        const isSubscribed = await getTapeSubscriptionState(
          req.prisma,
          tape,
          req.userId
        );
        return { ...base, isSubscribed };
      })
    );

    res.status(200).json({
      result: formatted,
      pagination: {
        currentPage: pageNum,
        totalPages: Math.ceil(totalTapes / limitNum),
        totalTapes,
        hasMore: skip + limitNum < totalTapes,
      },
    });
  } catch (error: any) {
    console.log(error.message);
    res.status(500).json({ message: error.message });
  }
});

// Tapes for a station profile
router.get("/station/:stationId", async (req: any, res: any) => {
  try {
    const { stationId } = req.params;
    const { page = 1, limit = 20 } = req.query;
    const pageNum = parseInt(page as string) || 1;
    const limitNum = Math.min(parseInt(limit as string) || 20, 50);
    const skip = (pageNum - 1) * limitNum;

    const totalTapes = await req.prisma.tape.count({ where: { stationId } });

    const tapes = await req.prisma.tape.findMany({
      where: { stationId },
      skip,
      take: limitNum,
      orderBy: { createdAt: "desc" },
      include: tapeInclude,
    });

    const formatted = tapes.map((tape: any) => formatTape(tape, req.userId));

    res.status(200).json({
      result: formatted,
      pagination: {
        currentPage: pageNum,
        totalPages: Math.ceil(totalTapes / limitNum),
        totalTapes,
        hasMore: skip + limitNum < totalTapes,
      },
    });
  } catch (error: any) {
    console.log(error.message);
    res.status(500).json({ message: error.message });
  }
});

// Tapes posted as self (no station)
router.get("/user/:userId", async (req: any, res: any) => {
  try {
    const { userId } = req.params;
    const { page = 1, limit = 20 } = req.query;
    const pageNum = parseInt(page as string) || 1;
    const limitNum = Math.min(parseInt(limit as string) || 20, 50);
    const skip = (pageNum - 1) * limitNum;

    const where = { userId, stationId: null };

    const totalTapes = await req.prisma.tape.count({ where });

    const tapes = await req.prisma.tape.findMany({
      where,
      skip,
      take: limitNum,
      orderBy: { createdAt: "desc" },
      include: tapeInclude,
    });

    res.status(200).json({
      result: tapes.map((tape: any) => formatTape(tape, req.userId)),
      pagination: {
        currentPage: pageNum,
        totalPages: Math.ceil(totalTapes / limitNum),
        totalTapes,
        hasMore: skip + limitNum < totalTapes,
      },
    });
  } catch (error: any) {
    console.log(error.message);
    res.status(500).json({ message: error.message });
  }
});

// Get tape comments
router.get("/:id/comments", async (req: any, res: any) => {
  try {
    const { id: tapeId } = req.params;
    const { page = 1, limit = 20 } = req.query;
    const pageNum = parseInt(page as string) || 1;
    const limitNum = Math.min(parseInt(limit as string) || 20, 50);
    const skip = (pageNum - 1) * limitNum;

    const tape = await req.prisma.tape.findUnique({ where: { id: tapeId } });
    if (!tape) {
      return res.status(404).json({ message: "Tape not found" });
    }

    const totalComments = await req.prisma.voiceComment.count({
      where: { tapeId, parentId: null },
    });

    const comments = await req.prisma.voiceComment.findMany({
      where: { tapeId, parentId: null },
      include: {
        author: {
          select: { id: true, name: true, profileImg: true, username: true },
        },
        replies: {
          include: {
            author: {
              select: { id: true, name: true, profileImg: true, username: true },
            },
            _count: { select: { replies: true } },
          },
          orderBy: { createdAt: "asc" },
          take: 3,
        },
        _count: { select: { replies: true } },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: limitNum,
    });

    const commentsWithCounts = comments.map((comment: any) => ({
      ...comment,
      likeCount: comment.likes.length,
      isLiked: req.userId ? comment.likes.includes(req.userId) : false,
      replyCount: comment._count.replies,
      replies: comment.replies.map((reply: any) => ({
        ...reply,
        likeCount: reply.likes.length,
        isLiked: req.userId ? reply.likes.includes(req.userId) : false,
        replyCount: reply._count.replies,
      })),
    }));

    res.status(200).json({
      result: commentsWithCounts,
      pagination: {
        currentPage: pageNum,
        totalPages: Math.ceil(totalComments / limitNum),
        totalComments,
        hasMore: skip + limitNum < totalComments,
      },
    });
  } catch (error: any) {
    console.log(error.message);
    res.status(500).json({ message: error.message });
  }
});

// Get single tape
router.get("/:id", async (req: any, res: any) => {
  try {
    const { id } = req.params;

    const tape = await req.prisma.tape.findUnique({
      where: { id },
      include: tapeInclude,
    });

    if (!tape) {
      return res.status(404).json({ message: "Tape not found" });
    }

    const isSubscribed = await getTapeSubscriptionState(
      req.prisma,
      tape,
      req.userId
    );

    res.status(200).json({
      result: {
        ...formatTape(tape, req.userId),
        isSubscribed,
      },
      message: "Tape found",
    });
  } catch (error: any) {
    console.log(error.message);
    res.status(500).json({ message: error.message });
  }
});

// Create tape
router.post("/", verifyToken, async (req: any, res: any) => {
  try {
    const { caption, thumbnailURL, audioURL, duration, stationId } = req.body;
    const userId = req.userId;

    if (!caption || !thumbnailURL || !audioURL || duration == null) {
      return res.status(400).json({
        message: "caption, thumbnailURL, audioURL, and duration are required",
      });
    }

    const trimmedCaption = String(caption).trim();
    if (!trimmedCaption) {
      return res.status(400).json({ message: "Caption is required" });
    }
    if (trimmedCaption.length > MAX_CAPTION_LENGTH) {
      return res.status(400).json({
        message: `Caption must be ${MAX_CAPTION_LENGTH} characters or fewer`,
      });
    }

    if (duration > MAX_TAPE_DURATION_SECONDS) {
      return res.status(400).json({
        message: `Tape duration cannot exceed ${MAX_TAPE_DURATION_SECONDS} seconds`,
      });
    }

    const durationSeconds = Math.floor(Number(duration));
    if (!Number.isFinite(durationSeconds) || durationSeconds < 1) {
      return res.status(400).json({
        message: `Tape duration must be between 1 and ${MAX_TAPE_DURATION_SECONDS} seconds`,
      });
    }

    if (stationId) {
      const station = await req.prisma.station.findUnique({
        where: { id: stationId },
      });
      if (!station) {
        return res.status(404).json({ message: "Station not found" });
      }
      if (station.userId !== userId) {
        return res.status(403).json({ message: "Not authorized to post to this station" });
      }
    }

    const tape = await req.prisma.tape.create({
      data: {
        userId,
        stationId: stationId || null,
        caption: trimmedCaption,
        thumbnailURL,
        audioURL,
        duration: durationSeconds,
      },
      include: tapeInclude,
    });

    if (stationId && tape.station) {
      notifySubscribersOfNewTape(
        req.prisma,
        stationId,
        tape.station.name,
        tape.id,
        trimmedCaption
      );
    }

    res.status(201).json({
      result: formatTape(tape, userId),
      message: "Tape created successfully",
    });
  } catch (error: any) {
    console.log(error.message);
    res.status(500).json({ message: error.message });
  }
});

// Update tape
router.patch("/:id", verifyToken, async (req: any, res: any) => {
  try {
    const { id } = req.params;
    const userId = req.userId;
    const { caption, thumbnailURL } = req.body;

    const tape = await req.prisma.tape.findUnique({ where: { id } });
    if (!tape) {
      return res.status(404).json({ message: "Tape not found" });
    }
    if (tape.userId !== userId) {
      return res.status(403).json({ message: "Not authorized" });
    }

    const updateData: any = {};
    if (caption != null) {
      const trimmedCaption = String(caption).trim();
      if (!trimmedCaption) {
        return res.status(400).json({ message: "Caption is required" });
      }
      if (trimmedCaption.length > MAX_CAPTION_LENGTH) {
        return res.status(400).json({
          message: `Caption must be ${MAX_CAPTION_LENGTH} characters or fewer`,
        });
      }
      updateData.caption = trimmedCaption;
    }
    if (thumbnailURL && tape.thumbnailURL !== thumbnailURL) {
      try {
        await deleteObject(tape.thumbnailURL);
      } catch (e) {}
      updateData.thumbnailURL = thumbnailURL;
    }

    const updated = await req.prisma.tape.update({
      where: { id },
      data: updateData,
      include: tapeInclude,
    });

    res.status(200).json({ result: formatTape(updated, userId), message: "Tape updated" });
  } catch (error: any) {
    console.log(error.message);
    res.status(500).json({ message: error.message });
  }
});

// Delete tape
router.delete("/:id", verifyToken, async (req: any, res: any) => {
  try {
    const { id } = req.params;
    const userId = req.userId;

    const tape = await req.prisma.tape.findUnique({ where: { id } });
    if (!tape) {
      return res.status(404).json({ message: "Tape not found" });
    }
    if (tape.userId !== userId) {
      return res.status(403).json({ message: "Not authorized" });
    }

    await deleteTapeS3Assets(req.prisma, tape);
    await req.prisma.tape.delete({ where: { id } });

    res.status(200).json({ message: "Tape deleted" });
  } catch (error: any) {
    console.log(error.message);
    res.status(500).json({ message: error.message });
  }
});

// Like/unlike tape
router.post("/:id/like", verifyToken, async (req: any, res: any) => {
  try {
    const { id } = req.params;
    const userId = req.userId;

    const tape = await req.prisma.tape.findUnique({ where: { id } });
    if (!tape) {
      return res.status(404).json({ message: "Tape not found" });
    }

    const isLiked = tape.likes.includes(userId);
    const updatedLikes = isLiked
      ? tape.likes.filter((like: string) => like !== userId)
      : [...tape.likes, userId];

    if (!isLiked && tape.userId !== userId) {
      const liker = await req.prisma.user.findUnique({
        where: { id: userId },
        select: { name: true },
      });
      if (liker) {
        createNotification(req.prisma, {
          senderName: liker.name || "Someone",
          senderId: userId,
          receiverId: tape.userId,
          type: "voice_tape_like",
          content: id,
        });
        notifyVoiceTapeLike(
          req.prisma,
          tape.userId,
          userId,
          liker.name || "Someone",
          id,
          tape.caption
        );
      }
    }

    await req.prisma.tape.update({
      where: { id },
      data: { likes: { set: updatedLikes } },
    });

    res.status(200).json({
      result: { isLiked: !isLiked, likeCount: updatedLikes.length },
      message: isLiked ? "Unliked" : "Liked",
    });
  } catch (error: any) {
    console.log(error.message);
    res.status(500).json({ message: error.message });
  }
});

// Increment view count
router.post("/:id/view", async (req: any, res: any) => {
  try {
    const { id } = req.params;

    const tape = await req.prisma.tape.findUnique({ where: { id } });
    if (!tape) {
      return res.status(404).json({ message: "Tape not found" });
    }

    const updated = await req.prisma.tape.update({
      where: { id },
      data: { viewCount: { increment: 1 } },
      select: { viewCount: true },
    });

    res.status(200).json({ result: { viewCount: updated.viewCount } });
  } catch (error: any) {
    console.log(error.message);
    res.status(500).json({ message: error.message });
  }
});

// Create tape comment
router.post("/:id/comments", verifyToken, async (req: any, res: any) => {
  try {
    const { id: tapeId } = req.params;
    const { content, parentId, audioFileURL } = req.body;
    const userId = req.userId;

    const preparedContent = prepareCommentText({
      rawText: content,
      hasAudio: Boolean(audioFileURL),
      maxLength: MAX_COMMENT_TEXT_LENGTH,
      emptyMessage: "Comment content or audio is required",
      preserveAudioOnlyPlaceholder: true,
    });

    if (!preparedContent.ok) {
      return res.status(400).json({ message: preparedContent.message });
    }

    const tape = await req.prisma.tape.findUnique({ where: { id: tapeId } });
    if (!tape) {
      return res.status(404).json({ message: "Tape not found" });
    }

    let threadRootId: string | null = null;
    if (parentId) {
      const parentComment = await req.prisma.voiceComment.findUnique({
        where: { id: parentId },
      });
      if (!parentComment) {
        return res.status(404).json({ message: "Parent comment not found" });
      }
      if (parentComment.tapeId !== tapeId) {
        return res.status(400).json({ message: "Parent comment belongs to different tape" });
      }
      threadRootId =
        parentComment.parentId === null ? parentComment.id : parentComment.parentId;

      // Notify parent comment author on reply
      if (parentComment.authorId !== userId) {
        const commenter = await req.prisma.user.findUnique({
          where: { id: userId },
          select: { name: true, username: true },
        });
        const notifContent =
          preparedContent.normalizedText || (audioFileURL ? "🎙️ Voice comment" : "");
        createNotification(req.prisma, {
          senderName: commenter?.name || commenter?.username || "Someone",
          senderId: userId,
          receiverId: parentComment.authorId,
          type: "voice_tape_comment",
          content: tapeId,
        });
        notifyVoiceTapeComment(
          req.prisma,
          parentComment.authorId,
          userId,
          commenter?.name || commenter?.username || "Someone",
          tapeId,
          notifContent
        );
      }
    }

    const comment = await req.prisma.voiceComment.create({
      data: {
        tapeId,
        authorId: userId,
        content: preparedContent.storedText,
        audioFileURL: audioFileURL || null,
        parentId: threadRootId,
      },
      include: {
        author: {
          select: { id: true, name: true, profileImg: true, username: true },
        },
      },
    });

    // Notify tape owner on top-level comment (not reply to self)
    if (!parentId && tape.userId !== userId) {
      const notifContent =
        preparedContent.normalizedText || (audioFileURL ? "🎙️ Voice comment" : "");
      createNotification(req.prisma, {
        senderName: comment.author.name || comment.author.username || "Someone",
        senderId: userId,
        receiverId: tape.userId,
        type: "voice_tape_comment",
        content: tapeId,
      });
      notifyVoiceTapeComment(
        req.prisma,
        tape.userId,
        userId,
        comment.author.name || comment.author.username || "Someone",
        tapeId,
        notifContent
      );
    }

    res.status(201).json({
      result: {
        ...comment,
        likeCount: 0,
        isLiked: false,
        replyCount: 0,
        replies: [],
      },
      message: "Comment created",
    });
  } catch (error: any) {
    console.log(error.message);
    res.status(500).json({ message: error.message });
  }
});

// Like/unlike tape comment
router.post("/:id/comments/:commentId/like", verifyToken, async (req: any, res: any) => {
  try {
    const { id: tapeId, commentId } = req.params;
    const userId = req.userId;

    const comment = await req.prisma.voiceComment.findUnique({
      where: { id: commentId },
    });

    if (!comment || comment.tapeId !== tapeId) {
      return res.status(404).json({ message: "Comment not found" });
    }

    const isLiked = comment.likes.includes(userId);
    const updatedLikes = isLiked
      ? comment.likes.filter((like: string) => like !== userId)
      : [...comment.likes, userId];

    await req.prisma.voiceComment.update({
      where: { id: commentId },
      data: { likes: { set: updatedLikes } },
    });

    res.status(200).json({
      result: { isLiked: !isLiked, likeCount: updatedLikes.length },
      message: isLiked ? "Unliked" : "Liked",
    });
  } catch (error: any) {
    console.log(error.message);
    res.status(500).json({ message: error.message });
  }
});

export default router;
