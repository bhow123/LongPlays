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
      copy_price_pence INTEGER NOT NULL DEFAULT 100,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    -- One row per listen. charged_pence is 0 until the play passes 30 seconds,
    -- and stays 0 if the listener owns a copy or has hit the monthly cap.
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
    -- Numbered copies: the "digital CD". Unlimited, never resold, one owner each.
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
  return db;
}

export type DB = ReturnType<typeof openDb>;
