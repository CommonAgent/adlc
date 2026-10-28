// Read the package: what it declares it will reach, spend and refuse, and the
// files its programs are made of. A step with no judgment in it.
//
// The package comes as one .tar.gz (or .tar) the package maker built, or as
// its files handed over one by one: agent-descriptor.json,
// agent-runtime-requirements.json, plugin.json and the scripts. A package
// source folder (the layout agents/<role>/ keeps, scripts at the top) reads
// the same way as a built package (scripts under skills/<slug>/scripts/).
//
// The descriptor is the half a caller reads (what each system is for, at what
// access, and whether a caller's material leaves for it); the runtime
// requirements are the half a host reads (the kind of each system, the NAME of
// its credential and the variable it is placed in, what it spends, the
// ceilings, binaries, dependencies and directories). Both are read, and an
// entry one names and the other does not is a finding: the deployment
// manager refuses a package whose two sets differ.
//
//   needs: node >= 22
//   import { readPackage, fromFiles } from "./read-package.mjs"
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { isGzip, packageRoot, readTar } from "./tar.mjs";
import { isCode } from "./trace-programs.mjs";

const trim = (s) => String(s ?? "").trim();
const sha = (b) => createHash("sha256").update(b).digest("hex");

/** The two names each half has gone by: the 0.30.0-draft names first. */
export const DESCRIPTOR_NAMES = ["agent-descriptor.json", "descriptor.json"];
export const REQUIREMENTS_NAMES = ["agent-runtime-requirements.json", "install.json"];


/** A folder on disk, read whole into memory, links left out and named. */
export function readFolder(dir) {
  const files = new Map();
  const links = [];
  const walk = (d) => {
    for (const name of readdirSync(d).sort()) {
      if (name === ".git") continue;
      const p = join(d, name);
      const rel = relative(dir, p).replace(/\\/g, "/");
      // A node_modules folder is named, not read: fromFiles counts it as bundled.
      if (name === "node_modules") { files.set(`${rel}/(not read)`, Buffer.alloc(0)); continue; }
      // A link is named and not followed: it can point anywhere on the machine.
      const st = lstatSync(p, { throwIfNoEntry: false });
      if (!st || st.isSymbolicLink()) { links.push(rel); continue; }
      if (st.isDirectory()) walk(p);
      else if (st.isFile()) files.set(rel, readFileSync(p));
    }
  };
  walk(dir);
  return { files, links, climbing: [], error: "" };
}

/** What was handed over, as one map of package paths to bytes.
 *  `given` is a list of { path, declared } as the run passes attached files.
 *  A gzip or tar among them is the package; otherwise each file is taken by
 *  its own name, which is how a package's files handed over one by one read. */
export function gather(given = []) {
  const problems = [];
  const files = new Map();
  let digest = "";
  let source = "";
  const archives = [];
  const loose = [];
  for (const g of given) {
    let bytes;
    try { bytes = readFileSync(g.path); } catch (e) { problems.push(`${basename(g.path)} could not be read (${e.code ?? e.message})`); continue; }
    const tarLike = isGzip(bytes) || (bytes.length >= 512 && bytes.subarray(257, 262).toString() === "ustar");
    if (tarLike) archives.push({ ...g, bytes });
    else loose.push({ ...g, bytes });
  }
  let links = [];
  let climbing = [];
  let outside = [];
  if (archives.length > 1) problems.push(`${archives.length} archives were handed over, and a review is of one package; the first, ${basename(archives[0].path)}, is reviewed`);
  if (archives.length) {
    const a = archives[0];
    const read = readTar(a.bytes);
    if (read.error) problems.push(`${basename(a.path)} is not a package this reviewer can read: ${read.error}`);
    const rooted = packageRoot(read.files);
    for (const [p, b] of rooted.files) files.set(p, b);
    links = read.links; climbing = read.climbing; outside = rooted.outside;
    digest = sha(a.bytes);
    source = basename(a.path);
  }
  const others = [];
  for (const l of loose) {
    const name = basename(l.path);
    // A loose file is one of the package's own files, or something given
    // beside it (the architecture record, a build record), which the caller
    // sorts out by name and kind before this.
    if (!archives.length) files.set(l.relative || name, l.bytes);
    else others.push(name);
  }
  if (!archives.length && files.size) source = "the files handed over";
  return { files, digest, source, links, climbing, outside, problems, others };
}

const parse = (files, names) => {
  for (const n of names) {
    if (!files.has(n)) continue;
    try { return { name: n, doc: JSON.parse(files.get(n).toString("utf8")) }; }
    catch (e) { return { name: n, doc: null, error: `${n} is not JSON that parses (${trim(e.message)})` }; }
  }
  return { name: "", doc: null };
};

const list = (v) => (Array.isArray(v) ? v : []);
const nameOf = (s) => trim(s?.name ?? s?.role);

