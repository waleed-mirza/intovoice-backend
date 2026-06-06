import { Router } from "express";

const router = Router();

// Get feed (all + featured + recommended)
router.get("/", async (req: any, res: any) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const pageNum = parseInt(page as string) || 1;
    const limitNum = Math.min(parseInt(limit as string) || 20, 50);
    const skip = (pageNum - 1) * limitNum;

    const totalPosts = await req.prisma.voicePost.count();

    // All feed: Mixed algorithm (blend of recent + popular)
    const allPostsRaw = await req.prisma.voicePost.findMany({
      skip,
      take: limitNum,
      include: {
        station: {
          select: { id: true, name: true, handle: true, avatarURL: true },
        },
        _count: {
          select: { comments: true },
        },
      },
    });

    // Score posts: combine recency and popularity
    const now = Date.now();
    const scoredPosts = allPostsRaw.map((post: any) => {
      const ageHours = (now - new Date(post.createdAt).getTime()) / (1000 * 60 * 60);
      const recencyScore = Math.max(0, 100 - ageHours * 0.5); // Decay over time
      const popularityScore = (post.viewCount * 0.3) + ((post.likes?.length || 0) * 2) + ((post._count?.comments || 0) * 1.5);
      const totalScore = recencyScore + popularityScore + (Math.random() * 10); // Small random factor
      return { ...post, _score: totalScore };
    });

    // Sort by score descending
    const sortedPosts = scoredPosts.sort((a: any, b: any) => b._score - a._score);

    // Featured: Random selection from top viewed posts
    const topPosts = await req.prisma.voicePost.findMany({
      take: 20,
      orderBy: { viewCount: "desc" },
      include: {
        station: {
          select: { id: true, name: true, handle: true, avatarURL: true },
        },
      },
    });
    const shuffledFeatured = topPosts.sort(() => Math.random() - 0.5).slice(0, 10);

    // Recommended: Random selection from recent posts
    const recentPosts = await req.prisma.voicePost.findMany({
      take: 20,
      orderBy: { createdAt: "desc" },
      include: {
        station: {
          select: { id: true, name: true, handle: true, avatarURL: true },
        },
      },
    });
    const shuffledRecommended = recentPosts.sort(() => Math.random() - 0.5).slice(0, 10);

    const formatPost = (post: any) => ({
      ...post,
      _score: undefined,
      likeCount: post.likes?.length || 0,
      commentCount: post._count?.comments || 0,
    });

    res.status(200).json({
      all: sortedPosts.map(formatPost),
      featured: shuffledFeatured.map(formatPost),
      recommended: shuffledRecommended.map(formatPost),
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

// Get subscribed stations feed
router.get("/subscriptions", async (req: any, res: any) => {
  try {
    const userId = req.userId;
    const { page = 1, limit = 20 } = req.query;
    const pageNum = parseInt(page as string) || 1;
    const limitNum = Math.min(parseInt(limit as string) || 20, 50);
    const skip = (pageNum - 1) * limitNum;

    // Get user's subscribed station IDs
    const subscriptions = await req.prisma.voiceSubscription.findMany({
      where: { userId },
      select: { stationId: true },
    });

    const stationIds = subscriptions.map((s: any) => s.stationId);

    if (stationIds.length === 0) {
      return res.status(200).json({
        result: [],
        pagination: {
          currentPage: 1,
          totalPages: 0,
          totalPosts: 0,
          hasMore: false,
        },
        message: "No subscriptions yet",
      });
    }

    const totalPosts = await req.prisma.voicePost.count({
      where: { stationId: { in: stationIds } },
    });

    const posts = await req.prisma.voicePost.findMany({
      where: { stationId: { in: stationIds } },
      skip,
      take: limitNum,
      orderBy: { createdAt: "desc" },
      include: {
        station: {
          select: { id: true, name: true, handle: true, avatarURL: true },
        },
        _count: {
          select: { comments: true },
        },
      },
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

// Get posts by category
router.get("/category/:slug", async (req: any, res: any) => {
  try {
    const { slug } = req.params;
    const { page = 1, limit = 20 } = req.query;
    const pageNum = parseInt(page as string) || 1;
    const limitNum = Math.min(parseInt(limit as string) || 20, 50);
    const skip = (pageNum - 1) * limitNum;

    const category = await req.prisma.voiceCategory.findUnique({
      where: { slug },
    });

    if (!category) {
      return res.status(404).json({ message: "Category not found" });
    }

    const totalPosts = await req.prisma.voicePost.count({
      where: { station: { categoryId: category.id } },
    });

    const posts = await req.prisma.voicePost.findMany({
      where: { station: { categoryId: category.id } },
      skip,
      take: limitNum,
      orderBy: { createdAt: "desc" },
      include: {
        station: {
          select: { id: true, name: true, handle: true, avatarURL: true },
        },
        _count: {
          select: { comments: true },
        },
      },
    });

    const postsWithCounts = posts.map((post: any) => ({
      ...post,
      likeCount: post.likes.length,
      commentCount: post._count.comments,
    }));

    res.status(200).json({
      category,
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

// Search posts and stations
router.get("/search", async (req: any, res: any) => {
  try {
    const { q, type = "all", page = 1, limit = 20 } = req.query;
    const pageNum = parseInt(page as string) || 1;
    const limitNum = Math.min(parseInt(limit as string) || 20, 50);
    const skip = (pageNum - 1) * limitNum;

    if (!q || (q as string).trim().length === 0) {
      return res.status(400).json({ message: "Search query is required" });
    }

    const searchQuery = (q as string).trim();
    const searchType = type as string;

    let posts: any[] = [];
    let stations: any[] = [];
    let totalPosts = 0;
    let totalStations = 0;

    if (searchType === "all" || searchType === "posts") {
      totalPosts = await req.prisma.voicePost.count({
        where: {
          OR: [
            { title: { contains: searchQuery, mode: "insensitive" } },
            { description: { contains: searchQuery, mode: "insensitive" } },
          ],
        },
      });

      posts = await req.prisma.voicePost.findMany({
        where: {
          OR: [
            { title: { contains: searchQuery, mode: "insensitive" } },
            { description: { contains: searchQuery, mode: "insensitive" } },
          ],
        },
        skip: searchType === "posts" ? skip : 0,
        take: searchType === "posts" ? limitNum : 5,
        orderBy: { createdAt: "desc" },
        include: {
          station: {
            select: { id: true, name: true, handle: true, avatarURL: true },
          },
        },
      });
    }

    if (searchType === "all" || searchType === "stations") {
      totalStations = await req.prisma.station.count({
        where: {
          OR: [
            { name: { contains: searchQuery, mode: "insensitive" } },
            { handle: { contains: searchQuery, mode: "insensitive" } },
            { description: { contains: searchQuery, mode: "insensitive" } },
          ],
        },
      });

      stations = await req.prisma.station.findMany({
        where: {
          OR: [
            { name: { contains: searchQuery, mode: "insensitive" } },
            { handle: { contains: searchQuery, mode: "insensitive" } },
            { description: { contains: searchQuery, mode: "insensitive" } },
          ],
        },
        skip: searchType === "stations" ? skip : 0,
        take: searchType === "stations" ? limitNum : 5,
        include: {
          category: true,
          _count: {
            select: { posts: true, subscriptions: true },
          },
        },
        orderBy: { subscriberCount: "desc" },
      });
    }

    const postsWithCounts = posts.map((post: any) => ({
      ...post,
      likeCount: post.likes.length,
    }));

    res.status(200).json({
      posts: postsWithCounts,
      stations,
      pagination: {
        currentPage: pageNum,
        totalPosts,
        totalStations,
        hasMorePosts: searchType === "posts" ? skip + limitNum < totalPosts : totalPosts > 5,
        hasMoreStations: searchType === "stations" ? skip + limitNum < totalStations : totalStations > 5,
      },
    });
  } catch (error: any) {
    console.log(error.message);
    res.status(500).json({ message: error.message });
  }
});

export default router;
