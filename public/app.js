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
  if (me) show("albums");
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
  ({ albums, collection, plan, payouts, artist })[tab]();
}

const trackRow = (t, owned) => `
  <li><span>${t.position}. ${esc(t.title)} <span class="muted">· ${t.plays} ${t.plays === 1 ? "play" : "plays"}</span></span>
  <button class="${owned ? "" : "ghost"}" data-play="${t.id}" data-title="${esc(t.title)}">${owned ? "Play" : "Preview"}</button></li>`;

async function albums() {
  const [list, acc] = await Promise.all([api("/api/albums"), api("/api/account")]);
  $("#credits-bar").innerHTML = acc.subscribed || acc.credits
    ? `<p><span class="pill">${acc.credits} album ${acc.credits === 1 ? "credit" : "credits"}</span>
       <span class="muted">${acc.subscribed ? `+${config.creditsPerMonth} every month, unused ones roll over` : "subscription cancelled"}</span></p>`
    : `<p class="muted">Subscribe for ${gbp(config.subscription)}/month to get ${config.creditsPerMonth} albums a month, or buy any album for ${gbp(config.albumPrice)}. <button class="ghost" data-goto="plan">See plans</button></p>`;
  $("#albums").innerHTML = list.length
    ? list.map((a) => `
      <li class="card album" data-artist="${esc(a.artist)}">
        <div class="album-head">
          <div>
            <h3>${esc(a.title)}</h3>
            <div class="muted">${esc(a.artist)} · ${a.tracks.length} ${a.tracks.length === 1 ? "track" : "tracks"} · ${a.copiesSold} ${a.copiesSold === 1 ? "copy" : "copies"} owned</div>
            ${a.credits ? `<div class="muted">${esc(a.credits)}</div>` : ""}
          </div>
          ${a.myCopy
            ? `<span class="copy-no" title="Your copy">Copy #${a.myCopy}</span>`
            : `<button data-buy="${a.id}">Own copy #${a.copiesSold + 1} · ${acc.credits > 0 ? "1 credit" : gbp(config.albumPrice)}</button>`}
        </div>
        <ul class="tracklist">${a.tracks.map((t) => trackRow(t, !!a.myCopy)).join("")}</ul>
      </li>`).join("")
    : `<li class="muted">No albums yet. Verified artists can release one from "For artists".</li>`;
}

document.addEventListener("click", (e) => {
  const goto = e.target.closest?.("[data-goto]")?.dataset.goto;
  if (goto) show(goto);
});

$("#albums").addEventListener("click", async (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.dataset.play) play(b.dataset.play, b.dataset.title, b.closest(".album").dataset.artist);
  if (b.dataset.buy) {
    const r = await api(`/api/albums/${b.dataset.buy}/buy`, { method: "POST" });
    alert(`You own copy #${r.number}${r.paidWith === "credit" ? ", paid with 1 credit" : `, for ${gbp(config.albumPrice)}`}. Play it as often as you like.`);
    albums();
  }
});

// Player: owners hear whole tracks; everyone else gets a preview.
const audio = $("#audio");
let previewLimit = null;

async function play(trackId, title, artist) {
  const r = await api(`/api/tracks/${trackId}/plays`, { method: "POST" });
  previewLimit = r.previewSeconds;
  $("#player").hidden = false;
  $("#now-title").textContent = title;
  $("#now-artist").textContent = artist;
  $("#play-status").textContent = r.owned ? "Your copy: unlimited plays" : `${r.previewSeconds}-second preview. Own the album to hear it all.`;
  audio.src = `/api/tracks/${trackId}/audio`;
  audio.play();
}

audio.addEventListener("timeupdate", () => {
  if (previewLimit !== null && audio.currentTime >= previewLimit) {
    audio.pause();
    audio.currentTime = 0;
    $("#play-status").textContent = "End of preview. Own the album to hear the whole track.";
  }
});

async function collection() {
  const acc = await api("/api/account");
  $("#collection").innerHTML = acc.purchases.length
    ? acc.purchases.map((c) => `
      <li class="card">
        <div><h3>${esc(c.title)} <span class="copy-no">#${c.number}</span></h3>
        <div class="muted">${esc(c.artist)} · owned since ${esc(c.month)}</div></div>
      </li>`).join("") + `<li class="muted">Play your albums from the Albums tab.</li>`
    : `<li class="muted">You don't own any albums yet. Each copy is numbered, belongs only to you, and is yours to play forever.</li>`;
}

