const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const gbp = (p) => `£${(p / 100).toFixed(2)}`;
const copyNo = (n) => `#${String(n).padStart(4, "0")}`;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const monthName = (ym) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

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

let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 3200);
}

// Generated artwork for albums without a cover: stable per album, so it reads as "the" cover.
function hash(str) {
  let h = 2166136261;
  for (const c of str) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}
function artSvg(id, title) {
  const h = hash(`${id}:${title}`);
  const a = h % 360, b = (a + 40 + ((h >>> 8) % 140)) % 360;
  const c1 = `hsl(${a} 85% 58%)`, c2 = `hsl(${b} 75% 45%)`, c3 = `hsl(${(a + 180) % 360} 90% 88%)`;
  const v = (h >>> 16) % 4;
  const x = 20 + ((h >>> 4) % 60), y = 20 + ((h >>> 12) % 60);
  const shapes = [
    Array.from({ length: 7 }, (_, i) => `<circle cx="${x}" cy="${y}" r="${88 - i * 12}" fill="none" stroke="${i % 2 ? c3 : c2}" stroke-width="6" opacity="${0.9 - i * 0.08}"/>`).join(""),
    Array.from({ length: 9 }, (_, i) => `<rect x="${i * 12 - 4}" y="-10" width="6" height="130" fill="${c3}" opacity="0.55" transform="rotate(${(h % 50) - 25} 50 50)"/>`).join(""),
    `<circle cx="${x}" cy="${y}" r="34" fill="${c3}"/><circle cx="${100 - x}" cy="${100 - y}" r="22" fill="${c2}"/><rect x="0" y="70" width="100" height="30" fill="${c2}" opacity="0.6"/>`,
    Array.from({ length: 5 }, (_, i) => `<rect x="${10 + i * 6}" y="${10 + i * 6}" width="${80 - i * 12}" height="${80 - i * 12}" fill="none" stroke="${c3}" stroke-width="3" opacity="${0.85 - i * 0.12}" transform="rotate(${i * 9} 50 50)"/>`).join(""),
  ][v];
  return `<svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <defs><linearGradient id="g${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>
    <rect width="100" height="100" fill="url(#g${id})"/>${shapes}</svg>`;
}
const discColor = (id, title) => `hsl(${hash(`${id}:${title}`) % 360} 85% 58%)`;
const cover = (id, title, hasCover) =>
  `<div class="cover">${hasCover ? `<img src="/api/albums/${id}/cover" alt="" loading="lazy" />` : artSvg(id, title)}</div>`;

let me = null;
let config = null;
let account = null;
let catalogue = [];

async function boot() {
  config = await api("/api/config");
  try { me = await api("/api/me"); } catch { me = null; }
  $("#login").hidden = !!me;
  $("#tabs").hidden = !me;
  if (me) {
    await refreshAccount();
    show(location.hash.slice(1) || "albums");
  } else {
    document.querySelectorAll("[data-panel]").forEach((p) => (p.hidden = true));
    $("#who").innerHTML = "";
  }
}

async function refreshAccount() {
  account = await api("/api/account");
  $("#who").innerHTML = `
    <span class="chip" title="Album credits"><span class="dot"></span>${plural(account.credits, "credit")}</span>
    <a class="avatar" href="#fan/${encodeURIComponent(me.name)}" title="Your record shelf">${esc(me.name.slice(0, 1).toUpperCase())}</a>`;
}

async function signOut() {
  if (!confirm(`Sign out ${me.name}?`)) return;
  await api("/api/logout", { method: "POST" });
  history.replaceState(null, "", "/");
  location.reload();
}

$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  try {
    await api("/api/login", { method: "POST", body: { name: f.get("name"), password: f.get("password") } });
  } catch (err) { return toast(err.message); }
  boot();

if ("serviceWorker" in navigator) addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
});

$("#tabs").addEventListener("click", (e) => {
  const tab = e.target.dataset?.tab;
  if (tab) show(tab);
});
document.addEventListener("click", (e) => {
  const goto = e.target.closest?.("[data-goto]")?.dataset.goto;
  if (goto) { closeSheet(); show(goto); }
});

const views = { albums, collection, community, plan, payouts, artist };
function show(tab) {
  closeSheet();
  if (tab.startsWith("fan/")) {
    history.replaceState(null, "", `#${tab}`);
    document.querySelectorAll("#tabs button").forEach((b) => b.classList.remove("on"));
    document.querySelectorAll("[data-panel]").forEach((p) => (p.hidden = p.dataset.panel !== "shelf"));
    return shelfView(decodeURIComponent(tab.slice(4)));
  }
  if (!views[tab]) tab = "albums";
  history.replaceState(null, "", `#${tab}`);
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
  document.querySelectorAll("[data-panel]").forEach((p) => (p.hidden = p.dataset.panel !== tab));
  window.scrollTo({ top: 0 });
  views[tab]();
}
window.addEventListener("hashchange", () => me && show(location.hash.slice(1)));
const fanLink = (name, label = name) => `<a class="fan-link" href="#fan/${encodeURIComponent(name)}">${esc(label)}</a>`;
const timeAgo = (iso) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
};
const whenParty = (iso) => new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/* ---------- Albums ---------- */

