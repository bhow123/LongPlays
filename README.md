# LongPlays

Actually own music for the same price as streaming.

LongPlays is an open-source proof of concept for a fairer way to pay for music. Fans buy albums they keep, the way they used to buy CDs. They can stream them from anywhere, and most of the money goes to the artist who made the record.

It is a working demo of the model, not a business. There is no real money, the sign-in is basic, and the NFTs live on a free test network (Base Sepolia). The aim is to show the mechanics to artists and fans and to give developers something to build on.

- **Live demo:** https://longplays.app (also https://ownmusic-production.up.railway.app, from when the project was called OwnMusic)
- **Concept doc** (research, reasoning and risks): https://claude.ai/artifact/V5R5iF6W5z79Xz79Bt6b4x (shared by the project owner; it may need access)
- **Licence:** MIT for the code (see [Licence](#licence)). The demo album's audio is not included.

---

## Contents

1. [The idea](#the-idea)
2. [The model today](#the-model-today)
3. [Decisions and why](#decisions-and-why)
4. [How the model got here](#how-the-model-got-here)
5. [Running it](#running-it)
6. [Architecture](#architecture)
7. [Money rules in code](#money-rules-in-code)
8. [Data model](#data-model)
9. [HTTP API](#http-api)
10. [Deploying](#deploying)
11. [Open questions](#open-questions)
12. [Roadmap](#roadmap)
13. [Contributing](#contributing)

---

## The idea

Streaming pays artists fractions of a penny per play, and fans own nothing. Buying downloads pays artists properly, but most people stopped doing it because streaming is easier. LongPlays tries to give fans **the convenience of streaming with the commitment of a physical product**:

- You buy an album and **own a numbered copy of it**, like a CD with a serial number: *Album A, copy #212*.
- You can play it as often as you like, on any device, with no per-play charges.
- A subscription makes buying a habit, like a record club.
- **The artist gets 90% of the money** for their album (after VAT).
- **There's a real artist behind every release.** Only verified artists can release music.
- Copy owners form a **community** around each album: an owners-only room, perks for low copy numbers, listening parties, and a public **record shelf** on every fan's profile.

## The model today

| | |
| --- | --- |
| What you buy | **Albums only.** No single tracks. |
| Album price | **£5**, including VAT |
| Subscription | **£10 a month**, which gives you **2 album credits** every month |
| Unused credits | **Roll over** month to month, never expire, and are kept if you cancel |
| Extra albums | Anyone can buy more albums for £5 each, with or without a subscription |
| After buying | Unlimited plays of every track on the album |
| Before buying | A 30-second preview of any track |
| Copies | Each purchase gets the next number for that album (#1, #2, #3…). Unlimited copies, one per person |
| Trading | Owners can **sell** their copy, or offer a **swap plus a top-up** so another owner can trade up (say #0003 for #0001). Only through LongPlays. **10%** of the price goes to the release's rights holders and **5%** to LongPlays; the seller gets 85% |
| NFTs | Every copy is minted as an NFT on Base Sepolia (testnet) into a hidden wallet for its owner. Only LongPlays can move the tokens, so trades can't dodge the cut |
| Artwork | Every copy comes with the album's full-resolution artwork package: front cover, back cover, booklet pages and inserts. Owners can view and download it. The cover is public; the rest is for owners only. Each image's SHA-256 fingerprint goes into the copy's NFT metadata, and the cover can be pinned to IPFS |
| Artist share | **90% of the price after VAT.** A £5 album is 83p VAT plus £4.17 net. The artist gets **£3.75** and the platform 42p, whether the fan used a credit or paid cash |
| Unspent credits | The subscription money behind them is **held**, not paid to anyone, until the credits are used |
| Record shelf | Every fan has a public profile (`#fan/<name>`) showing the albums they own, with copy numbers, and receipts of which artists they've backed |
| Owners' room | Each album has a feed that only its copy owners and its artist can read or post in. Posts show the author's copy number |
| Owner perks | The artist can post perks such as presale codes or demos, optionally only for copies up to a number (for example the first 100 owners). Everyone else sees them locked |
| Listening parties | The artist can schedule one in the room. Fans outside the room see the date as a teaser |
| Discovery | Each album shows what its owners also own |

## Decisions and why

These came from the project owner, Ben, and from the concept doc. Please keep them unless there's a good reason to change them, and record any change here.

- **Albums only, not tracks or per-play.** It's closest to buying a record. It keeps the price meaningful (£5, not 1p), and it avoids card fees eating small payments. Per-play and per-track pricing were tried first and dropped (see [history](#how-the-model-got-here)).
- **Artist gets 90% of net (after VAT).** It's a deliberately generous split, to show what fairer pay looks like. The platform's 10% is meant to cover running costs, not profit.
- **Each sale belongs to the artist whose album was bought.** There is no pool split by market share as on Spotify. A credit pays the artist when it's spent on their album.
- **Numbered copies are unlimited, and tradeable only through LongPlays.** Every buyer of a new copy still gets the next number. Ben first ruled out resale, then (2026-10-26) allowed trading because fans may want to trade up to a lower number. The condition is that the artist and platform take a cut of every trade, so trades happen only on LongPlays's market and the NFTs can't be moved anywhere else. Defaults: 10% to rights holders, 5% to LongPlays.
- **Verified real artists only.** The rule against "AI slop" is about having **a real artist behind each release**, not about whether AI was used. AI is treated like sampling: allowed, but it should be credited (there's a credits field on every album).
- **Community is for owners only.** Owning a copy is the way in, which keeps out bots and drive-by trolls, and the copy number shows when you joined. Low numbers can be rewarded with perks.
- **Fans never see crypto.** Copies are minted as NFTs into wallets LongPlays holds for each fan, so nobody needs a crypto wallet. Tokens can only be moved by LongPlays. They prove ownership publicly but carry no share of royalties: tradeable royalty tokens are out, because of FCA rules and because they turn fans into investors.
- **Open source and public.** This is a proof of concept for others to learn from and build on.

## How the model got here

Kept here so nobody has to re-argue settled points.

1. **1p per play, capped at £15 a month**, with each listener's money going only to the artists they played. Dropped because fans don't own anything and it still feels like renting.
2. **Buy a single track once** (around 99p) and own a numbered copy with unlimited plays. Dropped in favour of albums, which fit the "digital CD" idea better and make fees less of a problem.
3. **Albums only, £5, with a £10/month subscription for 2 rolling credits.** This is the current model. Artist payouts were then changed to 90% **net of VAT**.
4. **Resale allowed, through LongPlays only** (2026-10-26), with a cut for the artist and the platform, plus real NFT minting on a testnet.

## Running it

Needs **Node 22** (the SQLite driver, `better-sqlite3` 13, requires it).

```sh
npm install
ADMIN_TOKEN=pick-a-secret npm start      # http://localhost:3000
npm test                                 # money-rule tests
npm run typecheck                        # tsc, no output on success
npm run dev                              # restarts on file changes
```

### Try the whole flow

1. **Become an artist.** Sign in with a name and password (the first sign-in creates the account). Open **For artists** and apply with an artist name.
2. **Verify the artist.** Run `npm run verify-artist -- "Artist Name"` locally, or:
   ```sh
   curl -X POST http://localhost:3000/api/admin/verify \
     -H "x-admin-token: pick-a-secret" -H "content-type: application/json" \
     -d '{"name":"Artist Name"}'
   ```
3. **Release an album.** Reload **For artists**, give it a title, optional square cover art and credits, and select all its tracks at once. Tracks are ordered by file name, so number them (`01 Intro.mp3`, `02 …`). A leading track number is removed from the displayed title.
4. **Be a fan.** In another browser or a private window, sign in as someone else. Preview tracks, subscribe under **My plan** (no real payment is taken), and buy albums. The first two use credits and the next costs £5.
5. **Join the community.** Open an album you own and switch to **Owners' room** to post. As the artist, you can also post owner perks and listening parties there. Tap your avatar to see your record shelf, and tap any owner's name to see theirs.
6. **Check the money.** **My plan** shows credits and what each album paid its artist. **Where the money goes** shows sales, VAT, artist and platform amounts for the month, plus any money held for unspent credits.

### Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `DATA_DIR` | `./data` | Where the SQLite database (`ownmusic-v2.db`) and uploads (`audio/`, which also holds cover images) live |
| `ADMIN_TOKEN` | unset | Needed to call `POST /api/admin/verify`. If unset, verification only works through the CLI script |
| `SESSION_SECRET` | random per start | Signs the session cookie. Set it in production or everyone is signed out on every restart |
| `NFT_OPERATOR_KEY` | unset | Private key of the wallet that deploys the contract, mints and moves tokens. Unset means no NFTs. **Keep it secret and never rotate it casually**: fans' wallet addresses are derived from it, and it owns the contract |
| `NFT_RPC_URL` | `https://sepolia.base.org` | Chain RPC endpoint |
| `NFT_CONTRACT` | unset | Use an existing contract. Unset means the server deploys one once the operator has test ETH, and remembers it in the `settings` table |
| `PUBLIC_URL` | the Railway demo URL | Base for token metadata URLs (`<PUBLIC_URL>/api/nft/<tokenId>`) |
| `PINATA_JWT` | unset | Pinata API token. When set, album covers are pinned to IPFS and the NFT `image` becomes `ipfs://<cid>` |
| `PINATA_URL` | `https://api.pinata.cloud` | Pinata API base (for testing against a mock) |
| `PIN_ALL_ARTWORK` | unset | `1` also pins the owners-only pieces. Anything on IPFS is public, so this makes the whole package downloadable by anyone with the CID |

## Architecture

Deliberately small, with no build step, so anyone can read it in one sitting.

```
src/
  server.ts         Express app: auth, routes, uploads, admin
  money.ts          All pricing, credit, purchase and payout rules (pure functions over the DB)
  community.ts      Record shelves, owners' rooms (access, posts, perks, parties) and "owners also own"
  market.ts         Trading: listings, sales and swaps, and the resale cut
  nft.ts            NFT minting: hidden wallets, contract deploy, token metadata, background sync worker
  db.ts             SQLite schema, created on start
  verify-artist.ts  CLI: mark an artist as verified
public/
  index.html        Single page shell
  app.js            Vanilla JS UI: albums grid and album sheet (tracks / owners' room), player, collection, community, record shelves, plan, payouts, artist area
  style.css         Design tokens, light and dark themes, layout
  manifest.webmanifest, sw.js, icons/   Installable web app: manifest, service worker, app icons
test/
  money.test.ts     node:test tests for money.ts against an in-memory DB
  community.test.ts Tests for community.ts
  market.test.ts    Tests for market.ts
contracts/
  LongPlaysCopies.sol  ERC-721 contract: one token per copy, only the owner (LongPlays) can mint or move tokens
  LongPlaysCopies.json Compiled ABI and bytecode (committed; rebuild with npm run contract:compile)
```

- **Runtime:** Node 22 with TypeScript run directly by `tsx` (no compile step). `tsc` is only used for type-checking.
- **Storage:** SQLite through `better-sqlite3` (synchronous, with transactions for every money operation). Audio files go on disk under `DATA_DIR/audio` with random file names.
- **Auth:** a name and password (hashed with scrypt), stored in a signed, httpOnly cookie. It's fine for a demo, but it isn't real account security: there's no email, no reset and no rate limiting.
- **Money:** everything is in **integer pence**. Rules live only in `src/money.ts`, so the UI and routes never do money maths themselves.
- **Subscriptions:** there's no background job. `renewSubscription` runs on each signed-in request and bills any months the user hasn't been charged for yet, each giving 2 credits.
- **UI:** one page, no framework. Fonts are Space Grotesk and JetBrains Mono from Google Fonts. Albums without cover art get a generated cover, made from a hash of the album's id and title, so it's always the same. Copy numbers are shown as `#0007`, and each owned album has a certificate with a serial number, `OM-<album>-<copy>`.
- **Installable app (PWA):** `public/manifest.webmanifest`, icons in `public/icons/` (including `apple-touch-icon.png` for iPhone) and a small service worker (`public/sw.js`) that caches the app shell, network first, and never caches `/api/` or audio. On a phone, use "Add to Home Screen" to open it full screen. The player sets Media Session metadata, so lock-screen and headphone controls work.
- **Full-screen player:** tapping the mini player opens a Spotify-style now-playing view (`#np` in `index.html`, "Full-screen now playing" in `app.js`). It has big cover art, a scrubber, previous/play/next, the copy number or Preview badge, and a way to get the album when it's a preview. Swipe down, ⌄ or Escape closes it.
- **Trading** (`src/market.ts`): an owner lists their copy to `sell`, or to `swap` for another number plus a cash top-up. A sale needs a buyer with no copy yet; a swap needs a buyer who owns a different number, and the two copies change owners (through a hidden holding account, because copies are one per owner). Every trade records 10% to rights holders and 5% to LongPlays, and `payoutsForMonth` adds the rights holders' cut on top of first sales, split between recording and songwriting in the same proportion.
- **NFTs** (`src/nft.ts`, `contracts/`): the database is the source of truth and the chain mirrors it. A worker checks every few seconds for a copy whose `token_owner_id` doesn't match its owner, then mints it or calls `marketTransfer`, one transaction at a time. `transferFrom`, `approve` and `setApprovalForAll` revert for everyone, so a token can only move when LongPlays records a trade. Each fan's wallet address is an HMAC of the operator key and their user id; fans never see a key. Metadata is served by the app at `/api/nft/:tokenId`. Tested end to end against a local chain (ganache) with chain id 84532.
- **Royalty splits per release:** the rights holders' 90% of net splits between the recording (master) owner and songwriting/publishing. Publishing takes `publishing_percent` of the VAT-free price (default 8%, like the UK MCPS download rate), and the recording owner gets the rest, so £3.75 becomes £3.42 + 33p by default. `albums.master_holder` and `albums.publisher` name the payees, and NULL means the album's own artist (the demo album uses that). `splitRights` in `src/money.ts` does the maths, and `payoutsForMonth` returns a `rightsHolders` list. Artists set the split on the release form, and both shares show on the album page and the payouts page.
- **Demo release:** on start, `src/demo.ts` seeds a demo artist ("The Test Pressings") and demo album ("Ready for Release", one track, "Play Me First") from `demo/`, once. `artists.demo` flags it, and the UI labels it with a yellow Demo tag and a note, so it can't be mistaken for a real release. Nobody can sign in as the demo artist. The audio was supplied by Ben and is **not** MIT licensed (see `demo/README.md`). Anyone can add the demo album to their shelf free, with no subscription: `buyAlbum` stores it as a £0 copy (paid_with stays `cash` because of the column CHECK, reported as `free`), so it uses no credit, takes no payment and is left out of payouts and "artists backed". After buying any album, the sheet offers shortcuts to your record shelf and the owners' room.
- **Artists hear their own releases in full**, and playback starts inside the tap so iPhone home-screen apps allow it. Owned albums play on to the next track, with next, previous and seek on the lock screen.
- **Previews:** the player stops non-owners at 30 seconds. The full file is still served to anyone signed in, so this isn't protection (see the roadmap).

## Money rules in code

All in [`src/money.ts`](src/money.ts), covered by [`test/money.test.ts`](test/money.test.ts).

| Rule | Function |
| --- | --- |
| Subscribing charges £10 and grants 2 credits for the current month. Subscribing again while active does nothing, and restarting in a month already paid for doesn't charge again | `subscribe` |
| Each new month an active subscriber is charged £10 and granted 2 more credits. Unused credits roll over | `renewSubscription` |
| Cancelling stops future billing. Earned credits are kept | `cancelSubscription` |
| Buying an album uses a credit if you have one, otherwise records a £5 payment. You get the next copy number, one per person per album, and buying again never charges twice | `buyAlbum` |
| Every copy is a £5 sale including 20% VAT. Net = round(price ÷ 1.2) = 417p. Artist = floor(net × 90%) = 375p. Platform = net − artist = 42p. Worked out per copy, so every copy pays the artist the same | `netOfVat`, `artistCut`, `payoutsForMonth` |
| Money held for unspent credits = all payments to date − value of all copies bought to date | `payoutsForMonth` |
| Owners' plays are logged for play counts and never charged | `logPlay` |

Constants (`ALBUM_PRICE_PENCE`, `SUBSCRIPTION_PENCE`, `CREDITS_PER_MONTH`, `ARTIST_SHARE`, `VAT_RATE`, `PREVIEW_SECONDS`) are at the top of `money.ts`. The UI reads them from `GET /api/config`, so change them in one place.

## Data model

SQLite tables, defined in [`src/db.ts`](src/db.ts):

| Table | What it holds |
| --- | --- |
| `users` | Name (unique) and password hash |
| `artists` | One per user who applies. `verified` must be 1 before they can release or appear in the catalogue |
| `albums` | Title, credits and optional cover image file, belonging to an artist. Albums without a cover get generated artwork in the browser |
| `tracks` | Album tracks with position and audio file name |
| `copies` | Numbered album copies: `(album_id, number)` and `(album_id, owner_id)` are both unique. `paid_with` is `credit` or `cash`. `value_pence` is the sale value, and `month` is the month it counts towards payouts |
| `subscriptions` | One row per user: `started_month`, `last_billed_month`, `active` |
| `credit_ledger` | +2 for each billed month and −1 for each album bought with a credit. The balance is the sum |
| `payments` | Money in: `subscription` (£10) and `album` (£5 cash purchases) |
| `plays` | Owners' listens, for play counts |
| `posts` | Owners' room posts: `kind` is `post`, `perk` (with optional `max_number`) or `party` (with `starts_at`) |
| `listings` | Copies on the market: `kind` `sell` or `swap`, and `price_pence` (the price, or the top-up for a swap). One per copy |
| `trades` | Completed trades, with the price and the artist, platform and seller amounts. `swapped_copy_id` is the copy the buyer gave in a swap |
| `settings` | Key/value, e.g. the deployed NFT contract address |
| `artwork` | The album package's images at full resolution: `kind` (`cover`, `back`, `booklet`, `insert`), position, title, file, MIME type, bytes, width, height, `sha256` and `ipfs_cid` once pinned |

Copies also have `first_owner_id` (set when a copy first changes hands, so the original sale stays attributable), `token_owner_id` (the fan whose wallet holds the token on chain, as far as the minter has synced) and `token_tx`.

Months are stored as `YYYY-MM` strings (UTC). The database file is `ownmusic-v2.db`. The earlier per-track version used `ownmusic.db`, which is left alone and unused. There are no migrations yet. If you change the schema, either add an `ALTER TABLE` step in `openDb` or bump the file name.

## HTTP API

JSON in and out. "Auth" means it needs the session cookie from `/api/login`.

| Method and path | Auth | Purpose |
| --- | --- | --- |
| `GET /api/config` | | Prices, credits per month, VAT rate, artist share, artist £ per album, preview length |
| `POST /api/login` `{name, password}` | | Sign in, or create the account on first use |
| `POST /api/logout` | | Clear the session |
| `GET /api/me` | ✓ | Current user and their artist profile, if any |
| `GET /api/albums` | | Catalogue of verified artists' albums, with tracks, copies sold and your copy number |
| `GET /api/tracks/:id/audio` | ✓ | Stream the audio (supports range requests) |
| `POST /api/tracks/:id/plays` | ✓ | Start playing: returns `{owned, previewSeconds}` and logs the play if owned |
| `POST /api/albums/:id/buy` | ✓ | Buy the next copy: returns `{number, paidWith, alreadyOwned}` |
| `GET /api/albums/:id/owners` | | Copy numbers and owner names |
| `GET /api/albums/:id/cover` | | The album's cover image (404 if none) |
| `GET /api/albums/:id/artwork` | | The artwork package: each piece's kind, size, fingerprint, and whether it's locked for you |
| `GET /api/artwork/:id` (`?download=1`) | cover public, rest ✓ owner or artist | The full-resolution image, or a download |
| `POST /api/albums/:id/artwork` (multipart: `artwork`[], `kind?`) | ✓ the album's artist | Add artwork. A new `cover` replaces the old one |
| `GET /api/fans/:name` | | A fan's record shelf: copies owned, artists backed, and their artist name if they have one |
| `GET /api/albums/:id/also` | | Albums that this album's owners also own, most shared first |
| `GET /api/albums/:id/room` | ✓ owner or artist | The owners' room feed (403 with a teaser of owners, posts, perks and the next party otherwise) |
| `POST /api/albums/:id/room` `{body, kind?, maxNumber?, startsAt?}` | ✓ owner or artist | Post. Only the artist can use `kind` `perk` or `party` |
| `GET /api/rooms` | ✓ | Rooms you can enter (albums you own or made), with the latest activity |
| `GET /api/account` | ✓ | Subscription status, credits, total paid, purchases (with token links), trading totals and your wallet address |
| `GET /api/albums/:id/market` | | Listings for the album, and your own copy, listing and token if you have one |
| `POST /api/albums/:id/listing` `{kind, price}` / `DELETE` | ✓ owner | List your copy (`sell` or `swap`, price in pence) or take it off the market |
| `POST /api/listings/:id/take` | ✓ | Buy a listed copy, or swap yours for it (`{kind, number, gaveNumber, price}`) |
| `GET /api/nft` | | Whether minting is on, the chain, contract, operator address, copies waiting to sync and the last error |
| `GET /api/nft/:tokenId` | | ERC-721 metadata for a copy (the contract's `tokenURI`) |
| `POST /api/subscription` / `DELETE /api/subscription` | ✓ | Subscribe or cancel |
| `GET /api/payouts?month=YYYY-MM` | | Per-artist sales, VAT, artist and platform amounts, plus money held for unspent credits |
| `POST /api/artist` `{name, bio}` | ✓ | Apply as, or update, your artist profile |
| `POST /api/artist/albums` (multipart: `title`, `credits`, `cover`, `artwork`[], `audio`[]) | ✓ verified artist | Release an album (up to 40 audio files and 1 image, 100 MB each) |
| `POST /api/admin/verify` `{name}` + `x-admin-token` header | admin | Verify an artist by name |

## Deploying

The demo runs on **Railway**:

- A Railway project called `ownmusic` (the old name), with one service built from this repo by Railpack (`npm install`, then `npm start`).
- A **volume mounted at `/data`**, with `DATA_DIR=/data`. Without a volume, every deploy wipes the database and the audio.
- Variables: `DATA_DIR=/data`, `PORT=3000`, `ADMIN_TOKEN`, `SESSION_SECRET`, `NODE_ENV=production`.
- `package.json` pins `"engines": { "node": "22.x" }`. Railway's default Node 20 crashes on start.
- If a push doesn't start a deploy, trigger one from the Railway dashboard.
- NFTs: `NFT_OPERATOR_KEY` is set on the service. The operator address (shown at `/api/nft`) needs free Base Sepolia test ETH from a faucet. Once it has some, the server deploys the contract and mints every copy, oldest first.

- Custom domains `longplays.app` and `www.longplays.app` point at the service with CNAMEs in Cloudflare (DNS only, not proxied), so Railway issues the certificates.

Any host that runs Node 22 with a persistent disk will work the same way.

## Open questions

Things not yet decided. Please don't settle these silently in code.

- **Unspent credits.** If a subscriber never spends their credits, the money just sits there. Options include passing it to artists after a set time, capping how many credits can pile up, or refunding on cancel.
- **VAT on subscriptions.** The demo counts VAT when an album is bought. In real life VAT might be due when the subscription is paid, because credits may count as vouchers. This needs an accountant.
- **Card fees.** On a £5 cash purchase the platform keeps 42p, and card fees of about 20p + 1.5% take roughly 28p of that. Subscriptions (one £10 charge) or top-ups help.
- **Pricing per album.** It's a flat £5 today. Should artists be able to set their own price, or should EPs cost less?
- **Licensing.** A real service needs rights for every album. The demo only plays music uploaded by the artist who owns it. The concept doc suggests starting with independent artists through distributors.
- **Real artist verification.** Today it's an admin flag. What checks prove there's a real artist behind a release?
- **Downloads.** Owners can download the artwork. Should they be able to download the audio, or only if the service shuts down?
- **Artwork on IPFS.** Only the cover is pinned, because anything on IPFS is public. Pinning the whole package makes the NFT self-contained but gives it away to non-owners. Encrypting it before pinning is an option.
- **Resale rights.** Under UK/EU law, selling a digital copy on isn't covered the way selling a used CD is (the *Tom Kabinet* ruling), so labels and publishers would have to agree to resale in their licences. Should trading be opt-in per release?
- **Pricing swaps.** Today the owner of the lower number sets a cash top-up and the cut is taken on that only, so a swap with a tiny top-up pays almost nothing. Options: a minimum fee per trade, or a fee on an agreed value of both copies.
- **Speculation and scalping.** Should resale prices be capped (for example at a multiple of £5), or listings limited for new releases?
- **Holding fans' money.** Real trades mean holding sellers' proceeds, which needs a payments provider that handles that (Stripe Connect), and sellers who trade a lot may owe tax.
- **NFTs on a real network.** Going to Base mainnet costs a little per mint, and putting tradeable tokens on a public chain may bring cryptoasset rules into play (FCA financial promotions). Fans' wallets are custodial today; should fans be able to take their tokens out (which would let them skip the cut)?

## Roadmap

Roughly in order:

1. **Real payments:** a Stripe subscription for the £10 plan, Stripe Checkout for extra albums, and Stripe Connect for artist payouts.
2. **A monthly billing job** to replace lazy renewal, plus payout statements for artists.
3. **Server-side preview clips**, so non-owners can't fetch full files.
4. **Real accounts:** email sign-in, password reset and rate limiting.
5. **Editing albums after release:** track titles, order and cover art.
6. **More community:** live chat and audio for listening parties, notifications, moderation tools, and following other fans' shelves.
7. **NFTs beyond the testnet:** metadata on IPFS or Arweave so it outlives the server, a mainnet deployment, and a way to take a copy out if LongPlays ever shuts down.

## Contributing

Issues and pull requests are welcome. A few conventions:

- Keep money maths in `src/money.ts`, in integer pence, with a test for every rule. Community rules go in `src/community.ts`.
- Run `npm test` and `npm run typecheck` before opening a pull request.
- If you change a [decision](#decisions-and-why) or settle an [open question](#open-questions), update this README in the same pull request.

## Licence

The code is released under the [MIT Licence](LICENSE): anyone can use, change and redistribute it, commercially or not, as long as they keep the copyright notice.

**The demo audio is not covered.** `demo/one-i-can-release.m4a` ("Play Me First" on the demo album) is © Ben, all rights reserved, and is only included so the demo has something to play. Don't reuse it outside running LongPlays. See `demo/README.md`.

Music that artists upload to a running LongPlays belongs to them. The code licence doesn't grant any rights to it.
