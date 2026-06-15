import { Router } from "express";
import { deleteObject, getSignedURL } from "../../middlewares/AWSConfig";
import {
  assertReplaceKeyAllowed,
  getFolderForUploadType,
  userOwnsAssetKey,
} from "../../services/uploadKeys";

const router = Router();

const VALID_UPLOAD_TYPES = [
  "thumbnail",
  "audio",
  "avatar",
  "banner",
  "voice-comment",
] as const;

// Generate signed URL for voice uploads (thumbnails and audio)
router.get("/signed-url", async (req: any, res: any) => {
  try {
    const { fileName, fileType, uploadType, replaceKey } = req.query;

    if (!fileName || !fileType) {
      return res.status(400).json({ message: "fileName and fileType are required" });
    }

    if ((fileName as string).length > 200) {
      return res.status(400).json({ message: "File name is too long (max 200 characters)" });
    }

    if (uploadType && !VALID_UPLOAD_TYPES.includes(uploadType as typeof VALID_UPLOAD_TYPES[number])) {
      return res.status(400).json({ message: "Invalid uploadType" });
    }

    const resolvedUploadType = (uploadType as string) || "thumbnail";
    const baseFileType = (fileType as string).split(";")[0].trim();

    const allowedThumbnailTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    const allowedAudioTypes = [
      "audio/mpeg",
      "audio/mp4",
      "audio/wav",
      "audio/x-wav",
      "audio/wave",
      "audio/ogg",
      "audio/m4a",
      "audio/x-m4a",
      "audio/webm",
      "audio/aac",
      "audio/flac",
      "audio/x-flac",
    ];

    if (
      resolvedUploadType === "thumbnail" ||
      resolvedUploadType === "avatar" ||
      resolvedUploadType === "banner"
    ) {
      if (!allowedThumbnailTypes.includes(baseFileType)) {
        return res.status(400).json({
          message: "Invalid image type. Allowed: JPEG, PNG, WebP, GIF",
        });
      }
    } else if (resolvedUploadType === "audio" || resolvedUploadType === "voice-comment") {
      if (!allowedAudioTypes.includes(baseFileType)) {
        return res.status(400).json({
          message: "Invalid audio type. Allowed: MP3, M4A, WAV, OGG, WebM, AAC, FLAC",
        });
      }
    }

    const userId = req.userId;

    if (replaceKey) {
      const keyToDelete = assertReplaceKeyAllowed(
        replaceKey as string,
        userId,
        resolvedUploadType
      );
      await deleteObject(keyToDelete);
    }

    const timestamp = Date.now();
    const sanitizedFileName = (fileName as string).replace(/[^a-zA-Z0-9.-]/g, "_");
    const folder = getFolderForUploadType(resolvedUploadType);
    const key = `${folder}/${userId}/${timestamp}-${sanitizedFileName}`;

    const signedUrl = await getSignedURL(key, fileType);

    const bucketName = process.env.AWS_BUCKET_NAME?.trim();
    const region = process.env.AWS_CUSTOM_REGION?.trim();
    const fileUrl = `https://s3.${region}.amazonaws.com/${bucketName}/${key}`;

    res.status(200).json({
      signedUrl,
      key,
      fileUrl,
    });
  } catch (error: any) {
    console.log(error.message);
    res.status(error.message?.includes("replaceKey") ? 400 : 500).json({
      message: error.message,
    });
  }
});

/** Roll back a freshly uploaded key (e.g. create failed after PUT). */
router.delete("/asset", async (req: any, res: any) => {
  try {
    const { key } = req.query;
    if (!key || typeof key !== "string") {
      return res.status(400).json({ message: "key is required" });
    }

    if (!userOwnsAssetKey(key, req.userId)) {
      return res.status(403).json({ message: "Not authorized to delete this asset" });
    }

    await deleteObject(key);
    res.status(200).json({ message: "Asset deleted" });
  } catch (error: any) {
    console.log(error.message);
    res.status(500).json({ message: error.message });
  }
});

export default router;
