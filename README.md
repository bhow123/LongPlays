# OwnMusic

Actually own music for the same price as streaming.

OwnMusic is an open-source proof of concept for a fairer way to pay for music:

- **Buy once, own it.** Pay a one-off price for a track, like buying a single or a download, then play it as often as you like, streamed from anywhere. No subscription, no per-play charges.
- **Numbered copies, like a CD.** Every purchase gets the next number: copy #1, #2, #3… There's no limit and no resale; each copy belongs to one person.
- **Try before you buy.** Anyone can hear a 30-second preview.
- **Artists get 90%** of every sale, and your money only goes to the artists you chose to buy. Nothing is pooled and split by market share.
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

Sign in as a second user in another browser to preview, buy and play as a fan. **My purchases** shows what each sale paid the artist, and **Artist payouts** shows the 90/10 split.

## How the money works

All of the rules live in [`src/money.ts`](src/money.ts) and are covered by tests (`npm test`).

| Rule | Where |
| --- | --- |
| Buying a track gives you the next numbered copy, one per person, unlimited copies | `buyCopy` |
| Owners play for free as often as they like (plays are only logged for counts) | `logPlay` |
| Each artist gets 90% of their monthly sales, rounded down once | `payoutsForMonth` |
| Non-owners get a 30-second preview | `PREVIEW_SECONDS`, enforced by the player |

Artists set each track's price when they upload it (default 99p).

## Stack

Node + TypeScript (run directly with `tsx`), Express, SQLite (`better-sqlite3`), and plain HTML/CSS/JS in `public/`. No build step.

Data lives in `./data` (set `DATA_DIR` to move it): the SQLite database and the uploaded audio. To deploy on Railway or similar, mount a volume and point `DATA_DIR` at it, and set `ADMIN_TOKEN` and `SESSION_SECRET`.

## Not built yet

- Real payments (Stripe Checkout for each purchase) and real artist payouts.
- Server-side preview clips. Today the player stops non-owners at 30 seconds, but the full file can still be fetched.
- Real accounts and artist identity checks.
- Minting each numbered copy as a non-transferable NFT, so fans keep proof of ownership (and a download) even if the service shuts down. The fan should never have to see crypto.
- Owner communities around each track.
- Licensing. Any real service needs rights for every track; this demo only plays music uploaded by the artist who owns it.

Contributions welcome. MIT licensed.
