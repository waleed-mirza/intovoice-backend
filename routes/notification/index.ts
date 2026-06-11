import express from "express";
import verifyToken from "../../middlewares/verifyToken";

const router = express.Router();

const VOICE_NOTIFICATION_TYPES = [
  "voice_subscription",
  "voice_new_post",
  "voice_like",
  "voice_comment",
  "voice_live",
];

export const createNotification = async (
  prisma: any,
  data: {
    senderName: string;
    senderId: string;
    receiverId: string;
    type: string;
    content: string;
  }
) => {
  try {
    if (data.senderId === data.receiverId) return;
    await prisma.notification.create({ data });
  } catch (error) {
    console.log("Notification creation failed:", error);
  }
};

router.get("/all", verifyToken, async (req: any, res: any) => {
  try {
    const notifications = await req.prisma.notification.findMany({
      where: {
        receiverId: req.userId,
        type: { in: VOICE_NOTIFICATION_TYPES },
      },
      include: {
        sender: {
          select: { id: true, name: true, username: true, profileImg: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    res.status(200).json({
      notifications: notifications.map((n: any) => ({
        id: n.id,
        type: n.type,
        content: n.content,
        read: n.read,
        createdAt: n.createdAt,
        sender: n.sender,
      })),
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

router.get("/unreadcount", verifyToken, async (req: any, res: any) => {
  try {
    const count = await req.prisma.notification.count({
      where: {
        receiverId: req.userId,
        read: false,
        type: { in: VOICE_NOTIFICATION_TYPES },
      },
    });
    res.status(200).json({ count });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

router.post("/mark-read/:notificationId", verifyToken, async (req: any, res: any) => {
  try {
    const notification = await req.prisma.notification.findUnique({
      where: { id: req.params.notificationId },
    });
    if (!notification) return res.status(404).json({ message: "Notification not found" });
    if (notification.receiverId !== req.userId) {
      return res.status(403).json({ message: "Unauthorized" });
    }
    const result = await req.prisma.notification.update({
      where: { id: req.params.notificationId },
      data: { read: true },
    });
    res.status(200).json({ success: true, notification: result });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

router.post("/mark-all-read", verifyToken, async (req: any, res: any) => {
  try {
    const result = await req.prisma.notification.updateMany({
      where: {
        receiverId: req.userId,
        read: false,
        type: { in: VOICE_NOTIFICATION_TYPES },
      },
      data: { read: true },
    });
    res.status(200).json({ success: true, updatedCount: result.count });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

router.post("/fcm-token", verifyToken, async (req: any, res: any) => {
  try {
    const { fcmToken, deviceType, deviceInfo } = req.body;
    if (!fcmToken || !deviceType) {
      return res.status(400).json({ message: "fcmToken and deviceType are required" });
    }

    await req.prisma.fcmToken.upsert({
      where: { token: fcmToken },
      update: {
        userId: req.userId,
        deviceType,
        deviceInfo: deviceInfo || null,
        isActive: true,
        lastUsedAt: new Date(),
        updatedAt: new Date(),
      },
      create: {
        userId: req.userId,
        token: fcmToken,
        deviceType,
        deviceInfo: deviceInfo || null,
      },
    });

    res.status(200).json({ message: "FCM token registered" });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

router.delete("/fcm-token", verifyToken, async (req: any, res: any) => {
  try {
    const { fcmToken } = req.body;
    if (!fcmToken) {
      return res.status(400).json({ message: "fcmToken is required" });
    }
    await req.prisma.fcmToken.updateMany({
      where: { userId: req.userId, token: fcmToken },
      data: { isActive: false, updatedAt: new Date() },
    });
    res.status(200).json({ message: "FCM token removed" });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

export default router;
