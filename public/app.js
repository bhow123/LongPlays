const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const gbp = (p) => `£${(p / 100).toFixed(2)}`;

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: opts.body instanceof FormData ? {} : { "content-type": "application/json" },
    body: opts.body instanceof FormData ? opts.body : opts.body && JSON.stringify(opts.body),
  });
  const data = res.headers.get("content-type")?.includes("json") ? await res.json() : null;
  if (!res.ok) throw new Error(data?.error ?? res.statusText);
  return data;
}

let me = null;
let config = null;

async function boot() {
  config = await api("/api/config");
  try { me = await api("/api/me"); } catch { me = null; }
  $("#login").hidden = !!me;
  $("#tabs").hidden = !me;
  $("#who").innerHTML = me
    ? `<span class="muted">Signed in as ${esc(me.name)}</span> <button class="ghost" id="logout">Sign out</button>`
    : "";
  $("#logout")?.addEventListener("click", async () => { await api("/api/logout", { method: "POST" }); location.reload(); });
  if (me) show("listen");
}

$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  try {
    await api("/api/login", { method: "POST", body: { name: f.get("name"), password: f.get("password") } });
  } catch (err) { return alert(err.message); }
  boot();
});

$("#tabs").addEventListener("click", (e) => {
  const tab = e.target.dataset?.tab;
  if (tab) show(tab);
});

function show(tab) {
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
  document.querySelectorAll("[data-panel]").forEach((p) => (p.hidden = p.dataset.panel !== tab));
  ({ listen, copies, statement, payouts, artist })[tab]();
}

async function listen() {
  const tracks = await api("/api/tracks");
  $("#tracks").innerHTML = tracks.length
    ? tracks.map((t) => `
      <li class="card">
        <div>
          <h3>${esc(t.title)}</h3>
          <div class="muted">${esc(t.artist)} · ${t.copiesSold} ${t.copiesSold === 1 ? "copy" : "copies"} owned · ${t.plays} ${t.plays === 1 ? "play" : "plays"}</div>
          ${t.credits ? `<div class="muted">${esc(t.credits)}</div>` : ""}
        </div>
        <div>
          ${t.myCopy
            ? `<button data-play="${t.id}" data-title="${esc(t.title)}" data-artist="${esc(t.artist)}">Play</button>
               <span class="copy-no" title="Your copy">#${t.myCopy}</span>`
            : `<button class="ghost" data-play="${t.id}" data-title="${esc(t.title)}" data-artist="${esc(t.artist)}">Preview</button>
               <button data-buy="${t.id}">Buy copy #${t.copiesSold + 1} · ${gbp(t.copyPrice)}</button>`}
        </div>
      </li>`).join("")
    : `<li class="muted">No tracks yet. Verified artists can upload from "For artists".</li>`;
}

$("#tracks").addEventListener("click", async (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.dataset.play) play(b.dataset.play, b.dataset.title, b.dataset.artist);
  if (b.dataset.buy) {
    const r = await api(`/api/tracks/${b.dataset.buy}/copies`, { method: "POST" });
    alert(`You own copy #${r.number}. Play it as often as you like.`);
    listen();
  }
});

// Player: owners hear the whole track; everyone else gets a preview.
const audio = $("#audio");
let previewLimit = null;

async function play(trackId, title, artist) {
  const r = await api(`/api/tracks/${trackId}/plays`, { method: "POST" });
  previewLimit = r.previewSeconds;
  $("#player").hidden = false;
  $("#now-title").textContent = title;
  $("#now-artist").textContent = artist;
  $("#play-status").textContent = r.owned ? "Your copy: unlimited plays" : `${r.previewSeconds}-second preview. Buy a copy to hear it all.`;
  audio.src = `/api/tracks/${trackId}/audio`;
  audio.play();
}

audio.addEventListener("timeupdate", () => {
  if (previewLimit !== null && audio.currentTime >= previewLimit) {
    audio.pause();
    audio.currentTime = 0;
    $("#play-status").textContent = "End of preview. Buy a copy to hear the whole track.";
  }
});

