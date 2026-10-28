// What the auditor's tests share: keys for each stage holder, signed records
// made the family's way, a package tarball, and a platform served from a map
// in place of the network (fetchImpl), with a ledger and an audit store that
// keep what is filed.
import { createHash, sign as edSign } from "node:crypto";
import { gzipSync } from "node:zlib";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonical, idFromSeed, JOB_MANIFEST_TAG, newSeed, privateKeyFromSeed, sha256 } from "../scripts/keys.mjs";

export const DEV = "https://api.dev.example";
export const PROD = "https://api.example";

/** A key per holder, made fresh for each run. */
export function keyring(names) {
  const out = {};
  for (const n of names) { const seed = newSeed(); out[n] = { seed, key: idFromSeed(seed) }; }
  return out;
}

/** A record signed under its tag, the way the package maker, the deployment
 *  manager and the conformance checker sign. */
export function signRecord(doc, tag, seed) {
  const body = { ...doc, signatures: [] };
  const { signatures, ...rest } = body;
  const sig = edSign(null, Buffer.from(`${tag}\n${canonical(rest)}`, "utf8"), privateKeyFromSeed(seed)).toString("base64");
  return { ...rest, signatures: [{ tag, by: idFromSeed(seed), sig, alg: "ed25519" }] };
}

/** A delivery manifest signed the adapter's way (base64url). */
export function signManifest(pieces, seed, extra = {}) {
  const doc = { format: "job-manifest-v1", agent: idFromSeed(seed), pieces, ...extra };
  const sig = edSign(null, Buffer.from(JOB_MANIFEST_TAG + canonical(doc), "utf8"), privateKeyFromSeed(seed)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return { ...doc, sig };
}

/** A .tar.gz of files under one root folder. */
export function makeTar(root, files) {
  const blocks = [];
  for (const [path, content] of Object.entries(files)) {
    const body = Buffer.isBuffer(content) ? content : Buffer.from(String(content), "utf8");
    const h = Buffer.alloc(512);
    h.write(`${root}/${path}`, 0, 100, "utf8");
    h.write("0000644\0", 100); h.write("0000000\0", 108); h.write("0000000\0", 116);
    h.write(body.length.toString(8).padStart(11, "0") + "\0", 124);
    h.write("00000000000\0", 136);
    h.write("        ", 148); h.write("0", 156); h.write("ustar\0", 257); h.write("00", 263);
    let sum = 0; for (const b of h) sum += b;
    h.write(sum.toString(8).padStart(6, "0") + "\0 ", 148);
    blocks.push(h, body, Buffer.alloc((512 - (body.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

/** The agent's own files, as a package lays them out. */
export function agentFiles({ version = "1.0.0", script = "export const x = 1;\n", canUse = true } = {}) {
  const descriptor = {
    format: "agent-descriptor-v1", agent_version: version,
    does: "Turns notes into a summary a person reads.",
    offerings: [{
      id: "summarize", name: "Summarize", does: "Summarizes.",
      inputs: [{ name: "notes", kind: "text/markdown", required: true, given_by: "person" }],
      outputs: [{ name: "summary", kind: "text/markdown", when: "per_task", about: "The summary." }],
      revisions: { included: { count: 1, window_days: 14 }, flat: { model: "flat", amount_micro: 0, currency: "USD" } },
    }],
    ...(canUse ? { can_use: [{ schema: "https://schemas.agentmesh.ai/style-guide/v1", reads: ["voice"], required: false, does: "sets the voice", without: "writes in its own plain voice" }] } : {}),
    refusals: "Inventing facts.", records: [{ name: "what was read", when: "per_task" }],
  };
  return {
    descriptor,
    files: {
      "agent-descriptor.json": JSON.stringify(descriptor, null, 2),
      "agent-runtime-requirements.json": JSON.stringify({ format: "agent-runtime-requirements-v1", runtimes: [{ name: "node", version: ">=22" }] }),
      "plugin.json": JSON.stringify({ name: "summarizer", version }),
      "skills/summarize/SKILL.md": "---\nname: summarize\n---\n# Summarize\n",
      "skills/summarize/scripts/run.mjs": script,
    },
  };
}

/** The served Descriptor: the package's, bound and signed by the agent's own key. */
export function boundDescriptor(draft, agent, handle) {
  return signRecord({ ...draft, subject: { id: agent.key, handle }, interaction: "service", acts_for: "organization" }, "descriptor-statement-v1", agent.seed);
}

/**
 * A platform answering from a map, with a ledger and an audit store.
 * `routes` maps "GET <url>" to {status, body, bytes?, headers?}.
 */
export function fakePlatform(routes = {}) {
  const ledger = [];
  const audits = [];
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const method = init.method ?? "GET";
    calls.push({ method, url, auth: init.headers?.authorization ?? null });
    const u = new URL(url);
    const answer = (status, body, headers = {}) => {
      const bytes = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
      return { ok: status >= 200 && status < 300, status, headers: { get: (n) => headers[n.toLowerCase()] ?? null }, text: async () => bytes.toString("utf8"), arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) };
    };
    if (u.pathname === "/v1/operator/debt" && method === "GET") {
      const against = u.searchParams.get("against");
      const items = ledger.filter((x) => x.against === against);
      return answer(200, { items, total: items.length });
    }
    if (u.pathname === "/v1/operator/debt/items" && method === "POST") {
      const b = JSON.parse(init.body);
      const item = { ...b, number: 1000 + ledger.length, state: "open" };
      ledger.push(item);
      return answer(201, { ok: true, item });
    }
    const tr = /^\/v1\/operator\/debt\/(\d+)\/transition$/.exec(u.pathname);
    if (tr && method === "POST") {
      const b = JSON.parse(init.body);
      const item = ledger.find((x) => x.number === Number(tr[1]));
      if (!item) return answer(404, { error: "no such item" });
      item.state = b.to;
      item.evidence = b.evidence;
      return answer(200, { ok: true, item });
    }
    if (u.pathname === "/v1/operator/audits" && method === "POST") {
      const b = JSON.parse(init.body);
      const d = sha256(Buffer.from(b.report, "utf8"));
      const already = audits.some((a) => a.digest === d);
      if (!already) audits.push({ digest: d, report: b.report });
      return answer(already ? 200 : 201, { ok: true, already, filed: { report_digest: d }, report_url: `${DEV}/v1/audit-reports/${d}` });
    }
    const r = routes[`${method} ${url}`];
    if (!r) return answer(404, { error: "Not found" });
    return answer(r.status ?? 200, r.bytes ?? r.body, r.headers ?? {});
  };
  return { fetchImpl, ledger, audits, calls };
}

/** A job folder with a message and attached files. */
export function jobWith(message, attach = {}) {
  const root = mkdtempSync(join(tmpdir(), "auditor-"));
  const job = join(root, "job");
  mkdirSync(job, { recursive: true });
  writeFileSync(join(job, "message.txt"), message);
  const files = [];
  for (const [name, content] of Object.entries(attach)) {
    const at = join(job, name);
    writeFileSync(at, Buffer.isBuffer(content) ? content : typeof content === "string" ? content : JSON.stringify(content));
    files.push("--file", `${at}::application/octet-stream`);
  }
  return { root, job, argv: ["--job", job, "--records", join(root, "records"), "--work", join(root, "work"), "--text-file", join(job, "message.txt"), ...files] };
}

export const hex = (bytes) => createHash("sha256").update(bytes).digest("hex");
