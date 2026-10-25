import type { DB } from "./db.js";

export const PRICE_PER_PLAY_PENCE = 1;
export const MONTHLY_CAP_PENCE = 1500;
export const ARTIST_SHARE = 0.9;
export const MIN_SECONDS_FOR_PLAY = 30;

export const monthOf = (d: Date) => d.toISOString().slice(0, 7);

export function monthlySpend(db: DB, userId: number, month: string): number {
  const row = db
    .prepare(`SELECT COALESCE(SUM(charged_pence), 0) AS p FROM plays WHERE user_id = ? AND month = ?`)
    .get(userId, month) as { p: number };
  return row.p;
}

export function ownsCopy(db: DB, userId: number, trackId: number): boolean {
  return !!db.prepare(`SELECT 1 FROM copies WHERE owner_id = ? AND track_id = ?`).get(userId, trackId);
}

export function startPlay(db: DB, userId: number, trackId: number, now = new Date()): number {
  const r = db
    .prepare(`INSERT INTO plays (user_id, track_id, started_at) VALUES (?, ?, ?)`)
    .run(userId, trackId, now.toISOString());
  return Number(r.lastInsertRowid);
}

export type CountResult =
  | { counted: false; reason: "too_soon" | "already_counted" | "not_found" }
  | { counted: true; charged: number; why: "charged" | "owns_copy" | "cap_reached"; spend: number };

/** Count a play once 30s have passed (by server clock) and charge 1p unless free. */
export function countPlay(db: DB, userId: number, playId: number, now = new Date()): CountResult {
  return db.transaction((): CountResult => {
    const play = db.prepare(`SELECT * FROM plays WHERE id = ? AND user_id = ?`).get(playId, userId) as
      | { track_id: number; started_at: string; counted_at: string | null }
      | undefined;
    if (!play) return { counted: false, reason: "not_found" };
    if (play.counted_at) return { counted: false, reason: "already_counted" };
    const elapsed = (now.getTime() - new Date(play.started_at).getTime()) / 1000;
    if (elapsed < MIN_SECONDS_FOR_PLAY) return { counted: false, reason: "too_soon" };

    const month = monthOf(now);
    const spend = monthlySpend(db, userId, month);
    let charged = 0;
    let why: "charged" | "owns_copy" | "cap_reached" = "charged";
    if (ownsCopy(db, userId, play.track_id)) why = "owns_copy";
    else if (spend + PRICE_PER_PLAY_PENCE > MONTHLY_CAP_PENCE) why = "cap_reached";
    else charged = PRICE_PER_PLAY_PENCE;

    db.prepare(`UPDATE plays SET counted_at = ?, month = ?, charged_pence = ? WHERE id = ?`).run(
      now.toISOString(),
      month,
      charged,
      playId,
    );
    return { counted: true, charged, why, spend: spend + charged };
  })();
}

/** Buy the next numbered copy of a track. Returns the copy number (e.g. 3 for "A.3"). */
export function buyCopy(db: DB, userId: number, trackId: number, now = new Date()) {
  return db.transaction(() => {
    const existing = db
      .prepare(`SELECT number FROM copies WHERE owner_id = ? AND track_id = ?`)
      .get(userId, trackId) as { number: number } | undefined;
    if (existing) return { number: existing.number, alreadyOwned: true };
    const track = db.prepare(`SELECT copy_price_pence FROM tracks WHERE id = ?`).get(trackId) as
      | { copy_price_pence: number }
      | undefined;
    if (!track) throw new Error("track not found");
    const { n } = db
      .prepare(`SELECT COALESCE(MAX(number), 0) + 1 AS n FROM copies WHERE track_id = ?`)
      .get(trackId) as { n: number };
    db.prepare(
      `INSERT INTO copies (track_id, number, owner_id, price_pence, month) VALUES (?, ?, ?, ?, ?)`,
    ).run(trackId, n, userId, track.copy_price_pence, monthOf(now));
    return { number: n, alreadyOwned: false };
  })();
}

