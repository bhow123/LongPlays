import type { DB } from "./db.js";

export const DEFAULT_PRICE_PENCE = 99;
export const ARTIST_SHARE = 0.9;
export const PREVIEW_SECONDS = 30;

export const monthOf = (d: Date) => d.toISOString().slice(0, 7);

// Integer maths so 90% of 99p is exactly 89p, never 89.0999...
const artistCut = (pence: number) => Math.floor((pence * Math.round(ARTIST_SHARE * 100)) / 100);

export function ownsCopy(db: DB, userId: number, trackId: number): boolean {
  return !!db.prepare(`SELECT 1 FROM copies WHERE owner_id = ? AND track_id = ?`).get(userId, trackId);
}

/** Owners play as often as they like; each play is logged for the play count, never charged. */
export function logPlay(db: DB, userId: number, trackId: number, now = new Date()) {
  db.prepare(`INSERT INTO plays (user_id, track_id, started_at) VALUES (?, ?, ?)`).run(userId, trackId, now.toISOString());
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

export type ArtistPayout = {
  artistId: number;
  artist: string;
  copiesSold: number;
  buyers: number;
  gross: number;
  artistPayout: number;
  platformFee: number;
};

/**
 * Each sale belongs to the artist whose track was bought, so a fan's money only
 * ever reaches artists they chose. The 90% is taken from each artist's monthly
 * total and rounded down once, so the platform keeps under 1p of rounding per artist.
 */
export function payoutsForMonth(db: DB, month: string): ArtistPayout[] {
  const rows = db
    .prepare(
      `SELECT a.id AS artistId, a.name AS artist, COUNT(*) AS copiesSold,
              COUNT(DISTINCT c.owner_id) AS buyers, SUM(c.price_pence) AS gross
       FROM copies c JOIN tracks t ON t.id = c.track_id JOIN artists a ON a.id = t.artist_id
       WHERE c.month = ? GROUP BY a.id ORDER BY gross DESC`,
    )
    .all(month) as Omit<ArtistPayout, "artistPayout" | "platformFee">[];
  return rows.map((r) => {
    const artistPayout = artistCut(r.gross);
    return { ...r, artistPayout, platformFee: r.gross - artistPayout };
  });
}

/** What a fan bought in a month, and how much of each purchase went to the artist. */
export function listenerStatement(db: DB, userId: number, month: string) {
  const purchases = db
    .prepare(
      `SELECT t.title, a.name AS artist, c.number, c.price_pence AS pence
       FROM copies c JOIN tracks t ON t.id = c.track_id JOIN artists a ON a.id = t.artist_id
       WHERE c.owner_id = ? AND c.month = ? ORDER BY c.created_at`,
    )
    .all(userId, month) as { title: string; artist: string; number: number; pence: number }[];
  return {
    month,
    total: purchases.reduce((s, p) => s + p.pence, 0),
    purchases: purchases.map((p) => ({ ...p, toArtist: p.pence * ARTIST_SHARE })),
  };
}
