import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import type { AddressInfo } from "node:net";

// A stand-in for R2's S3 API that keeps uploads in memory and records each request.
const objects = new Map<string, { body: Buffer; type: string }>();
const requests: { method: string; url: string; auth: string }[] = [];
const server = http.createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    requests.push({ method: req.method!, url: req.url!, auth: String(req.headers.authorization ?? "") });
    const key = new URL(req.url!, "http://x").pathname;
    if (req.method === "PUT") {
      objects.set(key, { body: Buffer.concat(chunks), type: String(req.headers["content-type"]) });
      return res.end();
    }
    res.statusCode = 404;
    res.end();
  });
});

test("copies files to R2 once, again when they change, and redirects to signed links", async (t) => {
  await new Promise<void>((r) => server.listen(0, r));
  t.after(() => server.close());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lp-r2-"));
  Object.assign(process.env, {
    DATA_DIR: dir,
    R2_ENDPOINT: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    R2_BUCKET: "longplays-media",
    R2_ACCESS_KEY_ID: "test-key",
    R2_SECRET_ACCESS_KEY: "test-secret",
  });
  const { openDb, AUDIO_DIR } = await import("../src/db.js");
  const { syncNextFile, sendStored, storageStatus } = await import("../src/storage.js");
  const db = openDb(":memory:");
  const user = db.prepare(`INSERT INTO users (name) VALUES ('a')`).run().lastInsertRowid;
  const artist = db.prepare(`INSERT INTO artists (user_id, name, verified) VALUES (?, 'A', 1)`).run(user).lastInsertRowid;
  const album = db.prepare(`INSERT INTO albums (artist_id, title, cover_file) VALUES (?, 'X', 'c.jpg')`).run(artist).lastInsertRowid;
  db.prepare(`INSERT INTO tracks (album_id, position, title, audio_file) VALUES (?, 1, 'T', 't.m4a')`).run(album);
  fs.writeFileSync(path.join(AUDIO_DIR, "t.m4a"), "audio");
  fs.writeFileSync(path.join(AUDIO_DIR, "c.jpg"), "image");

  assert.equal(await syncNextFile(db), true);
  assert.equal(await syncNextFile(db), true);
  assert.equal(await syncNextFile(db), false);
  assert.equal(objects.get("/longplays-media/t.m4a")?.body.toString(), "audio");
  assert.equal(objects.get("/longplays-media/c.jpg")?.type, "image/jpeg");
  assert.match(requests[0].auth, /^AWS4-HMAC-SHA256 Credential=test-key\/\d{8}\/auto\/s3\/aws4_request/);
  assert.deepEqual(storageStatus(db), { r2: true, bucket: "longplays-media", files: 2, inR2: 2 });

  // A file rewritten in place (like the redrawn demo artwork) is copied again.
  fs.writeFileSync(path.join(AUDIO_DIR, "c.jpg"), "new image");
  assert.equal(await syncNextFile(db), true);
  assert.equal(objects.get("/longplays-media/c.jpg")?.body.toString(), "new image");
  assert.equal(await syncNextFile(db), false);

  let redirect = { status: 0, url: "", cache: "" };
  const res = {
    set(_k: string, v: string) { redirect.cache = v; return this; },
    redirect(status: number, url: string) { redirect = { ...redirect, status, url }; return this; },
  };
  await sendStored(db, res as never, "c.jpg", { cache: "public", downloadName: 'X - "Front" cover.jpg' });
  const url = new URL(redirect.url);
  assert.equal(redirect.status, 302);
  assert.equal(redirect.cache, "public, max-age=300");
  assert.equal(url.pathname, "/longplays-media/c.jpg");
  assert.equal(url.searchParams.get("X-Amz-Expires"), "3600");
  assert.equal(url.searchParams.get("response-content-disposition"), 'attachment; filename="X - Front cover.jpg"');
  assert.ok(url.searchParams.get("X-Amz-Signature"));
});
