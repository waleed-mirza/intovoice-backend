import { getMessaging } from "../middlewares/firebaseAdmin";
import { PrismaClient } from "@prisma/client";

interface NotificationData {
  title: string;
  body: string;
  type: string;
  contentId: string;
  senderId?: string;
  [key: string]: any;
}

const formatPreviewText = (value: string, maxLength = 50) => {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return normalized.length > maxLength
    ? `${normalized.substring(0, maxLength)}...`
    : normalized;
};

export async function sendPushNotification(
  prisma: PrismaClient,
  userId: string,
  notification: NotificationData
) {
  try {
    let messaging;
    try {
      messaging = getMessaging();
    } catch (error: any) {
      console.warn(`Firebase not available: ${error.message}`);
      return { success: false, message: "Firebase not available" };
    }

    const tokens = await prisma.fcmToken.findMany({
      where: { userId, isActive: true },
      select: { token: true },
    });

    if (tokens.length === 0) {
      return { success: false, message: "No active tokens" };
    }

    const fcmTokens = tokens.map((t) => t.token);
    const messageData: { [key: string]: string } = {
      type: notification.type,
      contentId: notification.contentId,
      clickAction: "FLUTTER_NOTIFICATION_CLICK",
    };

    if (notification.senderId) {
      messageData.senderId = notification.senderId;
    }

    const response = await messaging.sendEachForMulticast({
      tokens: fcmTokens,
      notification: { title: notification.title, body: notification.body },
      data: messageData,
      webpush: {
        notification: { icon: "/intovoice_logo.png", badge: "/intovoice_logo.png" },
      },
    });

    if (response.failureCount > 0) {
      const failedTokens: string[] = [];
      response.responses.forEach((resp, idx) => {
        if (!resp.success) failedTokens.push(fcmTokens[idx]);
      });
      if (failedTokens.length > 0) {
        await prisma.fcmToken.updateMany({
          where: { token: { in: failedTokens } },
          data: { isActive: false, updatedAt: new Date() },
        });
      }
    }

    return {
      success: true,
      successCount: response.successCount,
      failureCount: response.failureCount,
    };
  } catch (error: any) {
    console.error("Error sending push notification:", error);
    return { success: false, error: error.message };
  }
}

export async function notifyVoiceSubscription(
  prisma: PrismaClient,
  stationOwnerId: string,
  subscriberUserId: string,
  subscriberName: string,
  stationId: string,
  stationName: string
) {
  await sendPushNotification(prisma, stationOwnerId, {
    title: "New Subscriber",
    body: `${subscriberName} subscribed to ${stationName}`,
    type: "voice_subscription",
    contentId: stationId,
    senderId: subscriberUserId,
  });
}

export async function notifyVoiceNewPost(
  prisma: PrismaClient,
  subscriberId: string,
  stationId: string,
  stationName: string,
  postId: string,
  postTitle: string
) {
  const truncatedTitle =
    postTitle.length > 40 ? `${postTitle.substring(0, 40)}...` : postTitle;

  await sendPushNotification(prisma, subscriberId, {
    title: stationName,
    body: `New post: ${truncatedTitle}`,
    type: "voice_new_post",
    contentId: postId,
    senderId: stationId,
  });
}

export async function notifyVoicePostLike(
  prisma: PrismaClient,
  stationOwnerId: string,
  likerUserId: string,
  likerName: string,
  postId: string,
  postTitle: string
) {
  const truncatedTitle =
    postTitle.length > 30 ? `${postTitle.substring(0, 30)}...` : postTitle;

  await sendPushNotification(prisma, stationOwnerId, {
    title: "New Like",
    body: `${likerName} liked "${truncatedTitle}"`,
    type: "voice_like",
    contentId: postId,
    senderId: likerUserId,
  });
}

export async function notifyVoiceComment(
  prisma: PrismaClient,
  stationOwnerId: string,
  commenterUserId: string,
  commenterName: string,
  postId: string,
  commentText: string
) {
  const truncatedComment = formatPreviewText(commentText);

  await sendPushNotification(prisma, stationOwnerId, {
    title: "New Comment",
    body: `${commenterName}: ${truncatedComment}`,
    type: "voice_comment",
    contentId: postId,
    senderId: commenterUserId,
  });
}