async function albums() {
  catalogue = await api("/api/albums");
  const credits = account.credits;
  $("#credits-bar").innerHTML = account.subscribed || credits
    ? `<div class="banner">
        <div>
          <h3>${credits ? `You have ${plural(credits, "album")} to claim` : "All credits spent"}</h3>
          <p class="muted small">${account.subscribed ? `+${config.creditsPerMonth} every month. Unused credits roll over.` : "Subscription paused. Your credits are still yours."}</p>
          <div class="tokens">${Array.from({ length: Math.min(credits, 12) }, () => `<span class="token" title="1 album credit"></span>`).join("")}</div>
        </div>
        <button class="btn" data-goto="plan">My plan</button>
      </div>`
    : `<div class="banner">
        <div>
          <h3>${gbp(config.subscription)} a month = ${config.creditsPerMonth} albums you keep</h3>
          <p class="muted small">Or buy any album for ${gbp(config.albumPrice)}. ${gbp(config.artistPerAlbum)} of every album goes to the artist.</p>
        </div>
        <button class="btn btn-primary" data-goto="plan">Start subscription</button>
      </div>`;
  $("#albums").innerHTML = catalogue.length
    ? catalogue.map((a) => `
      <li>
        <button class="album-card" data-album="${a.id}">
          <div class="record" style="--disc:${discColor(a.id, a.title)}">
            <div class="vinyl"></div>
            ${cover(a.id, a.title, a.hasCover)}
            ${a.myCopy ? `<span class="stamp">${copyNo(a.myCopy)}</span>` : a.isMine ? `<span class="stamp">Yours</span>` : ""}
            ${a.demo ? `<span class="demo-tag">Demo</span>` : ""}
          </div>
          <h3>${esc(a.title)}</h3>
          <div class="muted">${esc(a.artist)}${a.demo ? " · demo artist" : ""}</div>
          <div class="owners">${plural(a.copiesSold, "owner")} · ${plural(a.tracks.length, "track")}</div>
        </button>
      </li>`).join("")
    : `<li class="empty">No albums yet. Verified artists can release one from <a href="#artist" data-goto="artist">For artists</a>.</li>`;
}

$("#albums").addEventListener("click", (e) => {
  const id = e.target.closest("[data-album]")?.dataset.album;
  if (id) openAlbum(Number(id));
});

