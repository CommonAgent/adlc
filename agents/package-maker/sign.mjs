// Sign a deployment record the way every mesh agent signs its envelopes and
// rosters: with the agent's IDENTITY nkey (from identity.json), not the NATS
// connection credential. Uses the mesh-adapter's own bundled nkeys.js, so this
// is the same library and the same key the agent presents as its identity on
// the mesh, with no extra software installed.
//
// Usage: node sign.mjs <identity.json>   (canonical message on stdin, base64 sig out)
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

// ESM import ignores NODE_PATH, so resolve nkeys.js from the adapter's own
// node_modules explicitly. Same package the mesh-adapter signs with.
const require = createRequire("/usr/lib/node_modules/mesh-adapter/node_modules/");
const nkeys = require("nkeys.js").default ?? require("nkeys.js");

const identity = JSON.parse(readFileSync(process.argv[2], "utf8"));
const seed = String(identity.seed || "").trim();
if (!seed) { process.stderr.write("no identity seed\n"); process.exit(1); }

let message = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => { message += c; });
process.stdin.on("end", () => {
  const kp = nkeys.fromSeed(new TextEncoder().encode(seed));
  const sig = kp.sign(new TextEncoder().encode(message));
  process.stdout.write(Buffer.from(sig).toString("base64"));
});
