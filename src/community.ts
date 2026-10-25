import type { DB } from "./db.js";

export type RoomAccess = { canRead: boolean; isArtist: boolean; myNumber: number | null };

/** Owning a copy is the way in. The album's own artist is always let in too. */
export function roomAccess(db: DB, userId: number, albumId: number): RoomAccess {
  const copy = db.prepare(`SELECT number FROM copies WHERE album_id = ? AND owner_id = ?`).get(albumId, userId) as
    | { number: number }
    | undefined;
  const isArtist = !!db
    .prepare(`SELECT 1 FROM albums al JOIN artists ar ON ar.id = al.artist_id WHERE al.id = ? AND ar.user_id = ?`)
    .get(albumId, userId);
  return { canRead: isArtist || !!copy, isArtist, myNumber: copy?.number ?? null };
}

export type NewPost = { body: string; kind?: "post" | "perk" | "party"; maxNumber?: number | null; startsAt?: string | null };

export function addPost(db: DB, userId: number, albumId: number, post: NewPost) {
  const access = roomAccess(db, userId, albumId);
  if (!access.canRead) throw new Error("own a copy to join this room");
  const kind = post.kind ?? "post";
  if (kind !== "post" && !access.isArtist) throw new Error("only the artist can post perks and listening parties");
  const body = post.body.trim().slice(0, 2000);
  if (!body) throw new Error("write something first");
  const maxNumber = kind === "perk" && post.maxNumber ? Math.max(1, Math.floor(post.maxNumber)) : null;
  const startsAt = kind === "party" && post.startsAt ? new Date(post.startsAt).toISOString() : null;
  if (kind === "party" && !startsAt) throw new Error("listening parties need a start time");
  return Number(
    db
      .prepare(`INSERT INTO posts (album_id, user_id, kind, body, max_number, starts_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(albumId, userId, kind, body, maxNumber, startsAt).lastInsertRowid,
  );
}

/**
 * The room's feed, newest first. Each author shows with their copy number, so you can see
 * who was there early. A perk limited to low numbers stays locked for everyone else.
 */
export function roomFeed(db: DB, userId: number, albumId: number) {
  const access = roomAccess(db, userId, albumId);
  if (!access.canRead) return null;
  const rows = db
    .prepare(
      `SELECT p.id, p.kind, p.body, p.max_number AS maxNumber, p.starts_at AS startsAt, p.created_at AS createdAt,
              u.name AS author, c.number AS authorNumber,
              (ar.user_id = p.user_id) AS byArtist, ar.name AS artistName
       FROM posts p JOIN users u ON u.id = p.user_id
       JOIN albums al ON al.id = p.album_id JOIN artists ar ON ar.id = al.artist_id
       LEFT JOIN copies c ON c.album_id = p.album_id AND c.owner_id = p.user_id
       WHERE p.album_id = ? ORDER BY p.id DESC LIMIT 200`,
    )
    .all(albumId) as {
    id: number; kind: string; body: string; maxNumber: number | null; startsAt: string | null; createdAt: string;
    author: string; authorNumber: number | null; byArtist: number; artistName: string;
  }[];
  const posts = rows.map((p) => {
    const locked =
      p.kind === "perk" && p.maxNumber !== null && !access.isArtist && (access.myNumber === null || access.myNumber > p.maxNumber);
    return { ...p, byArtist: !!p.byArtist, author: p.byArtist ? p.artistName : p.author, locked, body: locked ? null : p.body };
  });
  return { ...access, posts };
}

/** What a non-owner sees from outside the door. */
export function roomTeaser(db: DB, albumId: number) {
  return db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM copies WHERE album_id = ?) AS owners,
              (SELECT COUNT(*) FROM posts WHERE album_id = ?) AS posts,
              (SELECT COUNT(*) FROM posts WHERE album_id = ? AND kind = 'perk') AS perks,
              (SELECT MIN(starts_at) FROM posts WHERE album_id = ? AND kind = 'party' AND starts_at > ?) AS nextParty`,
    )
    .get(albumId, albumId, albumId, albumId, new Date().toISOString()) as { owners: number; posts: number; perks: number; nextParty: string | null };
}

/** A fan's public record shelf: every copy they own, plus which artists they've backed. */
export function shelf(db: DB, name: string) {
  const user = db.prepare(`SELECT id, name, created_at AS joined FROM users WHERE name = ?`).get(name) as
    | { id: number; name: string; joined: string }
    | undefined;
  if (!user) return null;
  const records = db
    .prepare(
      `SELECT al.id AS albumId, al.title, ar.name AS artist, ar.demo, c.number, c.month, al.cover_file IS NOT NULL AS hasCover,
              (SELECT COUNT(*) FROM copies c2 WHERE c2.album_id = al.id) AS owners
       FROM copies c JOIN albums al ON al.id = c.album_id JOIN artists ar ON ar.id = al.artist_id
       WHERE c.owner_id = ? ORDER BY c.id DESC`,
    )
    .all(user.id) as { albumId: number; title: string; artist: string; demo: number; number: number; month: string; hasCover: number; owners: number }[];
  const supported = db
    .prepare(
      `SELECT ar.name AS artist, COUNT(*) AS albums
       FROM copies c JOIN albums al ON al.id = c.album_id JOIN artists ar ON ar.id = al.artist_id
       WHERE c.owner_id = ? AND c.value_pence > 0 GROUP BY ar.id ORDER BY albums DESC, ar.name`,
    )
    .all(user.id) as { artist: string; albums: number }[];
  const artist = db.prepare(`SELECT name FROM artists WHERE user_id = ? AND verified = 1`).get(user.id) as { name: string } | undefined;
  return { name: user.name, joined: user.joined, artistName: artist?.name ?? null, records, supported };
}

/** Fan-to-fan discovery: what else this album's owners own, most shared first. */
export function ownersAlsoOwn(db: DB, albumId: number, limit = 6) {
  return db
    .prepare(
      `SELECT al.id, al.title, ar.name AS artist, al.cover_file IS NOT NULL AS hasCover, COUNT(*) AS sharedOwners
       FROM copies mine JOIN copies other ON other.owner_id = mine.owner_id AND other.album_id != mine.album_id
       JOIN albums al ON al.id = other.album_id JOIN artists ar ON ar.id = al.artist_id
       WHERE mine.album_id = ? AND ar.verified = 1
       GROUP BY al.id ORDER BY sharedOwners DESC, al.id DESC LIMIT ?`,
    )
    .all(albumId, limit);
}

/** The rooms a user can enter (albums they own or made), with the latest post in each. */
export function myRooms(db: DB, userId: number) {
  return db
    .prepare(
      `SELECT al.id AS albumId, al.title, ar.name AS artist, al.cover_file IS NOT NULL AS hasCover,
              (SELECT number FROM copies WHERE album_id = al.id AND owner_id = ?) AS myNumber,
              (ar.user_id = ?) AS isArtist,
              (SELECT COUNT(*) FROM copies WHERE album_id = al.id) AS owners,
              (SELECT COUNT(*) FROM posts WHERE album_id = al.id) AS posts,
              (SELECT body FROM posts WHERE album_id = al.id AND kind = 'post' ORDER BY id DESC LIMIT 1) AS lastBody,
              (SELECT created_at FROM posts WHERE album_id = al.id ORDER BY id DESC LIMIT 1) AS lastAt
       FROM albums al JOIN artists ar ON ar.id = al.artist_id
       WHERE ar.verified = 1 AND (ar.user_id = ? OR EXISTS (SELECT 1 FROM copies WHERE album_id = al.id AND owner_id = ?))
       ORDER BY COALESCE(lastAt, al.created_at) DESC`,
    )
    .all(userId, userId, userId, userId);
}
