// Compiles contracts/OwnMusicCopies.sol into contracts/OwnMusicCopies.json (ABI + bytecode).
// The JSON is committed, so the server never needs the compiler. Run: npm run contract:compile
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const solc = require("solc");
const file = "OwnMusicCopies.sol";
const input = {
  language: "Solidity",
  sources: { [file]: { content: fs.readFileSync(path.resolve("contracts", file), "utf8") } },
  settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "paris", outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } },
};
const findImports = (p: string) => {
  try {
    return { contents: fs.readFileSync(require.resolve(p), "utf8") };
  } catch {
    return { error: `not found: ${p}` };
  }
};
const out = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));
const errors = (out.errors ?? []).filter((e: { severity: string }) => e.severity === "error");
if (errors.length) {
  for (const e of errors) console.error(e.formattedMessage);
  process.exit(1);
}
const c = out.contracts[file].OwnMusicCopies;
fs.writeFileSync(
  path.resolve("contracts", "OwnMusicCopies.json"),
  JSON.stringify({ compiler: solc.version(), abi: c.abi, bytecode: `0x${c.evm.bytecode.object}` }, null, 2) + "\n",
);
console.log("compiled", solc.version());
