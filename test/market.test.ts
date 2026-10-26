import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { buyAlbum, payoutsForMonth, accountSummary, ownsAlbum } from "../src/money.js";
import { listCopy, takeListing, listingsFor, resaleSplit, cancelListing, tradingSummary } from "../src/market.js";

function setup() {
  const db = openDb(":memory:");
  const user = (name: string) => Number(db.prepare(`INSERT INTO users (name) VALUES (?)`).run(name).lastInsertRowid);
  const artistUser = user("Band");
  const artist = Number(db.prepare(`INSERT INTO artists (user_id, name, verified) VALUES (?, 'Band', 1)`).run(artistUser).lastInsertRowid);
  const album = Number(db.prepare(`INSERT INTO albums (artist_id, title) VALUES (?, 'LP')`).run(artist).lastInsertRowid);
  return { db, user, album };
}
const oct = new Date("2026-10-10T12:00:00Z");
const numberOf = (db: ReturnType<typeof openDb>, uid: number, album: number) =>
  (db.prepare(`SELECT number FROM copies WHERE owner_id = ? AND album_id = ?`).get(uid, album) as { number: number } | undefined)?.number;

test("resale split: 10% to the artist, 5% to OwnMusic, the rest to the seller", () => {
  assert.deepEqual(resaleSplit(2000), { artist: 200, platform: 100, seller: 1700 });
  assert.deepEqual(resaleSplit(333), { artist: 33, platform: 16, seller: 284 });
});

test("selling a copy moves the number to the buyer and pays the cut", () => {
  const { db, user, album } = setup();
  const a = user("a"), b = user("b");
  buyAlbum(db, a, album, oct);
  listCopy(db, a, album, "sell", 2000);
  const [l] = listingsFor(db, album);
  assert.equal(l.number, 1);
  const r = takeListing(db, b, l.id, oct);
  assert.equal(r.number, 1);
  assert.equal(numberOf(db, b, album), 1);
  assert.ok(!ownsAlbum(db, a, album));
  assert.equal(listingsFor(db, album).length, 0);
  const p = payoutsForMonth(db, "2026-10");
  assert.equal(p.payouts[0].resaleRoyalty, 200);
  assert.equal(p.payouts[0].artistPayout, 375 + 200);
  assert.equal(p.payouts[0].recordingPayout + p.payouts[0].publishingPayout, 575);
  assert.equal(p.resaleFees, 100);
  assert.deepEqual(tradingSummary(db, a), { spent: 0, earned: 1700 });
  assert.deepEqual(tradingSummary(db, b), { spent: 2000, earned: 0 });
  assert.equal(accountSummary(db, b).purchases[0].paidWith, "resale");
  assert.equal(accountSummary(db, b).purchases[0].value, 2000);
});

test("trading up: #0003 plus a top-up swaps for #0001", () => {
  const { db, user, album } = setup();
  const first = user("first"), second = user("second"), third = user("third");
  for (const u of [first, second, third]) buyAlbum(db, u, album, oct);
  listCopy(db, first, album, "swap", 1500);
  const [l] = listingsFor(db, album);
  const r = takeListing(db, third, l.id, oct);
  assert.equal(r.gaveNumber, 3);
  assert.equal(numberOf(db, third, album), 1);
  assert.equal(numberOf(db, first, album), 3);
  assert.equal(numberOf(db, second, album), 2);
  assert.equal(accountSummary(db, third).purchases[0].paidWith, "swap");
  assert.equal(payoutsForMonth(db, "2026-10").payouts[0].resaleRoyalty, 150);
});

test("market rules", () => {
  const { db, user, album } = setup();
  const a = user("a"), b = user("b"), c = user("c");
  buyAlbum(db, a, album, oct);
  buyAlbum(db, b, album, oct);
  assert.throws(() => listCopy(db, c, album, "sell", 1000), /don't own/);
  assert.throws(() => listCopy(db, a, album, "sell", 50), /price/);
  listCopy(db, a, album, "sell", 1000);
  const [l] = listingsFor(db, album);
  assert.throws(() => takeListing(db, a, l.id, oct), /your own/);
  assert.throws(() => takeListing(db, b, l.id, oct), /Only swaps/);
  cancelListing(db, a, album);
  assert.equal(listingsFor(db, album).length, 0);
  listCopy(db, a, album, "swap", 1000);
  assert.throws(() => takeListing(db, c, listingsFor(db, album)[0].id, oct), /needs a copy/);
});