// Integer maths so 90% of 10p is exactly 9p, never 8.999...
const artistCut = (pence: number) => Math.floor((pence * Math.round(ARTIST_SHARE * 100)) / 100);

export type ArtistPayout = {
  artistId: number;
  artist: string;
  playRevenue: number;
  copyRevenue: number;
  gross: number;
  artistPayout: number;
  platformFee: number;
  listeners: number;
};

/**
 * User-centric payouts: each listener's play money goes only to the artists they
 * played, because every charge is tied to a track. The 90% is taken from each artist's
 * monthly total and rounded down once, so the platform keeps under 1p of rounding per artist.
 */
export function payoutsForMonth(db: DB, month: string): ArtistPayout[] {
  const playRows = db
    .prepare(
      `SELECT a.id AS artistId, a.name AS artist, p.user_id AS userId, SUM(p.charged_pence) AS pence
       FROM plays p JOIN tracks t ON t.id = p.track_id JOIN artists a ON a.id = t.artist_id
       WHERE p.month = ? AND p.charged_pence > 0
       GROUP BY a.id, p.user_id`,
    )
    .all(month) as { artistId: number; artist: string; userId: number; pence: number }[];
  const copyRows = db
    .prepare(
      `SELECT a.id AS artistId, a.name AS artist, c.owner_id AS userId, SUM(c.price_pence) AS pence
       FROM copies c JOIN tracks t ON t.id = c.track_id JOIN artists a ON a.id = t.artist_id
       WHERE c.month = ? GROUP BY a.id, c.owner_id`,
    )
    .all(month) as { artistId: number; artist: string; userId: number; pence: number }[];

  const out = new Map<number, ArtistPayout & { _listeners: Set<number> }>();
  const get = (artistId: number, artist: string) => {
    let p = out.get(artistId);
    if (!p) {
      p = { artistId, artist, playRevenue: 0, copyRevenue: 0, gross: 0, artistPayout: 0, platformFee: 0, listeners: 0, _listeners: new Set() };
      out.set(artistId, p);
    }
    return p;
  };
  for (const r of playRows) {
    const p = get(r.artistId, r.artist);
    p.playRevenue += r.pence;
    p._listeners.add(r.userId);
  }
  for (const r of copyRows) {
    const p = get(r.artistId, r.artist);
    p.copyRevenue += r.pence;
  }
  return [...out.values()].map(({ _listeners, ...p }) => {
    p.gross = p.playRevenue + p.copyRevenue;
    p.artistPayout = artistCut(p.gross);
    p.platformFee = p.gross - p.artistPayout;
    p.listeners = _listeners.size;
    return p;
  });
}

/** What a listener owes for a month, and where every penny of it goes. */
export function listenerStatement(db: DB, userId: number, month: string) {
  const byArtist = db
    .prepare(
      `SELECT a.name AS artist, COUNT(*) AS plays, SUM(p.charged_pence) AS pence
       FROM plays p JOIN tracks t ON t.id = p.track_id JOIN artists a ON a.id = t.artist_id
       WHERE p.user_id = ? AND p.month = ? GROUP BY a.id ORDER BY pence DESC`,
    )
    .all(userId, month) as { artist: string; plays: number; pence: number }[];
  const copies = db
    .prepare(
      `SELECT t.title, c.number, c.price_pence AS pence, a.name AS artist
       FROM copies c JOIN tracks t ON t.id = c.track_id JOIN artists a ON a.id = t.artist_id
       WHERE c.owner_id = ? AND c.month = ?`,
    )
    .all(userId, month) as { title: string; number: number; pence: number; artist: string }[];
  const plays = byArtist.reduce((s, r) => s + r.pence, 0);
  return {
    month,
    playCharges: plays,
    capPence: MONTHLY_CAP_PENCE,
    capReached: plays >= MONTHLY_CAP_PENCE,
    copyPurchases: copies.reduce((s, c) => s + c.pence, 0),
    byArtist: byArtist.map((r) => ({ ...r, toArtist: r.pence * ARTIST_SHARE })),
    copies,
  };
}
