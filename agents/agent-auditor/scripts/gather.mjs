// Gather what the audit reads: the agent as it runs on dev and on prod, the
// deploy queue's signed records, the package, the attached records, and the
// keys of each stage's holders. Nothing is judged here; stages.mjs and
// checks.mjs judge. Every read that fails is kept with its reason.
//
//   needs: node >= 22
//   import { gather } from "./gather.mjs"
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonical, sha256 } from "./keys.mjs";
import { readPackage } from "./tar.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const trim = (s) => String(s ?? "").trim();
const hexOf = (d) => trim(d).toLowerCase().replace(/^sha256:/, "");

/** The stage holders' handles (references/stage-holders.json). */
export function holderHandles(path = null) {
  const tries = path ? [path] : [join(HERE, "..", "references", "stage-holders.json"), join(HERE, "stage-holders.json")];
  for (const p of tries) { try { return JSON.parse(readFileSync(p, "utf8")).stages; } catch { /* next */ } }
  throw new Error("references/stage-holders.json is not beside the scripts");
}

/** A semantic version compared to another: negative, zero, positive. */
export function versionOrder(a, b) {
  const pa = trim(a).split(/[.+-]/).map((x) => (/^\d+$/.test(x) ? Number(x) : x));
  const pb = trim(b).split(/[.+-]/).map((x) => (/^\d+$/.test(x) ? Number(x) : x));
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0, y = pb[i] ?? 0;
    if (x === y) continue;
    if (typeof x === "number" && typeof y === "number") return x - y;
    return String(x) < String(y) ? -1 : 1;
  }
  return 0;
}

async function readAgent(p, handle) {
  const out = { origin: p.root, handle, key: null, storefront: null, descriptor: null, agentdoc: null, evalRecord: null };
  const sf = await p.storefront(handle);
  out.storefront = { ok: sf.ok, status: sf.status, at: sf.at, url: sf.url, error: sf.error, body: sf.ok ? sf.body : null };
  if (!sf.ok) return out;
  out.key = trim(sf.body?.agent_id) || null;
  if (!out.key) return out;
  const d = await p.descriptor(out.key);
  let doc = null;
  if (d.ok) { try { doc = JSON.parse(d.bytes.toString("utf8")); } catch { doc = null; } }
  out.descriptor = {
    ok: d.ok && Boolean(doc), status: d.status, at: d.at, url: d.url, error: d.ok && !doc ? "the Descriptor door answered bytes that are not JSON" : d.error,
    doc, bytes_digest: d.ok ? sha256(d.bytes) : null, door_digest: trim(d.header("x-descriptor-digest")) || null,
  };
  const ad = await p.agentdoc(handle);
  out.agentdoc = { ok: ad.ok, status: ad.status, at: ad.at, url: ad.url, error: ad.error, doc: ad.ok ? ad.body : null };
  const ev = await p.evalRecord(out.key);
  out.evalRecord = { ok: ev.ok, status: ev.status, at: ev.at, url: ev.url, error: ev.error, doc: ev.ok ? ev.body : null };
  return out;
}

/** Which package is audited: the digest asked for, or the version asked for,
 *  or the version dev serves; matched against the deploy queue and the
 *  attached package. */
export function pickTarget({ asked, requests, devVersion, attachedPackages }) {
  const wantHex = hexOf(asked.digest);
  if (wantHex) {
    const r = requests.find((x) => hexOf(x.package?.sha256) === wantHex);
    return { digest: `sha256:${wantHex}`, version: asked.version || trim(r?.package?.version) || null, request: r ?? null, how: "the package digest the message names" };
  }
  const version = asked.version || devVersion || null;
  const how = asked.version ? "the version the message names" : devVersion ? "the version the agent serves on dev" : "";
  if (version) {
    const rs = requests.filter((x) => trim(x.package?.version) === version);
    const deployed = rs.find((x) => x.status === "deployed") ?? rs[0] ?? null;
    if (deployed?.package?.sha256) return { digest: `sha256:${hexOf(deployed.package.sha256)}`, version, request: deployed, how: `${how}, ${version}, and the deploy request that filed it` };
    const pkg = attachedPackages.find((p) => p.version === version) ?? (attachedPackages.length === 1 ? attachedPackages[0] : null);
    if (pkg) return { digest: pkg.digest, version, request: null, how: `${how}, ${version}, and the package attached` };
    return { digest: null, version, request: null, how: `${how}, ${version}; no package for it is on record` };
  }
  return { digest: null, version: null, request: null, how: "no version was named and dev serves none" };
}

