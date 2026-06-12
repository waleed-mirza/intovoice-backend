import { Router } from "express";
import { deleteObject } from "../../middlewares/AWSConfig";
import { deletePostS3Assets } from "../../services/s3Cleanup";
import { createNotification } from "../notification";
import { notifyVoiceNewPost, notifyVoicePostLike } from "../../services/pushNotificationService";

const router = Router();

const MAX_DURATION_SECONDS = 29 * 60; // 29 minutes


// Helper to notify all subscribers of a new post
async function notifySubscribersOfNewPost(
  prisma: any,
  stationId: string,
  stationName: string,
  postId: string,
  postTitle: string
) {
  try {
    // Get all subscribers of this station
    const subscriptions = await prisma.voiceSubscription.findMany({
      where: { stationId },
      select: { userId: true },
    });

    // Send notifications in batches to avoid overwhelming the system
    const BATCH_SIZE = 50;
    for (let i = 0; i < subscriptions.length; i += BATCH_SIZE) {
      const batch = subscriptions.slice(i, i + BATCH_SIZE);
      
      await Promise.all(
        batch.map(async (sub: { userId: string }) => {
          // Create in-app notification (content stores postId for navigation)
          await createNotification(prisma, {
            senderName: stationName,
            senderId: stationId,
            receiverId: sub.userId,
            type: "voice_new_post",
            content: postId, // postId for navigation
          });

          // Send push notification
          await notifyVoiceNewPost(
            prisma,
            sub.userId,
            stationId,
            stationName,
            postId,
            postTitle
          );
        })
      );
    }

    console.log(`Notified ${subscriptions.length} subscribers of new post: ${postId}`);
  } catch (error) {
    console.error("Error notifying subscribers:", error);
  }
}

// Create a new voice post
router.post("/", async (req: any, res: any) => {
  try {
    const { stationId, title, description, thumbnailURL, audioURL, duration } = req.body;
    const userId = req.userId;

    if (!stationId || !title || !thumbnailURL || !audioURL || !duration) {
      return res.status(400).json({ 
        message: "stationId, title, thumbnailURL, audioURL, and duration are required" 
      });
    }

    if (duration > MAX_DURATION_SECONDS) {
      return res.status(400).json({ 
        message: `Audio duration cannot exceed ${MAX_DURATION_SECONDS / 60} minutes` 
      });
    }

    // Verify station ownership
    const station = await req.prisma.station.findUnique({
      where: { id: stationId },
    });

    if (!station) {
      return res.status(404).json({ message: "Station not found" });
    }

    if (station.userId !== userId) {
      return res.status(403).json({ message: "Not authorized to post to this station" });
    }

    const post = await req.prisma.voicePost.create({
      data: {
        stationId,
        title,
        description,
        thumbnailURL,
        audioURL,
        duration,
      },
      include: {
        station: {
          select: { id: true, name: true, handle: true, avatarURL: true },
        },
      },
    });

    // Notify all subscribers about the new post (async, don't block response)
    notifySubscribersOfNewPost(req.prisma, stationId, station.name, post.id, title);

    res.status(201).json({ result: post, message: "Post created successfully" });
  } catch (error: any) {
    console.log(error.message);
    res.status(500).json({ message: error.message });
  }
});

// Get post by ID
router.get("/:id", async (req: any, res: any) => {
  try {
    const { id } = req.params;

    const post = await req.prisma.voicePost.findUnique({
      where: { id },
      include: {
        station: {
          include: {
            user: {
              select: { id: true, name: true, profileImg: true, username: true },
            },
            _count: {
              select: { subscriptions: true },
            },
          },
        },
        _count: {
          select: { comments: true },
        },
      },
    });

    if (!post) {
      return res.status(404).json({ message: "Post not found" });
    }

    // Increment view count
    await req.prisma.voicePost.update({
      where: { id },
      data: { viewCount: { increment: 1 } },
    });

    // Check if user has liked the post
    const isLiked = req.userId ? post.likes.includes(req.userId) : false;

    // Check if user is subscribed to station
    let isSubscribed = false;
    if (req.userId) {
      const subscription = await req.prisma.voiceSubscription.findUnique({
        where: {
          userId_stationId: { userId: req.userId, stationId: post.stationId },
        },
      });
      isSubscribed = !!subscription;
    }

    res.status(200).json({ 
      result: { 
        ...post, 
        isLiked,
        isSubscribed,
        likeCount: post.likes.length,
        viewCount: post.viewCount + 1, // Include the just-added view
      }, 
      message: "Post found" 
    });
  } catch (error: any) {
    console.log(error.message);
    res.status(500).json({ message: error.message });
  }
});

