import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import {
  buyAlbum, subscribe, cancelSubscription, renewSubscription, creditBalance, ownsAlbum, payoutsForMonth, accountSummary, splitRights,
} from "../src/money.js";

function setup() {
  const db = openDb(":memory:");
  const user = (name: string) => Number(db.prepare(`INSERT INTO users (name) VALUES (?)`).run(name).lastInsertRowid);
  const artist = (name: string) => {
    const uid = user(name);
    return Number(db.prepare(`INSERT INTO artists (user_id, name, verified) VALUES (?, ?, 1)`).run(uid, name).lastInsertRowid);
  };
  const album = (artistId: number) =>
    Number(db.prepare(`INSERT INTO albums (artist_id, title) VALUES (?, 'LP')`).run(artistId).lastInsertRowid);
  return { db, user, artist, album };
}

const oct = new Date("2026-10-10T12:00:00Z");
const nov = new Date("2026-11-03T12:00:00Z");
const jan = new Date("2027-01-05T12:00:00Z");

test("subscribing charges £10 and gives 2 album credits", () => {
  const { db, user } = setup();
  const fan = user("fan");
  subscribe(db, fan, oct);
  subscribe(db, fan, oct); // no double charge
  const a = accountSummary(db, fan);
  assert.equal(a.credits, 2);
  assert.equal(a.totalPaid, 1000);
});

test("unused credits roll over month to month", () => {
  const { db, user } = setup();
  const fan = user("fan");
  subscribe(db, fan, oct);
  renewSubscription(db, fan, jan); // bills Nov, Dec, Jan
  assert.equal(creditBalance(db, fan), 8);
  assert.equal(accountSummary(db, fan).totalPaid, 4000);
});

test("cancelling stops billing but keeps earned credits", () => {
  const { db, user } = setup();
  const fan = user("fan");
  subscribe(db, fan, oct);
  cancelSubscription(db, fan);
  renewSubscription(db, fan, jan);
  assert.equal(creditBalance(db, fan), 2);
  assert.equal(accountSummary(db, fan).totalPaid, 1000);
  subscribe(db, fan, oct); // resubscribing in an already-paid month doesn't charge again
  assert.equal(accountSummary(db, fan).totalPaid, 1000);
});

test("albums use credits first, then cost £5 each", () => {
  const { db, user, artist, album } = setup();
  const ben = artist("Ben");
  const [a1, a2, a3] = [album(ben), album(ben), album(ben)];
  const fan = user("fan");
  subscribe(db, fan, oct);
  assert.equal(buyAlbum(db, fan, a1, oct).paidWith, "credit");
  assert.equal(buyAlbum(db, fan, a2, oct).paidWith, "credit");
  assert.equal(buyAlbum(db, fan, a3, oct).paidWith, "cash");
  const acc = accountSummary(db, fan);
  assert.equal(acc.credits, 0);
  assert.equal(acc.totalPaid, 1500);
});

test("a fan without a subscription can still buy albums for £5", () => {
  const { db, user, artist, album } = setup();
  const fan = user("fan"), lp = album(artist("Ben"));
  assert.equal(buyAlbum(db, fan, lp, oct).paidWith, "cash");
  assert.ok(ownsAlbum(db, fan, lp));
  assert.equal(accountSummary(db, fan).totalPaid, 500);
});

test("album copies are numbered in order, one per person, and never charged twice", () => {
  const { db, user, artist, album } = setup();
  const lp = album(artist("Ben"));
  const fans = ["a", "b", "c"].map(user);
  assert.deepEqual(fans.map((f) => buyAlbum(db, f, lp, oct).number), [1, 2, 3]);
  assert.equal(buyAlbum(db, fans[0], lp, oct).alreadyOwned, true);
  assert.equal(accountSummary(db, fans[0]).totalPaid, 500);
});

