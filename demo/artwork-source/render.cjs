// Renders the demo album's artwork at 3000×3000 (1000px pages at 3× scale) into demo/.
// Run from the repo root: node demo/artwork-source/render.cjs  (needs Playwright + Chromium)
const path = require("node:path");
const { chromium } = require("playwright");
const out = { front: "cover.jpg", back: "back-cover.jpg", booklet: "booklet-01.jpg" };
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1000, height: 1000 }, deviceScaleFactor: 3 });
  for (const [page, file] of Object.entries(out)) {
    await p.goto("file://" + path.join(__dirname, `${page}.html`));
    await p.waitForTimeout(2500); // web fonts
    await p.screenshot({ path: path.join(__dirname, "..", file), type: "jpeg", quality: 93 });
  }
  await b.close();
})();
