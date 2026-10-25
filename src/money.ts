import type { DB } from "./db.js";

export const ALBUM_PRICE_PENCE = 500;
export const SUBSCRIPTION_PENCE = 1000;
export const CREDITS_PER_MONTH = 2;
export const ARTIST_SHARE = 0.9;
/** UK VAT. Prices include it; the artist's 90% is of the price after VAT. */
export const VAT_RATE = 0.2;
export const PREVIEW_SECONDS = 30;

export const monthOf = (d: Date) => d.toISOString().slice(0, 7);

function nextMonth(month: string) {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

// Integer maths, worked out per album copy. £5 incl. VAT is 417p net (rounded to the
// nearest penny), and the artist gets 90% of net, rounded down: 375p per copy.
const vatPercent = Math.round(VAT_RATE * 100);
export const netOfVat = (pence: number) => Math.round((pence * 100) / (100 + vatPercent));
export const artistCut = (pence: number) => Math.floor((netOfVat(pence) * Math.round(ARTIST_SHARE * 100)) / 100);

function bill(db: DB, userId: number, month: string) {
  db.prepare(`INSERT INTO payments (user_id, kind, amount_pence, month) VALUES (?, 'subscription', ?, ?)`).run(
    userId,
    SUBSCRIPTION_PENCE,
    month,
  );
  db.prepare(`INSERT INTO credit_ledger (user_id, delta, reason, month) VALUES (?, ?, 'subscription', ?)`).run(
    userId,
    CREDITS_PER_MONTH,
    month,
  );
}

/**
 * Bill any months an active subscriber hasn't been charged for yet, granting 2 credits
 * each. Run lazily on each request; a real service would do this from a monthly job.
 */
export function renewSubscription(db: DB, userId: number, now = new Date()) {
  db.transaction(() => {
    const sub = db.prepare(`SELECT last_billed_month, active FROM subscriptions WHERE user_id = ?`).get(userId) as
      | { last_billed_month: string; active: number }
      | undefined;
    if (!sub?.active) return;
    const current = monthOf(now);
    let month = sub.last_billed_month;
    while (month < current) {
      month = nextMonth(month);
      bill(db, userId, month);
    }
    db.prepare(`UPDATE subscriptions SET last_billed_month = ? WHERE user_id = ?`).run(month, userId);
  })();
}

/** Start (or restart) a £10/month subscription. The first month is billed straight away. */
export function subscribe(db: DB, userId: number, now = new Date()) {
  db.transaction(() => {
    const month = monthOf(now);
    const sub = db.prepare(`SELECT last_billed_month, active FROM subscriptions WHERE user_id = ?`).get(userId) as
      | { last_billed_month: string; active: number }
      | undefined;
    if (sub?.active) return;
    // Restarting in a month that was already paid for doesn't charge twice.
    const alreadyPaid = sub && sub.last_billed_month >= month;
    if (!alreadyPaid) bill(db, userId, month);
    db.prepare(
      `INSERT INTO subscriptions (user_id, started_month, last_billed_month, active) VALUES (?, ?, ?, 1)
       ON CONFLICT(user_id) DO UPDATE SET active = 1, last_billed_month = excluded.last_billed_month`,
    ).run(userId, month, alreadyPaid ? sub.last_billed_month : month);
  })();
}

/** Stop future billing. Credits already earned are kept. */
export function cancelSubscription(db: DB, userId: number) {
  db.prepare(`UPDATE subscriptions SET active = 0 WHERE user_id = ?`).run(userId);
}

export function creditBalance(db: DB, userId: number): number {
  return (db.prepare(`SELECT COALESCE(SUM(delta), 0) AS b FROM credit_ledger WHERE user_id = ?`).get(userId) as {
    b: number;
  }).b;
}

export function ownsAlbum(db: DB, userId: number, albumId: number): boolean {
  return !!db.prepare(`SELECT 1 FROM copies WHERE owner_id = ? AND album_id = ?`).get(userId, albumId);
}

/**
 * Buy the next numbered copy of an album: with a credit if the fan has one, otherwise
 * as an extra £5 purchase. Either way the copy is worth £5 to the artist.
 */
export function buyAlbum(db: DB, userId: number, albumId: number, now = new Date()) {
  return db.transaction(() => {
    const existing = db
      .prepare(`SELECT number, paid_with FROM copies WHERE owner_id = ? AND album_id = ?`)
      .get(userId, albumId) as { number: number; paid_with: "credit" | "cash" } | undefined;
    if (existing) return { number: existing.number, paidWith: existing.paid_with, alreadyOwned: true };
    if (!db.prepare(`SELECT 1 FROM albums WHERE id = ?`).get(albumId)) throw new Error("album not found");
    const month = monthOf(now);
    const paidWith = creditBalance(db, userId) > 0 ? "credit" : "cash";
    if (paidWith === "credit")
      db.prepare(`INSERT INTO credit_ledger (user_id, delta, reason, month) VALUES (?, -1, 'album', ?)`).run(userId, month);
    else
      db.prepare(`INSERT INTO payments (user_id, kind, amount_pence, month) VALUES (?, 'album', ?, ?)`).run(
        userId,
        ALBUM_PRICE_PENCE,
        month,
      );
    const { n } = db
      .prepare(`SELECT COALESCE(MAX(number), 0) + 1 AS n FROM copies WHERE album_id = ?`)
      .get(albumId) as { n: number };
    db.prepare(
      `INSERT INTO copies (album_id, number, owner_id, paid_with, value_pence, month) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(albumId, n, userId, paidWith, ALBUM_PRICE_PENCE, month);
    return { number: n, paidWith, alreadyOwned: false };
  })();
}

export function logPlay(db: DB, userId: number, trackId: number, now = new Date()) {
  db.prepare(`INSERT INTO plays (user_id, track_id, played_at) VALUES (?, ?, ?)`).run(userId, trackId, now.toISOString());
}

export type ArtistPayout = {
  artistId: number;
  artist: string;
  copiesSold: number;
  viaCredit: number;
  viaCash: number;
  gross: number;
  vat: number;
  net: number;
  artistPayout: number;
  platformFee: number;
};

/**
 * An artist earns when one of their albums is bought, whether with a credit or cash.
 * Each copy is a £5 sale including VAT; the artist gets 90% of the net, so £3.75 a copy.
 * Subscription money for credits nobody has spent yet isn't anyone's revenue: it's held.
 */
export function payoutsForMonth(db: DB, month: string) {
  const copies = db
    .prepare(
      `SELECT ar.id AS artistId, ar.name AS artist, c.paid_with AS paidWith, c.value_pence AS value
       FROM copies c JOIN albums al ON al.id = c.album_id JOIN artists ar ON ar.id = al.artist_id
       WHERE c.month = ? ORDER BY ar.id`,
    )
    .all(month) as { artistId: number; artist: string; paidWith: "credit" | "cash"; value: number }[];
  const byArtist = new Map<number, ArtistPayout>();
  for (const c of copies) {
    let p = byArtist.get(c.artistId);
    if (!p) {
      p = { artistId: c.artistId, artist: c.artist, copiesSold: 0, viaCredit: 0, viaCash: 0, gross: 0, vat: 0, net: 0, artistPayout: 0, platformFee: 0 };
      byArtist.set(c.artistId, p);
    }
    const net = netOfVat(c.value);
    const toArtist = artistCut(c.value);
    p.copiesSold++;
    if (c.paidWith === "credit") p.viaCredit++;
    else p.viaCash++;
    p.gross += c.value;
    p.vat += c.value - net;
    p.net += net;
    p.artistPayout += toArtist;
    p.platformFee += net - toArtist;
  }
  const payouts = [...byArtist.values()].sort((a, b) => b.gross - a.gross);
  const moneyIn = (db.prepare(`SELECT COALESCE(SUM(amount_pence), 0) AS p FROM payments WHERE month <= ?`).get(month) as { p: number }).p;
  const spent = (db.prepare(`SELECT COALESCE(SUM(value_pence), 0) AS p FROM copies WHERE month <= ?`).get(month) as { p: number }).p;
  return { month, payouts, heldForUnspentCredits: moneyIn - spent };
}

/** A fan's plan, credits and purchase history. */
export function accountSummary(db: DB, userId: number) {
  const sub = db.prepare(`SELECT started_month, last_billed_month, active FROM subscriptions WHERE user_id = ?`).get(userId) as
    | { started_month: string; last_billed_month: string; active: number }
    | undefined;
  const purchases = db
    .prepare(
      `SELECT al.title, ar.name AS artist, c.number, c.paid_with AS paidWith, c.value_pence AS value, c.month
       FROM copies c JOIN albums al ON al.id = c.album_id JOIN artists ar ON ar.id = al.artist_id
       WHERE c.owner_id = ? ORDER BY c.id DESC`,
    )
    .all(userId) as { title: string; artist: string; number: number; paidWith: string; value: number; month: string }[];
  const paid = (db.prepare(`SELECT COALESCE(SUM(amount_pence), 0) AS p FROM payments WHERE user_id = ?`).get(userId) as { p: number }).p;
  return {
    subscribed: !!sub?.active,
    since: sub?.started_month ?? null,
    credits: creditBalance(db, userId),
    totalPaid: paid,
    purchases: purchases.map((p) => ({ ...p, toArtist: artistCut(p.value) })),
  };
}
