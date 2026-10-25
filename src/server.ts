import express, { type Request, type Response, type NextFunction } from "express";
import cookieParser from "cookie-parser";
import multer from "multer";
import path from "node:path";
import crypto from "node:crypto";
import { openDb, AUDIO_DIR } from "./db.js";
import {
  buyAlbum, subscribe, cancelSubscription, renewSubscription, accountSummary, logPlay, ownsAlbum,
  payoutsForMonth, monthOf, ALBUM_PRICE_PENCE, SUBSCRIPTION_PENCE, CREDITS_PER_MONTH, ARTIST_SHARE, PREVIEW_SECONDS, VAT_RATE, artistCut,
} from "./money.js";
import { addPost, myRooms, ownersAlsoOwn, roomFeed, roomTeaser, shelf } from "./community.js";

const db = openDb();
const app = express();
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const SECRET = process.env.SESSION_SECRET ?? crypto.randomBytes(32).toString("hex");

app.use(express.json());
app.use(cookieParser(SECRET));
app.use(express.static(path.resolve("public")));

type User = { id: number; name: string };
type Authed = Request & { user: User };

// Demo sign-in: a name and a password, set the first time the name is used.
// Good enough for a public demo, not for real money.
function hashPassword(password: string, salt = crypto.randomBytes(16).toString("hex")) {
  return `${salt}:${crypto.scryptSync(password, salt, 32).toString("hex")}`;
}
function checkPassword(password: string, stored: string) {
  const [salt, hash] = stored.split(":");
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), crypto.scryptSync(password, salt, 32));
}

function auth(req: Request, res: Response, next: NextFunction) {
  const id = Number(req.signedCookies.uid);
  const user = id ? (db.prepare(`SELECT id, name FROM users WHERE id = ?`).get(id) as User | undefined) : undefined;
  if (!user) return res.status(401).json({ error: "sign in first" });
  (req as Authed).user = user;
  renewSubscription(db, user.id);
  next();
}
const artistFor = (userId: number) =>
  db.prepare(`SELECT * FROM artists WHERE user_id = ?`).get(userId) as
    | { id: number; name: string; verified: number }
    | undefined;

app.get("/api/config", (_req, res) =>
  res.json({
    albumPrice: ALBUM_PRICE_PENCE, subscription: SUBSCRIPTION_PENCE, creditsPerMonth: CREDITS_PER_MONTH,
    previewSeconds: PREVIEW_SECONDS, artistShare: ARTIST_SHARE, vatRate: VAT_RATE,
    artistPerAlbum: artistCut(ALBUM_PRICE_PENCE),
  }),
);

app.post("/api/login", (req, res) => {
  const name = String(req.body?.name ?? "").trim().slice(0, 40);
  const password = String(req.body?.password ?? "");
  if (!name) return res.status(400).json({ error: "name required" });
  if (password.length < 6) return res.status(400).json({ error: "password must be at least 6 characters" });
  const existing = db.prepare(`SELECT id, name, password_hash FROM users WHERE name = ?`).get(name) as
    | (User & { password_hash: string | null })
    | undefined;
  if (existing?.password_hash && !checkPassword(password, existing.password_hash))
    return res.status(401).json({ error: "wrong password for that name" });
  if (existing && !existing.password_hash)
    db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(hashPassword(password), existing.id);
  if (!existing) db.prepare(`INSERT INTO users (name, password_hash) VALUES (?, ?)`).run(name, hashPassword(password));
  const user = db.prepare(`SELECT id, name FROM users WHERE name = ?`).get(name) as User;
  res.cookie("uid", String(user.id), { signed: true, httpOnly: true, sameSite: "lax" });
  res.json(user);
});
app.post("/api/logout", (_req, res) => res.clearCookie("uid").json({ ok: true }));

app.get("/api/me", auth, (req, res) => {
  const { user } = req as Authed;
  res.json({ ...user, artist: artistFor(user.id) ?? null });
});

