import express, { type Request, type Response, type NextFunction } from "express";
import cookieParser from "cookie-parser";
import multer from "multer";
import path from "node:path";
import crypto from "node:crypto";
import { openDb, AUDIO_DIR } from "./db.js";
import {
  buyCopy, logPlay, ownsCopy, payoutsForMonth, listenerStatement, monthOf,
  ARTIST_SHARE, DEFAULT_PRICE_PENCE, PREVIEW_SECONDS,
} from "./money.js";

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
  next();
}
const artistFor = (userId: number) =>
  db.prepare(`SELECT * FROM artists WHERE user_id = ?`).get(userId) as
    | { id: number; name: string; verified: number }
    | undefined;

app.get("/api/config", (_req, res) =>
  res.json({ defaultPrice: DEFAULT_PRICE_PENCE, previewSeconds: PREVIEW_SECONDS, artistShare: ARTIST_SHARE }),
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

app.get("/api/tracks", (req, res) => {
  const uid = Number(req.signedCookies.uid) || 0;
  const rows = db
    .prepare(
      `SELECT t.id, t.title, t.credits, t.copy_price_pence AS copyPrice, a.name AS artist, a.id AS artistId,
              (SELECT COUNT(*) FROM copies c WHERE c.track_id = t.id) AS copiesSold,
              (SELECT COUNT(*) FROM plays p WHERE p.track_id = t.id) AS plays,
              (SELECT number FROM copies c WHERE c.track_id = t.id AND c.owner_id = ?) AS myCopy
       FROM tracks t JOIN artists a ON a.id = t.artist_id
       WHERE a.verified = 1 ORDER BY t.created_at DESC`,
    )
    .all(uid);
  res.json(rows);
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
  if (!db.prepare(`SELECT 1 FROM tracks WHERE id = ?`).get(trackId)) return res.sendStatus(404);
  const owned = ownsCopy(db, user.id, trackId);
  if (owned) logPlay(db, user.id, trackId);
  res.json({ owned, previewSeconds: owned ? null : PREVIEW_SECONDS });
});

app.post("/api/tracks/:id/copies", auth, (req, res) => {
  try {
    res.json(buyCopy(db, (req as Authed).user.id, Number(req.params.id)));
  } catch (e) {
    res.status(404).json({ error: (e as Error).message });
  }
});

app.get("/api/copies/mine", auth, (req, res) => {
  res.json(
    db
      .prepare(
        `SELECT c.number, c.created_at AS createdAt, t.id AS trackId, t.title, a.name AS artist, t.artist_id AS artistId
         FROM copies c JOIN tracks t ON t.id = c.track_id JOIN artists a ON a.id = t.artist_id
         WHERE c.owner_id = ? ORDER BY c.created_at DESC`,
      )
      .all((req as Authed).user.id),
  );
});

app.get("/api/tracks/:id/owners", (req, res) => {
  res.json(
    db
      .prepare(
        `SELECT c.number, u.name FROM copies c JOIN users u ON u.id = c.owner_id WHERE c.track_id = ? ORDER BY c.number`,
      )
      .all(Number(req.params.id)),
  );
});

app.get("/api/statement", auth, (req, res) => {
  const month = String(req.query.month ?? monthOf(new Date()));
  res.json(listenerStatement(db, (req as Authed).user.id, month));
});

app.get("/api/payouts", (req, res) => {
  const month = String(req.query.month ?? monthOf(new Date()));
  res.json({ month, artistShare: ARTIST_SHARE, payouts: payoutsForMonth(db, month) });
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
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, file.mimetype.startsWith("audio/")),
});

app.post("/api/artist/tracks", auth, upload.single("audio"), (req, res) => {
  const artist = artistFor((req as Authed).user.id);
  if (!artist?.verified) return res.status(403).json({ error: "only verified artists can release tracks" });
  if (!req.file) return res.status(400).json({ error: "audio file required" });
  const title = String(req.body.title ?? "").trim().slice(0, 120) || req.file.originalname;
  const credits = String(req.body.credits ?? "").slice(0, 1000);
  const pounds = Number(req.body.copyPrice || NaN);
  const price = Number.isFinite(pounds) && pounds >= 0 ? Math.round(pounds * 100) : DEFAULT_PRICE_PENCE;
  const r = db
    .prepare(`INSERT INTO tracks (artist_id, title, credits, audio_file, copy_price_pence) VALUES (?, ?, ?, ?, ?)`)
    .run(artist.id, title, credits, req.file.filename, price);
  res.json({ id: Number(r.lastInsertRowid) });
});

app.post("/api/admin/verify", (req, res) => {
  if (!ADMIN_TOKEN || req.get("x-admin-token") !== ADMIN_TOKEN) return res.sendStatus(403);
  const r = db.prepare(`UPDATE artists SET verified = 1 WHERE name = ?`).run(String(req.body?.name ?? ""));
  res.json({ verified: r.changes });
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => console.log(`OwnMusic on http://localhost:${port}`));