// Update post
router.put("/:id", async (req: any, res: any) => {
  try {
    const { id } = req.params;
    const userId = req.userId;
    const { title, description, thumbnailURL, audioURL, duration } = req.body;

    const post = await req.prisma.voicePost.findUnique({
      where: { id },
      include: { station: true },
    });

    if (!post) {
      return res.status(404).json({ message: "Post not found" });
    }

    if (post.station.userId !== userId) {
      return res.status(403).json({ message: "Not authorized" });
    }

    if (duration && duration > MAX_DURATION_SECONDS) {
      return res.status(400).json({ 
        message: `Audio duration cannot exceed ${MAX_DURATION_SECONDS / 60} minutes` 
      });
    }

    // Delete old files if being replaced
    if (thumbnailURL && post.thumbnailURL && post.thumbnailURL !== thumbnailURL) {
      try { await deleteObject(post.thumbnailURL); } catch (e) {}
    }
    if (audioURL && post.audioURL && post.audioURL !== audioURL) {
      try { await deleteObject(post.audioURL); } catch (e) {}
    }

    const updatedPost = await req.prisma.voicePost.update({
      where: { id },
      data: {
        title,
        description,
        thumbnailURL,
        audioURL,
        duration,
      },
      include: {
        station: {
          select: { id: true, name: true, handle: true, avatarURL: true },
        },
      },
    });

    res.status(200).json({ result: updatedPost, message: "Post updated" });
  } catch (error: any) {
    console.log(error.message);
    res.status(500).json({ message: error.message });
  }
});

// Delete post
router.delete("/:id", async (req: any, res: any) => {
  try {
    const { id } = req.params;
    const userId = req.userId;

    const post = await req.prisma.voicePost.findUnique({
      where: { id },
      include: { station: true },
    });

    if (!post) {
      return res.status(404).json({ message: "Post not found" });
    }

    if (post.station.userId !== userId) {
      return res.status(403).json({ message: "Not authorized" });
    }

    await deletePostS3Assets(req.prisma, post);

    // Cascade delete post (comments removed via DB onDelete: Cascade)
    await req.prisma.voicePost.delete({
      where: { id },
    });

    res.status(200).json({ message: "Post deleted" });
  } catch (error: any) {
    console.log(error.message);
    res.status(500).json({ message: error.message });
  }
});

// Like/unlike post
router.post("/:id/like", async (req: any, res: any) => {
  try {
    const { id } = req.params;
    const userId = req.userId;

    const post = await req.prisma.voicePost.findUnique({
      where: { id },
      include: {
        station: {
          select: { userId: true, name: true },
        },
      },
    });

    if (!post) {
      return res.status(404).json({ message: "Post not found" });
    }

    const isLiked = post.likes.includes(userId);
    let updatedLikes: string[];

    if (isLiked) {
      // Unlike
      updatedLikes = post.likes.filter((like: string) => like !== userId);
    } else {
      // Like
      updatedLikes = [...post.likes, userId];

      // Send notification to station owner (only on like, not unlike)
      if (post.station.userId !== userId) {
        const liker = await req.prisma.user.findUnique({
          where: { id: userId },
          select: { name: true },
        });

        if (liker) {
          // Create in-app notification (content stores postId for navigation)
          createNotification(req.prisma, {
            senderName: liker.name || "Someone",
            senderId: userId,
            receiverId: post.station.userId,
            type: "voice_like",
            content: id, // postId for navigation
          });

          // Send push notification
          notifyVoicePostLike(
            req.prisma,
            post.station.userId,
            userId,
            liker.name || "Someone",
            id,
            post.title
          );
        }
      }
    }

    const updatedPost = await req.prisma.voicePost.update({
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

// Get posts by station
router.get("/station/:stationId", async (req: any, res: any) => {
  try {
    const { stationId } = req.params;
    const { page = 1, limit = 20 } = req.query;
    const pageNum = parseInt(page as string) || 1;
    const limitNum = Math.min(parseInt(limit as string) || 20, 50);
    const skip = (pageNum - 1) * limitNum;

    const totalPosts = await req.prisma.voicePost.count({
      where: { stationId },
    });

    const posts = await req.prisma.voicePost.findMany({
      where: { stationId },
      include: {
        station: {
          select: { id: true, name: true, handle: true, avatarURL: true },
        },
        _count: {
          select: { comments: true },
        },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: limitNum,
    });

    const postsWithCounts = posts.map((post: any) => ({
      ...post,
      likeCount: post.likes.length,
      commentCount: post._count.comments,
    }));

    res.status(200).json({
      result: postsWithCounts,
      pagination: {
        currentPage: pageNum,
        totalPages: Math.ceil(totalPosts / limitNum),
        totalPosts,
        hasMore: skip + limitNum < totalPosts,
      },
    });
  } catch (error: any) {
    console.log(error.message);
    res.status(500).json({ message: error.message });
  }
});

// Get related posts (same station or category)
router.get("/:id/related", async (req: any, res: any) => {
  try {
    const { id } = req.params;
    const { limit = 10 } = req.query;
    const limitNum = Math.min(parseInt(limit as string) || 10, 20);

    const post = await req.prisma.voicePost.findUnique({
      where: { id },
      include: {
        station: {
          select: { id: true, categoryId: true },
        },
      },
    });

    if (!post) {
      return res.status(404).json({ message: "Post not found" });
    }

    // Get posts from same station (excluding current post)
    const relatedPosts = await req.prisma.voicePost.findMany({
      where: {
        id: { not: id },
        OR: [
          { stationId: post.stationId },
          { station: { categoryId: post.station.categoryId } },
        ],
      },
      include: {
        station: {
          select: { id: true, name: true, handle: true, avatarURL: true },
        },
      },
      orderBy: { createdAt: "desc" },
      take: limitNum,
    });

    const postsWithCounts = relatedPosts.map((p: any) => ({
      ...p,
      likeCount: p.likes.length,
    }));

    res.status(200).json({ result: postsWithCounts, message: "Related posts" });
  } catch (error: any) {
    console.log(error.message);
    res.status(500).json({ message: error.message });
  }
});

export default router;
