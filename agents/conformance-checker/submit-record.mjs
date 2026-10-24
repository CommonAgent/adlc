#!/usr/bin/env node
// Submit a signed agent-eval-record-v1 to the registry over the mesh.
//
// Usage: node submit-record.mjs <record.json> <identity.json>
//        (env MESH_CREDS_FILE for the connection credential)
//
// Two keys are in play and they are different on the fleet: the CREDS user
// authenticates the connection, and the IDENTITY key is the one that signed
// the record and must therefore be the envelope sender, because the
// registry's put gate requires the signature to be BY the sender. The SDK
// is loaded out of the installed adapter's own modules: this box carries no
// node_modules of its own.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { createRequire as amCreateRequire } from "node:module";
import { existsSync as amExists } from "node:fs";
import { dirname as amDirname, join as amJoin } from "node:path";
import { fileURLToPath as amFileURLToPath } from "node:url";

// The AgentMesh environment (env/<AGENTMESH_ENV>.json, default prod) through
// env/load.cjs. This file is copied flat onto hosts, so the loader is looked
// for in AGENTMESH_ENV_DIR, in the repository, beside this file, in
// /opt/fleet/env or /opt/agentmesh/env, then in an env/ above the working
// directory; not finding it is an error that names every place looked.
let amEnvLib;
function amEnv(key) {
  if (!amEnvLib) {
    const here = amDirname(amFileURLToPath(import.meta.url));
    const dirs = [process.env.AGENTMESH_ENV_DIR, amJoin(here, "../../env"), amJoin(here, "env"), "/opt/fleet/env", "/opt/agentmesh/env"].filter(Boolean);
    for (let d = process.cwd(); ; d = amDirname(d)) { dirs.push(amJoin(d, "env")); if (amDirname(d) === d) break; }
    const dir = dirs.find((d) => amExists(amJoin(d, "load.cjs")));
    if (!dir) throw new Error(`the AgentMesh environment loader (env/load.cjs) was not found; looked in ${dirs.join(", ")}`);
    amEnvLib = amCreateRequire(import.meta.url)(amJoin(dir, "load.cjs"));
  }
  return amEnvLib.get(key);
}

const recordPath = process.argv[2];
const identityPath = process.argv[3];
if (!recordPath || !identityPath) {
  console.error("usage: submit-record.mjs <record.json> <identity.json>");
  process.exit(2);
}
const credsPath = process.env.MESH_CREDS_FILE;
if (!credsPath) {
  console.error("submit-record: MESH_CREDS_FILE is not set");
  process.exit(2);
}

const creds = readFileSync(credsPath, "utf8");
const jwt = creds.match(/-----BEGIN NATS USER JWT-----\s*(\S+)/)?.[1];
const seed = creds.match(/-----BEGIN USER NKEY SEED-----\s*([A-Z2-7]+)/)?.[1];
if (!jwt || !seed) {
  console.error("submit-record: the creds file carries no JWT or no seed");
  process.exit(2);
}

const require = createRequire("/usr/lib/node_modules/mesh-adapter/node_modules/");
// The SDK is `agent-messaging` from adapter 0.99.3, `agentmesh` before it.
const sdkPath = (() => {
  try { return require.resolve("agent-messaging"); } catch { return require.resolve("agentmesh"); }
})();
const { AgentMesh, jwtAuthenticator } = await import(pathToFileURL(sdkPath).href);

const bytes = readFileSync(recordPath);
const identity = JSON.parse(readFileSync(identityPath, "utf8"));
const identitySeed = String(identity.seed ?? "").trim();
if (!identitySeed) {
  console.error("submit-record: identity.json carries no seed");
  process.exit(2);
}
const mesh = await AgentMesh.connect(process.env.MESH_URL ?? amEnv("broker.wss"), {
  authenticator: jwtAuthenticator(jwt, new TextEncoder().encode(seed)),
  // The identity key signed the record, so it must be the envelope sender
  // the put gate checks the signature against. The creds only authenticate
  // the connection.
  nkeySeed: new TextEncoder().encode(identitySeed),
});
try {
  const out = await mesh.serviceRequest(
    "mesh.registry.eval.put",
    { record: Buffer.from(bytes).toString("base64") },
    15000,
  );
  console.log(JSON.stringify(out));
} finally {
  await mesh.close().catch(() => {});
}
