import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { AUDIO_DIR, type DB } from "./db.js";

// A clearly labelled demo release, so anyone visiting the demo can try the whole flow:
// preview, own a copy, see it on their record shelf, and get into the owners' room.
export const DEMO_ARTIST = "The Test Pressings";
export const DEMO_ALBUM = "Ready for Release";
export const DEMO_TRACK = "Play Me First";
const SOURCE = path.resolve("demo", "one-i-can-release.m4a");

/** Seeds the demo artist and album once. Safe to call on every start. */
export function seedDemo(db: DB) {
  if (db.prepare(`SELECT 1 FROM artists WHERE demo = 1`).get() || !fs.existsSync(SOURCE)) return;
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
        "A demo artist, not a real act. This release is here so you can try OwnMusic end to end: preview it, own a numbered copy, and watch it land on your record shelf. No real money changes hands.",
      ).lastInsertRowid,
    );
    const albumId = Number(
      db.prepare(`INSERT INTO albums (artist_id, title, credits) VALUES (?, ?, ?)`).run(
        artistId,
        DEMO_ALBUM,
        "Demo album for the OwnMusic proof of concept.\nTrack supplied by Ben. All rights reserved.",
      ).lastInsertRowid,
    );
    db.prepare(`INSERT INTO tracks (album_id, position, title, audio_file) VALUES (?, 1, ?, ?)`).run(albumId, DEMO_TRACK, file);
    const post = db.prepare(`INSERT INTO posts (album_id, user_id, kind, body, max_number) VALUES (?, ?, ?, ?, ?)`);
    post.run(albumId, userId, "perk", "Demo perk: owners #0001 to #0100 would find something extra here, like stems, a lyric sheet or an early ticket link. Only low numbers can read this.", 100);
    post.run(albumId, userId, "post", "Welcome to the owners' room. Only people who own a copy can read and post here. Say hello to the other owners below.", null);
  })();
}
