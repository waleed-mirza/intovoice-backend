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

export const resolveS3Key = (value: string): string => {
  if (!value) return value;
  try {
    const url = new URL(value);
    const bucket = process.env.AWS_BUCKET_NAME?.trim();
    let path = url.pathname.replace(/^\//, "");

    // Path-style: https://s3.region.amazonaws.com/bucket/key
    if (bucket && path.startsWith(`${bucket}/`)) {
      return path.slice(bucket.length + 1);
    }

    // Virtual-hosted: https://bucket.s3.region.amazonaws.com/key
    if (bucket && url.hostname.startsWith(`${bucket}.`)) {
      return path;
    }

    return path;
  } catch {
    // Not a URL — already a bare key
    return value;
  }
};

/** Normalize media fields for DB storage — bare S3 key; legacy full URLs are stripped to keys on write. */
export const normalizeAssetKey = (value: string | null | undefined): string | null => {
  if (value == null || value === "") return null;
  return resolveS3Key(value);
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
