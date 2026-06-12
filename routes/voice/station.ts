import { Router } from "express";
import { deleteObject } from "../../middlewares/AWSConfig";
import { deleteStationS3Assets } from "../../services/s3Cleanup";
import { createNotification } from "../notification";
import { notifyVoiceSubscription } from "../../services/pushNotificationService";

const router = Router();

// Create a new station
router.post("/", async (req: any, res: any) => {
  try {
    const { name, handle, description, avatarURL, bannerURL, categoryId } = req.body;
    const userId = req.userId;

    if (!name || !handle) {
      return res.status(400).json({ message: "Name and handle are required" });
    }

    // Validate handle format (alphanumeric, underscores, hyphens only)
    const handleRegex = /^[a-zA-Z0-9_-]+$/;
    if (!handleRegex.test(handle)) {
      return res.status(400).json({ 
        message: "Handle can only contain letters, numbers, underscores, and hyphens" 
      });
    }

    // Check if handle already exists
    const existingStation = await req.prisma.station.findUnique({
      where: { handle: handle.toLowerCase() },
    });

    if (existingStation) {
      return res.status(409).json({ message: "This handle is already taken" });
    }

    const station = await req.prisma.station.create({
      data: {
        userId,
        name,
        handle: handle.toLowerCase(),
        description,
        avatarURL,
        bannerURL,
        categoryId,
      },
      include: {
        category: true,
        user: {
          select: { id: true, name: true, profileImg: true },
        },
      },
    });

    res.status(201).json({ result: station, message: "Station created successfully" });
  } catch (error: any) {
    console.log(error.message);
    res.status(500).json({ message: error.message });
  }
});

