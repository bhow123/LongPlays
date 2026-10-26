import fs from "node:fs";
import path from "node:path";
import type { Response } from "express";
import { AwsClient } from "aws4fetch";
import { AUDIO_DIR, type DB } from "./db.js";

// Uploads land on the local disk first. When Cloudflare R2 is configured, a worker copies every
// track and image into a private bucket, and the app then answers file requests with a short-lived
// signed link to R2, after its own access checks. R2 doesn't charge for downloads, so plays and
// artwork downloads stop costing hosting egress. The local copies stay as a backup.
const ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const BUCKET = process.env.R2_BUCKET;
const ENDPOINT = (process.env.R2_ENDPOINT ?? (ACCOUNT_ID ? `https://${ACCOUNT_ID}.r2.cloudflarestorage.com` : "")).replace(/\/$/, "");
const LINK_SECONDS = 3600;

const client =
  ENDPOINT && BUCKET && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY
    ? new AwsClient({
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
        service: "s3",
        region: "auto",
      })
    : null;

export const r2Enabled = () => !!client;

const objectUrl = (file: string) => `${ENDPOINT}/${BUCKET}/${encodeURIComponent(file)}`;

/** Every file the app serves: track audio, album covers and artwork. */
function referencedFiles(db: DB) {
  return (
    db
      .prepare(
        `SELECT audio_file AS file FROM tracks UNION SELECT cover_file FROM albums WHERE cover_file IS NOT NULL UNION SELECT file FROM artwork`,
      )
      .all() as { file: string }[]
  ).map((r) => r.file);
}

const MIME: Record<string, string> = {
  ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".aac": "audio/aac", ".wav": "audio/wav", ".flac": "audio/flac", ".ogg": "audio/ogg",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif",
};
const mimeOf = (file: string) => MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream";

/**
 * Copies the next file that isn't in R2 yet, or that changed since it was copied (the demo artwork
 * is redrawn in place). Returns false when everything is in sync.
 */
export async function syncNextFile(db: DB): Promise<boolean> {
  if (!client) return false;
  for (const file of referencedFiles(db)) {
    const local = path.join(AUDIO_DIR, file);
    if (!fs.existsSync(local)) continue;
    const { size, mtimeMs } = fs.statSync(local);
    const done = db.prepare(`SELECT bytes, mtime FROM remote_files WHERE file = ?`).get(file) as { bytes: number; mtime: number } | undefined;
    if (done && done.bytes === size && done.mtime === Math.floor(mtimeMs)) continue;
    const res = await client.fetch(objectUrl(file), {
      method: "PUT",
      body: fs.readFileSync(local),
      headers: { "content-type": mimeOf(file) },
    });
    if (!res.ok) throw new Error(`r2: upload of ${file} failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
    db.prepare(
      `INSERT INTO remote_files (file, bytes, mtime) VALUES (?, ?, ?)
       ON CONFLICT(file) DO UPDATE SET bytes = excluded.bytes, mtime = excluded.mtime, uploaded_at = datetime('now')`,
    ).run(file, size, Math.floor(mtimeMs));
    return true;
  }
  return false;
}

export function storageStatus(db: DB) {
  const files = referencedFiles(db);
  const inR2 = (db.prepare(`SELECT COUNT(*) AS n FROM remote_files`).get() as { n: number }).n;
  return { r2: r2Enabled(), bucket: client ? BUCKET : null, files: files.length, inR2 };
}

/** Copies files to R2 in the background, a few seconds apart, logging each distinct error once. */
export function startStorageSync(db: DB) {
  if (!client) return;
  let busy = false;
  let lastError = "";
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      let copied = 0;
      while (await syncNextFile(db)) copied++;
      if (copied) console.log(`r2: copied ${copied} file(s) to ${BUCKET}`);
      lastError = "";
    } catch (e) {
      const msg = (e as Error).message;
      if (msg !== lastError) console.error(msg);
      lastError = msg;
    } finally {
      busy = false;
    }
  };
  console.log(`r2: storing files in bucket ${BUCKET}`);
  void tick();
  setInterval(tick, 15_000);
}

/**
 * Sends a stored file. Once it's in R2 the response is a redirect to a signed link that works for an
 * hour; otherwise the file comes from the local disk. Call this only after the caller's access checks.
 */
export async function sendStored(
  db: DB,
  res: Response,
  file: string,
  opts: { cache?: "public" | "private"; downloadName?: string } = {},
) {
  if (client && db.prepare(`SELECT 1 FROM remote_files WHERE file = ?`).get(file)) {
    const url = new URL(objectUrl(file));
    url.searchParams.set("X-Amz-Expires", String(LINK_SECONDS));
    url.searchParams.set("response-content-type", mimeOf(file));
    if (opts.downloadName) url.searchParams.set("response-content-disposition", `attachment; filename="${opts.downloadName.replace(/"/g, "")}"`);
    const signed = await client.sign(url.toString(), { method: "GET", aws: { signQuery: true } });
    // The signed link expires, so browsers may only reuse the redirect for a few minutes.
    return res.set("cache-control", `${opts.cache ?? "private"}, max-age=300`).redirect(302, signed.url);
  }
  if (opts.downloadName) res.attachment(opts.downloadName);
  if (opts.cache) res.set("cache-control", `${opts.cache}, max-age=86400`);
  res.sendFile(path.join(AUDIO_DIR, file));
}
