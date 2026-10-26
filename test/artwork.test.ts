import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { imageSize, kindFromName } from "../src/artwork.js";

test("reads image sizes from PNG and JPEG headers", () => {
  assert.deepEqual(imageSize(fs.readFileSync("public/icons/icon-192.png")), { width: 192, height: 192 });
  assert.deepEqual(imageSize(fs.readFileSync("demo/cover.jpg")), { width: 3000, height: 3000 });
  assert.equal(imageSize(Buffer.from("not an image")), null);
});

test("guesses the artwork kind from the file name", () => {
  assert.equal(kindFromName("Front cover.png"), "cover");
  assert.equal(kindFromName("02 back.jpg"), "back");
  assert.equal(kindFromName("Back cover.jpg"), "back");
  assert.equal(kindFromName("poster insert.jpg"), "insert");
  assert.equal(kindFromName("03 lyrics page.jpg"), "booklet");
});
