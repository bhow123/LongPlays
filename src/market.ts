import crypto from "node:crypto";
import type { DB } from "./db.js";
import { monthOf } from "./money.js";

// Resale cut, taken from the price the buyer pays. The artist's share goes to the
// release's rights holders, split the same way as a first sale.
export const RESALE_ARTIST_PERCENT = 10;
export const RESALE_PLATFORM_PERCENT = 5;
export const MIN_RESALE_PENCE = 100;
export const MAX_RESALE_PENCE = 1_000_000;

export function resaleSplit(price: number) {
  const artist = Math.floor((price * RESALE_ARTIST_PERCENT) / 100);
  const platform = Math.floor((price * RESALE_PLATFORM_PERCENT) / 100);
  return { artist, platform, seller: price - artist - platform };
}

type Copy = { id: number; album_id: number; number: number; owner_id: number };
const copyOf = (db: DB, userId: number, albumId: number) =>
  db.prepare(`SELECT id, album_id, number, owner_id FROM copies WHERE owner_id = ? AND album_id = ?`).get(userId, albumId) as Copy | undefined;

/** Put your copy up for sale, or offer it as a swap for someone else's number plus a top-up. */
export function listCopy(db: DB, userId: number, albumId: number, kind: "sell" | "swap", price: number) {
  const copy = copyOf(db, userId, albumId);
  if (!copy) throw new Error("you don't own a copy of this album");
  if (kind !== "sell" && kind !== "swap") throw new Error("choose sell or swap");
  if (!Number.isInteger(price) || price < MIN_RESALE_PENCE || price > MAX_RESALE_PENCE)
    throw new Error(`price must be between £${MIN_RESALE_PENCE / 100} and £${MAX_RESALE_PENCE / 100}`);
  db.prepare(
    `INSERT INTO listings (copy_id, seller_id, kind, price_pence) VALUES (?, ?, ?, ?)
     ON CONFLICT(copy_id) DO UPDATE SET kind = excluded.kind, price_pence = excluded.price_pence, seller_id = excluded.seller_id`,
  ).run(copy.id, userId, kind, price);
}

export function cancelListing(db: DB, userId: number, albumId: number) {
  const copy = copyOf(db, userId, albumId);
  if (copy) db.prepare(`DELETE FROM listings WHERE copy_id = ?`).run(copy.id);
}

export function listingsFor(db: DB, albumId: number) {
  const rows = db
    .prepare(
      `SELECT l.id, l.kind, l.price_pence AS price, c.number, u.name AS seller, l.seller_id AS sellerId
       FROM listings l JOIN copies c ON c.id = l.copy_id JOIN users u ON u.id = l.seller_id
       WHERE c.album_id = ? ORDER BY c.number`,
    )
    .all(albumId) as { id: number; kind: "sell" | "swap"; price: number; number: number; seller: string; sellerId: number }[];
  return rows.map((r) => ({ ...r, split: resaleSplit(r.price) }));
}

// Copies are one per owner, so a swap passes through a holding account inside the transaction.
function escrowUser(db: DB) {
  const name = "__ownmusic_escrow__";
  const row = db.prepare(`SELECT id FROM users WHERE name = ?`).get(name) as { id: number } | undefined;
  if (row) return row.id;
  const lock = `locked:${crypto.randomBytes(32).toString("hex")}`;
  return Number(db.prepare(`INSERT INTO users (name, password_hash) VALUES (?, ?)`).run(name, lock).lastInsertRowid);
}

function moveCopy(db: DB, copyId: number, to: number) {
  db.prepare(`UPDATE copies SET first_owner_id = COALESCE(first_owner_id, owner_id), owner_id = ? WHERE id = ?`).run(to, copyId);
}

export type TradeResult = { kind: "sell" | "swap"; number: number; gaveNumber: number | null; price: number; copyId: number; swappedCopyId: number | null };

/**
 * Take a listing. A sale needs the buyer not to own a copy yet. A swap needs them to own a
 * different number: they get the listed copy and the seller gets theirs, plus the top-up.
 */
export function takeListing(db: DB, buyerId: number, listingId: number, now = new Date()): TradeResult {
  return db.transaction(() => {
    const l = db
      .prepare(
        `SELECT l.id, l.kind, l.price_pence AS price, l.seller_id AS sellerId, c.id AS copyId, c.album_id AS albumId, c.number, c.owner_id AS ownerId
         FROM listings l JOIN copies c ON c.id = l.copy_id WHERE l.id = ?`,
      )
      .get(listingId) as
      | { id: number; kind: "sell" | "swap"; price: number; sellerId: number; copyId: number; albumId: number; number: number; ownerId: number }
      | undefined;
    if (!l || l.ownerId !== l.sellerId) throw new Error("that copy is no longer for sale");
    if (l.sellerId === buyerId) throw new Error("that's your own copy");
    const mine = copyOf(db, buyerId, l.albumId);
    if (l.kind === "sell" && mine) throw new Error(`you already own ${"#" + String(mine.number).padStart(4, "0")}. Only swaps work for owners`);
    if (l.kind === "swap" && !mine) throw new Error("a swap needs a copy of your own to trade in");
    const split = resaleSplit(l.price);
    if (mine) {
      const escrow = escrowUser(db);
      moveCopy(db, mine.id, escrow);
      moveCopy(db, l.copyId, buyerId);
      moveCopy(db, mine.id, l.sellerId);
      db.prepare(`DELETE FROM listings WHERE copy_id = ?`).run(mine.id);
    } else {
      moveCopy(db, l.copyId, buyerId);
    }
    db.prepare(`DELETE FROM listings WHERE id = ?`).run(l.id);
    db.prepare(
      `INSERT INTO trades (album_id, copy_id, swapped_copy_id, seller_id, buyer_id, kind, price_pence, artist_pence, platform_pence, seller_pence, month)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(l.albumId, l.copyId, mine?.id ?? null, l.sellerId, buyerId, l.kind, l.price, split.artist, split.platform, split.seller, monthOf(now));
    return { kind: l.kind, number: l.number, gaveNumber: mine?.number ?? null, price: l.price, copyId: l.copyId, swappedCopyId: mine?.id ?? null };
  })();
}

/** A fan's trading totals: what they've spent buying copies and what they've earned selling. */
export function tradingSummary(db: DB, userId: number) {
  const sum = (sql: string) => (db.prepare(sql).get(userId) as { p: number }).p;
  return {
    spent: sum(`SELECT COALESCE(SUM(price_pence), 0) AS p FROM trades WHERE buyer_id = ?`),
    earned: sum(`SELECT COALESCE(SUM(seller_pence), 0) AS p FROM trades WHERE seller_id = ?`),
  };
}
