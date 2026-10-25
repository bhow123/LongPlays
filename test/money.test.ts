import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { buyCopy, logPlay, ownsCopy, payoutsForMonth, listenerStatement } from "../src/money.js";

function setup() {
  const db = openDb(":memory:");
  const user = (name: string) => Number(db.prepare(`INSERT INTO users (name) VALUES (?)`).run(name).lastInsertRowid);
  const artist = (name: string) => {
    const uid = user(name);
    return Number(db.prepare(`INSERT INTO artists (user_id, name, verified) VALUES (?, ?, 1)`).run(uid, name).lastInsertRowid);
  };
  const track = (artistId: number, price = 99) =>
    Number(
      db.prepare(`INSERT INTO tracks (artist_id, title, audio_file, copy_price_pence) VALUES (?, 't', 'x.mp3', ?)`)
        .run(artistId, price).lastInsertRowid,
    );
  return { db, user, artist, track };
}

const t0 = new Date("2026-10-10T12:00:00Z");

test("copies are numbered in order, unlimited, and one per person", () => {
  const { db, user, artist, track } = setup();
  const tr = track(artist("Ben"));
  const fans = ["a", "b", "c"].map(user);
  assert.deepEqual(fans.map((f) => buyCopy(db, f, tr, t0).number), [1, 2, 3]);
  assert.deepEqual(buyCopy(db, fans[0], tr, t0), { number: 1, alreadyOwned: true });
  assert.ok(ownsCopy(db, fans[0], tr));
});

test("buying again never charges twice, and plays never cost anything", () => {
  const { db, user, artist, track } = setup();
  const fan = user("fan"), tr = track(artist("Ben"), 99);
  buyCopy(db, fan, tr, t0);
  buyCopy(db, fan, tr, t0);
  for (let i = 0; i < 1000; i++) logPlay(db, fan, tr, t0);
  assert.equal(listenerStatement(db, fan, "2026-10").total, 99);
  assert.equal(payoutsForMonth(db, "2026-10")[0].gross, 99);
});

test("a fan's money only reaches the artists whose tracks they bought", () => {
  const { db, user, artist, track } = setup();
  const ben = artist("Ben"), other = artist("Other");
  const benTrack = track(ben, 99), otherTrack = track(other, 150);
  const fan = user("fan");
  buyCopy(db, fan, benTrack, t0);
  for (const f of ["x", "y", "z"].map(user)) buyCopy(db, f, otherTrack, t0);
  const p = Object.fromEntries(payoutsForMonth(db, "2026-10").map((r) => [r.artist, r]));
  assert.deepEqual([p.Ben.copiesSold, p.Ben.buyers, p.Ben.gross], [1, 1, 99]);
  assert.deepEqual([p.Other.copiesSold, p.Other.buyers, p.Other.gross], [3, 3, 450]);
});

test("artist gets 90% of the monthly total, rounded down once", () => {
  const { db, user, artist, track } = setup();
  const tr = track(artist("Ben"), 99);
  for (let i = 0; i < 5; i++) buyCopy(db, user(`f${i}`), tr, t0);
  const [p] = payoutsForMonth(db, "2026-10");
  // 90% of 495p is 445.5p: the artist gets 445p and the platform 50p.
  assert.equal(p.gross, 495);
  assert.equal(p.artistPayout, 445);
  assert.equal(p.platformFee, 50);
});

test("sales are reported in the month they happened", () => {
  const { db, user, artist, track } = setup();
  const tr = track(artist("Ben"), 99);
  buyCopy(db, user("oct"), tr, t0);
  buyCopy(db, user("nov"), tr, new Date("2026-11-02T09:00:00Z"));
  assert.equal(payoutsForMonth(db, "2026-10")[0].copiesSold, 1);
  assert.equal(payoutsForMonth(db, "2026-11")[0].copiesSold, 1);
});
