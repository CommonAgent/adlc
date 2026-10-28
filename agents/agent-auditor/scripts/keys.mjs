// Keys, canonical JSON, digests and signatures, with node's own crypto and
// nothing installed.
//
// Every record the auditor checks is signed the family's way: Ed25519, by an
// nkey, over an ASCII tag, one newline, and the RFC 8785 canonical JSON of the
// document without its signatures (Common Agent 6.6 and 8.1). A delivery
// manifest is the same with its own tag and a base64url signature in `sig`.
// The audit report is signed by the auditor's own key over its tag and the
// report's text without its `signature:` line.
//
// The nkey and canonical helpers are copied from AgentMesh
// conformance/lib/envelope-vectors.mjs (the suite's reference rule), so a
// signature this file accepts is one the platform's reference accepts.
//
//   needs: node >= 22
//   import { verifyDoc, verifyManifest, signReport, ... } from "./keys.mjs"
import { createHash, randomBytes, createPrivateKey, createPublicKey, sign as edSign, verify as edVerify } from "node:crypto";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Decode(s) {
  let bits = 0, value = 0;
  const out = [];
  for (const ch of s) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error("not base32");
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Uint8Array.from(out);
}

function base32Encode(raw) {
  let bits = 0, value = 0, out = "";
  for (const b of raw) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function crc16(bytes) {
  let crc = 0;
  for (const b of bytes) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}

function checked(raw, what) {
  const body = raw.subarray(0, raw.length - 2);
  const want = raw[raw.length - 2] | (raw[raw.length - 1] << 8);
  if (crc16(body) !== want) throw new Error(`${what} fails its checksum`);
  return body;
}

/** The Ed25519 private key inside an nkey seed (`S...`). */
export function privateKeyFromSeed(seed) {
  const raw = base32Decode(String(seed).trim());
  if (raw.length !== 36) throw new Error("an nkey seed decodes to 36 bytes");
  const body = checked(raw, "seed");
  const pkcs8 = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(body.subarray(2))]);
  return createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" });
}

/** The Ed25519 public key named by an nkey public key (`U...`, `A...`). */
export function publicKeyFromId(id) {
  const raw = base32Decode(String(id).trim());
  if (raw.length !== 35) throw new Error("an nkey public key decodes to 35 bytes");
  const body = checked(raw, "public key");
  const spki = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(body.subarray(1))]);
  return createPublicKey({ key: spki, format: "der", type: "spki" });
}

/** The agent key (`U...`) for a seed. */
export function idFromSeed(seed) {
  const pub = createPublicKey(privateKeyFromSeed(seed)).export({ format: "der", type: "spki" }).subarray(12);
  const body = Buffer.concat([Buffer.from([20 << 3]), pub]);
  const crc = crc16(body);
  return base32Encode(Buffer.concat([body, Buffer.from([crc & 0xff, crc >> 8])]));
}

/** A new user seed (`SU...`), for tests and for making the auditor's key once. */
export function newSeed(random = randomBytes) {
  const body = Buffer.concat([Buffer.from([(18 << 3) | ((20 << 3) >> 5), ((20 << 3) & 31) << 3]), Buffer.from(random(32))]);
  const crc = crc16(body);
  return base32Encode(Buffer.concat([body, Buffer.from([crc & 0xff, crc >> 8])]));
}

/** RFC 8785 canonical JSON for the value shapes records use. */
export function canonical(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("NaN and Infinity are not JSON");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object") {
    const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
  }
  throw new Error(`cannot canonicalize a ${typeof value}`);
}

export const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const unb64 = (s) => Buffer.from(String(s).replace(/-/g, "+").replace(/_/g, "/"), "base64");

/** Ed25519 by `key` over `bytes`; false on anything malformed. */
export function verifyBytes(key, bytes, sig) {
  try { return edVerify(null, Buffer.from(bytes), publicKeyFromId(key), unb64(sig)); } catch { return false; }
}

/** A signed record or Descriptor: each signature with whether it verifies.
 *  [{tag, by, verifies}] */
export function verifyDoc(doc) {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return [];
  const { signatures, _unsigned, ...rest } = doc;
  let body;
  try { body = canonical(rest); } catch { return []; }
  return (Array.isArray(signatures) ? signatures : []).map((s) => ({
    tag: String(s?.tag ?? ""),
    by: String(s?.by ?? ""),
    verifies: Boolean(s?.sig) && verifyBytes(String(s?.by ?? ""), Buffer.from(`${s?.tag}\n${body}`, "utf8"), s.sig),
  }));
}

/** The adapter's job manifest tag (pinned by the adapter's conformance fixture). */
export const JOB_MANIFEST_TAG = "agentmesh-job-manifest-v1\n";

/** Whether a delivery manifest verifies under the key it names. */
export function verifyManifest(doc) {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return false;
  if (doc.format !== "job-manifest-v1" || typeof doc.sig !== "string" || typeof doc.agent !== "string" || !Array.isArray(doc.pieces)) return false;
  const { sig, ...unsigned } = doc;
  try { return verifyBytes(doc.agent, Buffer.from(JOB_MANIFEST_TAG + canonical(unsigned), "utf8"), sig); } catch { return false; }
}

/** The audit report's tag. */
export const REPORT_TAG = "agent-audit-report-v1\n";

/** The text a report's signature covers: the report without its `signature:` line. */
export const signedText = (text) => String(text).replace(/^signature:[^\n]*\n/m, "");

/** The report's signature, base64, by the seed. */
export function signReport(text, seed) {
  return edSign(null, Buffer.from(REPORT_TAG + signedText(text), "utf8"), privateKeyFromSeed(seed)).toString("base64");
}

/** Whether a report's signature verifies by `key`. */
export function verifyReport(text, key, sig) {
  return verifyBytes(key, Buffer.from(REPORT_TAG + signedText(text), "utf8"), sig);
}
