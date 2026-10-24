// An agent's own files, read the way the builder reads them.
//
// An agent here is kept in the layout Common Agent 13.2 says a package is
// authored in: agent-descriptor.json (every caller-facing fact),
// agent-runtime-requirements.json (every host-facing fact) and plugin.json,
// with each skill's SKILL.md under skills/<slug>/. plugin.json's
// extensions["net.agentdoc.package"].build is the builder's own entry: the
// files each skill carries (kept once, beside the agent, and copied into every
// skill that runs them) and anything else only a build reads.
//
// readAgentFolder(dir) returns those files as they are, and `jobs`: one entry
// per skill, in the build entry's order, with the members a test of a package
// reads about a job: slug, title, does, inputs, outputs, how, examples,
// offered, steps (the ids), revisions, trial, scopes, run, lockfile, scripts,
// references, assets, and skill (the SKILL.md text, which holds what a
// spec called a job's when, good, empty and instructions); and `systems`,
// each system's descriptor entry with its runtime binding laid over it,
// `refuses` (one line each), `escalates`, `records` and `description`. It is the same
// projection adlc's build.py makes of the folder (read_folder), so a test
// that checks a job checks what the package is built from. The names before
// Common Agent 0.30.0-draft (descriptor.json, install.json) are read where
// the current ones are absent.
//
// specOfFolder(dir) is the whole of read_folder's projection, every member a
// spec.json carried, with each job's when, good, empty and instructions read
// back out of its SKILL.md. It is what a writer downstream of the spec writer
// reads when the files came instead of a spec.json, so the writer's own steps
// run unchanged. It validates nothing: the builder does that, in its words.
//
// agentFilesAmong(files) finds those files among the ones a message carried,
// by content and never by name, because a file that came through the process
// runner arrives under its piece label with a prefix per hop. layOutAgentFiles
// puts what it found back into the layout, under a folder of the caller's.
//
// This file is kept once, here, and copied into each agent that reads an
// agent's files (test-writer/scripts, code-writer/scripts), because a package
// carries its own scripts. test_folder.py holds every copy to this one.
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const EXT = "net.agentdoc.package";
export const DESCRIPTOR_FILE = "agent-descriptor.json";
export const RUNTIME_FILE = "agent-runtime-requirements.json";
export const MANIFEST_FILE = "plugin.json";
const DESCRIPTOR_FORMAT = "agent-descriptor-v1";
const RUNTIME_FORMATS = ["agent-runtime-requirements-v1", "agent-install-v1"];
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const first = (dir, names) => names.map((n) => join(dir, n)).find((p) => existsSync(p)) ?? null;
const systemName = (s) => s?.name ?? s?.role;

/** Whether a folder holds an agent's own files. */
export function isAgentFolder(dir) {
  return existsSync(join(dir, "plugin.json")) && first(dir, ["agent-descriptor.json", "descriptor.json"]) !== null;
}

export function readAgentFolder(dir) {
  const manifest = readJson(join(dir, "plugin.json"));
  const dpath = first(dir, ["agent-descriptor.json", "descriptor.json"]);
  const rpath = first(dir, ["agent-runtime-requirements.json", "install.json"]);
  if (!dpath || !rpath) throw new Error(`${dir} has no agent-descriptor.json or agent-runtime-requirements.json`);
  const descriptor = readJson(dpath);
  const runtime = readJson(rpath);
  const build = manifest.extensions?.[EXT]?.build ?? {};
  const offerings = descriptor.offerings ?? [];
  const projected = new Map();
  for (const o of offerings) for (const p of [o, ...(o.steps ?? [])]) if (!projected.has(p.id)) projected.set(p.id, p);
  const order = build.skills ? Object.keys(build.skills) : [...projected.keys()];
  const byOffering = new Map(offerings.map((o) => [o.id, o]));
  const deps = new Map((runtime.dependencies ?? []).map((d) => [d.skill, d]));
  const jobs = order.map((slug) => {
    const p = byOffering.get(slug) ?? projected.get(slug) ?? { name: slug };
    const j = { slug, title: p.name };
    for (const k of ["does", "inputs", "outputs", "how", "examples"]) if (k in p) j[k] = p[k];
    j.offered = byOffering.has(slug);
    const o = byOffering.get(slug);
    if (o?.steps?.length) j.steps = o.steps.map((s) => s.id);
    for (const k of ["revisions", "trial", "scopes"]) if (o && k in o) j[k] = o[k];
    if (runtime.run?.[slug]) j.run = runtime.run[slug];
    if (deps.has(slug)) j.lockfile = deps.get(slug).lockfile.slice(`skills/${slug}/`.length);
    for (const k of ["scripts", "references", "assets"]) if (build.skills?.[slug]?.[k]?.length) j[k] = [...build.skills[slug][k]];
    const md = join(dir, "skills", slug, "SKILL.md");
    j.skill = existsSync(md) ? readFileSync(md, "utf8") : "";
    return j;
  });
  // A system is one name in both files: what it is for in the descriptor,
  // how it is bound in the runtime requirements.
  const bound = new Map((runtime.systems ?? []).map((s) => [s.name ?? s.role, s]));
  const systems = (descriptor.systems ?? []).map((d) => ({ ...d, ...(bound.get(d.name ?? d.role) ?? {}) }));
  return {
    dir, manifest, descriptor, runtime, build, jobs, systems,
    name: manifest.name, version: manifest.version, description: manifest.description,
    refuses: (descriptor.refusals ?? "").split(/\n/).filter((l) => l.trim()),
    escalates: descriptor.escalates ?? [], records: descriptor.records ?? [],
  };
}

