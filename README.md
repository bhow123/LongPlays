# OwnMusic

Actually own music for the same price as streaming.

OwnMusic is an open-source proof of concept for a fairer way to pay for music:

- **Albums only, £5 each.** You buy whole albums, like a CD, then play them as often as you like, streamed from anywhere. No per-play charges.
- **£10 a month gets you 2 albums.** Subscribers get 2 album credits a month. Unused credits roll over and never expire, even if you cancel. You can buy extra albums for £5 at any time, with or without a subscription.
- **Numbered copies.** Every purchase gets the next number: copy #1, #2, #3… There's no limit and no resale; each copy belongs to one person.
- **Try before you buy.** Anyone can hear a 30-second preview of any track.
- **Artists get 90% after VAT.** Prices include 20% VAT, so a £5 album is £4.17 net and the artist gets £3.75 of it, whether the fan used a credit or paid cash. Your money only goes to the artists you chose. Subscription money for credits nobody has spent yet is held, not pooled and split by market share.
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
3. Reload **For artists** and release an album: pick all its tracks at once. Tracks are ordered by file name, so number them (`01 Intro.mp3`, `02 …`).

Sign in as a second user in another browser to act as a fan: preview tracks, subscribe under **My plan** (no real payment), and buy albums. **My plan** shows your credits and what each album paid the artist, and **Artist payouts** shows the 90/10 split.

## How the money works

All of the rules live in [`src/money.ts`](src/money.ts) and are covered by tests (`npm test`).

| Rule | Where |
| --- | --- |
| Subscribing charges £10 and grants 2 album credits for that month | `subscribe` |
| Each later month an active subscriber is charged £10 and granted 2 more credits; unused credits roll over | `renewSubscription` |
| Cancelling stops billing; earned credits are kept | `cancelSubscription` |
| Buying an album uses a credit if you have one, otherwise costs £5; you get the next numbered copy, one per person | `buyAlbum` |
| Every copy is a £5 sale including 20% VAT (£4.17 net); the artist gets 90% of net, £3.75, and the platform 42p | `payoutsForMonth`, `artistCut` |
| Money for unspent credits is held until a credit is used | `payoutsForMonth` |
| Non-owners get a 30-second preview of each track | `PREVIEW_SECONDS`, enforced by the player |

## Stack

Node + TypeScript (run directly with `tsx`), Express, SQLite (`better-sqlite3`), and plain HTML/CSS/JS in `public/`. No build step.

Data lives in `./data` (set `DATA_DIR` to move it): the SQLite database and the uploaded audio. To deploy on Railway or similar, mount a volume and point `DATA_DIR` at it, and set `ADMIN_TOKEN` and `SESSION_SECRET`.

## Not built yet

- Real payments (a Stripe subscription plus Checkout for extra albums) and real artist payouts.
- A monthly billing job. Today a subscriber's missed months are billed the next time they use the site.
- Server-side preview clips. Today the player stops non-owners at 30 seconds, but the full file can still be fetched.
- Real accounts and artist identity checks.
- Album artwork and editing track names after release.
- Minting each numbered copy as a non-transferable NFT, so fans keep proof of ownership (and a download) even if the service shuts down. The fan should never have to see crypto.
- Owner communities around each album.
- Licensing. Any real service needs rights for every album; this demo only plays music uploaded by the artist who owns it.

Contributions welcome. MIT licensed.