async function plan() {
  const acc = await api("/api/account");
  $("#plan").innerHTML = `
    <h2>My plan</h2>
    ${acc.subscribed
      ? `<p>Subscribed since ${esc(acc.since)}: <strong>${gbp(config.subscription)}/month</strong>, ${config.creditsPerMonth} album credits a month.</p>
         <button class="ghost" id="cancel">Cancel subscription</button> <span class="muted">You keep any credits you've earned.</span>`
      : `<p><strong>${gbp(config.subscription)}/month</strong> gets you ${config.creditsPerMonth} album credits every month. Unused credits roll over, and you can buy extra albums for ${gbp(config.albumPrice)} each.</p>
         <button id="subscribe">Subscribe (demo, no real payment)</button>`}
    <p><span class="pill">${acc.credits} album ${acc.credits === 1 ? "credit" : "credits"} available</span></p>
    <h2>Purchases</h2>
    <p class="muted">Total paid so far: ${gbp(acc.totalPaid)}</p>
    <table>
      <tr><th>Album</th><th>Artist</th><th class="n">Copy</th><th>Paid with</th><th class="n">Artist gets</th></tr>
      ${acc.purchases.map((r) => `<tr><td>${esc(r.title)}</td><td>${esc(r.artist)}</td><td class="n">#${r.number}</td><td>${r.paidWith === "credit" ? "1 credit" : gbp(r.value)}</td><td class="n">${gbp(r.toArtist)}</td></tr>`).join("")
        || `<tr><td colspan="5" class="muted">No albums yet.</td></tr>`}
    </table>`;
  $("#subscribe")?.addEventListener("click", async () => { await api("/api/subscription", { method: "POST" }); plan(); });
  $("#cancel")?.addEventListener("click", async () => { await api("/api/subscription", { method: "DELETE" }); plan(); });
}

async function payouts() {
  const p = await api("/api/payouts");
  $("#payouts").innerHTML = `
    <h2>Artist payouts for ${esc(p.month)}</h2>
    <p class="muted">Every album copy is a ${gbp(config.albumPrice)} sale (including ${p.vatRate * 100}% VAT), whether the fan used a credit or paid cash. The artist gets ${p.artistShare * 100}% of the amount after VAT.</p>
    <table>
      <tr><th>Artist</th><th class="n">Copies</th><th class="n">Credit / cash</th><th class="n">Sales</th><th class="n">VAT</th><th class="n">To artist</th><th class="n">Platform</th></tr>
      ${p.payouts.map((r) => `<tr><td>${esc(r.artist)}</td><td class="n">${r.copiesSold}</td><td class="n">${r.viaCredit} / ${r.viaCash}</td><td class="n">${gbp(r.gross)}</td><td class="n">${gbp(r.vat)}</td><td class="n"><strong>${gbp(r.artistPayout)}</strong></td><td class="n">${gbp(r.platformFee)}</td></tr>`).join("")
        || `<tr><td colspan="7" class="muted">No sales yet this month.</td></tr>`}
    </table>
    <p class="muted">Subscription money held for credits fans haven't spent yet: ${gbp(p.heldForUnspentCredits)}. It goes to artists when the credits are used.</p>`;
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
      <h2>Release an album</h2>
      <p class="muted">Albums sell for ${gbp(config.albumPrice)} including VAT; you get 90% of the rest, ${gbp(config.artistPerAlbum)} per copy.</p>
      <form id="upload-form">
        <label>Album title <input name="title" required /></label>
        <label>Credits <textarea name="credits" rows="2" placeholder="Written by…, produced by…, samples / AI tools used…"></textarea></label>
        <label>Tracks <input name="audio" type="file" accept="audio/*" multiple required />
          <span class="muted">Select every track at once. They're ordered by file name, so number them (01 Intro.mp3, 02 …).</span></label>
        <button>Release</button> <span id="upload-status" class="muted"></span>
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
      const r = await api("/api/artist/albums", { method: "POST", body: new FormData(e.target) });
      $("#upload-status").textContent = `Released with ${r.tracks} tracks. It's live on Albums.`;
      e.target.reset();
    } catch (err) { $("#upload-status").textContent = err.message; }
  });
}

boot();
