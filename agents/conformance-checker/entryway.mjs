// The agent's own Descriptor, through the Common Agent entryway.
//
// Exchange 2, "Show me your descriptor" (Common Agent 0.41.0 Section 4.4): the
// agent's current Agent Descriptor, bound and signed (Section 4.9), as the
// document's exact bytes with their digest, so the caller can check what it
// received and cite the version it read. This takes those bytes and that
// digest, checks the one against the other, and refuses a mismatch, an empty
// answer, or bytes that are not a Descriptor.
//
// The exchange itself is handed in: one function, handle -> { bytes, digest }.
// The default asks the registry the agent is listed with for the Descriptor it
// serves (GET /a/<handle> for its key, then /v1/agents/<key>/descriptor) and
// takes the digest from the answer's descriptor digest header when it sends
// one, else from the bytes. That is the registry's copy and not the agent's own
// answer, and the mesh adapter has no command for exchange 2 yet; a transport
// that asks the agent passes its own function.
//
// standInFolder makes the package folder eval-gen reads from a Descriptor: its
// manifest named for the handle, the Descriptor as agent-descriptor.json
// without its signatures, and a skill per offering and step.
//
//   needs: node >= 22
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
// A script beside this one: by its name here, or by its name on a fleet host,
// where the checker is copied flat into /opt/fleet as agenteval-<name>.
const nearby = (n) => { const own = new URL(`./${n}`, import.meta.url); return existsSync(fileURLToPath(own)) ? own.href : new URL(`./agenteval-${n.replace(/^eval-/, "")}`, import.meta.url).href; };
const { pyDumps } = await import(nearby("pyjson.mjs"));

const HERE = dirname(fileURLToPath(import.meta.url));
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
export const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

/** The API address: MESH_API_BASE, or the environment file's urls.api. */
export function apiBase(env = process.env) {
  if (env.MESH_API_BASE) return env.MESH_API_BASE.replace(/\/+$/, "");
  const name = String(env.AGENTMESH_ENV || "prod").trim();
  for (const d of [env.AGENTMESH_ENV_DIR, "/opt/fleet/env", join(HERE, "..", "..", "env")]) {
    const p = join(d || "", `${name}.json`);
    if (d && existsSync(p)) return String(JSON.parse(readFileSync(p, "utf8")).urls.api).replace(/\/+$/, "");
  }
  throw new Error(`no API address for environment "${name}"`);
}

/** The default exchange: the Descriptor the registry serves for the agent. */
export async function registryExchange(handle, { base = null, fetchImpl = fetch } = {}) {
  const at = base ?? apiBase();
  const card = await (await fetchImpl(`${at}/a/${encodeURIComponent(handle)}`)).json();
  const key = card?.agent_id;
  if (!key) throw new Error(`${handle} is not registered on ${at}`);
  const r = await fetchImpl(`${at}/v1/agents/${key}/descriptor`);
  if (!r.ok) throw new Error(`the registry answered ${r.status} for ${handle}'s Descriptor`);
  const bytes = Buffer.from(await r.arrayBuffer());
  const header = r.headers?.get?.("x-descriptor-sha256") ?? r.headers?.get?.("digest") ?? null;
  return { bytes, digest: header ? (/^sha256:/.test(header) ? header : `sha256:${header}`) : sha256(bytes) };
}

/** The Descriptor through exchange 2, its digest checked against its bytes. */
export async function descriptorOfAgent(handle, { exchange = registryExchange } = {}) {
  const got = await exchange(handle);
  const bytes = Buffer.isBuffer(got?.bytes) ? got.bytes : Buffer.from(String(got?.bytes ?? ""), "utf8");
  if (!bytes.length) throw new Error(`${handle} answered exchange 2 with no Descriptor, which does not conform (Common Agent 4.4, exchange 2)`);
  const digest = String(got?.digest ?? "").trim();
  if (!digest) throw new Error(`${handle} answered exchange 2 without the digest of its Descriptor (Common Agent 4.4, exchange 2)`);
  const actual = sha256(bytes);
  if (digest.toLowerCase() !== actual) throw new Error(`the Descriptor's bytes have the digest ${actual}, and ${handle} said ${digest}`);
  let descriptor;
  try { descriptor = JSON.parse(bytes.toString("utf8")); } catch { throw new Error(`${handle}'s Descriptor is not JSON`); }
  if (!isObj(descriptor)) throw new Error(`${handle}'s Descriptor is not an object`);
  return { descriptor, digest: actual, bytes };
}

/** A stand-in package folder from a Descriptor, as derive-test.py made it. */
export function standInFolder(descriptor, handle, into) {
  const desc = { ...descriptor };
  delete desc.signatures;
  const folder = join(into, "pkg");
  mkdirSync(join(folder, "skills"), { recursive: true });
  writeFileSync(join(folder, "plugin.json"), pyDumps({ name: String(handle).split(".")[0] }));
  writeFileSync(join(folder, "agent-descriptor.json"), pyDumps(desc));
  for (const o of desc.offerings || []) {
    for (const s of [o, ...((isObj(o) && o.steps) || [])]) {
      const sid = String((isObj(s) && s.id) || "").trim();
      if (/^[A-Za-z0-9._-]{1,80}$/.test(sid)) mkdirSync(join(folder, "skills", sid), { recursive: true });
    }
  }
  return folder;
}
