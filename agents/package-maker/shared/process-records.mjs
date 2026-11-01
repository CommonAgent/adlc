// What the three process kinds share (the package maker signs a process, the
// deployment manager installs it, the conformance checker judges it): the two
// digests a process is known by, the family's way of signing a record, the
// framed prompt a brain is handed, the pieces a reply carries, and the signed
// body of a call to the platform's process-install doors.
//
// A process is an Agent Processes document (agentprocesses.ai, 0.9.2), not a
// package. Its records keep the family's tags (agent-build-record-v1,
// agent-deployment-record-v1, agent-eval-record-v1) with `kind: "process"`
// and a `process` member where an agent's record has `package`.
//
// On a fleet host this file sits flat in /opt/fleet as process-records.mjs,
// beside process-check.mjs (adlc standards/process-check.mjs). In this
// repository it finds the checker in standards/.
//
//   needs: node >= 22, nothing else; the host signer reads the mesh-adapter's
//   own nkeys.js, the way sign.mjs does
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const SPEC = "Agent Processes 0.9.2";
export const KIND = "process";
export const TAGS = Object.freeze({ build: "agent-build-record-v1", deploy: "agent-deployment-record-v1", evaluate: "agent-eval-record-v1" });
export const MEDIA = Object.freeze({
  bundle: "application/vnd.agentmesh.process-bundle+json",
  build: "application/vnd.agentmesh.process-build-record+json",
  deploy: "application/vnd.agentmesh.process-deployment-record+json",
  verdict: "application/vnd.agentmesh.conformance-verdict+json",
});
export const BUNDLE_FORMAT = "process-bundle-v1";
/** The platform's process-install doors sign over this tag (services processes/process-installs.ts). */
export const DOOR_TAG = "process-install-v1";
/** The handles each role answers at, newest name first: dev has the new names,
 *  prod the old ones until its rename (services api/agent-moves.ts). */
export const HANDLES = Object.freeze({
  package_maker: ["package-maker", "agentbuilder"],
  deployment_manager: ["deployment-manager", "deploymgr"],
  conformance_checker: ["conformance-checker", "agentevaluator"],
});

const HERE = dirname(fileURLToPath(import.meta.url));
const ADAPTER_MODULES = "/usr/lib/node_modules/mesh-adapter/node_modules/";

// ── Digests ────────────────────────────────────────────────────────────────

/** `sha256:<hex>` of a string (UTF-8) or bytes. */
export function sha256(v) {
  return `sha256:${createHash("sha256").update(typeof v === "string" ? Buffer.from(v, "utf8") : v).digest("hex")}`;
}

/** The document out of what was read, every line ending `\n`: a Markdown
 *  page's fenced block that opens with PROCESS:, or the text as it is. The
 *  checker's own documentText, which the text digest is taken over. */
