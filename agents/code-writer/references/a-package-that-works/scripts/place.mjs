// Put the files where a person can open them, then go and look.
//   needs: node >= 22
//
// Two steps live here because they are two claims. Placing says "I sent these
// bytes and the host took them". Reading back says "and what is served at that
// address now is those bytes". The second is the one worth having, and it is
// the one almost nothing does: an upload that returns 200 and an address that
// serves the wrong thing is a normal Tuesday with a cache in the way.
//
// The House Stack's draft-host is brokered: an agent holds no storage key.
// For each file it asks the mesh for a link that writes that one file, good for
// ten minutes, under the agent's own private folder of drafts, and the mesh
// refuses when the agent is stopped.
import { createHash, createPrivateKey, sign } from "node:crypto";
import { extname } from "node:path";

const trim = (t) => String(t ?? "").trim();
export const sha = (b) => createHash("sha256").update(b).digest("hex");

export const API_DEFAULT = "https://api.agentmesh.ai/v1";

// A minute, so a republish shows up quickly and nothing has to be invalidated
// by hand. Long enough that a page being read is not refetched on every hop.
export const CACHE = "public, max-age=60";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const B32_MAP = Object.fromEntries([...B32].map((c, i) => [c, i]));

/** Decode RFC 4648 base32 without padding. */
export function base32Decode(str) {
  let bits = 0, value = 0;
  const out = [];
  for (const c of String(str ?? "").toUpperCase()) {
    if (c === "=" || c === " " || c === "\n" || c === "\r") continue;
    const v = B32_MAP[c];
    if (v === undefined) throw new Error(`invalid base32 character: ${c}`);
    value = (value << 5) | v;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** The job credential from the environment. */
export function jobCredentialOf(env = {}) {
  const jwt = trim(env.MESH_JOB_JWT);
  if (!jwt) throw new Error("MESH_JOB_JWT is required");
  const seed = trim(env.MESH_JOB_NKEY_SEED);
  if (!seed) throw new Error("MESH_JOB_NKEY_SEED is required");
  const api = trim(env.MESH_API_BASE) || API_DEFAULT;
  return { api, jwt, seed };
}

/** The canonical text signed for the broker. */
export function askCanonical({ ts, worker, object }) {
  return `mesh-stack-cred-job-v1:${ts}:${worker}:draft-host:${object}`;
}

/** The request body for asking the broker for a stack credential. */
export function askBody({ env = {}, object, now = Date.now }) {
  const cred = jobCredentialOf(env);
  const parts = cred.jwt.split(".");
  if (parts.length < 2) throw new Error("invalid MESH_JOB_JWT format");
  const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  const worker = payload.sub;
  if (!worker) throw new Error("no sub in MESH_JOB_JWT");

  const ts = Math.floor((typeof now === "function" ? now() : now) / 1000);
  const text = askCanonical({ ts, worker, object });

  const decoded = base32Decode(cred.seed);
  const raw32 = decoded.subarray(2, 34);
  const privKey = createPrivateKey({
    key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), raw32]),
    format: "der",
    type: "pkcs8",
  });
  const sig = sign(null, Buffer.from(text), privKey).toString("base64");

  return {
    job_jwt: cred.jwt,
    system: "draft-host",
    object,
    ts,
    sig,
  };
}

/** Folder name for a draft, based on the first file's settled name without extension. */
export function folderFor(fileName) {
  const ext = extname(fileName);
  return ext ? fileName.slice(0, -ext.length) : fileName;
}

/** Place one file through the broker. */
export async function placeOne({ env, object, name, bytes, type, fetchImpl = fetch }) {
  const body = askBody({ env, object });
  const cred = jobCredentialOf(env);
  const api = cred.api.replace(/\/+$/, "");
  const askUrl = `${api}/stack-credential`;

  let res = await fetchImpl(askUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (res.status === 503) {
    res = await fetchImpl(askUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  if (!res.ok) {
    let doc = null;
    try { doc = await res.json(); } catch {
      const text = await res.text().catch(() => "");
      try { doc = JSON.parse(text); } catch { doc = { error: text }; }
    }
    const errorMsg = trim(doc?.error) || `the broker answered ${res.status}`;
    const isStopped = res.status === 403 && (
      doc?.code === "agent_paused" ||
      doc?.code === "agent_terminated" ||
      /agent is paused|agent is terminated|agent is stopped|stopped/i.test(errorMsg)
    );
    const err = new Error(errorMsg);
    if (isStopped) err.stopped = true;
    err.status = res.status;
    err.code = doc?.code;
    throw err;
  }

  const doc = await res.json();
  const credential = doc?.credential;
  if (!credential || !credential.url) {
    throw new Error("broker returned no upload credential");
  }

  const putRes = await fetchImpl(credential.url, {
    method: credential.method || "PUT",
    headers: credential.headers || { "content-type": type },
    body: bytes,
  });

  if (!putRes.ok) {
    const said = (await putRes.text().catch(() => "")).slice(0, 200);
    throw new Error(`${name} was not placed: storage answered ${putRes.status}${said ? `, ${said}` : ""}`);
  }

  const address = credential.read_url || credential.public_url;
  return {
    name,
    object,
    address,
    type,
    bytes: bytes.length,
    sha256: sha(bytes),
    at: new Date().toISOString(),
    read_url: credential.read_url,
    public_url: credential.public_url,
  };
}

/** Read an address back and say whether it serves what was placed.
 *
 *  `ok` false is not an error to throw on. A file that went up and is not
 *  being served yet is a thing the person needs told about, in the same reply
 *  as the ones that are fine, so it travels as a result rather than a stop. */
export async function readBack({ url, placed, fetchImpl = fetch }) {
  const address = placed?.address || (url ? (url.endsWith("/") ? `${url}${placed.name}` : url) : "");
  let res;
  try { res = await fetchImpl(address, { redirect: "follow" }); }
  catch (e) { return { ...placed, address, ok: false, why: `the address could not be reached: ${trim(e?.message) || e}` }; }
  if (!res.ok) return { ...placed, address, ok: false, why: `the address answered ${res.status}` };
  const got = Buffer.from(await res.arrayBuffer());
  const served = sha(got);
  if (served !== placed.sha256) {
    return { ...placed, address, ok: false, served_sha256: served,
      why: `the address serves ${got.length} bytes that hash to ${served.slice(0, 12)}, and what went up hashes to ${placed.sha256.slice(0, 12)}` };
  }
  return { ...placed, address, ok: true, served_sha256: served };
}
