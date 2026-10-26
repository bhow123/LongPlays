// Usage: npm run verify-artist -- "Artist Name"
import { openDb } from "./db.js";
const name = process.argv[2];
if (!name) throw new Error('usage: npm run verify-artist -- "Artist Name"');
const r = openDb().prepare(`UPDATE artists SET verified = 1 WHERE name = ?`).run(name);
console.log(r.changes ? `verified ${name}` : `no artist called ${name} (apply from the Artist page first)`);