export function documentText(text) {
  const t = String(text ?? "").replace(/\r\n?/g, "\n");
  if (!/^```/m.test(t)) return t;
  for (const m of t.matchAll(/^```[^\n]*\n([\s\S]*?)^```/gm)) if (/^\s*PROCESS:/.test(m[1])) return m[1];
  return t;
}

/** Whether a file's text is a process document. */
export const isProcessText = (text) => /^\s*PROCESS:/.test(documentText(text));

/** §21.1: the document with its `bindings:` block left out, the line that
 *  opens it and every line under it, up to the next line at column 0. */
export function shapeOf(text) {
  const out = [];
  let skipping = false;
  for (const line of documentText(text).split("\n")) {
    if (/^bindings:/.test(line)) { skipping = true; continue; }
    if (skipping && /^\S/.test(line)) skipping = false;
    if (!skipping) out.push(line);
  }
  return out.join("\n");
}

/** The two digests a process is known by: its text's, and its shape's, which
 *  a test case is pinned to. The checker's own shape digest is used where the
 *  checker has one, so the three agents and the test writer agree on it. */
export function digests(text, checker = null) {
  const doc = documentText(text);
  return {
    text_sha256: sha256(doc),
    shape_sha256: typeof checker?.shapeDigestOf === "function" ? checker.shapeDigestOf(doc) : sha256(shapeOf(doc)),
  };
}

/** The process check, adlc standards/process-check.mjs: beside this file on a
 *  host, else in the repository's standards/. */
export async function loadChecker(dirs = [HERE, join(HERE, ".."), join(HERE, "..", "..", "..", "standards"), join(HERE, "..", "..", "standards")]) {
  for (const d of dirs) {
    const at = join(d, "process-check.mjs");
    if (existsSync(at)) return import(pathToFileURL(at).href);
  }
  throw new Error(`the process check (process-check.mjs) is not here; looked in ${dirs.join(", ")}`);
}

/** The header facts of a document: id, version, name, owner, team and slug. */
export function headerOf(text) {
  const doc = documentText(text);
  const first = doc.split("\n").find((l) => /^\s*PROCESS:/.test(l)) ?? "";
  const id = /\bid:\s*([a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*)\s+v(\d+)\b/i.exec(first);
  const name = /^\s*PROCESS:\s*(.*?)\s{2,}id:/.exec(first)?.[1]?.trim() ?? /^\s*PROCESS:\s*(.*)$/.exec(first)?.[1]?.trim() ?? "";
  const owner = /^owner:\s*(.*?)(?:\s{2,}effective:.*)?$/m.exec(doc)?.[1]?.trim() ?? "";
  if (!id) return null;
  const [team, slug] = id[1].split("/");
  return { id: id[1], version: id[2], name, owner, team, slug };
}

// ── Test cases (§21.1) ─────────────────────────────────────────────────────

/** A test case's header: `TEST: <name>  for: <id>` and `digest: sha256:…`.
 *  Null when the text is not a test case. */
export function readCase(text) {
  const t = String(text ?? "").replace(/\r\n?/g, "\n");
  const m = /^TEST:\s*(\S+)(?:\s+for:\s*(\S+))?/m.exec(t);
  if (!m || !/^\s*TEST:/.test(t)) return null;
  const forLine = m[2] ?? /^\s*for:\s*(\S+)/m.exec(t)?.[1] ?? null;
  const digest = /^\s*digest:\s*(sha256:[0-9a-f]{64})\s*$/m.exec(t)?.[1] ?? null;
  return { name: m[1], for: forLine, digest };
}

// ── Records ────────────────────────────────────────────────────────────────

/** Canonical JSON: sorted keys, no whitespace, UTF-8 as is (the family's
 *  convention; JCS for strings, whole numbers, booleans and null). */
export function canonical(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map((x) => canonical(x === undefined ? null : x)).join(",")}]`;
  const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;
}

/** What a record's signature is over: the tag, a newline, the record without
 *  its signatures. */
export const signedText = (doc, tag) => {
  const { signatures: _s, ...body } = doc;
  return `${tag}\n${canonical(body)}`;
};

/** The record signed by `signer` ({ by, sign(text) -> base64 }). A signer that
 *  cannot sign leaves the record faithful and says so, as every builder does. */
export function signRecord(doc, tag, signer) {
  const body = { ...doc, by: signer?.by ?? doc.by ?? null, signatures: [] };
  let sig = null;
  try { sig = signer?.sign ? signer.sign(signedText(body, tag)) : null; } catch { sig = null; }
  if (sig) body.signatures = [{ tag, by: body.by, sig, alg: "ed25519" }];
  else body._unsigned = "signer unavailable; record is faithful but unsigned";
  return body;
}

/** Whether a record carries a signature of `tag` by its own `by` that
 *  verifies (`verify(key, text, sig) -> boolean`). */
export function verifyRecord(doc, tag, verify) {
  if (!doc || typeof doc !== "object") return { ok: false, why: "it is not a record" };
  const entry = (Array.isArray(doc.signatures) ? doc.signatures : []).find((s) => s?.tag === tag);
  if (!entry) return { ok: false, why: `it carries no ${tag} signature` };
  if (!entry.by || entry.by !== doc.by) return { ok: false, why: "its signature is not by the key that names itself as its signer" };
  let ok = false;
  try { ok = !!verify(entry.by, signedText(doc, tag), entry.sig); } catch { ok = false; }
  return ok ? { ok: true, by: entry.by } : { ok: false, why: "its signature does not verify" };
}

/** The signer and verifier on a fleet host: the mesh-adapter's nkeys.js and
 *  the agent's identity seed, the same key it is known by on the mesh. */
export function hostKeys(identityPath = null) {
  const require = createRequire(ADAPTER_MODULES);
  const nkeys = require("nkeys.js").default ?? require("nkeys.js");
  const verify = (key, text, sig) => nkeys.fromPublic(key).verify(new TextEncoder().encode(text), Uint8Array.from(Buffer.from(String(sig ?? ""), "base64")));
  if (!identityPath) return { verify, signer: null };
  const identity = JSON.parse(readFileSync(identityPath, "utf8"));
  const seed = String(identity.seed ?? "").trim();
  const kp = seed ? nkeys.fromSeed(new TextEncoder().encode(seed)) : null;
  const signer = kp ? { by: identity.public_key ?? kp.getPublicKey(), sign: (text) => Buffer.from(kp.sign(new TextEncoder().encode(text))).toString("base64") } : null;
  return { verify, signer };
}

// ── The platform's doors ───────────────────────────────────────────────────

/** A signed body for a process-install door: the signature is over
 *  `process-install-v1:<agent>:<ts>:<id>:<act>:<sha256 hex of the body's
 *  canonical JSON without sig>`. */
export function signedBody(body, { id, act, signer, now = new Date() }) {
  const b = { ...body, agent: signer.by, ts: now.toISOString(), act };
  delete b.sig;
  const hash = createHash("sha256").update(canonical(b), "utf8").digest("hex");
  return { ...b, sig: signer.sign(`${DOOR_TAG}:${b.agent}:${b.ts}:${id}:${act}:${hash}`) };
}

// ── The framed prompt and the reply's pieces ───────────────────────────────

/** The job folder and the attached files named in the framed prompt the fleet
 *  supervisor hands a brain (supervisor.mjs framePrompt): the `job folder:`
 *  line, and under `attached:` one path per line, its media type in brackets. */
export function promptFiles(text) {
  let jobDir = null;
  const files = [];
  let inFiles = false;
  for (const raw of String(text ?? "").split("\n")) {
    const line = raw.replace(/\s+$/, "");
    if (line.startsWith("job folder: ")) { jobDir = line.slice("job folder: ".length).split("  (")[0].trim(); continue; }
    if (line.startsWith("attached:")) { inFiles = true; continue; }
    if (!inFiles) continue;
    const s = line.trim();
    if (!s) { inFiles = false; continue; }
    if (!(s.startsWith("/") || /^[A-Za-z]:[\\/]/.test(s))) { inFiles = false; continue; }
    if (s.includes("NOT downloaded")) continue;
    files.push(s.split("  (")[0].trim());
  }
  return { jobDir, files };
}

/** The sender's own words in a framed prompt (between the markers), or the
 *  whole text when it is not framed. */
export function senderText(text) {
  const t = String(text ?? "");
  const m = /--- BEGIN SENDER MESSAGE ---\n([\s\S]*?)\n--- END SENDER MESSAGE ---/.exec(t);
  return m ? m[1] : t;
}

/** The attached files read: name (without the adapter's inbound prefix), path, text. */
export function readFiles(paths) {
  return paths.filter((p) => existsSync(p)).map((p) => ({ path: p, name: bareName(basename(p)), text: readFileSync(p, "utf8") }));
}

/** A file's name without the prefix the adapter puts on an attachment it
 *  downloads, `<n>-<8 characters>-` or `<8 characters>-`, taken off as often
 *  as it is there (pack.py sent_name: one per hop through the runner). */
export function bareName(name) {
  let n = String(name ?? "");
  for (;;) {
    const s = n.replace(/^(?:\d+-)?[A-Za-z0-9_-]{8}-(?=.)/, "");
    if (s === n) return n;
    n = s;
  }
}

/** A JSON file's content, or null. */
export function jsonOf(text) {
  try { const v = JSON.parse(text); return v && typeof v === "object" ? v : null; } catch { return null; }
}

/** Write each piece under the job folder's out/ and list them in pieces.json,
 *  the way every packaged agent hands its result on. `pieces`: [{ name, file,
 *  text | from, media_type, about }]. Returns the paths written. */
export function writePieces(jobDir, step, pieces) {
  const out = join(jobDir, "out");
  mkdirSync(out, { recursive: true });
  const entries = [];
  for (const p of pieces) {
    const at = join(out, p.file);
    if (p.from) copyFileSync(p.from, at);
    else writeFileSync(at, p.text);
    entries.push({ name: p.name, step, path: `out/${p.file}`, media_type: p.media_type, about: p.about });
  }
  writeFileSync(join(jobDir, "pieces.json"), `${JSON.stringify(entries, null, 2)}\n`);
  return entries.map((e) => e.path);
}

/** The AgentMesh environment's value at a dotted key, through env/load.cjs
 *  (AGENTMESH_ENV_DIR, beside this file, the repository, /opt/fleet/env). */
let envLib = null;
export function amEnv(key) {
  if (!envLib) {
    const dirs = [process.env.AGENTMESH_ENV_DIR, join(HERE, "env"), join(HERE, "..", "..", "..", "env"), "/opt/fleet/env", "/opt/agentmesh/env"].filter(Boolean);
    const dir = dirs.find((d) => existsSync(join(d, "load.cjs")));
    if (!dir) throw new Error(`the AgentMesh environment loader (env/load.cjs) was not found; looked in ${dirs.join(", ")}`);
    envLib = createRequire(import.meta.url)(join(dir, "load.cjs"));
  }
  return envLib.get(key);
}

/** The key a handle resolves to at the naming service, or null. */
export async function resolveKey(handle, fetchImpl = fetch) {
  try {
    const r = await fetchImpl(`${amEnv("urls.naming")}/api/resolve?handle=${encodeURIComponent(handle)}`, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) return null;
    const card = await r.json();
    for (const ep of card?.card?.endpoints ?? []) if (ep?.protocol === "agentmesh" && ep.agent_id) return String(ep.agent_id);
    return null;
  } catch { return null; }
}

/** The keys one of the platform's roles answers at: every handle it has that
 *  resolves (`<name>.<platform email>`). An operator may name them instead,
 *  comma separated, in `env` (a host with no naming service). */
export async function roleKeys(role, { platform = process.env.PLATFORM_EMAIL || "platform@agentmesh.ai", env = null, resolve = resolveKey } = {}) {
  if (env && process.env[env]) return process.env[env].split(",").map((s) => s.trim()).filter(Boolean);
  const keys = [];
  for (const n of HANDLES[role] ?? []) {
    const k = await resolve(`${n}.${platform}`);
    if (k && !keys.includes(k)) keys.push(k);
  }
  return keys;
}

/** Lines `<label>: <value>` in a message's words, by label (lowercase). */
export function labelled(text, label) {
  const re = new RegExp(`^\\s*${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:\\s*(.+?)\\s*$`, "gim");
  return [...String(text ?? "").matchAll(re)].map((m) => m[1]);
}
