// Sign a deployment record the way every mesh agent signs its envelopes and
// rosters: with the agent's IDENTITY nkey (from identity.json), not the NATS
// connection credential. Uses the mesh-adapter's own bundled nkeys.js, so this
// is the same library and the same key the agent presents as its identity on
// the mesh, with no extra software installed.
//
// Usage: node sign.mjs <identity.json>   (canonical message on stdin, base64 sig out)
//        node sign.mjs --verify <public key> <sig>
//            (message on stdin; exit 0 when the sig, base64 or base64url,
//             verifies under the key, 1 when it does not). Used before the
//             deploy adds to a document someone else signed, such as the
//             owner's allowance, so a document that fails is never re-signed.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

// ESM import ignores NODE_PATH, so resolve nkeys.js from the adapter's own
// node_modules explicitly. Same package the mesh-adapter signs with.
const require = createRequire("/usr/lib/node_modules/mesh-adapter/node_modules/");
const nkeys = require("nkeys.js").default ?? require("nkeys.js");

const verifying = process.argv[2] === "--verify";
let seed = "";
if (!verifying) {
  const identity = JSON.parse(readFileSync(process.argv[2], "utf8"));
  seed = String(identity.seed || "").trim();
  if (!seed) { process.stderr.write("no identity seed\n"); process.exit(1); }
}

let message = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => { message += c; });
process.stdin.on("end", () => {
  if (verifying) {
    try {
      const kp = nkeys.fromPublic(String(process.argv[3] ?? ""));
      const sig = new Uint8Array(Buffer.from(String(process.argv[4] ?? ""), "base64"));
      process.exit(kp.verify(new TextEncoder().encode(message), sig) ? 0 : 1);
    } catch { process.exit(1); }
  }
  const kp = nkeys.fromSeed(new TextEncoder().encode(seed));
  const sig = kp.sign(new TextEncoder().encode(message));
  process.stdout.write(Buffer.from(sig).toString("base64"));
});
