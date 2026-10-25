import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export const DATA_DIR = process.env.DATA_DIR ?? path.resolve("data");
export const AUDIO_DIR = path.join(DATA_DIR, "audio");
fs.mkdirSync(AUDIO_DIR, { recursive: true });

export function openDb(file = path.join(DATA_DIR, "ownmusic.db")) {
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      password_hash TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    -- An artist is a real person or band, verified by the platform before releasing.
    CREATE TABLE IF NOT EXISTS artists (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
      name TEXT NOT NULL,
      bio TEXT NOT NULL DEFAULT '',
      verified INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS tracks (
      id INTEGER PRIMARY KEY,
      artist_id INTEGER NOT NULL REFERENCES artists(id),
      title TEXT NOT NULL,
      credits TEXT NOT NULL DEFAULT '',
      audio_file TEXT NOT NULL,
      copy_price_pence INTEGER NOT NULL DEFAULT 99,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    -- A log of owners' listens, for play counts. Plays are never charged:
    -- you pay once for a copy. (counted_at, month and charged_pence are unused
    -- leftovers from the earlier pay-per-play version.)
    CREATE TABLE IF NOT EXISTS plays (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      track_id INTEGER NOT NULL REFERENCES tracks(id),
      started_at TEXT NOT NULL,
      counted_at TEXT,
      month TEXT,
      charged_pence INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS plays_user_month ON plays(user_id, month);
    -- Numbered copies: the "digital CD". Bought once, unlimited plays, never resold, one per owner.
    CREATE TABLE IF NOT EXISTS copies (
      id INTEGER PRIMARY KEY,
      track_id INTEGER NOT NULL REFERENCES tracks(id),
      number INTEGER NOT NULL,
      owner_id INTEGER NOT NULL REFERENCES users(id),
      price_pence INTEGER NOT NULL,
      month TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (track_id, number),
      UNIQUE (track_id, owner_id)
    );
  `);
  // Databases created before passwords were added.
  const cols = db.prepare(`PRAGMA table_info(users)`).all() as { name: string }[];
  if (!cols.some((c) => c.name === "password_hash")) db.exec(`ALTER TABLE users ADD COLUMN password_hash TEXT`);
  return db;
}

export type DB = ReturnType<typeof openDb>;
