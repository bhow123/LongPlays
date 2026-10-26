import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { AUDIO_DIR, type DB } from "./db.js";
import { addArtwork, imageSize, type ArtworkKind } from "./artwork.js";

// A clearly labelled demo release, so anyone visiting the demo can try the whole flow:
// preview, own a copy, see it on their record shelf, and get into the owners' room.
export const DEMO_ARTIST = "The Test Pressings";
export const DEMO_ALBUM = "Ready for Release";
export const DEMO_TRACK = "Play Me First";
const SOURCE = path.resolve("demo", "one-i-can-release.m4a");
const DEMO_BIO =
  "A demo artist, not a real act. This release is here so you can try LongPlays end to end: preview it, own a numbered copy, and watch it land on your record shelf. No real money changes hands.";
const DEMO_CREDITS = "Demo album for the LongPlays proof of concept.\nTrack supplied by Ben. All rights reserved.";

/** Seeds the demo artist and album once. Safe to call on every start. */
export function seedDemo(db: DB) {
  if (db.prepare(`SELECT 1 FROM artists WHERE demo = 1`).get()) {
    // Keep an already seeded demo's wording current (e.g. after the rename to LongPlays).
    db.prepare(`UPDATE artists SET bio = ? WHERE demo = 1`).run(DEMO_BIO);
    db.prepare(`UPDATE albums SET credits = ? WHERE artist_id IN (SELECT id FROM artists WHERE demo = 1)`).run(DEMO_CREDITS);
    return;
  }
  if (!fs.existsSync(SOURCE)) return;
  const file = "demo-one-i-can-release.m4a";
  fs.copyFileSync(SOURCE, path.join(AUDIO_DIR, file));
  db.transaction(() => {
    // Nobody can sign in as the demo artist: the password is random and thrown away.
    const salt = crypto.randomBytes(16).toString("hex");
    const hash = `${salt}:${crypto.scryptSync(crypto.randomBytes(32), salt, 32).toString("hex")}`;
    const userId = Number(db.prepare(`INSERT INTO users (name, password_hash) VALUES (?, ?)`).run(DEMO_ARTIST, hash).lastInsertRowid);
    const artistId = Number(
      db.prepare(`INSERT INTO artists (user_id, name, bio, verified, demo) VALUES (?, ?, ?, 1, 1)`).run(
        userId,
        DEMO_ARTIST,
        DEMO_BIO,
      ).lastInsertRowid,
    );
    const albumId = Number(
      db.prepare(`INSERT INTO albums (artist_id, title, credits) VALUES (?, ?, ?)`).run(
        artistId,
        DEMO_ALBUM,
        DEMO_CREDITS,
      ).lastInsertRowid,
    );
    db.prepare(`INSERT INTO tracks (album_id, position, title, audio_file) VALUES (?, 1, ?, ?)`).run(albumId, DEMO_TRACK, file);
    const post = db.prepare(`INSERT INTO posts (album_id, user_id, kind, body, max_number) VALUES (?, ?, ?, ?, ?)`);
    post.run(albumId, userId, "perk", "Demo perk: owners #0001 to #0100 would find something extra here, like stems, a lyric sheet or an early ticket link. Only low numbers can read this.", 100);
    post.run(albumId, userId, "post", "Welcome to the owners' room. Only people who own a copy can read and post here. Say hello to the other owners below.", null);
  })();
}

// The demo album's package: full-resolution front cover, back cover and a booklet page.
const DEMO_ARTWORK: [string, ArtworkKind][] = [["cover.jpg", "cover"], ["back-cover.jpg", "back"], ["booklet-01.jpg", "booklet"]];

/** Adds the demo artwork, including to a demo album seeded before artwork existed, and refreshes it when the files change. */
export function seedDemoArtwork(db: DB) {
  const album = db
    .prepare(`SELECT al.id FROM albums al JOIN artists ar ON ar.id = al.artist_id WHERE ar.demo = 1 ORDER BY al.id LIMIT 1`)
    .get() as { id: number } | undefined;
  if (!album) return;
  for (const [name, kind] of DEMO_ARTWORK) {
    const source = path.resolve("demo", name);
    if (!fs.existsSync(source)) continue;
    const file = `demo-${name}`;
    const buf = fs.readFileSync(source);
    const sha256 = crypto.createHash("sha256").update(buf).digest("hex");
    const existing = db.prepare(`SELECT id, sha256 FROM artwork WHERE album_id = ? AND file = ?`).get(album.id, file) as
      | { id: number; sha256: string }
      | undefined;
    if (existing?.sha256 === sha256) continue;
    fs.writeFileSync(path.join(AUDIO_DIR, file), buf);
    if (!existing) {
      addArtwork(db, album.id, file, kind, kind === "booklet" ? "Booklet page 1" : undefined);
      continue;
    }
    // The demo artwork was redrawn: refresh it in place, and pin the new version if IPFS is on.
    const size = imageSize(buf);
    db.prepare(`UPDATE artwork SET bytes = ?, width = ?, height = ?, sha256 = ?, ipfs_cid = NULL WHERE id = ?`).run(
      buf.length, size?.width ?? null, size?.height ?? null, sha256, existing.id,
    );
  }
}
