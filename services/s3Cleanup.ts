import { deleteObject } from "../middlewares/AWSConfig";
import { PrismaClient } from "@prisma/client";

/** Best-effort delete of one or more S3 assets (full URL or bare key). */
export async function deleteS3Assets(
  urls: (string | null | undefined)[]
): Promise<void> {
  const unique = [...new Set(urls.filter(Boolean) as string[])];
  await Promise.all(
    unique.map(async (url) => {
      try {
        await deleteObject(url);
      } catch (e) {
        console.log("Failed to delete S3 asset:", url, e);
      }
    })
  );
}

/**
 * Delete S3 audio for a comment and all direct replies.
 * Replies are flattened to the thread root, so deleting a top-level comment
 * removes every nested reply's audio before the DB cascade runs.
 */
export async function deleteCommentTreeS3Assets(
  prisma: PrismaClient,
  commentId: string,
  ownAudioUrl?: string | null
): Promise<void> {
  const replies = await prisma.voiceComment.findMany({
    where: { parentId: commentId, audioFileURL: { not: null } },
    select: { audioFileURL: true },
  });

  await deleteS3Assets([
    ownAudioUrl,
    ...replies.map((r) => r.audioFileURL),
  ]);
}

/** Delete tape thumbnail, audio, and all comment audio for a tape. */
export async function deleteTapeS3Assets(
  prisma: PrismaClient,
  tape: { id: string; thumbnailURL?: string | null; audioURL?: string | null }
): Promise<void> {
  const commentAudios = await prisma.voiceComment.findMany({
    where: { tapeId: tape.id, audioFileURL: { not: null } },
    select: { audioFileURL: true },
  });

  await deleteS3Assets([
    tape.thumbnailURL,
    tape.audioURL,
    ...commentAudios.map((c) => c.audioFileURL),
  ]);
}

/** Delete post thumbnail, audio, and all comment audio for a voice post. */
export async function deletePostS3Assets(
  prisma: PrismaClient,
  post: { id: string; thumbnailURL?: string | null; audioURL?: string | null }
): Promise<void> {
  const commentAudios = await prisma.voiceComment.findMany({
    where: { postId: post.id, audioFileURL: { not: null } },
    select: { audioFileURL: true },
  });

  await deleteS3Assets([
    post.thumbnailURL,
    post.audioURL,
    ...commentAudios.map((c) => c.audioFileURL),
  ]);
}

/** Delete station avatar/banner and all post + comment audio under the station. */
export async function deleteStationS3Assets(
  prisma: PrismaClient,
  station: {
    avatarURL?: string | null;
    bannerURL?: string | null;
    posts: Array<{
      thumbnailURL?: string | null;
      audioURL?: string | null;
      comments: Array<{ audioFileURL?: string | null }>;
    }>;
  }
): Promise<void> {
  const urls: (string | null | undefined)[] = [
    station.avatarURL,
    station.bannerURL,
  ];

  for (const post of station.posts) {
    urls.push(post.thumbnailURL, post.audioURL);
    for (const comment of post.comments) {
      urls.push(comment.audioFileURL);
    }
  }

  await deleteS3Assets(urls);
}