app.get("/api/albums", (req, res) => {
  const uid = Number(req.signedCookies.uid) || 0;
  const albums = db
    .prepare(
      `SELECT al.id, al.title, al.credits, ar.name AS artist, ar.bio AS artistBio, al.cover_file IS NOT NULL AS hasCover,
              (SELECT COUNT(*) FROM copies c WHERE c.album_id = al.id) AS copiesSold,
              (SELECT number FROM copies c WHERE c.album_id = al.id AND c.owner_id = ?) AS myCopy
       FROM albums al JOIN artists ar ON ar.id = al.artist_id
       WHERE ar.verified = 1 ORDER BY al.created_at DESC, al.id DESC`,
    )
    .all(uid) as { id: number }[];
  const tracks = db.prepare(
    `SELECT t.id, t.title, t.position, (SELECT COUNT(*) FROM plays p WHERE p.track_id = t.id) AS plays
     FROM tracks t WHERE t.album_id = ? ORDER BY t.position`,
  );
  res.json(albums.map((a) => ({ ...a, tracks: tracks.all(a.id) })));
});

app.get("/api/albums/:id/cover", (req, res) => {
  const a = db.prepare(`SELECT cover_file FROM albums WHERE id = ?`).get(Number(req.params.id)) as
    | { cover_file: string | null }
    | undefined;
  if (!a?.cover_file) return res.sendStatus(404);
  res.set("cache-control", "public, max-age=86400").sendFile(path.join(AUDIO_DIR, a.cover_file));
});

app.get("/api/tracks/:id/audio", auth, (req, res) => {
  const t = db.prepare(`SELECT audio_file FROM tracks WHERE id = ?`).get(Number(req.params.id)) as
    | { audio_file: string }
    | undefined;
  if (!t) return res.sendStatus(404);
  res.sendFile(path.join(AUDIO_DIR, t.audio_file));
});

// Anyone can hear a preview; the player stops non-owners after PREVIEW_SECONDS.
// (A real service would serve a separate preview clip so the full file isn't exposed.)
app.post("/api/tracks/:id/plays", auth, (req, res) => {
  const { user } = req as Authed;
  const trackId = Number(req.params.id);
  const t = db.prepare(`SELECT album_id FROM tracks WHERE id = ?`).get(trackId) as { album_id: number } | undefined;
  if (!t) return res.sendStatus(404);
  const owned = ownsAlbum(db, user.id, t.album_id);
  if (owned) logPlay(db, user.id, trackId);
  res.json({ owned, previewSeconds: owned ? null : PREVIEW_SECONDS });
});

app.post("/api/albums/:id/buy", auth, (req, res) => {
  try {
    res.json(buyAlbum(db, (req as Authed).user.id, Number(req.params.id)));
  } catch (e) {
    res.status(404).json({ error: (e as Error).message });
  }
});

app.get("/api/albums/:id/owners", (req, res) => {
  res.json(
    db
      .prepare(`SELECT c.number, u.name FROM copies c JOIN users u ON u.id = c.owner_id WHERE c.album_id = ? ORDER BY c.number`)
      .all(Number(req.params.id)),
  );
});

// Community: shelves, owners' rooms and discovery.
app.get("/api/fans/:name", (req, res) => {
  const s = shelf(db, String(req.params.name));
  if (!s) return res.status(404).json({ error: "no fan with that name" });
  res.json(s);
});

app.get("/api/albums/:id/also", (req, res) => res.json(ownersAlsoOwn(db, Number(req.params.id))));

app.get("/api/albums/:id/room", auth, (req, res) => {
  const albumId = Number(req.params.id);
  const feed = roomFeed(db, (req as Authed).user.id, albumId);
  if (!feed) return res.status(403).json({ error: "own a copy to join this room", teaser: roomTeaser(db, albumId) });
  res.json(feed);
});

