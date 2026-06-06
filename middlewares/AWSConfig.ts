import S3 from "aws-sdk/clients/s3";

export const s3 = new S3({
  accessKeyId: process.env.AWS_ACCESS_KEY,
  secretAccessKey: process.env.AWS_SECRET_KEY,
  region: process.env.AWS_CUSTOM_REGION,
});

export const getSignedURL = async (fileName: any, fileType: any) => {
  const fileParams = {
    Bucket: process.env.AWS_BUCKET_NAME,
    Key: fileName,
    Expires: 6000,
    ContentType: fileType,
  };
  const url = await s3.getSignedUrlPromise("putObject", fileParams);

  return url;
};

/**
 * Resolves an S3 key from either a full S3 URL or a bare key.
 * Handles both storage patterns:
 *   - Full URL: "https://s3.region.amazonaws.com/bucket/voice/thumbnails/file.jpg" → "voice/thumbnails/file.jpg"
 *   - Bare key: "voice/comments/file.webm" → "voice/comments/file.webm"
 */
export const resolveS3Key = (value: string): string => {
  if (!value) return value;
  try {
    const url = new URL(value);
    // It's a valid URL — strip the leading slash from pathname to get the key
    return url.pathname.replace(/^\//, "");
  } catch {
    // Not a URL — already a bare key
    return value;
  }
};

// delete object from bucket if it exists in bucket
export const deleteObject = async (fileName: any) => {
  const key = resolveS3Key(fileName);
  const fileParams = {
    Bucket: process.env.AWS_BUCKET_NAME,
    Key: key,
  };
  try {
    await s3.deleteObject(fileParams).promise();
    console.log("deleteObject: ", key);
  } catch (error) {
    console.log("Error deleting object from bucket: ", error);
    throw error.message;
  }
};
