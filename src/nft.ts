import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Contract, ContractFactory, JsonRpcProvider, Wallet, formatEther } from "ethers";
import type { DB } from "./db.js";
import { listArtwork } from "./artwork.js";

// Each numbered copy is minted as an NFT on Base Sepolia (a free test network).
// The database stays the source of truth: a background worker keeps the chain in step with it,
// minting new copies and moving tokens when copies change hands on the market.
//
// Wallets are hidden from fans. Each fan gets an address derived from the operator key, and
// only the operator (OwnMusic) can move tokens, so trades can't skip the market and its cut.

const RPC_URL = process.env.NFT_RPC_URL ?? "https://sepolia.base.org";
const OPERATOR_KEY = process.env.NFT_OPERATOR_KEY;
const PUBLIC_URL = (process.env.PUBLIC_URL ?? "https://ownmusic-production.up.railway.app").replace(/\/$/, "");
export const EXPLORER = process.env.NFT_EXPLORER ?? "https://sepolia.basescan.org";
export const CHAIN_NAME = process.env.NFT_CHAIN_NAME ?? "Base Sepolia (testnet)";

const artifact = JSON.parse(fs.readFileSync(path.resolve("contracts", "OwnMusicCopies.json"), "utf8")) as { abi: object[]; bytecode: string };

export const nftEnabled = () => !!OPERATOR_KEY;

/** A fan's hidden wallet address. Same fan, same address, every time. */
export function walletFor(userId: number) {
  if (!OPERATOR_KEY) return null;
  const key = crypto.createHmac("sha256", OPERATOR_KEY).update(`ownmusic-wallet:${userId}`).digest("hex");
  return new Wallet(`0x${key}`).address;
}

const setting = (db: DB, key: string) =>
  (db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as { value: string } | undefined)?.value ?? null;
const setSetting = (db: DB, key: string, value: string) =>
  db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, value);

export function contractAddress(db: DB) {
  return process.env.NFT_CONTRACT ?? setting(db, "nft_contract");
}

/** Public status for the UI and README: is minting on, where, and is the operator funded. */
export function nftStatus(db: DB) {
  const pending = (db.prepare(`SELECT COUNT(*) AS n FROM copies WHERE token_owner_id IS NULL OR token_owner_id != owner_id`).get() as { n: number }).n;
  return {
    enabled: nftEnabled(),
    chain: CHAIN_NAME,
    contract: contractAddress(db),
    explorer: EXPLORER,
    operator: OPERATOR_KEY ? new Wallet(OPERATOR_KEY).address : null,
    pending,
    lastError: setting(db, "nft_last_error"),
  };
}

/** Token metadata, served at /api/nft/:tokenId (the contract's tokenURI). */
export function tokenMetadata(db: DB, tokenId: number) {
  const c = db
    .prepare(
      `SELECT c.number, al.id AS albumId, al.title, ar.name AS artist, ar.demo, al.cover_file IS NOT NULL AS hasCover
       FROM copies c JOIN albums al ON al.id = c.album_id JOIN artists ar ON ar.id = al.artist_id WHERE c.id = ?`,
    )
    .get(tokenId) as { number: number; albumId: number; title: string; artist: string; demo: number; hasCover: number } | undefined;
  if (!c) return null;
  const no = `#${String(c.number).padStart(4, "0")}`;
  // The full-resolution artwork that comes with the copy. Each file's SHA-256 is fixed here,
  // so the token proves which images belong to it even if they move to other storage.
  const art = listArtwork(db, c.albumId).map((a) => ({
    kind: a.kind,
    title: a.title,
    uri: a.ipfsCid ? `ipfs://${a.ipfsCid}` : `${PUBLIC_URL}/api/artwork/${a.id}`,
    mime: a.mime,
    width: a.width,
    height: a.height,
    bytes: a.bytes,
    sha256: a.sha256,
    ownersOnly: a.kind !== "cover",
  }));
  const front = art.find((a) => a.kind === "cover");
  return {
    name: `${c.title} ${no}`,
    description: `Copy ${no} of "${c.title}" by ${c.artist} on OwnMusic. It plays in full for whoever owns it and can only change hands on the OwnMusic market.${c.demo ? " This is a demo release." : ""}`,
    image: front?.uri ?? (c.hasCover ? `${PUBLIC_URL}/api/albums/${c.albumId}/cover` : `${PUBLIC_URL}/icons/icon-512.png`),
    external_url: `${PUBLIC_URL}/`,
    attributes: [
      { trait_type: "Artist", value: c.artist },
      { trait_type: "Album", value: c.title },
      { trait_type: "Copy number", value: c.number, display_type: "number" },
      { trait_type: "Artwork pieces", value: art.length, display_type: "number" },
      ...(front?.width ? [{ trait_type: "Cover resolution", value: `${front.width}×${front.height}` }] : []),
      ...(c.demo ? [{ trait_type: "Demo", value: "Yes" }] : []),
    ],
    properties: { artwork: art },
  };
}

