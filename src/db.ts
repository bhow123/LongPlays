import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export const DATA_DIR = process.env.DATA_DIR ?? path.resolve("data");
export const AUDIO_DIR = path.join(DATA_DIR, "audio");
fs.mkdirSync(AUDIO_DIR, { recursive: true });

// v2: albums + subscriptions. Earlier per-track demo data lives in ownmusic.db and is left alone.
export function openDb(file = path.join(DATA_DIR, "ownmusic-v2.db")) {
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
    -- Music is only sold as whole albums.
    CREATE TABLE IF NOT EXISTS albums (
      id INTEGER PRIMARY KEY,
      artist_id INTEGER NOT NULL REFERENCES artists(id),
      title TEXT NOT NULL,
      credits TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS tracks (
      id INTEGER PRIMARY KEY,
      album_id INTEGER NOT NULL REFERENCES albums(id),
      position INTEGER NOT NULL,
      title TEXT NOT NULL,
      audio_file TEXT NOT NULL
    );
    -- Numbered copies: the "digital CD". Bought once, unlimited plays, never resold, one per owner.
    -- paid_with is 'credit' (a subscription allowance) or 'cash' (an extra purchase).
    CREATE TABLE IF NOT EXISTS copies (
      id INTEGER PRIMARY KEY,
      album_id INTEGER NOT NULL REFERENCES albums(id),
      number INTEGER NOT NULL,
      owner_id INTEGER NOT NULL REFERENCES users(id),
      paid_with TEXT NOT NULL CHECK (paid_with IN ('credit', 'cash')),
      value_pence INTEGER NOT NULL,
      month TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (album_id, number),
      UNIQUE (album_id, owner_id)
    );
    -- A log of owners' listens, for play counts. Plays are never charged.
    CREATE TABLE IF NOT EXISTS plays (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      track_id INTEGER NOT NULL REFERENCES tracks(id),
      played_at TEXT NOT NULL
    );
    -- One subscription per user. last_billed_month is the latest month charged and credited.
    CREATE TABLE IF NOT EXISTS subscriptions (
      user_id INTEGER PRIMARY KEY REFERENCES users(id),
      started_month TEXT NOT NULL,
      last_billed_month TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1
    );
    -- Album credits: +2 per subscribed month, -1 per album bought with a credit. They never expire.
    CREATE TABLE IF NOT EXISTS credit_ledger (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      delta INTEGER NOT NULL,
      reason TEXT NOT NULL,
      month TEXT NOT NULL
    );
    -- Money in: subscription fees and extra album purchases.
    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      kind TEXT NOT NULL CHECK (kind IN ('subscription', 'album')),
      amount_pence INTEGER NOT NULL,
      month TEXT NOT NULL
    );
  `);
  return db;
}

export type DB = ReturnType<typeof openDb>;
