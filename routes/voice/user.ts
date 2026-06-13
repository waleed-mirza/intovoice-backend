import { Router } from "express";

const router = Router();

const publicUserSelect = {
  id: true,
  name: true,
  username: true,
  profileImg: true,
  bannerImg: true,
  createdAt: true,
} as const;

// Public profile: user info + owned stations
router.get("/:id", async (req: any, res: any) => {
  try {
    const { id } = req.params;

    const user = await req.prisma.user.findFirst({
      where: { id, isDeleted: false },
      select: publicUserSelect,
    });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const stations = await req.prisma.station.findMany({
      where: { userId: id },
      select: {
        id: true,
        name: true,
        handle: true,
        description: true,
        avatarURL: true,
        bannerURL: true,
        subscriberCount: true,
        category: { select: { id: true, name: true, slug: true } },
        _count: { select: { posts: true, subscriptions: true, tapes: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    res.status(200).json({
      result: { ...user, stations },
      message: "User profile",
    });
  } catch (error: any) {
    console.log(error.message);
    res.status(500).json({ message: error.message });
  }
});

export default router;