async function copies() {
  const rows = await api("/api/copies/mine");
  $("#copies").innerHTML = rows.length
    ? rows.map((c) => `
      <li class="card">
        <div><h3>${esc(c.title)} <span class="copy-no">#${c.number}</span></h3>
        <div class="muted">${esc(c.artist)} · owned since ${esc(c.createdAt.slice(0, 10))}</div></div>
        <button class="ghost" data-owners="${c.trackId}">Fellow owners</button>
      </li>`).join("")
    : `<li class="muted">You don't own any copies yet. Each one is numbered, belongs only to you, and is yours to play forever.</li>`;
}

$("#copies").addEventListener("click", async (e) => {
  const id = e.target.dataset?.owners;
  if (!id) return;
  const owners = await api(`/api/tracks/${id}/owners`);
  alert(owners.map((o) => `#${o.number}  ${o.name}`).join("\n"));
});

async function statement() {
  const s = await api("/api/statement");
  $("#statement").innerHTML = `
    <h2>Your purchases in ${esc(s.month)}</h2>
    <p>Total: <strong>${gbp(s.total)}</strong></p>
    <table>
      <tr><th>Track</th><th>Artist</th><th class="n">Copy</th><th class="n">You paid</th><th class="n">Artist gets</th></tr>
      ${s.purchases.map((r) => `<tr><td>${esc(r.title)}</td><td>${esc(r.artist)}</td><td class="n">#${r.number}</td><td class="n">${gbp(r.pence)}</td><td class="n">${gbp(r.toArtist)}</td></tr>`).join("")
        || `<tr><td colspan="5" class="muted">Nothing bought yet this month.</td></tr>`}
    </table>
    <p class="muted">You pay once per track. Every play after that is free, for good.</p>`;
}

async function payouts() {
  const p = await api("/api/payouts");
  $("#payouts").innerHTML = `
    <h2>Artist payouts for ${esc(p.month)}</h2>
    <table>
      <tr><th>Artist</th><th class="n">Copies sold</th><th class="n">Buyers</th><th class="n">Sales</th><th class="n">To artist (${p.artistShare * 100}%)</th><th class="n">Platform</th></tr>
      ${p.payouts.map((r) => `<tr><td>${esc(r.artist)}</td><td class="n">${r.copiesSold}</td><td class="n">${r.buyers}</td><td class="n">${gbp(r.gross)}</td><td class="n"><strong>${gbp(r.artistPayout)}</strong></td><td class="n">${gbp(r.platformFee)}</td></tr>`).join("")
        || `<tr><td colspan="6" class="muted">No sales yet this month.</td></tr>`}
    </table>`;
}

async function artist() {
  const a = me.artist;
  $("#artist").innerHTML = `
    <h2>${a ? esc(a.name) : "Become an artist"}</h2>
    ${a && !a.verified ? `<p class="muted">Waiting for verification. Every release needs a real, verified artist behind it.</p>` : ""}
    <form id="artist-form">
      <label>Artist name <input name="name" required value="${esc(a?.name)}" /></label>
      <label>Bio <textarea name="bio" rows="3">${esc(a?.bio)}</textarea></label>
      <button>${a ? "Save" : "Apply"}</button>
    </form>
    ${a?.verified ? `
      <h2>Upload a track</h2>
      <form id="upload-form">
        <label>Title <input name="title" required /></label>
        <label>Credits <input name="credits" placeholder="Written by…, produced by…, samples / AI tools used…" /></label>
        <label>Price to own a copy (£) <input name="copyPrice" type="number" step="0.01" min="0" value="${(config.defaultPrice / 100).toFixed(2)}" /></label>
        <label>Audio file <input name="audio" type="file" accept="audio/*" required /></label>
        <button>Upload</button> <span id="upload-status" class="muted"></span>
      </form>` : ""}`;
  $("#artist-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    await api("/api/artist", { method: "POST", body: { name: f.get("name"), bio: f.get("bio") } });
    me = await api("/api/me");
    artist();
  });
  $("#upload-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    $("#upload-status").textContent = "Uploading…";
    try {
      await api("/api/artist/tracks", { method: "POST", body: new FormData(e.target) });
      $("#upload-status").textContent = "Done. It's live on Listen.";
      e.target.reset();
    } catch (err) { $("#upload-status").textContent = err.message; }
  });
}

boot();