/** The sections of a SKILL.md the builder writes from a job, by heading. Each
 *  is the text under its "## " heading up to the next one, trimmed. */
export function skillSections(text) {
  const out = {};
  let at = null;
  let body = [];
  const close = () => { if (at !== null) out[at] = body.join("\n").trim(); };
  for (const line of String(text ?? "").replace(/\r/g, "").split("\n")) {
    const m = /^## (.+?)\s*$/.exec(line);
    if (m) { close(); at = m[1]; body = []; } else if (at !== null) body.push(line);
  }
  close();
  // A job's instructions are its own markdown and may carry "## " headings
  // of their own, so "How to do it" runs to the lists of files the builder
  // writes after it (Scripts, References, Assets), and not to the next
  // heading.
  const lines = String(text ?? "").replace(/\r/g, "").split("\n");
  const start = lines.indexOf("## How to do it");
  if (start >= 0) {
    const TRAILER = /^(## (Scripts|References|Assets)|- (scripts|references|assets)\/.*|Run these from this skill's folder; each one says what it needs at the top\.|Templates and resources the scripts fill in; never edited by hand\.|)$/;
    let end = lines.length;
    for (let i = lines.length - 1; i > start; i--) {
      if (!TRAILER.test(lines[i])) break;
      if (/^## (Scripts|References|Assets)$/.test(lines[i])) end = i;
    }
    out["How to do it"] = lines.slice(start + 1, end).join("\n").trim();
  }
  return out;
}

/** The spec an agent's folder states: read_folder's projection in build.py,
 *  member for member, with when, good, empty and instructions read back out
 *  of each SKILL.md (the sections the builder writes them into). A member
 *  the folder does not state is absent here, as it would be in a spec. */
export function specOfFolder(dir) {
  const a = readAgentFolder(dir);
  const { manifest, descriptor: desc, runtime: inst, build: b } = a;
  const own = manifest.extensions?.[EXT] ?? {};
  const version = manifest.version ?? desc.agent_version ?? "1.0.0";
  const spec = {};
  if (typeof manifest.name === "string" && manifest.name) spec.name = manifest.name;
  spec.version = version;
  if (manifest.description !== undefined) spec.description = manifest.description;
  for (const k of ["license", "homepage", "repository", "author"]) if (k in manifest) spec[k] = manifest[k];
  if ("from" in own) spec.from = own.from;
  for (const k of ["kind", "container", "claims"]) if (k in b) spec[k] = b[k];
  spec.jobs = a.jobs.map(({ skill, ...j }) => {
    const s = skillSections(skill);
    const job = { ...j };
    if (s["When to use this"]) job.when = s["When to use this"];
    if (s["What a good result looks like"]) job.good = s["What a good result looks like"];
    if (s["When it comes back empty"]) job.empty = s["When it comes back empty"];
    if (s["How to do it"]) job.instructions = s["How to do it"];
    return job;
  });
  spec.refuses = a.refuses;
  if (desc.escalates?.length) spec.escalates = desc.escalates;
  spec.records = desc.records ?? [];
  const bound = new Map((inst.systems ?? []).map((e) => [systemName(e), e]));
  spec.systems = (desc.systems ?? []).map((d) => {
    const e = bound.get(systemName(d)) ?? {};
    const s = { name: systemName(d), access: d.access };
    for (const k of ["needs", "leaves"]) if (k in d) s[k] = d[k];
    for (const k of ["kind", "credential", "env", "spends", "settings"]) if (k in e) s[k] = e[k];
    return s;
  });
  for (const k of ["can_use", "run_config"]) if (k in desc) spec[k] = desc[k];
  for (const k of ["runtimes", "binaries", "directories"]) if (k in inst) spec[k] = inst[k];
  if (Array.isArray(inst.ceilings)) {
    spec.ceilings = inst.ceilings.map((c) => {
      if (!c || typeof c !== "object") return c;
      const { enforced_by, ...rest } = c;
      return rest;
    });
  }
  for (const k of ["job_seconds", "wants_replies", "one_at_a_time", "samples_ref", "trial_ceiling"]) if (k in inst) spec[k] = inst[k];
  if (inst.answer && typeof inst.answer === "object") spec.answer = inst.answer.piece;
  if (inst.price?.price) {
    const price = { ...inst.price.price };
    if ("sku" in inst.price) price.sku = inst.price.sku;
    if (inst.price.covers?.offerings) price.covers = inst.price.covers.offerings;
    spec.price = price;
  }
  const v = /^skills\/([^/]+)\/(.+)$/.exec(String(inst.verify ?? ""));
  if (v) spec.verify = { job: v[1], script: v[2] };
  return spec;
}

/** A spec from wherever it is kept: an agent's folder, or a spec.json, which
 *  is still read for one transition. */
export function loadSpec(path) {
  if (existsSync(path) && statSync(path).isDirectory()) return specOfFolder(path);
  return readJson(path);
}

/** What one file is, by its content: "descriptor", "runtime", "manifest",
 *  "skill" (with its slug), or null. */
export function agentFileKind(text) {
  const t = String(text ?? "");
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(t);
  if (fm) {
    const names = fm[1].split(/\r?\n/).filter((l) => l.startsWith("name:")).map((l) => l.slice(5).trim());
    if (names.length === 1 && /^[a-z][a-z0-9-]{1,62}$/.test(names[0])) return { kind: "skill", slug: names[0] };
    return null;
  }
  let doc;
  try { doc = JSON.parse(t); } catch { return null; }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return null;
  if (doc.format === DESCRIPTOR_FORMAT) return { kind: "descriptor" };
  if (RUNTIME_FORMATS.includes(doc.format)) return { kind: "runtime" };
  const ext = doc.extensions;
  if (ext && typeof ext === "object" && (EXT in ext || /agent-plugins\.org/.test(String(doc.$schema ?? "")))) return { kind: "manifest" };
  return null;
}

/** An agent's own files among the ones a message carried, found by content:
 *  {descriptor, runtime, manifest, skills: {slug: path}, used: [paths]}, or
 *  null unless the descriptor, the runtime requirements and the manifest are
 *  all there. A job manifest is JSON too and is skipped by name. When two
 *  files claim the same place, the later one wins, the way a later piece of
 *  the same name replaces an earlier one. */
export function agentFilesAmong(files, read = (p) => readFileSync(p, "utf8")) {
  const found = { skills: {} };
  for (const f of files ?? []) {
    const path = typeof f === "string" ? f : f?.path;
    if (!path || /job-manifest\.json$/.test(path)) continue;
    let text;
    try { text = read(path); } catch { continue; }
    const k = agentFileKind(text);
    if (!k) continue;
    if (k.kind === "skill") found.skills[k.slug] = path;
    else found[k.kind] = path;
  }
  if (!found.descriptor || !found.runtime || !found.manifest) return null;
  found.used = [found.descriptor, found.runtime, found.manifest, ...Object.values(found.skills)];
  return found;
}

/** Put the files agentFilesAmong found back into the layout under dir, by
 *  their bytes. Returns dir. */
export function layOutAgentFiles(found, dir, readBytes = (p) => readFileSync(p)) {
  const put = (rel, from) => {
    const at = join(dir, rel);
    mkdirSync(dirname(at), { recursive: true });
    writeFileSync(at, readBytes(from));
  };
  put(DESCRIPTOR_FILE, found.descriptor);
  put(RUNTIME_FILE, found.runtime);
  put(MANIFEST_FILE, found.manifest);
  for (const [slug, p] of Object.entries(found.skills ?? {})) put(join("skills", slug, "SKILL.md"), p);
  return dir;
}
