// The required coder check: whether these files came from a code writer the
// operator of this builder chose to require. It is optional. A builder with no
// required coder set packs scripts from any code writer.
//
// An operator who wants every packed script traced to one code writer (their
// own, or this repository's reference code-writer) names that writer's public
// key. The trace is the delivery manifest the adapter signs on every job: each
// piece with its digest, under the delivering agent's key. A script is traced
// when a manifest signed by a required key lists a piece with exactly its
// bytes. A script somebody wrote or changed by hand has no such piece, and the
// reply says to send it through the required code writer.
//
// Nothing here judges the code. It answers one question per file: did the
// required code writer deliver these bytes.
//
//   node provenance.mjs <job-manifest.json> <required coder public key[,key...]> <file>...
//   prints one JSON object; exit 0 when every file is traced, 1 when any is
//   not, 2 when called wrong
import { createRequire } from "node:module";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const trim = (s) => String(s ?? "").trim();

/** The same tag the adapter signs with. Pinned by the adapter's conformance
 *  fixture; a different tag here would verify nothing. */
export const JOB_MANIFEST_TAG = "agentmesh-job-manifest-v1\n";

/** The adapter's own libraries, so this verifies with the same nkeys and the
 *  same canonical form the adapter signed with. On the host they sit under
 *  the installed adapter; in the repository, beside it. */
export function libs({ bases = null } = {}) {
  const tries = bases ?? [
    "/usr/lib/node_modules/mesh-adapter/node_modules/",
    join(HERE, "..", "..", "mesh-adapter", "node_modules") + "/",
  ];
  for (const base of tries) {
    if (!existsSync(join(base, "agentmesh")) || !existsSync(join(base, "nkeys.js"))) continue;
    const req = createRequire(base);
    const nk = req("nkeys.js");
    const sdk = req("agentmesh");
    return { nkeys: nk.default ?? nk, canonicalJSON: sdk.canonicalJSON };
  }
  throw new Error("the mesh-adapter's libraries are not on this host, so nothing here can verify a signature");
}

export const digestOf = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

/** Does the manifest verify under the key it names? Same check as the
 *  adapter's, written out here so the door does not import the adapter. */
export function verifyManifest(doc, { nkeys, canonicalJSON }) {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return false;
  if (doc.format !== "job-manifest-v1" || typeof doc.sig !== "string" || typeof doc.agent !== "string" || !Array.isArray(doc.pieces)) return false;
  try {
    const { sig, ...unsigned } = doc;
    const kp = nkeys.fromPublic(doc.agent);
    return kp.verify(new TextEncoder().encode(JOB_MANIFEST_TAG + canonicalJSON(unsigned)), Buffer.from(sig, "base64url"));
  } catch { return false; }
}

/** The keys the check accepts as the required coder: one, or several separated
 *  by commas, because a coder may be re-keyed and both keys are honoured
 *  for a while. */
export const officialKeys = (text) => trim(text).split(",").map(trim).filter(Boolean);

/** The verdict. Pure: the manifest as a document, the required keys, and each
 *  file as its path and bytes. */
export function traced(doc, official, files, lib) {
  const keys = Array.isArray(official) ? official : officialKeys(official);
  const verified = verifyManifest(doc, lib);
  const agent = doc?.agent ?? null;
  const agentOk = verified && keys.includes(agent);
  const pieces = verified ? doc.pieces : [];
  const out = files.map(({ path, bytes }) => {
    const digest = digestOf(bytes);
    const same = pieces.find((p) => p && p.digest === digest);
    if (same) return { path, ok: true, piece: same.name, digest };
    const named = pieces.find((p) => p && (p.name === basename(path) || String(p.path ?? "").endsWith("/" + basename(path))));
    const why = named
      ? `a piece named ${named.name} was delivered with different bytes; this file has been changed since the code writer delivered it`
      : "no piece in the delivery has these bytes";
    return { path, ok: false, why, digest };
  });
  const ok = agentOk && out.every((f) => f.ok);
  let said;
  if (!verified) said = "the delivery manifest does not verify, so nothing in it can be trusted";
  else if (!agentOk) said = `the delivery manifest is signed by ${agent}, which is not the required coder`;
  else if (ok) said = `${out.length} file${out.length === 1 ? "" : "s"} traced to the code writer's delivery`;
  else said = `${out.filter((f) => !f.ok).length} of ${out.length} file${out.length === 1 ? "" : "s"} cannot be traced to the code writer's delivery`;
  return { ok, verified, agent, agent_ok: agentOk, files: out, said };
}

/** Every file under a path: the path itself, or, for a folder, each file in it. */
export function filesUnder(p) {
  if (!existsSync(p)) return [{ path: p, missing: true }];
  if (!statSync(p).isDirectory()) return [{ path: p, bytes: readFileSync(p) }];
  const out = [];
  const walk = (d) => { for (const n of readdirSync(d).sort()) { const at = join(d, n); if (statSync(at).isDirectory()) walk(at); else out.push({ path: at, bytes: readFileSync(at) }); } };
  walk(p);
  return out;
}

export const DOOR =
  "This builder requires scripts from a named code writer. Send the code to that code writer with the spec, "
  + "and pack what it delivers with its signed manifest.";

const thisFile = process.argv[1] ? process.argv[1].replace(/\\/g, "/").split("/").pop() : "";
if (thisFile && import.meta.url.endsWith(thisFile)) {
  const [manifestPath, official, ...paths] = process.argv.slice(2);
  if (!manifestPath || !trim(official) || !paths.length) {
    console.error("usage: provenance.mjs <job-manifest.json> <required coder key[,key]> <file>...");
    process.exit(2);
  }
  try {
    let doc = null;
    try { doc = JSON.parse(readFileSync(manifestPath, "utf8")); } catch { doc = null; }
    const files = paths.flatMap(filesUnder);
    const missing = files.filter((f) => f.missing).map((f) => f.path);
    const present = files.filter((f) => !f.missing);
    const v = doc ? traced(doc, official, present, libs()) : { ok: false, verified: false, agent: null, agent_ok: false, files: present.map((f) => ({ path: f.path, ok: false, why: "there is no delivery manifest to trace it to" })), said: `there is no delivery manifest at ${manifestPath}` };
    for (const m of missing) v.files.push({ path: m, ok: false, why: "the file does not exist" });
    if (missing.length) v.ok = false;
    console.log(JSON.stringify({ ...v, door: v.ok ? undefined : DOOR }));
    process.exitCode = v.ok ? 0 : 1;
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
