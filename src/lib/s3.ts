import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createWriteStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export const s3 = new S3Client({
  region: process.env.S3_REGION ?? "us-east-1",
  endpoint: process.env.S3_ENDPOINT || undefined, // local MinIO
  forcePathStyle: !!process.env.S3_ENDPOINT,
});
const Bucket = process.env.S3_BUCKET ?? "mauagent";
const TTL = 15 * 60; // presigned URLs are short-lived

export const presignPut = (Key: string) =>
  getSignedUrl(s3, new PutObjectCommand({ Bucket, Key, ContentType: "video/mp4" }), { expiresIn: TTL });

export const presignGet = (Key: string) => getSignedUrl(s3, new GetObjectCommand({ Bucket, Key }), { expiresIn: TTL });

export async function download(Key: string, dest: string) {
  const { Body } = await s3.send(new GetObjectCommand({ Bucket, Key }));
  await pipeline(Body as Readable, createWriteStream(dest));
}

export async function uploadFile(Key: string, path: string, ContentType = "video/mp4") {
  await s3.send(new PutObjectCommand({ Bucket, Key, Body: await readFile(path), ContentType }));
}

export async function uploadFromUrl(Key: string, url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download ${url}: ${res.status}`);
  await s3.send(new PutObjectCommand({ Bucket, Key, Body: Buffer.from(await res.arrayBuffer()), ContentType: "video/mp4" }));
}