app.post("/api/albums/:id/room", auth, (req, res) => {
  try {
    const { body, kind, maxNumber, startsAt } = req.body ?? {};
    const id = addPost(db, (req as Authed).user.id, Number(req.params.id), {
      body: String(body ?? ""),
      kind: kind === "perk" || kind === "party" ? kind : "post",
      maxNumber: maxNumber ? Number(maxNumber) : null,
      startsAt: startsAt ? String(startsAt) : null,
    });
    res.json({ id });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

app.get("/api/rooms", auth, (req, res) => res.json(myRooms(db, (req as Authed).user.id)));

app.get("/api/account", auth, (req, res) => res.json(accountSummary(db, (req as Authed).user.id)));
app.post("/api/subscription", auth, (req, res) => {
  subscribe(db, (req as Authed).user.id);
  res.json(accountSummary(db, (req as Authed).user.id));
});
app.delete("/api/subscription", auth, (req, res) => {
  cancelSubscription(db, (req as Authed).user.id);
  res.json(accountSummary(db, (req as Authed).user.id));
});

app.get("/api/payouts", (req, res) => {
  const month = String(req.query.month ?? monthOf(new Date()));
  res.json({ artistShare: ARTIST_SHARE, vatRate: VAT_RATE, ...payoutsForMonth(db, month) });
});

// Artists: anyone can apply; only a verified artist's tracks are listed or uploadable.
app.post("/api/artist", auth, (req, res) => {
  const { user } = req as Authed;
  const name = String(req.body?.name ?? "").trim().slice(0, 80);
  const bio = String(req.body?.bio ?? "").slice(0, 1000);
  if (!name) return res.status(400).json({ error: "artist name required" });
  db.prepare(
    `INSERT INTO artists (user_id, name, bio) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET name = excluded.name, bio = excluded.bio`,
  ).run(user.id, name, bio);
  res.json(artistFor(user.id));
});

const upload = multer({
  storage: multer.diskStorage({
    destination: AUDIO_DIR,
    filename: (_req, file, cb) => cb(null, crypto.randomUUID() + path.extname(file.originalname).toLowerCase()),
  }),
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (_req, file, cb) =>
    cb(null, file.fieldname === "cover" ? file.mimetype.startsWith("image/") : file.mimetype.startsWith("audio/")),
});

const albumUpload = upload.fields([
  { name: "audio", maxCount: 40 },
  { name: "cover", maxCount: 1 },
]);

app.post("/api/artist/albums", auth, albumUpload, (req, res) => {
  const artist = artistFor((req as Authed).user.id);
  if (!artist?.verified) return res.status(403).json({ error: "only verified artists can release albums" });
  const uploaded = (req.files ?? {}) as Record<string, Express.Multer.File[]>;
  const files = uploaded.audio ?? [];
  const cover = uploaded.cover?.[0]?.filename ?? null;
  if (!files.length) return res.status(400).json({ error: "add at least one audio file" });
  const title = String(req.body.title ?? "").trim().slice(0, 120);
  if (!title) return res.status(400).json({ error: "album title required" });
  const credits = String(req.body.credits ?? "").slice(0, 2000);
  // Track order follows the file names, so "01 Intro.mp3", "02 ..." land in order.
  const sorted = [...files].sort((a, b) => a.originalname.localeCompare(b.originalname, undefined, { numeric: true }));
  const albumId = db.transaction(() => {
    const id = Number(
      db.prepare(`INSERT INTO albums (artist_id, title, credits, cover_file) VALUES (?, ?, ?, ?)`)
        .run(artist.id, title, credits, cover).lastInsertRowid,
    );
    const insert = db.prepare(`INSERT INTO tracks (album_id, position, title, audio_file) VALUES (?, ?, ?, ?)`);
    sorted.forEach((f, i) => {
      const name = path.parse(f.originalname).name.replace(/^\d+[\s._-]*/, "").trim() || f.originalname;
      insert.run(id, i + 1, name.slice(0, 120), f.filename);
    });
    return id;
  })();
  res.json({ id: albumId, tracks: sorted.length });
});

app.post("/api/admin/verify", (req, res) => {
  if (!ADMIN_TOKEN || req.get("x-admin-token") !== ADMIN_TOKEN) return res.sendStatus(403);
  const r = db.prepare(`UPDATE artists SET verified = 1 WHERE name = ?`).run(String(req.body?.name ?? ""));
  res.json({ verified: r.changes });
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => console.log(`OwnMusic on http://localhost:${port}`));