let justBought = null;
async function openAlbum(id, pane = "tracks") {
  if (!catalogue.some((x) => x.id === id)) catalogue = await api("/api/albums");
  const a = catalogue.find((x) => x.id === id);
  if (!a) return;
  const [owners, also] = await Promise.all([api(`/api/albums/${id}/owners`), api(`/api/albums/${id}/also`)]);
  const nowPlayingHere = current && a.tracks.some((t) => t.id === current.trackId) && !audio.paused;
  $("#sheet-content").innerHTML = `
    <div class="album-hero ${nowPlayingHere ? "spinning" : ""}" id="hero">
      <div class="record" style="--disc:${discColor(a.id, a.title)}">
        <div class="vinyl"></div>
        ${cover(a.id, a.title, a.hasCover)}
        ${a.myCopy ? `<span class="stamp">${copyNo(a.myCopy)}</span>` : a.isMine ? `<span class="stamp">Yours</span>` : ""}
            ${a.demo ? `<span class="demo-tag">Demo</span>` : ""}
      </div>
      <div>
        <p class="eyebrow">${a.demo ? "Demo album" : "Album"} · ${plural(a.tracks.length, "track")}</p>
        <h2 id="sheet-title">${esc(a.title)}</h2>
        <p class="by">${esc(a.artist)}</p>
        ${a.demo ? `<p class="demo-note">This is a demo release by a demo artist, here so you can try OwnMusic. Add a free copy, no subscription needed, and it lands on your record shelf and opens the owners' room.</p>` : ""}
        ${justBought === a.id ? `<div class="next-steps">
          <strong>${copyNo(a.myCopy)} is yours.</strong>
          <a class="btn" href="#fan/${encodeURIComponent(me.name)}">See it on your record shelf</a>
          <button class="btn" data-pane="room">Go to the owners' room</button>
        </div>` : ""}
        <div class="buy-row">
          ${a.isMine
            ? `<div class="owned-badge"><span class="muted small">Your release</span><strong>${plural(a.copiesSold, "owner")}</strong></div>`
            : a.myCopy
            ? `<div class="owned-badge"><span class="muted small">You own copy</span><strong>${copyNo(a.myCopy)}</strong></div>`
            : a.demo
            ? `<button class="btn btn-primary" data-buy="${a.id}">Add copy ${copyNo(a.copiesSold + 1)} to my shelf · free</button>
               <span class="muted small">Demo album: no subscription or payment needed</span>`
            : `<button class="btn btn-primary" data-buy="${a.id}">Own copy ${copyNo(a.copiesSold + 1)} · ${account.credits > 0 ? "1 credit" : gbp(config.albumPrice)}</button>
               <span class="muted small">${gbp(config.artistPerAlbum)} goes to ${esc(a.artist)}</span>`}
        </div>
      </div>
    </div>
    <div class="seg" role="tablist">
      <button data-pane="tracks" class="${pane === "tracks" ? "on" : ""}">Tracks</button>
      <button data-pane="room" class="${pane === "room" ? "on" : ""}">Owners' room ${a.myCopy || a.isMine ? "" : "🔒"}</button>
    </div>
    <div data-pane-body="room" ${pane === "room" ? "" : "hidden"}><div id="room"></div></div>
    <div data-pane-body="tracks" ${pane === "tracks" ? "" : "hidden"}>
    <ol class="tracklist">
      ${a.tracks.map((t) => `
        <li data-track-row="${t.id}" class="${current?.trackId === t.id ? "playing" : ""}">
          <span class="n">${t.position}</span>
          <span><span class="t">${esc(t.title)}</span><br /><span class="p">${a.myCopy || a.isMine ? plural(t.plays, "play") : `${config.previewSeconds}s preview`}</span></span>
          <button class="track-btn ${a.myCopy || a.isMine ? "own" : ""}" data-play="${t.id}" aria-label="${a.myCopy || a.isMine ? "Play" : "Preview"} ${esc(t.title)}">▶</button>
        </li>`).join("")}
    </ol>
    ${a.credits ? `<div class="credits-note"><strong>Credits</strong>\n${esc(a.credits)}</div>` : ""}
    <div style="margin-top:22px">
      <p class="eyebrow">Copy owners</p>
      <div class="owner-list">${owners.length ? owners.map((o) => `<a href="#fan/${encodeURIComponent(o.name)}">${copyNo(o.number)} ${esc(o.name)}</a>`).join("") : `<span>No owners yet. Be ${copyNo(1)}.</span>`}</div>
    </div>
    ${also.length ? `
    <div style="margin-top:26px">
      <p class="eyebrow">Owners of this album also own</p>
      <div class="also-row">${also.map((x) => `
        <button class="also" data-open="${x.id}">
          ${cover(x.id, x.title, x.hasCover)}
          <strong>${esc(x.title)}</strong><span class="muted">${esc(x.artist)}</span>
          <span class="owners">${plural(x.sharedOwners, "shared owner")}</span>
        </button>`).join("")}</div>
    </div>` : ""}
    </div>`;
  const wasOpen = !$("#sheet").hidden && $("#sheet").dataset.album === String(id);
  $("#sheet").hidden = false;
  $("#sheet").dataset.album = id;
  if (!wasOpen) $(".sheet-body").scrollTop = 0;
  document.body.style.overflow = "hidden";
  if (pane === "room") loadRoom(a);
}

function switchPane(pane) {
  document.querySelectorAll(".seg [data-pane]").forEach((b) => b.classList.toggle("on", b.dataset.pane === pane));
  document.querySelectorAll("[data-pane-body]").forEach((d) => (d.hidden = d.dataset.paneBody !== pane));
  if (pane === "room") loadRoom(catalogue.find((x) => x.id === Number($("#sheet").dataset.album)));
}

/* ---------- Owners' room ---------- */

async function loadRoom(a) {
  const el = $("#room");
  el.innerHTML = `<p class="muted">Opening the room…</p>`;
  const res = await fetch(`/api/albums/${a.id}/room`);
  const data = await res.json();
  if (res.status === 403) {
    const t = data.teaser;
    el.innerHTML = `
      <div class="room-door">
        <div class="lock">🔒</div>
        <h3>The owners' room for ${esc(a.title)}</h3>
        <p class="muted">Only people who own a copy can read and post here, so it's real fans, no bots.</p>
        <div class="door-stats">
          <span><strong>${t.owners}</strong> owners inside</span>
          <span><strong>${t.posts}</strong> posts</span>
          <span><strong>${t.perks}</strong> owner perks</span>
        </div>
        ${t.nextParty ? `<p class="party-teaser">🎧 Listening party ${esc(whenParty(t.nextParty))}</p>` : ""}
        <button class="btn btn-primary" data-buy="${a.id}">${a.demo ? "Add a free demo copy" : `Own copy ${copyNo(a.copiesSold + 1)}`} to get in</button>
      </div>`;
    return;
  }
  const room = data;
  el.innerHTML = `
    <form id="composer" class="composer">
      <div class="composer-who">
        ${room.isArtist ? `<span class="badge own">Artist</span>` : `<span class="badge own">${copyNo(room.myNumber)}</span>`}
        <span class="muted small">Posting as ${esc(room.isArtist ? a.artist : me.name)}</span>
      </div>
      ${room.isArtist ? `
        <div class="kind-pick" role="radiogroup">
          <label><input type="radio" name="kind" value="post" checked /> Post</label>
          <label><input type="radio" name="kind" value="perk" /> 🎁 Owner perk</label>
          <label><input type="radio" name="kind" value="party" /> 🎧 Listening party</label>
        </div>
        <div class="kind-extra" data-for="perk" hidden><label>Only for copies up to # <input name="maxNumber" type="number" min="1" placeholder="Leave empty for every owner" /></label></div>
        <div class="kind-extra" data-for="party" hidden><label>Starts <input name="startsAt" type="datetime-local" /></label></div>` : ""}
      <textarea name="body" rows="2" maxlength="2000" required placeholder="${room.isArtist ? "Say something to everyone who owns this album…" : "Say something to the other owners…"}"></textarea>
      <button class="btn btn-primary btn-small">Post</button>
    </form>
    <ul class="feed">${room.posts.length ? room.posts.map(postCard).join("") : `<li class="muted empty">Nobody's said anything yet. Start it off.</li>`}</ul>`;
  const form = $("#composer");
  form.addEventListener("change", () => {
    const kind = form.kind?.value ?? "post";
    form.querySelectorAll(".kind-extra").forEach((d) => (d.hidden = d.dataset.for !== kind));
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const startsAt = f.get("startsAt");
    try {
      await api(`/api/albums/${a.id}/room`, {
        method: "POST",
        body: { body: f.get("body"), kind: f.get("kind") ?? "post", maxNumber: f.get("maxNumber") || null, startsAt: startsAt ? new Date(startsAt).toISOString() : null },
      });
      loadRoom(a);
    } catch (err) { toast(err.message); }
  });
}

function postCard(p) {
  const who = p.byArtist
    ? `<strong>${esc(p.author)}</strong> <span class="badge own">Artist</span>`
    : `${fanLink(p.author)} <span class="badge">${copyNo(p.authorNumber)}</span>`;
  if (p.kind === "perk")
    return `<li class="post perk ${p.locked ? "locked" : ""}">
      <div class="post-head"><span class="perk-icon">🎁</span> Owner perk${p.maxNumber ? ` · copies ${copyNo(1)}–${copyNo(p.maxNumber)}` : ""} <span class="muted small">· ${timeAgo(p.createdAt)}</span></div>
      <p>${p.locked ? `🔒 For the first ${p.maxNumber} owners. Low numbers get rewarded.` : esc(p.body)}</p></li>`;
  if (p.kind === "party") {
    const d = new Date(p.startsAt);
    return `<li class="post party">
      <div class="party-date"><span>${d.toLocaleDateString("en-GB", { month: "short" })}</span><strong>${d.getDate()}</strong></div>
      <div><div class="post-head">🎧 Listening party · ${esc(whenParty(p.startsAt))}</div><p>${esc(p.body)}</p>
      <span class="muted small">Hosted by ${esc(p.author)}</span></div></li>`;
  }
  return `<li class="post"><div class="post-head">${who} <span class="muted small">· ${timeAgo(p.createdAt)}</span></div><p>${esc(p.body)}</p></li>`;
}

function closeSheet() {
  justBought = null;
  $("#sheet").hidden = true;
  document.body.style.overflow = "";
}
$("#sheet").addEventListener("click", async (e) => {
  if (e.target.closest("[data-close]")) return closeSheet();
  const b = e.target.closest("button");
  if (!b) return;
  const album = catalogue.find((x) => x.id === Number($("#sheet").dataset.album));
  if (b.dataset.pane) return switchPane(b.dataset.pane);
  if (b.dataset.open) return openAlbum(Number(b.dataset.open));
  if (b.dataset.play) play(Number(b.dataset.play), album);
  if (b.dataset.buy) {
    b.disabled = true;
    try {
      const r = await api(`/api/albums/${b.dataset.buy}/buy`, { method: "POST" });
      toast(`You own ${copyNo(r.number)} of ${album.title}${r.paidWith === "credit" ? " · 1 credit used" : r.paidWith === "free" ? " · free demo copy" : ` · ${gbp(config.albumPrice)}`}`);
      await refreshAccount();
      await albums();
      justBought = album.id;
      await openAlbum(album.id, $(".seg .on")?.dataset.pane ?? "tracks");
    } catch (err) { toast(err.message); b.disabled = false; }
  }
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#sheet").hidden) closeSheet(); });

/* ---------- Player ---------- */

const audio = $("#audio");
let current = null;

// The audio starts inside the tap itself. iPhone (especially the home-screen app)
// refuses play() once an await has run, so the play is logged alongside, not before.
function play(trackId, album) {
  const owned = !!(album.myCopy || album.isMine);
  // Same track again is play/pause, unless the album was just bought mid-preview.
  if (current?.trackId === trackId && current.owned === owned) return toggle();
  const t = album.tracks.find((x) => x.id === trackId);
  current = { trackId, albumId: album.id, album, owned, limit: owned ? null : config.previewSeconds };
  audio.src = `/api/tracks/${trackId}/audio`;
  audio.play().catch(() => toast("Tap play again to start the music."));
  $("#player").hidden = false;
  $("#now-cover").innerHTML = cover(album.id, album.title, album.hasCover);
  $("#now-title").textContent = t.title;
  $("#now-artist").textContent = `${album.artist} · ${album.title}`;
  $("#now-badge").innerHTML = album.isMine ? `<span class="badge own">Your release</span>` : owned ? `<span class="badge own">${copyNo(album.myCopy)}</span>` : `<span class="badge">Preview</span>`;
  $("#preview-mark").hidden = true;
  highlightTrack();
  api(`/api/tracks/${trackId}/plays`, { method: "POST" })
    .then((r) => { if (current?.trackId === trackId) current.limit = r.previewSeconds; })
    .catch(() => {});
  // Lock screen and headphone controls when installed on a phone.
  if ("mediaSession" in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: t.title,
      artist: album.artist,
      album: album.title,
      artwork: album.hasCover
        ? [{ src: `/api/albums/${album.id}/cover`, sizes: "512x512" }]
        : [{ src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" }],
    });
  }
}

// Next and previous within the album. Previews stop at the end of each track.
function step(by) {
  if (!current) return;
  const tracks = current.album.tracks;
  const next = tracks[tracks.findIndex((x) => x.id === current.trackId) + by];
  if (next) play(next.id, current.album);
}
audio.addEventListener("ended", () => { if (current?.owned) step(1); });
if ("mediaSession" in navigator) {
  const ms = navigator.mediaSession;
  const handlers = {
    play: () => audio.play(),
    pause: () => audio.pause(),
    nexttrack: () => step(1),
    previoustrack: () => (audio.currentTime > 3 ? (audio.currentTime = 0) : step(-1)),
    seekto: (d) => { if (!current?.limit || d.seekTime < current.limit) audio.currentTime = d.seekTime; },
  };
  for (const [k, fn] of Object.entries(handlers)) try { ms.setActionHandler(k, fn); } catch {}
}

function toggle() { audio.paused ? audio.play().catch(() => {}) : audio.pause(); }
$("#toggle").addEventListener("click", toggle);

function highlightTrack() {
  document.querySelectorAll("[data-track-row]").forEach((li) => li.classList.toggle("playing", Number(li.dataset.trackRow) === current?.trackId));
  const hero = $("#hero");
  if (hero) hero.classList.toggle("spinning", !audio.paused && Number($("#sheet").dataset.album) === current?.albumId);
}

audio.addEventListener("play", () => { $("#toggle").textContent = "❚❚"; $("#toggle").ariaLabel = "Pause"; highlightTrack(); });
audio.addEventListener("pause", () => { $("#toggle").textContent = "▶"; $("#toggle").ariaLabel = "Play"; highlightTrack(); });
audio.addEventListener("timeupdate", () => {
  if (!current) return;
  const length = current.limit ? Math.min(current.limit, audio.duration || current.limit) : audio.duration || 0;
  $("#progress").style.width = `${length ? Math.min(100, (audio.currentTime / length) * 100) : 0}%`;
  $("#now-time").textContent = current.limit
    ? `${fmtTime(audio.currentTime)} / ${fmtTime(length)}`
    : fmtTime(Math.max(0, (audio.duration || 0) - audio.currentTime));
  if (current.limit && audio.currentTime >= current.limit) {
    audio.pause();
    audio.currentTime = 0;
    toast("End of preview. Own the album to hear every track in full.");
  }
});
$("#seek").addEventListener("click", (e) => {
  if (!current || !audio.duration) return;
  const r = e.currentTarget.getBoundingClientRect();
  const length = current.limit ? Math.min(current.limit, audio.duration) : audio.duration;
  audio.currentTime = ((e.clientX - r.left) / r.width) * length;
});

/* ---------- Collection ---------- */

async function collection() {
  await refreshAccount();
  const p = account.purchases;
  $("#collection").innerHTML = `
    <div class="section-head">
      <div><h2>My collection</h2><p>${p.length ? `${plural(p.length, "album")}, numbered and yours to keep.` : ""}</p></div>
      <a class="btn" href="#fan/${encodeURIComponent(me.name)}">View my record shelf</a>
    </div>
    ${p.length
      ? `<div class="certs">${p.map((c) => `
        <button class="cert" data-album="${c.albumId}">
          ${cover(c.albumId, c.title, c.hasCover)}
          <div>
            <div class="label">Certificate of ownership</div>
            <div class="num">${copyNo(c.number)}</div>
            <div><strong>${esc(c.title)}</strong> <span class="muted">· ${esc(c.artist)}</span></div>
            <div class="serial">OM-${String(c.albumId).padStart(4, "0")}-${String(c.number).padStart(4, "0")} · ${esc(me.name)} · ${esc(monthName(c.month))}</div>
          </div>
        </button>`).join("")}</div>`
      : `<div class="empty">No albums yet. Every album you buy gets a numbered certificate here. <br /><br /><button class="btn btn-primary" data-goto="albums">Browse albums</button></div>`}`;
}
$("#collection").addEventListener("click", async (e) => {
  const id = e.target.closest("[data-album]")?.dataset.album;
  if (!id) return;
  catalogue = await api("/api/albums");
  openAlbum(Number(id));
});

/* ---------- Community ---------- */

const shelfRows = (records, perRow) => {
  const rows = [];
  for (let i = 0; i < records.length; i += perRow) rows.push(records.slice(i, i + perRow));
  return rows;
};
const shelfHtml = (records, perRow) =>
  shelfRows(records, perRow).map((row) => `
    <div class="shelf-row" style="--per:${perRow}">
      ${row.map((r, i) => `
        <button class="shelf-item" data-open-album="${r.albumId}" style="--tilt:${[-2, 1, -1, 2, 0][(r.albumId + i) % 5]}deg" title="${esc(r.title)} · ${esc(r.artist)}">
          ${cover(r.albumId, r.title, r.hasCover)}
          <span class="stamp">${copyNo(r.number)}</span>
          ${r.demo ? `<span class="demo-tag">Demo</span>` : ""}
        </button>`).join("")}
    </div>`).join("");
const perRow = () => (innerWidth < 520 ? 3 : innerWidth < 900 ? 4 : 6);

async function community() {
  const [rooms, mine] = await Promise.all([api("/api/rooms"), api(`/api/fans/${encodeURIComponent(me.name)}`)]);
  $("#community").innerHTML = `
    <div class="section-head">
      <div><h2>Community</h2><p>Every album has an owners' room. Only people with a numbered copy get in, so it's real fans talking to each other and to the artist.</p></div>
    </div>
    <div class="panel shelf-preview">
      <div class="section-head" style="margin-bottom:8px">
        <div><p class="eyebrow">Your record shelf</p><h3>${plural(mine.records.length, "record")} · ${plural(mine.supported.length, "artist")} backed</h3></div>
        <a class="btn" href="#fan/${encodeURIComponent(me.name)}">Open shelf</a>
      </div>
      ${mine.records.length ? shelfHtml(mine.records.slice(0, perRow()), perRow()) : `<p class="muted">Your shelf fills up as you buy albums. Friends can browse it.</p>`}
    </div>
    <h2 style="margin:30px 0 12px">Your rooms</h2>
    ${rooms.length ? `<ul class="room-list">${rooms.map((r) => `
      <li><button class="room-row" data-room="${r.albumId}">
        ${cover(r.albumId, r.title, r.hasCover)}
        <div class="room-meta">
          <div><strong>${esc(r.title)}</strong> <span class="muted">· ${esc(r.artist)}</span></div>
          <div class="muted small room-last">${r.lastBody ? `“${esc(r.lastBody.slice(0, 90))}”` : "Quiet so far. Say hello."}</div>
          <div class="owners">${plural(r.owners, "owner")} · ${plural(r.posts, "post")}${r.lastAt ? ` · ${timeAgo(r.lastAt)}` : ""}</div>
        </div>
        <span class="badge own">${r.isArtist ? "Artist" : copyNo(r.myNumber)}</span>
      </button></li>`).join("")}</ul>`
      : `<div class="empty">Own an album to get into its owners' room. <br /><br /><button class="btn btn-primary" data-goto="albums">Browse albums</button></div>`}`;
}
$("#community").addEventListener("click", (e) => {
  const room = e.target.closest("[data-room]")?.dataset.room;
  if (room) openAlbum(Number(room), "room");
});

async function shelfView(name) {
  const el = $("#shelf");
  el.innerHTML = `<p class="muted">Loading shelf…</p>`;
  let f;
  try { f = await api(`/api/fans/${encodeURIComponent(name)}`); }
  catch { el.innerHTML = `<div class="empty">No fan called ${esc(name)}.</div>`; return; }
  const isMe = f.name === me.name;
  el.innerHTML = `
    <div class="profile">
      <div class="profile-avatar">${esc(f.name.slice(0, 1).toUpperCase())}</div>
      <div>
        <p class="eyebrow">${isMe ? "Your record shelf" : "Record shelf"}</p>
        <h2>${esc(f.name)}</h2>
        <p class="muted">Collecting since ${esc(monthName(f.joined.slice(0, 7)))}${f.artistName ? ` · releases music as <strong>${esc(f.artistName)}</strong>` : ""}</p>
      </div>
      ${isMe ? `<div class="profile-actions"><button class="btn btn-small" id="share-shelf">Copy link</button><button class="btn btn-small" id="signout">Sign out</button></div>` : ""}
    </div>
    <div class="stat-grid">
      <div class="stat"><strong>${f.records.length}</strong><span>records</span></div>
      <div class="stat"><strong>${f.supported.length}</strong><span>artists backed</span></div>
      <div class="stat"><strong>${f.records.length ? copyNo(Math.min(...f.records.map((r) => r.number))) : "–"}</strong><span>lowest copy number</span></div>
      <div class="stat"><strong>${gbp(f.records.filter((r) => !r.demo).length * config.artistPerAlbum)}</strong><span>sent to artists</span></div>
    </div>
    <div class="shelf">${f.records.length ? shelfHtml(f.records, perRow()) : `<div class="empty">${isMe ? "Your shelf is empty. Every album you buy stands here with its copy number." : "Nothing on this shelf yet."}</div>`}</div>
    ${f.supported.length ? `
      <h2 style="margin:30px 0 4px">Backing</h2>
      <ul class="rows">${f.supported.map((s) => `<li><span>${esc(isMe ? "You've" : `${f.name} has`)} bought ${plural(s.albums, "album")} from <strong>${esc(s.artist)}</strong></span><span class="r">${gbp(s.albums * config.artistPerAlbum)} to them</span></li>`).join("")}</ul>` : ""}`;
  $("#signout")?.addEventListener("click", signOut);
  $("#share-shelf")?.addEventListener("click", async () => {
    const url = `${location.origin}/#fan/${encodeURIComponent(f.name)}`;
    try { await navigator.clipboard.writeText(url); toast("Shelf link copied"); } catch { prompt("Your shelf link", url); }
  });
}
document.addEventListener("click", (e) => {
  const id = e.target.closest?.("[data-open-album]")?.dataset.openAlbum;
  if (id) openAlbum(Number(id));
});