/** The declaration, read off the package's files. Pure. */
export function fromFiles(files) {
  const problems = [];
  const desc = parse(files, DESCRIPTOR_NAMES);
  const reqs = parse(files, REQUIREMENTS_NAMES);
  const plugin = parse(files, ["plugin.json"]);
  for (const p of [desc, reqs, plugin]) if (p.error) problems.push(p.error);
  const d = desc.doc ?? {};
  const r = reqs.doc ?? {};
  const pl = plugin.doc ?? {};

  const name = trim(pl.name) || trim(d.name) || "";
  const version = trim(d.agent_version) || trim(pl.version) || "";

  // The systems, merged by name, each half's facts kept apart so a finding
  // can say which half is missing what.
  const byName = new Map();
  for (const s of list(d.systems)) {
    const n = nameOf(s);
    if (!n) { problems.push("the descriptor lists a system with no name"); continue; }
    byName.set(n, { name: n, inDescriptor: true, inRequirements: false, access: trim(s.access), needs: trim(s.needs), leaves: s.leaves === true });
  }
  for (const s of list(r.systems)) {
    const n = nameOf(s);
    if (!n) { problems.push("the runtime requirements list a system with no name"); continue; }
    const had = byName.get(n) ?? { name: n, inDescriptor: false, access: trim(s.access), needs: trim(s.needs ?? s.purpose), leaves: s.leaves === true };
    byName.set(n, {
      ...had, inRequirements: true,
      kind: trim(s.kind) || "directory",
      credential: trim(s.credential), env: trim(s.env),
      settings: list(s.settings).map((x) => ({ env: trim(x.env), purpose: trim(x.purpose) })),
      spends: s.spends && typeof s.spends === "object" ? { unit: trim(s.spends.unit) || "units" } : null,
    });
  }

  const offerings = list(d.offerings).map((o) => ({
    id: trim(o.id), name: trim(o.name), does: trim(o.does),
    inputs: list(o.inputs).map((i) => ({ name: trim(i.name), kind: trim(i.kind), required: i.required === true })),
    outputs: list(o.outputs).map((i) => ({ name: trim(i.name), kind: trim(i.kind) })),
    how: o.how ?? {},
    authority: Array.isArray(o.authority) ? o.authority.map(trim) : null,
    ceilings: o.ceilings && typeof o.ceilings === "object" && !Array.isArray(o.ceilings) ? o.ceilings : null,
    scope: trim(o.scope),
    steps: list(o.steps).map((s) => ({ id: trim(s.id), how: s.how ?? {} })),
  }));

  const refusals = Array.isArray(d.refusals) ? d.refusals.map(trim).filter(Boolean)
    : trim(d.refusals).split("\n").map(trim).filter(Boolean);

  const programs = [...files.keys()].filter((p) => !/(?:^|\/)node_modules\//.test(p) && isCode(p, files.get(p))).sort();
  // A package that ships its own dependencies is a package whose
  // dependencies nobody verified: the installer refuses one, and so does this.
  const bundled = [...new Set([...files.keys()].filter((p) => /(?:^|\/)node_modules\//.test(p)).map((p) => p.slice(0, p.indexOf("node_modules/") + "node_modules".length)))];
  const lockfiles = [...files.keys()].filter((p) => /(?:^|\/)(?:package-lock\.json|requirements\.txt|poetry\.lock|pnpm-lock\.yaml|yarn\.lock)$/.test(p)).sort();

  return {
    name, version,
    descriptorFile: desc.name, requirementsFile: reqs.name,
    does: trim(d.does),
    systems: [...byName.values()],
    offerings,
    refusals,
    escalates: list(d.escalates).map(trim).filter(Boolean),
    ceilings: list(r.ceilings).filter((c) => c && typeof c === "object"),
    trialCeiling: r.trial_ceiling && typeof r.trial_ceiling === "object" ? r.trial_ceiling : (d.trial_ceiling ?? null),
    price: r.price ?? null,
    binaries: list(r.binaries).map((b) => ({ name: trim(b.name), purpose: trim(b.purpose) })),
    dependencies: list(r.dependencies),
    directories: list(r.directories).map((x) => ({ name: trim(x.name), purpose: trim(x.purpose) })),
    runtimes: list(r.runtimes),
    jobSeconds: Number.isFinite(r.job_seconds) ? r.job_seconds : null,
    wantsReplies: r.wants_replies === true,
    run: r.run && typeof r.run === "object" ? r.run : null,
    programs, lockfiles, bundled,
    problems,
    found: { descriptor: Boolean(desc.doc), requirements: Boolean(reqs.doc), plugin: Boolean(plugin.doc) },
  };
}

/** A package on disk (a folder, a .tar.gz or a .tar), read and declared. */
export function readPackage(path) {
  if (!existsSync(path)) throw new Error(`there is no package at ${path}`);
  const st = statSync(path);
  let got;
  if (st.isDirectory()) {
    got = { ...readFolder(path), digest: "", source: basename(path), problems: [], others: [] };
  } else {
    got = gather([{ path }]);
  }
  return { ...got, declared: fromFiles(got.files) };
}
