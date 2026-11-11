// The derive-test offering: show the test without running it.
//
// Given a package (the .tar.gz handed to the job), this derives the cases the
// conformance check would run against an agent installed from it, with
// eval-gen, and hands them back as the derived test. Nothing is sent to any
// agent and nothing is signed: it is the test, shown.
//
// Without a package, a handle named in the request (name.owner@domain) is read
// instead: the Descriptor the agent serves through the entryway (entryway.mjs)
// stands in for the package's, and its offerings' steps for the package's
// skills. The reply says which was read.
//
// This is derive-test.py written in node, output for output.
//
//   needs: node >= 22
//   node derive-test.mjs [--job <job folder>] [--prompt <the request's words>]
//   The job folder's files are searched for the package; its out/ receives
//   derived-test.json, listed in pieces.json, so the reply carries it as a
//   file. Prints the reply's words (Markdown).
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, sep } from "node:path";
import { gunzipSync } from "node:zlib";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve as resolvePath } from "node:path";
// A script beside this one: by its name here, or by its name on a fleet host,
// where the checker is copied flat into /opt/fleet as agenteval-<name>.
const nearby = (n) => { const own = new URL(`./${n}`, import.meta.url); return existsSync(fileURLToPath(own)) ? own.href : new URL(`./agenteval-${n.replace(/^eval-/, "")}`, import.meta.url).href; };
const { evalOf } = await import(nearby("eval-gen.mjs"));
const { descriptorOfAgent, standInFolder } = await import(nearby("entryway.mjs"));
const { pyDumps } = await import(nearby("pyjson.mjs"));

const HANDLE = /\b[a-z0-9][a-z0-9._-]*\.[a-z0-9._-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i;
const MEDIA = "application/vnd.agentmesh.conformance-test+json";
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** The first .tar.gz or .tgz among the job's files, or null, in os.walk's
 *  order, out/ left out. */
export function findPackage(job) {
  if (!job || !existsSync(job) || !statSync(job).isDirectory()) return null;
  const visit = (dir) => {
    if (relative(job, dir).split(sep)[0] === "out") return null;
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const f of entries.filter((e) => !e.isDirectory()).map((e) => e.name).sort(cmp)) {
      if (f.endsWith(".tar.gz") || f.endsWith(".tgz")) return join(dir, f);
    }
    for (const d of entries.filter((e) => e.isDirectory()).map((e) => e.name)) {
      const hit = visit(join(dir, d));
      if (hit) return hit;
    }
    return null;
  };
  return visit(job);
}

const field = (h, at, len) => h.subarray(at, at + len).toString("utf8").replace(/\0.*$/s, "");
const octal = (h, at, len) => parseInt(field(h, at, len).trim() || "0", 8);

/** The files of a gzipped tar, plain files and folders only: anything else
 *  (a link, a device, an absolute path, a "..") is refused, as tarfile's
 *  "data" filter refuses it. Pax and GNU long names are read. */
export function untar(bytes) {
  const tar = gunzipSync(bytes);
  const out = [];
  let at = 0;
  let longName = null;
  while (at + 512 <= tar.length) {
    const h = tar.subarray(at, at + 512);
    if (h.every((b) => b === 0)) break;
    const size = octal(h, 124, 12);
    const type = String.fromCharCode(h[156] || 48);
    const body = tar.subarray(at + 512, at + 512 + size);
    at += 512 + Math.ceil(size / 512) * 512;
    if (type === "x") { const m = /\d+ path=([^\n]*)\n/.exec(body.toString("utf8")); longName = m ? m[1] : longName; continue; }
    if (type === "L") { longName = body.toString("utf8").replace(/\0.*$/s, ""); continue; }
    if (type === "g") continue;
    const prefix = field(h, 345, 155);
    let name = longName ?? (prefix ? `${prefix}/${field(h, 0, 100)}` : field(h, 0, 100));
    longName = null;
    name = name.replace(/\/+$/, "");
    if (!["0", "\0", "5"].includes(type) || name.startsWith("/") || name.split("/").includes("..")) {
      throw new Error(`the package holds '${name}', which is not a plain file`);
    }
    if (name && name !== ".") out.push({ name, dir: type === "5", body: type === "5" ? null : body });
  }
  return out;
}