/* ---------- Plan ---------- */

async function plan() {
  await refreshAccount();
  const acc = account;
  $("#plan").innerHTML = `
    <div class="plan-grid">
      <div class="plan-card">
        <p class="eyebrow">${acc.subscribed ? `Member since ${esc(monthName(acc.since))}` : "The record club"}</p>
        <div class="price">${gbp(config.subscription)}<small> / month</small></div>
        <ul>
          <li>${config.creditsPerMonth} albums to keep, every month</li>
          <li>Unused credits roll over and never expire</li>
          <li>Extra albums ${gbp(config.albumPrice)} each</li>
          <li>${gbp(config.artistPerAlbum)} of every album goes to the artist</li>
        </ul>
        ${acc.subscribed
          ? `<button class="btn ghost" id="cancel">Cancel subscription</button>`
          : `<button class="btn" id="subscribe">Subscribe · demo, no real payment</button>`}
      </div>
      <div class="panel">
        <p class="eyebrow">Album credits</p>
        <div class="credit-count">${acc.credits}</div>
        <div class="tokens">${Array.from({ length: Math.min(acc.credits, 24) }, () => `<span class="token"></span>`).join("")}</div>
        <p class="muted small" style="margin-top:10px">${acc.subscribed ? `+${config.creditsPerMonth} on the 1st of each month.` : acc.credits ? "Your subscription is off, but these credits are still yours." : "Subscribe to get credits, or buy albums one at a time."}</p>
        <ul class="rows">
          <li><span>Paid so far</span><span class="r">${gbp(acc.totalPaid)}</span></li>
          <li><span>Albums owned</span><span class="r">${acc.purchases.length}</span></li>
          <li><span>Sent to artists</span><span class="r">${gbp(acc.purchases.reduce((s, p) => s + p.toArtist, 0))}</span></li>
        </ul>
      </div>
    </div>
    ${acc.purchases.length ? `
      <h2 style="margin:28px 0 4px">Purchases</h2>
      <ul class="rows">${acc.purchases.map((r) => `
        <li><span><strong>${esc(r.title)}</strong> <span class="muted">· ${esc(r.artist)} · ${copyNo(r.number)}</span></span>
        <span class="r">${r.paidWith === "free" ? "Free demo copy" : `${r.paidWith === "credit" ? "1 credit" : gbp(r.value)} → ${gbp(r.toArtist)} to artist`}</span></li>`).join("")}
      </ul>` : ""}`;
  $("#subscribe")?.addEventListener("click", async () => {
    await api("/api/subscription", { method: "POST" });
    toast(`Welcome to the club. ${config.creditsPerMonth} album credits added.`);
    plan();
  });
  $("#cancel")?.addEventListener("click", async () => {
    if (!confirm("Cancel your subscription? You keep the credits you have.")) return;
    await api("/api/subscription", { method: "DELETE" });
    toast("Subscription cancelled. Your credits are still yours.");
    plan();
  });
}