/** Starts the background worker. Does nothing unless NFT_OPERATOR_KEY is set. */
export function startNftWorker(db: DB, intervalMs = 4000) {
  if (!OPERATOR_KEY) return;
  const provider = new JsonRpcProvider(RPC_URL);
  const operator = new Wallet(OPERATOR_KEY, provider);
  let busy = false;
  let lastLogged = "";
  const fail = (e: unknown) => {
    const msg = (e as { shortMessage?: string; message?: string }).shortMessage ?? (e as Error).message ?? String(e);
    setSetting(db, "nft_last_error", `${new Date().toISOString()} ${msg.slice(0, 300)}`);
    // The worker retries every few seconds, so only log an error when it changes.
    if (msg !== lastLogged) console.error("nft:", msg);
    lastLogged = msg;
  };
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      let address = contractAddress(db);
      if (!address) {
        if ((await provider.getBalance(operator.address)) === 0n)
          throw new Error(`operator ${operator.address} has no test ETH yet; fund it from a Base Sepolia faucet`);
        const deployed = await new ContractFactory(artifact.abi, artifact.bytecode, operator).deploy(`${PUBLIC_URL}/api/nft/`);
        await deployed.waitForDeployment();
        address = await deployed.getAddress();
        setSetting(db, "nft_contract", address);
        console.log("nft: deployed OwnMusicCopies at", address);
      }
      const contract = new Contract(address, artifact.abi, operator);
      // One copy at a time keeps nonces simple; the oldest out-of-step copy goes first.
      const c = db
        .prepare(`SELECT id, owner_id AS ownerId, token_owner_id AS tokenOwnerId FROM copies WHERE token_owner_id IS NULL OR token_owner_id != owner_id ORDER BY id LIMIT 1`)
        .get() as { id: number; ownerId: number; tokenOwnerId: number | null } | undefined;
      if (!c) return;
      const to = walletFor(c.ownerId)!;
      const tx =
        c.tokenOwnerId === null
          ? await contract.mint(to, c.id)
          : await contract.marketTransfer(walletFor(c.tokenOwnerId)!, to, c.id);
      await tx.wait();
      db.prepare(`UPDATE copies SET token_owner_id = ?, token_tx = ? WHERE id = ?`).run(c.ownerId, tx.hash, c.id);
      db.prepare(`DELETE FROM settings WHERE key = 'nft_last_error'`).run();
      lastLogged = "";
    } catch (e) {
      fail(e);
    } finally {
      busy = false;
    }
  };
  setInterval(tick, intervalMs);
  tick();
  provider.getBalance(operator.address).then(
    (b) => console.log(`nft: operator ${operator.address} on ${CHAIN_NAME}, balance ${formatEther(b)} ETH`),
    fail,
  );
}
