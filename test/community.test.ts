import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { buyAlbum } from "../src/money.js";
import { addPost, roomFeed, roomTeaser, shelf, ownersAlsoOwn, myRooms } from "../src/community.js";

function setup() {
  const db = openDb(":memory:");
  const user = (name: string) => Number(db.prepare(`INSERT INTO users (name) VALUES (?)`).run(name).lastInsertRowid);
  const artist = (name: string) => {
    const uid = user(name);
    const id = Number(db.prepare(`INSERT INTO artists (user_id, name, verified) VALUES (?, ?, 1)`).run(uid, name).lastInsertRowid);
    return { uid, id };
  };
  const album = (artistId: number, title = "LP") =>
    Number(db.prepare(`INSERT INTO albums (artist_id, title) VALUES (?, ?)`).run(artistId, title).lastInsertRowid);
  return { db, user, artist, album };
}

test("only copy owners and the album's artist can get into its room", () => {
  const { db, user, artist, album } = setup();
  const ben = artist("Ben");
  const lp = album(ben.id);
  const owner = user("owner"), outsider = user("outsider");
  buyAlbum(db, owner, lp);
  addPost(db, owner, lp, { body: "Track 3 is the one" });
  assert.throws(() => addPost(db, outsider, lp, { body: "hi" }), /own a copy/);
  assert.equal(roomFeed(db, outsider, lp), null);
  assert.deepEqual(roomTeaser(db, lp), { owners: 1, posts: 1, perks: 0, nextParty: null });
  const feed = roomFeed(db, ben.uid, lp)!;
  assert.equal(feed.isArtist, true);
  assert.equal(feed.posts[0].author, "owner");
  assert.equal(feed.posts[0].authorNumber, 1);
});

test("artist posts show the artist name; only the artist can post perks and parties", () => {
  const { db, user, artist, album } = setup();
  const ben = artist("Ben Howell");
  const lp = album(ben.id);
  const fan = user("fan");
  buyAlbum(db, fan, lp);
  assert.throws(() => addPost(db, fan, lp, { body: "free stuff", kind: "perk" }), /only the artist/);
  addPost(db, ben.uid, lp, { body: "Live playback Friday", kind: "party", startsAt: "2030-01-01T20:00:00Z" });
  const [post] = roomFeed(db, fan, lp)!.posts;
  assert.equal(post.author, "Ben Howell");
  assert.equal(post.byArtist, true);
  assert.equal(post.startsAt, "2030-01-01T20:00:00.000Z");
  assert.throws(() => addPost(db, ben.uid, lp, { body: "no time", kind: "party" }), /start time/);
});

test("a perk for the first N copies stays locked for later numbers", () => {
  const { db, user, artist, album } = setup();
  const ben = artist("Ben");
  const lp = album(ben.id);
  const early = user("early"), late = user("late");
  buyAlbum(db, early, lp); // #1
  buyAlbum(db, late, lp); // #2
  addPost(db, ben.uid, lp, { body: "Presale code: FIRST", kind: "perk", maxNumber: 1 });
  assert.equal(roomFeed(db, early, lp)!.posts[0].body, "Presale code: FIRST");
  const locked = roomFeed(db, late, lp)!.posts[0];
  assert.equal(locked.locked, true);
  assert.equal(locked.body, null);
});

test("a fan's shelf lists their numbered copies and the artists they back", () => {
  const { db, user, artist, album } = setup();
  const ben = artist("Ben"), nova = artist("Nova");
  const [b1, b2, n1] = [album(ben.id, "B1"), album(ben.id, "B2"), album(nova.id, "N1")];
  const fan = user("fan");
  buyAlbum(db, user("someone"), b1);
  for (const a of [b1, b2, n1]) buyAlbum(db, fan, a);
  const s = shelf(db, "fan")!;
  assert.deepEqual(s.records.map((r) => [r.title, r.number]).sort(), [["B1", 2], ["B2", 1], ["N1", 1]]);
  assert.deepEqual(s.supported, [{ artist: "Ben", albums: 2 }, { artist: "Nova", albums: 1 }]);
  assert.equal(shelf(db, "nobody"), null);
});

test("owners also own: albums shared by this album's owners, most shared first", () => {
  const { db, user, artist, album } = setup();
  const ben = artist("Ben");
  const [a, b, c] = [album(ben.id, "A"), album(ben.id, "B"), album(ben.id, "C")];
  const [f1, f2] = [user("f1"), user("f2")];
  for (const f of [f1, f2]) { buyAlbum(db, f, a); buyAlbum(db, f, b); }
  buyAlbum(db, f1, c);
  const also = ownersAlsoOwn(db, a) as { title: string; sharedOwners: number }[];
  assert.deepEqual(also.map((x) => [x.title, x.sharedOwners]), [["B", 2], ["C", 1]]);
});

test("my rooms covers albums I own and albums I made", () => {
  const { db, user, artist, album } = setup();
  const ben = artist("Ben");
  const mine = album(ben.id, "Mine");
  const other = artist("Other");
  const bought = album(other.id, "Bought");
  album(other.id, "Not mine");
  buyAlbum(db, ben.uid, bought);
  const rooms = myRooms(db, ben.uid) as { title: string }[];
  assert.deepEqual(rooms.map((r) => r.title).sort(), ["Bought", "Mine"]);
});

test("owners can reply to posts; replies thread under the top-level post", () => {
  const { db, user, artist, album } = setup();
  const ben = artist("Ben");
  const lp = album(ben.id), other = album(ben.id, "Other");
  const a = user("a"), b = user("b"), outsider = user("outsider");
  buyAlbum(db, a, lp);
  buyAlbum(db, b, lp);
  const post = addPost(db, a, lp, { body: "Favourite track?" });
  const r1 = addPost(db, b, lp, { body: "Track 2", parentId: post });
  addPost(db, ben.uid, lp, { body: "Mine too", parentId: r1, kind: "perk" });
  assert.throws(() => addPost(db, outsider, lp, { body: "hi", parentId: post }), /own a copy/);
  const elsewhere = addPost(db, ben.uid, other, { body: "Other room" });
  assert.throws(() => addPost(db, a, lp, { body: "x", parentId: elsewhere }), /isn't in this room/);

  const feed = roomFeed(db, a, lp)!;
  assert.equal(feed.posts.length, 1);
  assert.equal(feed.posts[0].replyCount, 2);
  assert.deepEqual(feed.posts[0].replies.map((r) => [r.author, r.body, r.kind, r.parentId]), [
    ["b", "Track 2", "post", post],
    ["Ben", "Mine too", "post", post],
  ]);
  assert.equal(feed.posts[0].replies[1].byArtist, true);
});

test("replies to a perk stay locked with it", () => {
  const { db, user, artist, album } = setup();
  const ben = artist("Ben");
  const lp = album(ben.id);
  const early = user("early"), late = user("late");
  buyAlbum(db, early, lp);
  buyAlbum(db, late, lp);
  const perk = addPost(db, ben.uid, lp, { body: "Presale code", kind: "perk", maxNumber: 1 });
  addPost(db, early, lp, { body: "Thanks!", parentId: perk });
  assert.throws(() => addPost(db, late, lp, { body: "me too?", parentId: perk }), /lower copy numbers/);
  const lateView = roomFeed(db, late, lp)!.posts[0];
  assert.equal(lateView.locked, true);
  assert.equal(lateView.replyCount, 1);
  assert.deepEqual(lateView.replies, []);
  assert.equal(roomFeed(db, early, lp)!.posts[0].replies[0].body, "Thanks!");
});