/* ---------- Payouts ---------- */

async function payouts() {
  const p = await api("/api/payouts");
  const price = config.albumPrice, artist = config.artistPerAlbum;
  const net = Math.round(price / (1 + config.vatRate));
  const vat = price - net, platform = net - artist;
  const pct = (x) => `${(x / price) * 100}%`;
  const tot = p.payouts.reduce((s, r) => ({ copies: s.copies + r.copiesSold, gross: s.gross + r.gross, artist: s.artist + r.artistPayout }), { copies: 0, gross: 0, artist: 0 });
  $("#payouts").innerHTML = `
    <div class="section-head">
      <div><h2>Where every ${gbp(price)} goes</h2>
      <p>Prices include ${p.vatRate * 100}% VAT. The artist gets ${p.artistShare * 100}% of what's left, whether the fan used a credit or paid cash.</p></div>
    </div>
    <div class="split">
      <div class="split-bar">
        <div class="s-artist" style="width:${pct(artist)}">${gbp(artist)}</div>
        <div class="s-vat" style="width:${pct(vat)}">${gbp(vat)}</div>
        <div class="s-platform" style="width:${pct(platform)}"></div>
      </div>
      <div class="legend">
        <div><strong>${gbp(artist)}</strong><i style="background:var(--accent)"></i>Artist</div>
        <div><strong>${gbp(vat)}</strong><i style="background:var(--vat)"></i>VAT</div>
        <div><strong>${gbp(platform)}</strong><i style="background:var(--accent-2)"></i>OwnMusic</div>
      </div>
    </div>
    <h2 style="margin:32px 0 0">${esc(monthName(p.month))}</h2>
    <div class="stat-grid">
      <div class="stat"><strong>${tot.copies}</strong><span>albums sold</span></div>
      <div class="stat"><strong>${gbp(tot.gross)}</strong><span>sales</span></div>
      <div class="stat"><strong>${gbp(tot.artist)}</strong><span>to artists</span></div>
      <div class="stat"><strong>${gbp(p.heldForUnspentCredits)}</strong><span>held for unspent credits</span></div>
    </div>
    <ul class="rows" style="margin-top:20px">
      ${p.payouts.map((r) => `
        <li class="payout-row">
          <strong>${esc(r.artist)}</strong><span class="r"><strong>${gbp(r.artistPayout)}</strong></span>
          <span class="muted small">${plural(r.copiesSold, "album")} · ${r.viaCredit} by credit, ${r.viaCash} cash</span>
          <span class="muted small r">of ${gbp(r.gross)} · VAT ${gbp(r.vat)} · us ${gbp(r.platformFee)}</span>
        </li>`).join("")
        || `<li class="muted">No sales yet this month.</li>`}
    </ul>
    <p class="muted small" style="margin-top:14px">Subscription money for credits nobody has spent yet is held. It reaches an artist when a fan uses the credit on their album.</p>`;
}

