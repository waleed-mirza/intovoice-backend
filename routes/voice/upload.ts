import { Router } from "express";
import { getSignedURL } from "../../middlewares/AWSConfig";

const router = Router();

// Generate signed URL for voice uploads (thumbnails and audio)
router.get("/signed-url", async (req: any, res: any) => {
  try {
    const { fileName, fileType, uploadType } = req.query;

    if (!fileName || !fileType) {
      return res.status(400).json({ message: "fileName and fileType are required" });
    }

    // Enforce max filename length to prevent oversized S3 keys
    if ((fileName as string).length > 200) {
      return res.status(400).json({ message: "File name is too long (max 200 characters)" });
    }

    // Validate uploadType
    const validTypes = [
      "thumbnail",
      "audio",
      "avatar",
      "banner",
      "voice-comment",
    ];
    if (uploadType && !validTypes.includes(uploadType)) {
      return res.status(400).json({ message: "Invalid uploadType" });
    }

    // Validate file type based on upload type
    // Strip codec suffix (e.g. "audio/webm;codecs=opus" → "audio/webm") for validation
    const baseFileType = (fileType as string).split(";")[0].trim();

    const allowedThumbnailTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    const allowedAudioTypes = ["audio/mpeg", "audio/mp4", "audio/wav", "audio/ogg", "audio/m4a", "audio/x-m4a", "audio/webm"];
    const allowedImageTypes = [...allowedThumbnailTypes];

    if (uploadType === "thumbnail" || uploadType === "avatar" || uploadType === "banner") {
      if (!allowedImageTypes.includes(baseFileType)) {
        return res.status(400).json({ 
          message: "Invalid image type. Allowed: JPEG, PNG, WebP, GIF" 
        });
      }
    } else if (uploadType === "audio" || uploadType === "voice-comment") {
      if (!allowedAudioTypes.includes(baseFileType)) {
        return res.status(400).json({ 
          message: "Invalid audio type. Allowed: MP3, M4A, WAV, OGG, WebM" 
        });
      }
    }

    // Generate unique file key with folder structure
    const timestamp = Date.now();
    const userId = req.userId;
    const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, "_");
    
    let folder = "voice";
    if (uploadType === "thumbnail") folder = "voice/thumbnails";
    else if (uploadType === "audio") folder = "voice/audio";
    else if (uploadType === "avatar") folder = "voice/avatars";
    else if (uploadType === "banner") folder = "voice/banners";
    else if (uploadType === "voice-comment") folder = "voice/comments";

    const key = `${folder}/${userId}/${timestamp}-${sanitizedFileName}`;

    const signedUrl = await getSignedURL(key, fileType);
    
    // Use path-style URL format (same as posts)
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
    res.status(500).json({ message: error.message });
  }
});

export default router;