test("artist gets 90% of £5 net of VAT, £3.75, per album however it was paid for", () => {
  const { db, user, artist, album } = setup();
  const lp = album(artist("Ben"));
  const sub = user("sub"), cash = user("cash");
  subscribe(db, sub, oct);
  buyAlbum(db, sub, lp, oct);
  buyAlbum(db, cash, lp, oct);
  const { payouts } = payoutsForMonth(db, "2026-10");
  const p = payouts[0];
  assert.deepEqual([p.copiesSold, p.viaCredit, p.viaCash], [2, 1, 1]);
  // Per copy: £5.00 = £0.83 VAT + £4.17 net; artist £3.75, platform £0.42.
  assert.deepEqual([p.gross, p.vat, p.net, p.artistPayout, p.platformFee], [1000, 166, 834, 750, 84]);
  assert.equal(p.vat + p.artistPayout + p.platformFee, p.gross);
  assert.equal(accountSummary(db, sub).purchases[0].toArtist, 375);
});

test("money for unspent credits is held, not paid to anyone", () => {
  const { db, user, artist, album } = setup();
  const lp = album(artist("Ben"));
  const fan = user("fan");
  subscribe(db, fan, oct); // £10 in
  buyAlbum(db, fan, lp, oct); // £5 of it spent
  assert.equal(payoutsForMonth(db, "2026-10").heldForUnspentCredits, 500);
  renewSubscription(db, fan, nov); // another £10, nothing bought
  assert.equal(payoutsForMonth(db, "2026-11").heldForUnspentCredits, 1500);
  assert.equal(payoutsForMonth(db, "2026-11").payouts.length, 0);
});

test("the demo album is free: no credit used, nothing charged or paid out", () => {
  const { db, user, artist, album } = setup();
  const demoArtist = artist("Demo");
  db.prepare(`UPDATE artists SET demo = 1 WHERE id = ?`).run(demoArtist);
  const demo = album(demoArtist);
  const fan = user("fan");
  subscribe(db, fan, oct);
  const r = buyAlbum(db, fan, demo, oct);
  assert.equal(r.paidWith, "free");
  assert.ok(ownsAlbum(db, fan, demo));
  assert.equal(creditBalance(db, fan), 2);
  const a = accountSummary(db, fan);
  assert.equal(a.totalPaid, 1000);
  assert.equal(a.purchases[0].paidWith, "free");
  const p = payoutsForMonth(db, "2026-10");
  assert.equal(p.payouts.length, 0);
  assert.equal(p.heldForUnspentCredits, 1000);
  // Works without a subscription too.
  assert.equal(buyAlbum(db, user("newcomer"), demo, oct).paidWith, "free");
});

test("rights split: songwriting takes 8% of net by default, recording the rest of the 90%", () => {
  assert.deepEqual(splitRights(500), { recording: 342, publishing: 33 });
  assert.deepEqual(splitRights(500, 0), { recording: 375, publishing: 0 });
  assert.deepEqual(splitRights(500, 90), { recording: 0, publishing: 375 });
});

test("payouts credit the label and publisher per release, defaulting to the artist", () => {
  const { db, user, artist, album } = setup();
  const a = artist("Band");
  const own = album(a); // artist owns both sides
  const signed = album(a);
  db.prepare(`UPDATE albums SET master_holder = 'Indie Label', publisher = 'Songs Ltd', publishing_percent = 10 WHERE id = ?`).run(signed);
  buyAlbum(db, user("f1"), own, oct);
  buyAlbum(db, user("f2"), signed, oct);
  const p = payoutsForMonth(db, "2026-10");
  assert.equal(p.payouts[0].artistPayout, 750);
  assert.equal(p.payouts[0].recordingPayout + p.payouts[0].publishingPayout, 750);
  const by = Object.fromEntries(p.rightsHolders.map((h) => [`${h.role}:${h.name}`, h.amount]));
  assert.deepEqual(by, { "recording:Band": 342, "songwriting:Band": 33, "recording:Indie Label": 334, "songwriting:Songs Ltd": 41 });
});