/* ---------- Artist ---------- */

async function artist() {
  me = await api("/api/me");
  const a = me.artist;
  $("#artist").innerHTML = `
    <div class="section-head">
      <div><h2>${a ? esc(a.name) : "Release your music"}</h2>
      <p>Albums sell for ${gbp(config.albumPrice)} including VAT. You get ${gbp(config.artistPerAlbum)} of every copy, every time, whether fans use a credit or pay cash.</p></div>
      ${a ? `<span class="status-pill ${a.verified ? "ok" : "wait"}">${a.verified ? "✓ Verified artist" : "Awaiting verification"}</span>` : ""}
    </div>
    <div class="stack two">
      <form id="artist-form" class="panel">
        <h2>${a ? "Artist profile" : "Apply as an artist"}</h2>
        <label>Artist name <input name="name" required value="${esc(a?.name)}" /></label>
        <label>Bio <textarea name="bio" rows="3">${esc(a?.bio)}</textarea></label>
        <button class="btn ${a ? "" : "btn-primary"}">${a ? "Save" : "Apply"}</button>
        ${a && !a.verified ? `<p class="muted small" style="margin-top:12px">Every release needs a real, verified artist behind it. AI tools are fine, like sampling, as long as they're credited.</p>` : ""}
      </form>
      ${a?.verified ? `
      <form id="upload-form" class="panel">
        <h2>Release an album</h2>
        <label>Album title <input name="title" required /></label>
        <div class="cover-pick">
          <div id="cover-preview">${artSvg(0, "new")}</div>
          <label class="drop" style="margin:0">
            <span><strong>Cover art</strong><br />Square image, optional</span>
            <input name="cover" type="file" accept="image/*" />
          </label>
        </div>
        <label class="drop" style="margin-top:14px">
          <span><strong>Tracks</strong><br />Select every track at once. They're ordered by file name, so number them: 01 Intro.mp3, 02 …</span>
          <input name="audio" type="file" accept="audio/*" multiple required />
        </label>
        <ol class="file-list" id="file-list"></ol>
        <label style="margin-top:14px">Credits <textarea name="credits" rows="3" placeholder="Written by…, produced by…, samples or AI tools used…"></textarea></label>
        <button class="btn btn-primary btn-block">Release album</button>
        <p id="upload-status" class="muted small" style="margin-top:10px"></p>
      </form>` : ""}
    </div>`;
  $("#cover-preview")?.classList.add("cover");
  $("#artist-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    await api("/api/artist", { method: "POST", body: { name: f.get("name"), bio: f.get("bio") } });
    toast(a ? "Profile saved" : "Application sent. You'll be able to release once verified.");
    artist();
  });
  const form = $("#upload-form");
  if (!form) return;
  form.cover.addEventListener("change", () => {
    const file = form.cover.files[0];
    if (file) $("#cover-preview").innerHTML = `<img src="${URL.createObjectURL(file)}" alt="" />`;
  });
  form.audio.addEventListener("change", () => {
    const names = [...form.audio.files].map((f) => f.name).sort((x, y) => x.localeCompare(y, undefined, { numeric: true }));
    $("#file-list").innerHTML = names.map((n) => `<li>${esc(n)}</li>`).join("");
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = form.querySelector("button");
    btn.disabled = true;
    $("#upload-status").textContent = "Uploading…";
    try {
      const r = await api("/api/artist/albums", { method: "POST", body: new FormData(form) });
      toast(`Released with ${plural(r.tracks, "track")}. It's live.`);
      show("albums");
    } catch (err) {
      $("#upload-status").textContent = err.message;
      btn.disabled = false;
    }
  });
}

boot();

if ("serviceWorker" in navigator) addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
