import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { startPlay, countPlay, buyCopy, payoutsForMonth, listenerStatement, MONTHLY_CAP_PENCE } from "../src/money.js";

function setup() {
  const db = openDb(":memory:");
  const user = (name: string) => Number(db.prepare(`INSERT INTO users (name) VALUES (?)`).run(name).lastInsertRowid);
  const artist = (name: string) => {
    const uid = user(name);
    return Number(db.prepare(`INSERT INTO artists (user_id, name, verified) VALUES (?, ?, 1)`).run(uid, name).lastInsertRowid);
  };
  const track = (artistId: number, price = 100) =>
    Number(
      db.prepare(`INSERT INTO tracks (artist_id, title, audio_file, copy_price_pence) VALUES (?, 't', 'x.mp3', ?)`)
        .run(artistId, price).lastInsertRowid,
    );
  return { db, user, artist, track };
}

const t0 = new Date("2026-10-10T12:00:00Z");
const later = (s: number, from = t0) => new Date(from.getTime() + s * 1000);

function listen(db: ReturnType<typeof openDb>, userId: number, trackId: number, at = t0) {
  const id = startPlay(db, userId, trackId, at);
  return countPlay(db, userId, id, later(31, at));
}

test("a play under 30 seconds is not counted or charged", () => {
  const { db, user, artist, track } = setup();
  const u = user("fan"), tr = track(artist("Ben"));
  const id = startPlay(db, u, tr, t0);
  assert.deepEqual(countPlay(db, u, id, later(10)), { counted: false, reason: "too_soon" });
  const r = countPlay(db, u, id, later(30));
  assert.equal(r.counted && r.charged, 1);
  assert.deepEqual(countPlay(db, u, id, later(60)), { counted: false, reason: "already_counted" });
});

test("spend stops at the £15 monthly cap and resets next month", () => {
  const { db, user, artist, track } = setup();
  const u = user("fan"), tr = track(artist("Ben"));
  for (let i = 0; i < MONTHLY_CAP_PENCE; i++) listen(db, u, tr);
  const over = listen(db, u, tr);
  assert.ok(over.counted && over.charged === 0 && over.why === "cap_reached");
  assert.equal(listenerStatement(db, u, "2026-10").playCharges, 1500);
  const nextMonth = listen(db, u, tr, new Date("2026-11-01T00:00:00Z"));
  assert.ok(nextMonth.counted && nextMonth.charged === 1);
});

test("owning a copy makes plays of that track free", () => {
  const { db, user, artist, track } = setup();
  const u = user("fan"), tr = track(artist("Ben"));
  buyCopy(db, u, tr, t0);
  const r = listen(db, u, tr);
  assert.ok(r.counted && r.charged === 0 && r.why === "owns_copy");
});

test("copies are numbered in order, unlimited, and one per person", () => {
  const { db, user, artist, track } = setup();
  const tr = track(artist("Ben"));
  const fans = ["a", "b", "c"].map(user);
  assert.deepEqual(fans.map((f) => buyCopy(db, f, tr, t0).number), [1, 2, 3]);
  assert.deepEqual(buyCopy(db, fans[0], tr, t0), { number: 1, alreadyOwned: true });
});

test("payouts are user-centric: a listener's money only reaches artists they played", () => {
  const { db, user, artist, track } = setup();
  const ben = artist("Ben"), other = artist("Other");
  const benTrack = track(ben), otherTrack = track(other);
  const heavy = user("heavy"), light = user("light");
  // Heavy listener maxes out on Other; light listener plays Ben 10 times.
  for (let i = 0; i < 2000; i++) listen(db, heavy, otherTrack);
  for (let i = 0; i < 10; i++) listen(db, light, benTrack);
  const p = Object.fromEntries(payoutsForMonth(db, "2026-10").map((r) => [r.artist, r]));
  // Pro-rata would hand Ben a sliver of the pool; user-centric gives him all of the light listener's 10p.
  assert.equal(p.Ben.playRevenue, 10);
  assert.equal(p.Ben.artistPayout, 9);
  assert.equal(p.Other.playRevenue, 1500);
  assert.equal(p.Other.artistPayout, 1350);
});

test("artist gets 90% of the monthly total, rounded down once", () => {
  const { db, user, artist, track } = setup();
  const ben = artist("Ben");
  const tr = track(ben, 150);
  buyCopy(db, user("a"), tr, t0);
  for (let i = 0; i < 5; i++) listen(db, user(`p${i}`), tr);
  const [p] = payoutsForMonth(db, "2026-10");
  assert.equal(p.copyRevenue, 150);
  assert.equal(p.playRevenue, 5);
  // 90% of 155p is 139.5p: the artist gets 139p and the platform 16p.
  assert.equal(p.artistPayout, 139);
  assert.equal(p.platformFee, 16);
});
