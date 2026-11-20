const { S3Client, PutObjectCommand, HeadBucketCommand } = require("@aws-sdk/client-s3");

function getS3Client() {
    const endpoint = process.env.S3_ENDPOINT || "https://nos.jkt-1.neo.id";
    const region = process.env.S3_REGION || "jkt-1";
    const accessKeyId = process.env.S3_ACCESS_KEY_ID || "";
    const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY || "";

    return new S3Client({
        region,
        endpoint,
        credentials: {
            accessKeyId,
            secretAccessKey,
        },
        forcePathStyle: true,
    });
}

function getBucketName() {
    return process.env.S3_BUCKET_NAME || "plantoday-images";
}

function getS3PublicUrl(key) {
    const bucket = getBucketName();
    const cleanKey = String(key || "").replace(/^\/+/, "");
    const defaultBase = `${process.env.S3_ENDPOINT || "https://nos.jkt-1.neo.id"}/${bucket}`;
    const publicBase = (process.env.S3_PUBLIC_BASE_URL || defaultBase).replace(/\/+$/, "");
    return `${publicBase}/${cleanKey}`;
}

/**
 * Upload buffer ke S3 Object Storage (NEO NOS)
 * @param {Object} params
 * @param {Buffer} params.buffer - Data file gambar
 * @param {string} params.key - Path key di dalam bucket (cth: images/visits/3075-123.jpg)
 * @param {string} [params.contentType='image/jpeg'] - MIME type
 * @param {string} [params.acl='public-read'] - ACL permissions
 * @returns {Promise<{ url: string, key: string, bucket: string }>}
 */
async function uploadToS3({ buffer, key, contentType = "image/jpeg", acl = "public-read" }) {
    if (!buffer || !Buffer.isBuffer(buffer)) {
        throw new Error("Buffer file tidak valid untuk upload S3");
    }
    if (!key) {
        throw new Error("Key tujuan di S3 wajib diisi");
    }

    const bucket = getBucketName();
    const cleanKey = String(key).replace(/^\/+/, "");
    const client = getS3Client();

    const command = new PutObjectCommand({
        Bucket: bucket,
        Key: cleanKey,
        Body: buffer,
        ContentType: contentType,
        ACL: acl,
    });

    await client.send(command);

    const url = getS3PublicUrl(cleanKey);
    return {
        url,
        key: cleanKey,
        bucket,
    };
}

module.exports = {
    getS3Client,
    getBucketName,
    getS3PublicUrl,
    uploadToS3,
};