/** Everything the audit reads. */
export async function gather({ asked, attached, dev, prod = null, holders = holderHandles(), now = new Date() }) {
  const notes = [];
  const handle = asked.handle;
  const devAgent = await readAgent(dev, handle);
  const prodAgent = prod && prod.root ? await readAgent(prod, handle) : null;
  if (!prodAgent) notes.push({ wanted: "the prod origin (PROD_API_BASE)", did: "read the agent on dev only, and said nothing about the version prod runs" });

  // The deploy queue's signed records, through the auditor's key.
  const queue = { read: false, why: "", requests: [] };
  if (!dev.hasToken) queue.why = "this host binds no audit key (AUDIT_TOKEN), so the deploy queue's signed build and deployment records could not be read";
  else {
    const pkgName = trim(devAgent.descriptor?.doc?.subject?.handle || handle).split(".")[0];
    const r = await dev.stageRecords({ agent: devAgent.key ?? handle, pkg: pkgName });
    if (r.ok && Array.isArray(r.body?.requests)) { queue.read = true; queue.requests = r.body.requests; queue.url = r.url; queue.at = r.at; }
    else queue.why = `the deploy queue's records could not be read (${r.error})`;
  }
  if (!queue.read) notes.push({ wanted: "the deploy queue's signed records", did: "checked the build and deployment records only from what was attached", why: queue.why });

  // Attached packages, read.
  const attachedPackages = [];
  for (const p of attached.packages) {
    try {
      const pkg = readPackage(p.bytes);
      let version = null;
      try { version = JSON.parse(pkg.files.get("agent-descriptor.json")?.toString("utf8") ?? "{}").agent_version ?? null; } catch { /* none */ }
      attachedPackages.push({ name: p.name, digest: sha256(p.bytes), files: pkg.files, root: pkg.root, version, source: "attached" });
    } catch (e) { notes.push({ wanted: `the attached package ${p.name}`, did: "audited without it", why: e.message }); }
  }

  const devVersion = trim(devAgent.descriptor?.doc?.agent_version) || null;
  const target = pickTarget({ asked, requests: queue.requests, devVersion, attachedPackages });

  // The package's bytes: attached, or from the request that filed it.
  let pkg = attachedPackages.find((p) => target.digest && p.digest === target.digest) ?? null;
  if (!pkg && target.request?.id && target.digest) {
    const r = await dev.packageBytes(target.request.id);
    if (r.ok && r.bytes?.length) {
      const got = sha256(r.bytes);
      if (got !== target.digest) notes.push({ wanted: "the package bytes the deploy request filed", did: "audited without them", why: `the bytes served for request ${target.request.id} hash to ${got}, not ${target.digest}` });
      else {
        try { const p = readPackage(r.bytes); pkg = { name: `${target.request.id}/package.tar.gz`, digest: got, files: p.files, root: p.root, source: r.url }; }
        catch (e) { notes.push({ wanted: "the package bytes", did: "audited without them", why: e.message }); }
      }
    } else notes.push({ wanted: "the package bytes", did: "audited without them, so the design-time checks read the served Descriptor only", why: r.error });
  }
  if (pkg) {
    pkg.digests = new Map([...pkg.files].map(([path, bytes]) => [sha256(bytes), path]));
    try { pkg.descriptor = JSON.parse(pkg.files.get("agent-descriptor.json")?.toString("utf8") ?? "null"); } catch { pkg.descriptor = null; }
  }

  // When the agent was first released: the earliest of its requests in this
  // environment's deploy queue and its listing on each environment read. An
  // agent new to dev may have run on prod for months; the earliest date wins.
  const listed = (a) => trim(a?.storefront?.body?.card?.listing?.created_at);
  const filed = [...queue.requests.map((r) => trim(r.decided_at || r.filed_at)), listed(devAgent), listed(prodAgent)]
    .filter((x) => Number.isFinite(Date.parse(x))).sort((a, b) => Date.parse(a) - Date.parse(b));
  const firstReleased = filed[0] ?? null;

  // Each stage holder's keys, resolved on dev and prod.
  const holderKeys = {};
  const seen = new Map();
  const keyOf = async (p, h) => {
    const k = `${p.root} ${h}`;
    if (!seen.has(k)) seen.set(k, p.storefront(h).then((r) => (r.ok ? trim(r.body?.agent_id) || null : null)));
    return seen.get(k);
  };
  for (const [stage, s] of Object.entries(holders)) {
    const keys = [];
    for (const h of s.holders ?? []) {
      for (const p of [dev, prod].filter((x) => x && x.root)) {
        const k = await keyOf(p, h);
        if (k && !keys.some((x) => x.key === k)) keys.push({ key: k, handle: h, origin: p.root });
      }
    }
    holderKeys[stage] = keys;
  }

  return {
    handle, asked, now: now.toISOString(),
    dev: devAgent, prod: prodAgent, queue, target, pkg, firstReleased,
    attached, holders, holderKeys, notes,
    devVersion, prodVersion: trim(prodAgent?.descriptor?.doc?.agent_version) || null,
    canonicalDigest: (doc) => sha256(Buffer.from(canonical(doc), "utf8")),
  };
}
