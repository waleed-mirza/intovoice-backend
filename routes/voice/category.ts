import { Router } from "express";

const router = Router();

// Predefined categories
const DEFAULT_CATEGORIES = [
  { name: "Music", slug: "music", icon: "music" },
  { name: "Talk & Interviews", slug: "talk-interviews", icon: "mic" },
  { name: "News & Politics", slug: "news-politics", icon: "newspaper" },
  { name: "Comedy", slug: "comedy", icon: "smile" },
  { name: "Education", slug: "education", icon: "book" },
  { name: "Sports", slug: "sports", icon: "trophy" },
  { name: "Technology", slug: "technology", icon: "cpu" },
  { name: "True Crime", slug: "true-crime", icon: "search" },
  { name: "Health & Wellness", slug: "health-wellness", icon: "heart" },
  { name: "Business", slug: "business", icon: "briefcase" },
  { name: "Entertainment", slug: "entertainment", icon: "star" },
  { name: "Religious", slug: "religious", icon: "moon" },
  { name: "Self-Help", slug: "self-help", icon: "self-help" },
];

// Get all categories
router.get("/", async (req: any, res: any) => {
  try {
    const categories = await req.prisma.voiceCategory.findMany({
      include: {
        _count: {
          select: { stations: true },
        },
      },
      orderBy: { name: "asc" },
    });

    // If no categories exist, seed them
    if (categories.length === 0) {
      const createdCategories = await Promise.all(
        DEFAULT_CATEGORIES.map((cat) =>
          req.prisma.voiceCategory.create({
            data: cat,
            include: {
              _count: {
                select: { stations: true },
              },
            },
          })
        )
      );
      return res.status(200).json({ result: createdCategories, message: "Categories created" });
    }

    // Migrate legacy 'islamic' category to 'religious' if it exists
    const islamicCat = categories.find((c: any) => c.slug === "islamic");
    if (islamicCat) {
      await req.prisma.voiceCategory.update({
        where: { id: islamicCat.id },
        data: { name: "Religious", slug: "religious", icon: "moon" },
      });
      // Refresh list after migration
      const refreshed = await req.prisma.voiceCategory.findMany({
        include: { _count: { select: { stations: true } } },
        orderBy: { name: "asc" },
      });
      categories.splice(0, categories.length, ...refreshed);
    }

    // Sync any new categories added to DEFAULT_CATEGORIES that aren't in the DB yet
    const existingSlugs = new Set(categories.map((c: any) => c.slug));
    const missing = DEFAULT_CATEGORIES.filter((cat) => !existingSlugs.has(cat.slug));
    if (missing.length > 0) {
      await Promise.all(
        missing.map((cat) => req.prisma.voiceCategory.create({ data: cat }))
      );
      const updatedCategories = await req.prisma.voiceCategory.findMany({
        include: { _count: { select: { stations: true } } },
        orderBy: { name: "asc" },
      });
      return res.status(200).json({ result: updatedCategories, message: "All categories" });
    }

    res.status(200).json({ result: categories, message: "All categories" });
  } catch (error: any) {
    console.log(error.message);
    res.status(500).json({ message: error.message });
  }
});

// Get single category by slug
router.get("/:slug", async (req: any, res: any) => {
  try {
    const { slug } = req.params;

    const category = await req.prisma.voiceCategory.findUnique({
      where: { slug },
      include: {
        stations: {
          take: 20,
          orderBy: { subscriberCount: "desc" },
          include: {
            user: {
              select: { id: true, name: true, profileImg: true },
            },
            _count: {
              select: { posts: true, subscriptions: true },
            },
          },
        },
        _count: {
          select: { stations: true },
        },
      },
    });

    if (!category) {
      return res.status(404).json({ message: "Category not found" });
    }

    res.status(200).json({ result: category, message: "Category found" });
  } catch (error: any) {
    console.log(error.message);
    res.status(500).json({ message: error.message });
  }
});

// Get stations by category with pagination
router.get("/:slug/stations", async (req: any, res: any) => {
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

    const totalStations = await req.prisma.station.count({
      where: { categoryId: category.id },
    });

    const stations = await req.prisma.station.findMany({
      where: { categoryId: category.id },
      skip,
      take: limitNum,
      orderBy: { subscriberCount: "desc" },
      include: {
        user: {
          select: { id: true, name: true, profileImg: true },
        },
        _count: {
          select: { posts: true, subscriptions: true },
        },
      },
    });

    res.status(200).json({
      category,
      result: stations,
      pagination: {
        currentPage: pageNum,
        totalPages: Math.ceil(totalStations / limitNum),
        totalStations,
        hasMore: skip + limitNum < totalStations,
      },
    });
  } catch (error: any) {
    console.log(error.message);
    res.status(500).json({ message: error.message });
  }
});

// Seed categories (admin only - for now just check if empty)
router.post("/seed", async (req: any, res: any) => {
  try {
    const existingCount = await req.prisma.voiceCategory.count();

    if (existingCount > 0) {
      return res.status(400).json({ message: "Categories already exist" });
    }

    const createdCategories = await Promise.all(
      DEFAULT_CATEGORIES.map((cat) =>
        req.prisma.voiceCategory.create({ data: cat })
      )
    );

    res.status(201).json({ 
      result: createdCategories, 
      message: `${createdCategories.length} categories created` 
    });
  } catch (error: any) {
    console.log(error.message);
    res.status(500).json({ message: error.message });
  }
});

export default router;
