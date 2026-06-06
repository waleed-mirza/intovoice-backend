import { Router } from "express";
import verifyToken from "../../middlewares/verifyToken";
import { reportLimiter } from "../../middlewares/rateLimiter";

const router = Router();

export const REPORT_TARGET_TYPES = ["voice_post", "voice_comment"] as const;
type ReportTargetType = (typeof REPORT_TARGET_TYPES)[number];

export const REPORT_REASONS = [
  "spam",
  "harassment",
  "hate_speech",
  "violence",
  "sexual_content",
  "self_harm",
  "misinformation",
  "intellectual_property",
  "other",
] as const;

const MAX_DESCRIPTION_LENGTH = 1000;

async function loadTarget(
  prisma: any,
  targetType: ReportTargetType,
  targetId: string
): Promise<{ exists: boolean; authorId?: string }> {
  if (targetType === "voice_post") {
    const row = await prisma.voicePost.findUnique({
      where: { id: targetId },
      select: { station: { select: { userId: true } } },
    });
    return row ? { exists: true, authorId: row.station?.userId } : { exists: false };
  }
  if (targetType === "voice_comment") {
    const row = await prisma.voiceComment.findUnique({
      where: { id: targetId },
      select: { authorId: true },
    });
    return row ? { exists: true, authorId: row.authorId } : { exists: false };
  }
  return { exists: false };
}

router.post("/", verifyToken, reportLimiter, async (req: any, res: any) => {
  try {
    const userId = req.userId;
    const { targetType, targetId, reason, description } = req.body || {};

    if (!targetType || !targetId || !reason) {
      return res.status(400).json({ message: "targetType, targetId and reason are required" });
    }
    if (!REPORT_TARGET_TYPES.includes(targetType)) {
      return res.status(400).json({ message: "Invalid targetType" });
    }
    if (!REPORT_REASONS.includes(reason)) {
      return res.status(400).json({ message: "Invalid reason" });
    }

    const trimmedDescription =
      typeof description === "string" ? description.trim() : "";
    if (trimmedDescription.length > MAX_DESCRIPTION_LENGTH) {
      return res.status(400).json({
        message: `Description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer`,
      });
    }

    const target = await loadTarget(req.prisma, targetType, String(targetId));
    if (!target.exists) {
      return res.status(404).json({ message: "Reported content not found" });
    }
    if (target.authorId && target.authorId === userId) {
      return res.status(400).json({ message: "You cannot report your own content" });
    }

    const existing = await req.prisma.report.findUnique({
      where: {
        reporterId_targetType_targetId: {
          reporterId: userId,
          targetType,
          targetId: String(targetId),
        },
      },
    });

    if (existing) {
      return res.status(200).json({
        result: existing,
        alreadyReported: true,
        message: "You have already reported this content",
      });
    }

    const report = await req.prisma.report.create({
      data: {
        targetType,
        targetId: String(targetId),
        reporterId: userId,
        reason,
        description: trimmedDescription || null,
      },
    });

    res.status(201).json({
      result: report,
      alreadyReported: false,
      message: "Report submitted. Thank you for helping keep the community safe.",
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

router.get(
  "/mine/:targetType/:targetId",
  verifyToken,
  async (req: any, res: any) => {
    try {
      const { targetType, targetId } = req.params;
      if (!REPORT_TARGET_TYPES.includes(targetType)) {
        return res.status(400).json({ message: "Invalid targetType" });
      }
      const existing = await req.prisma.report.findUnique({
        where: {
          reporterId_targetType_targetId: {
            reporterId: req.userId,
            targetType,
            targetId,
          },
        },
        select: { id: true, status: true, reason: true, createdAt: true },
      });
      res.status(200).json({ result: existing || null });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  }
);

export default router;
