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
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const EXT = "net.agentdoc.package";
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const first = (dir, names) => names.map((n) => join(dir, n)).find((p) => existsSync(p)) ?? null;

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