/** The package folder (the one holding plugin.json) inside the archive. */
export function unpack(archive, into) {
  for (const f of untar(readFileSync(archive))) {
    const p = join(into, ...f.name.split("/"));
    if (f.dir) mkdirSync(p, { recursive: true });
    else { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, f.body); }
  }
  const find = (dir) => {
    const entries = readdirSync(dir, { withFileTypes: true });
    if (entries.some((e) => !e.isDirectory() && e.name === "plugin.json")) return dir;
    for (const e of entries.filter((x) => x.isDirectory())) { const hit = find(join(dir, e.name)); if (hit) return hit; }
    return null;
  };
  const root = existsSync(into) ? find(into) : null;
  if (!root) throw new Error("the archive holds no plugin.json, so it is not an Agent Package");
  return root;
}

/** A stand-in package folder from the agent's own Descriptor. */
export async function fromAgent(handle, into, { exchange } = {}) {
  const got = await descriptorOfAgent(handle, exchange ? { exchange } : {});
  return [standInFolder(got.descriptor, handle, into), got.descriptor.agent_version, got.digest];
}

export async function derive(job = null, prompt = "", { agent = fromAgent } = {}) {
  const tmp = mkdtempSync(join(tmpdir(), "derive-test-"));
  try {
    const archive = findPackage(job);
    let folder; let source; let digest = null;
    if (archive) {
      folder = unpack(archive, join(tmp, "unpacked"));
      source = `the package ${basename(archive)}`;
    } else {
      const m = HANDLE.exec(prompt || "");
      if (!m) return [null, "I derive the test from a package. Attach the agent's package (.tar.gz), or name an agent (name.owner@domain) and I will derive it from the Descriptor the registry serves for it."];
      let version;
      [folder, version, digest] = await agent(m[0], tmp);
      source = `the Descriptor the registry serves for ${m[0]}${version ? ` (version ${version})` : ""}`;
    }
    const spec = evalOf(folder);
    spec.derived_from = source;
    if (digest) spec.descriptor_sha256 = digest;
    return [spec, null];
  } catch (e) {
    return [null, `I could not derive the test: ${String(e?.message ?? e).slice(0, 300)}`];
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

export function words(spec) {
  const kinds = {};
  for (const c of spec.cases) kinds[c.kind] = (kinds[c.kind] ?? 0) + 1;
  const out = [`## The test for ${spec.agent}`, "",
    `Derived from ${spec.derived_from}. Nothing was sent to the agent; this is the test, shown.`, "",
    `${spec.cases.length} cases: ${Object.entries(kinds).sort(([a], [b]) => cmp(a, b)).map(([k, n]) => `${n} ${k}`).join(", ")}.`, ""];
  for (const c of spec.cases) out.push(`- **${c.id}** (${c.kind}): ${c.source}. Expect: ${c.expect}.`);
  if (spec.records_required?.length) out.push("", "Records checked after the run:", ...spec.records_required.map((r) => `- ${r}`));
  if (spec.trials?.length) out.push("", `Trial cases are added for: ${spec.trials.join(", ")}.`);
  return out.join("\n");
}

export function filePiece(job, spec) {
  mkdirSync(join(job, "out"), { recursive: true });
  writeFileSync(join(job, "out", "derived-test.json"), pyDumps(spec, { indent: 2 }));
  writeFileSync(join(job, "pieces.json"), pyDumps([{ name: "the derived test", step: "derive-test", path: "out/derived-test.json",
    media_type: MEDIA, produced_from: ["the package"],
    about: "The cases the conformance check would run, each with the declaration it came from. Nothing was sent to the agent." }], { indent: 2 }));
}

export async function main(argv) {
  let job = null; let prompt = null;
  for (let i = 0; i < argv.length;) {
    if (argv[i] === "--job" && i + 1 < argv.length) { job = argv[i + 1]; i += 2; }
    else if (argv[i] === "--prompt" && i + 1 < argv.length) { prompt = argv[i + 1]; i += 2; }
    else i += 1;
  }
  if (!job && prompt) { const m = /^job folder:\s*(\S+)/m.exec(prompt); job = m ? m[1] : null; }
  const [spec, why] = await derive(job, prompt || "");
  if (!spec) { console.log(why); return 1; }
  if (job && existsSync(job) && statSync(job).isDirectory()) filePiece(job, spec);
  console.log(words(spec));
  return 0;
}

// Run as a command, under its name here or on a host (agenteval-<name>).
const isMain = Boolean(process.argv[1]) && pathToFileURL(resolvePath(process.argv[1])).href === import.meta.url;
if (isMain) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
