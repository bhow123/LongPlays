# OwnMusic

Actually own music for the same price as streaming.

OwnMusic is an open-source proof of concept for a fairer way to pay for music:

- **1p per play**, billed monthly, **capped at £15 a month**. After 1,500 plays everything is free until next month.
- **User-centric payouts.** Your money goes only to the artists you played. Nothing is pooled and split by market share.
- **Artists get 90%** of what their listeners pay, for plays and for copies.
- **Numbered copies, like a CD.** Buy copy #1, #2, #3… of a track. There's no limit and no resale; each copy belongs to one person, and owning a copy makes that track free to play.
- **A real artist behind every release.** Only verified artists can upload. AI is treated like sampling: allowed, but credited.

It is a demo of the model, not a business. There is no real money, only a basic name-and-password sign-in, and no blockchain yet.

## Run it

Needs Node 22.

```sh
npm install
ADMIN_TOKEN=pick-a-secret npm start
# open http://localhost:3000
```

Then, to release music:

1. Sign in with a name and password (the first sign-in creates the account), open **For artists**, and apply with your artist name.
2. Verify yourself: `npm run verify-artist -- "Your Artist Name"`
   (or `curl -X POST localhost:3000/api/admin/verify -H "x-admin-token: pick-a-secret" -H "content-type: application/json" -d '{"name":"Your Artist Name"}'`).
3. Reload **For artists** and upload tracks.

Sign in as a second user in another browser to listen as a fan. **My bill** shows where each penny went, and **Artist payouts** shows the 90/10 split.

## How the money works

All of the rules live in [`src/money.ts`](src/money.ts) and are covered by tests (`npm test`).

| Rule | Where |
| --- | --- |
| A play counts after 30 seconds of listening, checked against the server clock | `countPlay` |
| Each counted play costs 1p, unless you own a copy or have hit the £15 cap | `countPlay` |
| Copies are numbered in order, one per person, unlimited | `buyCopy` |
| Each artist gets 90% of their monthly total (plays + copies), rounded down once | `payoutsForMonth` |

Because every charge is attached to the track that was played, payouts are user-centric by construction. If one fan plays only your music, all of their spend goes to you, however much other people stream other artists.

## Stack

Node + TypeScript (run directly with `tsx`), Express, SQLite (`better-sqlite3`), and plain HTML/CSS/JS in `public/`. No build step.

Data lives in `./data` (set `DATA_DIR` to move it): the SQLite database and the uploaded audio. To deploy on Railway or similar, mount a volume and point `DATA_DIR` at it, and set `ADMIN_TOKEN` and `SESSION_SECRET`.

## Not built yet

- Real payments (Stripe: monthly invoice in arrears for plays, checkout for copies) and real artist payouts.
- Real accounts and artist identity checks.
- Minting each numbered copy as a non-transferable NFT, so fans keep proof of ownership (and a download) even if the service shuts down. The fan should never have to see crypto.
- Owner communities around each track.
- Licensing. Any real service needs rights for every track; this demo only plays music uploaded by the artist who owns it.

Contributions welcome. MIT licensed.
