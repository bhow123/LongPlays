import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export const DATA_DIR = process.env.DATA_DIR ?? path.resolve("data");
export const AUDIO_DIR = path.join(DATA_DIR, "audio");
fs.mkdirSync(AUDIO_DIR, { recursive: true });

// Internal names (this file, the escrow user, the wallet salt) keep the old OwnMusic name so existing data and wallets stay valid.
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
      cover_file TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS tracks (
      id INTEGER PRIMARY KEY,
      album_id INTEGER NOT NULL REFERENCES albums(id),
      position INTEGER NOT NULL,
      title TEXT NOT NULL,
      audio_file TEXT NOT NULL
    );
    -- Numbered copies: the "digital CD". Bought once, unlimited plays, one per owner.
    -- paid_with is 'credit' (a subscription allowance) or 'cash' (an extra purchase), and with
    -- value_pence describes the first sale. Copies can change hands later, only through the market.
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
    -- Owners' rooms: one feed per album. Only copy owners and the album's artist can read or post.
    -- Artists can also post perks (optionally only for copies up to max_number) and listening parties.
    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY,
      album_id INTEGER NOT NULL REFERENCES albums(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      kind TEXT NOT NULL DEFAULT 'post' CHECK (kind IN ('post', 'perk', 'party')),
      body TEXT NOT NULL,
      max_number INTEGER,
      starts_at TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE INDEX IF NOT EXISTS posts_album ON posts(album_id, id);
    -- Money in: subscription fees and extra album purchases.
    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      kind TEXT NOT NULL CHECK (kind IN ('subscription', 'album')),
      amount_pence INTEGER NOT NULL,
      month TEXT NOT NULL
    );
  `);
  // Albums released before cover art was supported.
  const albumCols = db.prepare(`PRAGMA table_info(albums)`).all() as { name: string }[];
  if (!albumCols.some((c) => c.name === "cover_file")) db.exec(`ALTER TABLE albums ADD COLUMN cover_file TEXT`);
  // Royalty splits per release. A NULL holder means the album's own artist.
  if (!albumCols.some((c) => c.name === "master_holder")) db.exec(`ALTER TABLE albums ADD COLUMN master_holder TEXT`);
  if (!albumCols.some((c) => c.name === "publisher")) db.exec(`ALTER TABLE albums ADD COLUMN publisher TEXT`);
  if (!albumCols.some((c) => c.name === "publishing_percent"))
    db.exec(`ALTER TABLE albums ADD COLUMN publishing_percent INTEGER NOT NULL DEFAULT 8`);
  // Who first bought each copy, kept once it changes hands (NULL means the current owner).
  const copyCols = db.prepare(`PRAGMA table_info(copies)`).all() as { name: string }[];
  if (!copyCols.some((c) => c.name === "first_owner_id")) db.exec(`ALTER TABLE copies ADD COLUMN first_owner_id INTEGER REFERENCES users(id)`);
  // Owners can sell a copy outright, or offer it as a swap for another number of the same album
  // plus a cash top-up. Every trade goes through LongPlays so the artist and platform cut is always taken.
  db.exec(`
    CREATE TABLE IF NOT EXISTS listings (
      id INTEGER PRIMARY KEY,
      copy_id INTEGER NOT NULL UNIQUE REFERENCES copies(id),
      seller_id INTEGER NOT NULL REFERENCES users(id),
      kind TEXT NOT NULL CHECK (kind IN ('sell', 'swap')),
      price_pence INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS trades (
      id INTEGER PRIMARY KEY,
      album_id INTEGER NOT NULL REFERENCES albums(id),
      copy_id INTEGER NOT NULL REFERENCES copies(id),
      swapped_copy_id INTEGER REFERENCES copies(id),
      seller_id INTEGER NOT NULL REFERENCES users(id),
      buyer_id INTEGER NOT NULL REFERENCES users(id),
      kind TEXT NOT NULL CHECK (kind IN ('sell', 'swap')),
      price_pence INTEGER NOT NULL,
      artist_pence INTEGER NOT NULL,
      platform_pence INTEGER NOT NULL,
      seller_pence INTEGER NOT NULL,
      month TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  // NFT mirror: which fan the token on chain belongs to, as far as we've synced, and the last transaction.
  if (!copyCols.some((c) => c.name === "token_owner_id")) db.exec(`ALTER TABLE copies ADD COLUMN token_owner_id INTEGER`);
  if (!copyCols.some((c) => c.name === "token_tx")) db.exec(`ALTER TABLE copies ADD COLUMN token_tx TEXT`);
  db.exec(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  // The album package's artwork, at full resolution: cover, back cover, booklet pages, inserts.
  db.exec(`
    CREATE TABLE IF NOT EXISTS artwork (
      id INTEGER PRIMARY KEY,
      album_id INTEGER NOT NULL REFERENCES albums(id),
      position INTEGER NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('cover', 'back', 'booklet', 'insert')),
      title TEXT NOT NULL,
      file TEXT NOT NULL,
      mime TEXT NOT NULL,
      bytes INTEGER NOT NULL,
      width INTEGER,
      height INTEGER,
      sha256 TEXT NOT NULL,
      ipfs_cid TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  // Files copied to Cloudflare R2, with the local size and modified time they were copied at.
  db.exec(`CREATE TABLE IF NOT EXISTS remote_files (file TEXT PRIMARY KEY, bytes INTEGER NOT NULL, mtime INTEGER NOT NULL, uploaded_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  // Demo releases are flagged so the UI can label them.
  const artistCols = db.prepare(`PRAGMA table_info(artists)`).all() as { name: string }[];
  if (!artistCols.some((c) => c.name === "demo")) db.exec(`ALTER TABLE artists ADD COLUMN demo INTEGER NOT NULL DEFAULT 0`);
  return db;
}

export type DB = ReturnType<typeof openDb>;
