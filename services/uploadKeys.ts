import { resolveS3Key } from "../middlewares/AWSConfig";

export const UPLOAD_TYPE_FOLDERS: Record<string, string> = {
  thumbnail: "voice/thumbnails",
  audio: "voice/audio",
  avatar: "voice/avatars",
  banner: "voice/banners",
  "voice-comment": "voice/comments",
};

export function getFolderForUploadType(uploadType: string): string {
  return UPLOAD_TYPE_FOLDERS[uploadType] ?? "voice";
}

/** True when key is under voice/{type}/{userId}/ for any upload type. */
export function userOwnsAssetKey(key: string, userId: string): boolean {
  const normalized = resolveS3Key(key);
  return Object.values(UPLOAD_TYPE_FOLDERS).some((folder) =>
    normalized.startsWith(`${folder}/${userId}/`)
  );
}

/** replaceKey must match the folder for the current uploadType and belong to the user. */
export function assertReplaceKeyAllowed(
  replaceKey: string,
  userId: string,
  uploadType: string
): string {
  const normalized = resolveS3Key(replaceKey);
  const folder = getFolderForUploadType(uploadType);
  const prefix = `${folder}/${userId}/`;
  if (!normalized.startsWith(prefix)) {
    throw new Error("replaceKey is not valid for this upload type");
  }
  return normalized;
}