// Get stations the current user is subscribed to (for sidebar)
router.get("/subscribed", async (req: any, res: any) => {
  try {
    const userId = req.userId;

    const subscriptions = await req.prisma.voiceSubscription.findMany({
      where: { userId },
      include: {
        station: {
          select: {
            id: true,
            name: true,
            handle: true,
            avatarURL: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const stations = subscriptions.map((s: any) => s.station);
    res.status(200).json({ result: stations, message: "Subscribed stations" });
  } catch (error: any) {
    console.log(error.message);
    res.status(500).json({ message: error.message });
  }
});

// Get all stations for current user
router.get("/my-stations", async (req: any, res: any) => {
  try {
    const userId = req.userId;

    const stations = await req.prisma.station.findMany({
      where: { userId },
      include: {
        category: true,
        _count: {
          select: { posts: true, subscriptions: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    res.status(200).json({ result: stations, message: "User stations" });
  } catch (error: any) {
    console.log(error.message);
    res.status(500).json({ message: error.message });
  }
});

// Get station by ID
router.get("/:id", async (req: any, res: any) => {
  try {
    const { id } = req.params;

    const station = await req.prisma.station.findUnique({
      where: { id },
      include: {
        category: true,
        user: {
          select: { id: true, name: true, profileImg: true, username: true },
        },
        posts: {
          orderBy: { createdAt: "desc" },
          take: 20,
          include: {
            station: {
              select: { id: true, name: true, handle: true, avatarURL: true },
            },
          },
        },
        _count: {
          select: { posts: true, subscriptions: true },
        },
      },
    });

    if (!station) {
      return res.status(404).json({ message: "Station not found" });
    }

    // Check if current user is subscribed (if authenticated)
    let isSubscribed = false;
    if (req.userId) {
      const subscription = await req.prisma.voiceSubscription.findUnique({
        where: {
          userId_stationId: { userId: req.userId, stationId: id },
        },
      });
      isSubscribed = !!subscription;
    }

    res.status(200).json({ 
      result: { ...station, isSubscribed }, 
      message: "Station found" 
    });
  } catch (error: any) {
    console.log(error.message);
    res.status(500).json({ message: error.message });
  }
});

// Get station by handle
router.get("/handle/:handle", async (req: any, res: any) => {
  try {
    const { handle } = req.params;

    const station = await req.prisma.station.findUnique({
      where: { handle: handle.toLowerCase() },
      include: {
        category: true,
        user: {
          select: { id: true, name: true, profileImg: true, username: true },
        },
        posts: {
          orderBy: { createdAt: "desc" },
          take: 20,
          include: {
            station: {
              select: { id: true, name: true, handle: true, avatarURL: true },
            },
          },
        },
        _count: {
          select: { posts: true, subscriptions: true },
        },
      },
    });

    if (!station) {
      return res.status(404).json({ message: "Station not found" });
    }

    // Check if current user is subscribed (if authenticated)
    let isSubscribed = false;
    if (req.userId) {
      const subscription = await req.prisma.voiceSubscription.findUnique({
        where: {
          userId_stationId: { userId: req.userId, stationId: station.id },
        },
      });
      isSubscribed = !!subscription;
    }

    res.status(200).json({ 
      result: { ...station, isSubscribed }, 
      message: "Station found" 
    });
  } catch (error: any) {
    console.log(error.message);
    res.status(500).json({ message: error.message });
  }
});

// Update station
router.put("/:id", async (req: any, res: any) => {
  try {
    const { id } = req.params;
    const userId = req.userId;
    const { name, handle, description, avatarURL, bannerURL, categoryId } = req.body;

    const station = await req.prisma.station.findUnique({
      where: { id },
    });

    if (!station) {
      return res.status(404).json({ message: "Station not found" });
    }

    if (station.userId !== userId) {
      return res.status(403).json({ message: "Not authorized" });
    }

    // If handle is being changed, check uniqueness
    if (handle && handle.toLowerCase() !== station.handle) {
      const handleRegex = /^[a-zA-Z0-9_-]+$/;
      if (!handleRegex.test(handle)) {
        return res.status(400).json({
          message: "Handle can only contain letters, numbers, underscores, and hyphens",
        });
      }
      const existingStation = await req.prisma.station.findUnique({
        where: { handle: handle.toLowerCase() },
      });
      if (existingStation) {
        return res.status(409).json({ message: "This handle is already taken" });
      }
    }

    // Delete old files if being replaced
    if (avatarURL && station.avatarURL && station.avatarURL !== avatarURL) {
      try {
        await deleteObject(station.avatarURL);
      } catch (e) {
        console.log("Error deleting old avatar:", e);
      }
    }

    if (bannerURL && station.bannerURL && station.bannerURL !== bannerURL) {
      try {
        await deleteObject(station.bannerURL);
      } catch (e) {
        console.log("Error deleting old banner:", e);
      }
    }

    const updatedStation = await req.prisma.station.update({
      where: { id },
      data: {
        name,
        handle: handle ? handle.toLowerCase() : undefined,
        description,
        avatarURL,
        bannerURL,
        categoryId,
      },
      include: {
        category: true,
        user: {
          select: { id: true, name: true, profileImg: true },
        },
      },
    });

    res.status(200).json({ result: updatedStation, message: "Station updated" });
  } catch (error: any) {
    console.log(error.message);
    res.status(500).json({ message: error.message });
  }
});

// Delete station
router.delete("/:id", async (req: any, res: any) => {
  try {
    const { id } = req.params;
    const userId = req.userId;

    const station = await req.prisma.station.findUnique({
      where: { id },
      include: {
        posts: {
          include: {
            comments: {
              where: { audioFileURL: { not: null } },
              select: { audioFileURL: true },
            },
          },
        },
      },
    });

    if (!station) {
      return res.status(404).json({ message: "Station not found" });
    }

    if (station.userId !== userId) {
      return res.status(403).json({ message: "Not authorized" });
    }

    await deleteStationS3Assets(req.prisma, station);

    await req.prisma.station.delete({
      where: { id },
    });

    res.status(200).json({ message: "Station deleted" });
  } catch (error: any) {
    console.log(error.message);
    res.status(500).json({ message: error.message });
  }
});

// Subscribe to station
router.post("/:id/subscribe", async (req: any, res: any) => {
  try {
    const { id } = req.params;
    const userId = req.userId;

    const station = await req.prisma.station.findUnique({
      where: { id },
    });

    if (!station) {
      return res.status(404).json({ message: "Station not found" });
    }

    // Check if already subscribed
    const existingSubscription = await req.prisma.voiceSubscription.findUnique({
      where: {
        userId_stationId: { userId, stationId: id },
      },
    });

    if (existingSubscription) {
      // Unsubscribe
      await req.prisma.voiceSubscription.delete({
        where: { id: existingSubscription.id },
      });

      await req.prisma.station.update({
        where: { id },
        data: { subscriberCount: { decrement: 1 } },
      });

      return res.status(200).json({ 
        result: { isSubscribed: false }, 
        message: "Unsubscribed" 
      });
    }

    // Subscribe
    await req.prisma.voiceSubscription.create({
      data: { userId, stationId: id },
    });

    await req.prisma.station.update({
      where: { id },
      data: { subscriberCount: { increment: 1 } },
    });

    // Send notification to station owner (async, don't block response)
    if (station.userId !== userId) {
      const subscriber = await req.prisma.user.findUnique({
        where: { id: userId },
        select: { name: true },
      });

      if (subscriber) {
        // Create in-app notification (content stores stationId for navigation)
        createNotification(req.prisma, {
          senderName: subscriber.name || "Someone",
          senderId: userId,
          receiverId: station.userId,
          type: "voice_subscription",
          content: id, // stationId for navigation
        });

        // Send push notification
        notifyVoiceSubscription(
          req.prisma,
          station.userId,
          userId,
          subscriber.name || "Someone",
          id,
          station.name
        );
      }
    }

    res.status(200).json({ 
      result: { isSubscribed: true }, 
      message: "Subscribed" 
    });
  } catch (error: any) {
    console.log(error.message);
    res.status(500).json({ message: error.message });
  }
});

// Get station subscribers
router.get("/:id/subscribers", async (req: any, res: any) => {
  try {
    const { id } = req.params;
    const { page = 1, limit = 20 } = req.query;
    const pageNum = parseInt(page as string) || 1;
    const limitNum = Math.min(parseInt(limit as string) || 20, 50);
    const skip = (pageNum - 1) * limitNum;

    const totalSubscribers = await req.prisma.voiceSubscription.count({
      where: { stationId: id },
    });

    const subscribers = await req.prisma.voiceSubscription.findMany({
      where: { stationId: id },
      include: {
        user: {
          select: { id: true, name: true, profileImg: true, username: true },
        },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: limitNum,
    });

    res.status(200).json({
      result: subscribers.map((s: any) => s.user),
      pagination: {
        currentPage: pageNum,
        totalPages: Math.ceil(totalSubscribers / limitNum),
        totalSubscribers,
        hasMore: skip + limitNum < totalSubscribers,
      },
    });
  } catch (error: any) {
    console.log(error.message);
    res.status(500).json({ message: error.message });
  }
});

// Check handle availability
router.get("/check-handle/:handle", async (req: any, res: any) => {
  try {
    const { handle } = req.params;

    const existingStation = await req.prisma.station.findUnique({
      where: { handle: handle.toLowerCase() },
    });

    res.status(200).json({ 
      available: !existingStation,
      message: existingStation ? "Handle is taken" : "Handle is available"
    });
  } catch (error: any) {
    console.log(error.message);
    res.status(500).json({ message: error.message });
  }
});

// Get station analytics (owner only)
router.get("/:id/analytics", async (req: any, res: any) => {
  try {
    const { id } = req.params;
    const userId = req.userId;

    const station = await req.prisma.station.findUnique({
      where: { id },
      include: {
        _count: {
          select: { posts: true, subscriptions: true },
        },
      },
    });

    if (!station) {
      return res.status(404).json({ message: "Station not found" });
    }

    if (station.userId !== userId) {
      return res.status(403).json({ message: "Not authorized to view analytics" });
    }

    // Get all posts for aggregate stats
    const posts = await req.prisma.voicePost.findMany({
      where: { stationId: id },
      select: {
        id: true,
        title: true,
        thumbnailURL: true,
        viewCount: true,
        likes: true,
        createdAt: true,
        _count: {
          select: { comments: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    // Calculate basic stats
    const totalPlays = posts.reduce((sum: number, p: any) => sum + p.viewCount, 0);
    const totalLikes = posts.reduce((sum: number, p: any) => sum + p.likes.length, 0);
    const totalComments = posts.reduce((sum: number, p: any) => sum + p._count.comments, 0);

    // Top 5 posts by views
    const topPostsByViews = [...posts]
      .sort((a: any, b: any) => b.viewCount - a.viewCount)
      .slice(0, 5)
      .map((p: any) => ({
        id: p.id,
        title: p.title,
        thumbnailURL: p.thumbnailURL,
        viewCount: p.viewCount,
        likeCount: p.likes.length,
        commentCount: p._count.comments,
      }));

    // Top 5 posts by likes
    const topPostsByLikes = [...posts]
      .sort((a: any, b: any) => b.likes.length - a.likes.length)
      .slice(0, 5)
      .map((p: any) => ({
        id: p.id,
        title: p.title,
        thumbnailURL: p.thumbnailURL,
        viewCount: p.viewCount,
        likeCount: p.likes.length,
        commentCount: p._count.comments,
      }));

    // Growth metrics - subscribers over time (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const newSubscribersThisMonth = await req.prisma.voiceSubscription.count({
      where: {
        stationId: id,
        createdAt: { gte: thirtyDaysAgo },
      },
    });

    const newSubscribersThisWeek = await req.prisma.voiceSubscription.count({
      where: {
        stationId: id,
        createdAt: { gte: sevenDaysAgo },
      },
    });

    // Posts this week/month
    const postsThisMonth = posts.filter(
      (p: any) => new Date(p.createdAt) >= thirtyDaysAgo
    ).length;
    const postsThisWeek = posts.filter(
      (p: any) => new Date(p.createdAt) >= sevenDaysAgo
    ).length;

    // Views this week/month
    const viewsThisMonth = posts
      .filter((p: any) => new Date(p.createdAt) >= thirtyDaysAgo)
      .reduce((sum: number, p: any) => sum + p.viewCount, 0);
    const viewsThisWeek = posts
      .filter((p: any) => new Date(p.createdAt) >= sevenDaysAgo)
      .reduce((sum: number, p: any) => sum + p.viewCount, 0);

    res.status(200).json({
      result: {
        basicStats: {
          totalPosts: station._count.posts,
          totalSubscribers: station._count.subscriptions,
          totalPlays,
          totalLikes,
          totalComments,
        },
        topPosts: {
          byViews: topPostsByViews,
          byLikes: topPostsByLikes,
        },
        growth: {
          subscribersThisWeek: newSubscribersThisWeek,
          subscribersThisMonth: newSubscribersThisMonth,
          postsThisWeek,
          postsThisMonth,
          viewsThisWeek,
          viewsThisMonth,
        },
      },
      message: "Analytics retrieved",
    });
  } catch (error: any) {
    console.log(error.message);
    res.status(500).json({ message: error.message });
  }
});

export default router;
