import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { AUDIO_DIR, type DB } from "./db.js";

// Artwork is part of the album package: the cover, back cover, booklet pages and inserts,
// kept at the full resolution the artist uploaded. The cover is public (it sells the album);
// everything else is for owners. Each image's SHA-256 goes into the NFT metadata, so a
// copy's token proves exactly which files came with it.

export type ArtworkKind = "cover" | "back" | "booklet" | "insert";
export const ARTWORK_KINDS: ArtworkKind[] = ["cover", "back", "booklet", "insert"];
const LABEL: Record<ArtworkKind, string> = { cover: "Front cover", back: "Back cover", booklet: "Booklet", insert: "Insert" };

export type Artwork = {
  id: number; albumId: number; position: number; kind: ArtworkKind; title: string; mime: string;
  bytes: number; width: number | null; height: number | null; sha256: string; ipfsCid: string | null;
};

/** Width and height from a PNG, JPEG or WebP header, without an image library. */
export function imageSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) return null;
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      // SOF0..SOF15, except DHT (c4), JPG (c8) and DAC (cc), carry the frame size.
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker))
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      i += 2 + len;
    }
    return null;
  }
  if (buf.length > 30 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    const chunk = buf.toString("ascii", 12, 16);
    if (chunk === "VP8X") return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
    if (chunk === "VP8 ") return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    if (chunk === "VP8L") {
      const b = buf.readUInt32LE(21);
      return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
    }
  }
  return null;
}

const MIME: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" };

/** Adds an image already saved in AUDIO_DIR to an album's package. A new cover replaces the old one. */
export function addArtwork(db: DB, albumId: number, file: string, kind: ArtworkKind, title?: string) {
  const buf = fs.readFileSync(path.join(AUDIO_DIR, file));
  const size = imageSize(buf);
  const sha256 = crypto.createHash("sha256").update(buf).digest("hex");
  const mime = MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream";
  return db.transaction(() => {
    if (kind === "cover") {
      db.prepare(`DELETE FROM artwork WHERE album_id = ? AND kind = 'cover'`).run(albumId);
      db.prepare(`UPDATE albums SET cover_file = ? WHERE id = ?`).run(file, albumId);
    }
    const { n } = db.prepare(`SELECT COALESCE(MAX(position), 0) + 1 AS n FROM artwork WHERE album_id = ?`).get(albumId) as { n: number };
    return Number(
      db.prepare(
        `INSERT INTO artwork (album_id, position, kind, title, file, mime, bytes, width, height, sha256) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(albumId, kind === "cover" ? 0 : n, kind, title ?? LABEL[kind], file, mime, buf.length, size?.width ?? null, size?.height ?? null, sha256).lastInsertRowid,
    );
  })();
}

/** Guess the kind from a file name: "back.jpg" is a back cover, "insert" an insert, the rest booklet pages. */
export function kindFromName(name: string): ArtworkKind {
  const n = name.toLowerCase();
  if (/\b(front|cover)\b/.test(n) && !/back/.test(n)) return "cover";
  if (/back/.test(n)) return "back";
  if (/insert|poster|sticker/.test(n)) return "insert";
  return "booklet";
}

export function listArtwork(db: DB, albumId: number): Artwork[] {
  return db
    .prepare(
      `SELECT id, album_id AS albumId, position, kind, title, mime, bytes, width, height, sha256, ipfs_cid AS ipfsCid
       FROM artwork WHERE album_id = ?
       ORDER BY CASE kind WHEN 'cover' THEN 0 WHEN 'back' THEN 1 WHEN 'booklet' THEN 2 ELSE 3 END, position`,
    )
    .all(albumId) as Artwork[];
}

export function artworkFile(db: DB, id: number) {
  return db.prepare(`SELECT album_id AS albumId, kind, title, file, mime FROM artwork WHERE id = ?`).get(id) as
    | { albumId: number; kind: ArtworkKind; title: string; file: string; mime: string }
    | undefined;
}

/** Albums released before the artwork table get their cover recorded as artwork. */
export function backfillCovers(db: DB) {
  const missing = db
    .prepare(`SELECT id, cover_file AS file FROM albums WHERE cover_file IS NOT NULL AND NOT EXISTS (SELECT 1 FROM artwork WHERE album_id = albums.id AND kind = 'cover')`)
    .all() as { id: number; file: string }[];
  for (const a of missing) if (fs.existsSync(path.join(AUDIO_DIR, a.file))) addArtwork(db, a.id, a.file, "cover");
}

// Optional permanent copies on IPFS through Pinata. Pinned files are public, so only the cover
// is pinned unless PIN_ALL_ARTWORK=1. Set PINATA_JWT to turn it on.
const PINATA_JWT = process.env.PINATA_JWT;
const PINATA_URL = process.env.PINATA_URL ?? "https://api.pinata.cloud/pinning/pinFileToIPFS";
const PIN_ALL = process.env.PIN_ALL_ARTWORK === "1";
export const ipfsEnabled = () => !!PINATA_JWT;

export async function pinNextArtwork(db: DB) {
  if (!PINATA_JWT) return false;
  const a = db
    .prepare(`SELECT id, file, mime, title, album_id AS albumId FROM artwork WHERE ipfs_cid IS NULL ${PIN_ALL ? "" : "AND kind = 'cover'"} ORDER BY id LIMIT 1`)
    .get() as { id: number; file: string; mime: string; title: string; albumId: number } | undefined;
  if (!a) return false;
  const form = new FormData();
  form.append("file", new Blob([fs.readFileSync(path.join(AUDIO_DIR, a.file))], { type: a.mime }), a.file);
  form.append("pinataMetadata", JSON.stringify({ name: `ownmusic-album-${a.albumId}-${a.title}` }));
  const res = await fetch(PINATA_URL, { method: "POST", headers: { Authorization: `Bearer ${PINATA_JWT}` }, body: form });
  if (!res.ok) throw new Error(`IPFS pin failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const { IpfsHash } = (await res.json()) as { IpfsHash: string };
  db.prepare(`UPDATE artwork SET ipfs_cid = ? WHERE id = ?`).run(IpfsHash, a.id);
  return true;
}
