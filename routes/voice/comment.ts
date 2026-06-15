import { Router } from "express";
import { normalizeAssetKey } from "../../middlewares/AWSConfig";
import { deleteCommentTreeS3Assets } from "../../services/s3Cleanup";
import { createNotification } from "../notification";
import { notifyVoiceComment } from "../../services/pushNotificationService";
import {
  MAX_COMMENT_TEXT_LENGTH,
  prepareCommentText,
} from "../../services/commentText";

const router = Router();

// Get comments for a post (with threaded replies)
router.get("/post/:postId", async (req: any, res: any) => {
  try {
    const { postId } = req.params;
    const { page = 1, limit = 20 } = req.query;
    const pageNum = parseInt(page as string) || 1;
    const limitNum = Math.min(parseInt(limit as string) || 20, 50);
    const skip = (pageNum - 1) * limitNum;

    // Get top-level comments only (parentId is null)
    const totalComments = await req.prisma.voiceComment.count({
      where: { postId, parentId: null },
    });

    const comments = await req.prisma.voiceComment.findMany({
      where: { postId, parentId: null },
      include: {
        author: {
          select: { id: true, name: true, profileImg: true, username: true },
        },
        replies: {
          include: {
            author: {
              select: { id: true, name: true, profileImg: true, username: true },
            },
            _count: {
              select: { replies: true },
            },
          },
          orderBy: { createdAt: "asc" },
          take: 3, // Initially load 3 replies
        },
        _count: {
          select: { replies: true },
        },
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

// Get replies for a comment
router.get("/:commentId/replies", async (req: any, res: any) => {
  try {
    const { commentId } = req.params;
    const { page = 1, limit = 20 } = req.query;
    const pageNum = parseInt(page as string) || 1;
    const limitNum = Math.min(parseInt(limit as string) || 20, 50);
    const skip = (pageNum - 1) * limitNum;

    const totalReplies = await req.prisma.voiceComment.count({
      where: { parentId: commentId },
    });

    const replies = await req.prisma.voiceComment.findMany({
      where: { parentId: commentId },
      include: {
        author: {
          select: { id: true, name: true, profileImg: true, username: true },
        },
        _count: {
          select: { replies: true },
        },
      },
      orderBy: { createdAt: "asc" },
      skip,
      take: limitNum,
    });

    const repliesWithCounts = replies.map((reply: any) => ({
      ...reply,
      likeCount: reply.likes.length,
      isLiked: req.userId ? reply.likes.includes(req.userId) : false,
      replyCount: reply._count.replies,
    }));

    res.status(200).json({
      result: repliesWithCounts,
      pagination: {
        currentPage: pageNum,
        totalPages: Math.ceil(totalReplies / limitNum),
        totalReplies,
        hasMore: skip + limitNum < totalReplies,
      },
    });
  } catch (error: any) {
    console.log(error.message);
    res.status(500).json({ message: error.message });
  }
});

// Create a comment (supports optional audioFileURL for voice comments)
router.post("/post/:postId", async (req: any, res: any) => {
  try {
    const { postId } = req.params;
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

    // Verify post exists and get station owner
    const post = await req.prisma.voicePost.findUnique({
      where: { id: postId },
      include: {
        station: {
          select: { userId: true },
        },
      },
    });

    if (!post) {
      return res.status(404).json({ message: "Post not found" });
    }

    // If replying, verify parent comment exists and flatten to thread root
    let threadRootId: string | null = null;
    if (parentId) {
      const parentComment = await req.prisma.voiceComment.findUnique({
        where: { id: parentId },
      });

      if (!parentComment) {
        return res.status(404).json({ message: "Parent comment not found" });
      }

      if (parentComment.postId !== postId) {
        return res.status(400).json({ message: "Parent comment belongs to different post" });
      }

      threadRootId =
        parentComment.parentId === null ? parentComment.id : parentComment.parentId;
    }

    const comment = await req.prisma.voiceComment.create({
      data: {
        postId,
        authorId: userId,
        content: preparedContent.storedText,
        audioFileURL: audioFileURL ? normalizeAssetKey(audioFileURL) : null,
        parentId: threadRootId,
      },
      include: {
        author: {
          select: { id: true, name: true, profileImg: true, username: true },
        },
      },
    });

    // Send notification to station owner (if not commenting on own post)
    if (post.station.userId !== userId) {
      const notifContent =
        preparedContent.normalizedText || (audioFileURL ? "🎙️ Voice comment" : "");
      // Create in-app notification (content stores postId for navigation)
      createNotification(req.prisma, {
        senderName: comment.author.name || comment.author.username || "Someone",
        senderId: userId,
        receiverId: post.station.userId,
        type: "voice_comment",
        content: postId, // postId for navigation
      });

      // Send push notification
      notifyVoiceComment(
        req.prisma,
        post.station.userId,
        userId,
        comment.author.name || comment.author.username || "Someone",
        postId,
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
      message: "Comment created" 
    });
  } catch (error: any) {
    console.log(error.message);
    res.status(500).json({ message: error.message });
  }
});

// Update a comment (text only; audio cannot be edited)
router.put("/:id", async (req: any, res: any) => {
  try {
    const { id } = req.params;
    const userId = req.userId;

    const comment = await req.prisma.voiceComment.findUnique({
      where: { id },
    });

    if (!comment) {
      return res.status(404).json({ message: "Comment not found" });
    }

    if (comment.authorId !== userId) {
      return res.status(403).json({ message: "Not authorized" });
    }

    const preparedContent = prepareCommentText({
      rawText: req.body?.content,
      maxLength: MAX_COMMENT_TEXT_LENGTH,
      emptyMessage: "Comment content is required",
    });

    if (!preparedContent.ok) {
      return res.status(400).json({ message: preparedContent.message });
    }

    const updatedComment = await req.prisma.voiceComment.update({
      where: { id },
      data: { content: preparedContent.storedText },
      include: {
        author: {
          select: { id: true, name: true, profileImg: true, username: true },
        },
      },
    });

    res.status(200).json({ 
      result: { 
        ...updatedComment, 
        likeCount: updatedComment.likes.length,
        isLiked: updatedComment.likes.includes(userId),
      }, 
      message: "Comment updated" 
    });
  } catch (error: any) {
    console.log(error.message);
    res.status(500).json({ message: error.message });
  }
});

// Delete a comment — author or station owner can delete
// Also deletes the S3 audio asset if present
router.delete("/:id", async (req: any, res: any) => {
  try {
    const { id } = req.params;
    const userId = req.userId;

    const comment = await req.prisma.voiceComment.findUnique({
      where: { id },
      include: {
        post: {
          include: { station: true },
        },
        tape: {
          select: { userId: true },
        },
      },
    });

    if (!comment) {
      return res.status(404).json({ message: "Comment not found" });
    }

    const isAuthor = comment.authorId === userId;
    const isPostStationOwner = comment.post?.station?.userId === userId;
    const isTapeOwner = comment.tape?.userId === userId;

    if (!isAuthor && !isPostStationOwner && !isTapeOwner) {
      return res.status(403).json({ message: "Not authorized" });
    }

    await deleteCommentTreeS3Assets(req.prisma, id, comment.audioFileURL);

    // DB cascade deletes direct replies when removing a top-level comment
    await req.prisma.voiceComment.delete({
      where: { id },
    });

    res.status(200).json({ message: "Comment deleted" });
  } catch (error: any) {
    console.log(error.message);
    res.status(500).json({ message: error.message });
  }
});

// Like/unlike a comment
router.post("/:id/like", async (req: any, res: any) => {
  try {
    const { id } = req.params;
    const userId = req.userId;

    const comment = await req.prisma.voiceComment.findUnique({
      where: { id },
    });

    if (!comment) {
      return res.status(404).json({ message: "Comment not found" });
    }

    const isLiked = comment.likes.includes(userId);
    let updatedLikes: string[];

    if (isLiked) {
      updatedLikes = comment.likes.filter((like: string) => like !== userId);
    } else {
      updatedLikes = [...comment.likes, userId];
    }

    await req.prisma.voiceComment.update({
      where: { id },
      data: { likes: { set: updatedLikes } },
    });

    res.status(200).json({ 
      result: { 
        isLiked: !isLiked, 
        likeCount: updatedLikes.length 
      }, 
      message: isLiked ? "Unliked" : "Liked" 
    });
  } catch (error: any) {
    console.log(error.message);
    res.status(500).json({ message: error.message });
  }
});

export default router;
