// What the spec declares that a suite can hold the scripts to, written down
// before anything is written.
//
// This step has no opinions. It reads the spec and lists, per job, the four
// sentences, what it takes and produces, the scripts it names and the command
// lines its instructions give with the variables they pass; and for the
// package, the records it promises, the refusals, the systems and their
// variables. What is worth testing is a judgment and belongs to the step that
// calls a model. What this does is make the material legible, so the writer
// works from the declaration and the checker knows which scripts to stand in.
//
//   needs: node >= 22
//   SPEC=<the agent's folder, or a spec.json> RECORDS=<records folder> node declared.mjs
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadSpec } from "./agent-folder.mjs";

const trim = (s) => String(s ?? "").trim();

/** The name a systems[] entry gives the system it is bound to. Common Agent
 *  0.16.0-draft renamed this member from `role` to `name`, because `role`
 *  already means the standard job an agent holds; `role` is read as an alias
 *  for one revision and `name` wins where a spec carries both. */
export const systemName = (s) =>
  (typeof s?.name === "string" && s.name) || (typeof s?.role === "string" && s.role) || null;

/** Does this JSON look like a package spec? The builder's own floor: a name,
 *  a version, and jobs with slugs. */
export function looksLikeSpec(doc) {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return false;
  if (typeof doc.name !== "string" || !doc.name) return false;
  if (!Array.isArray(doc.jobs) || !doc.jobs.length) return false;
  return doc.jobs.every((j) => j && typeof j === "object" && typeof j.slug === "string" && j.slug);
}

/** The command lines an instruction gives: every line that runs a script,
 *  with the variables set before `node` and the flags after it. The harness
 *  runs these verbatim, so they are the process contract a suite pins. */
export function commandsOf(instructions) {
  const out = [];
  for (const raw of String(instructions ?? "").split(/\n+/)) {
    const line = trim(raw).replace(/^\d+\.\s*/, "").replace(/^`|`\.?$/g, "");
    const m = /node\s+(\S*?([a-z0-9-]+\.mjs))/.exec(line);
    if (!m) continue;
    const before = line.slice(0, m.index);
    const after = line.slice(m.index + m[0].length);
    const variables = [...before.matchAll(/\b([A-Z][A-Z0-9_]+)=/g)].map((x) => x[1]);
    const flags = [...after.matchAll(/--([a-z][a-z-]*)/g)].map((x) => x[1]);
    out.push({ script: m[2], variables: [...new Set(variables)], flags: [...new Set(flags)], line });
  }
  return out;
}

/** The whole declaration a suite works from. Pure. */
export function declaredOf(spec) {
  if (!looksLikeSpec(spec)) throw new Error("this is not a spec: a spec carries a name, a version and jobs with slugs");
  const jobs = spec.jobs.map((j) => ({
    slug: j.slug, title: j.title ?? null, offered: !!j.offered, steps: j.steps ?? [],
    when: j.when ?? null, good: j.good ?? null, empty: j.empty ?? null, does: j.does ?? null,
    how: j.how ?? null,
    inputs: (j.inputs ?? []).map((i) => ({ name: i.name, kind: i.kind ?? null, required: !!i.required })),
    outputs: (j.outputs ?? []).map((o) => ({ name: o.name, kind: o.kind ?? null, when: o.when ?? null, ...(o.about ? { about: o.about } : {}) })),
    scripts: j.scripts ?? [],
    commands: commandsOf(j.instructions),
  }));
  const scripts = [...new Set(jobs.flatMap((j) => j.scripts))];
  return {
    declared: "v1",
    at: new Date().toISOString(),
    name: spec.name, version: spec.version ?? null,
    jobs,
    scripts,
    records: (spec.records ?? []).map((r) => ({ name: r.name, when: r.when ?? null, file: r.file ?? null })),
    refuses: spec.refuses ?? [],
    escalates: spec.escalates ?? [],
    systems: (spec.systems ?? []).map((s) => ({
      name: systemName(s), access: s.access ?? null, env: s.env ?? null,
      settings: (s.settings ?? []).map((t) => t.env).filter(Boolean),
    })),
    runtimes: spec.runtimes ?? [],
    directories: (spec.directories ?? []).map((d) => d.name),
  };
}

/** What this step says out loud: the line the next step and the log read. */
export function summary(d) {
  const offered = d.jobs.filter((j) => j.offered).length;
  const bits = [`${d.name} ${d.version ?? ""}`.trim(), `${d.jobs.length} job${d.jobs.length === 1 ? "" : "s"} (${offered} offered)`,
    `${d.scripts.length} script${d.scripts.length === 1 ? "" : "s"}`, `${d.records.length} record${d.records.length === 1 ? "" : "s"}`,
    `${d.refuses.length} refusal${d.refuses.length === 1 ? "" : "s"}`];
  if (!d.scripts.length) bits.push("no scripts named, so there is nothing a suite could import");
  return bits.join("; ");
}

export const NOT_A_SPEC =
  "There is no spec here to write tests from. Attach the agent's own files the package is built from "
  + "(agent-descriptor.json, agent-runtime-requirements.json, plugin.json and the SKILL.md files): "
  + "they carry a name, a version, and the jobs, and they are what the tests hold the scripts to.";

const thisFile = process.argv[1] ? process.argv[1].replace(/\\/g, "/").split("/").pop() : "";
if (thisFile && import.meta.url.endsWith(thisFile)) {
  const { SPEC, RECORDS } = process.env;
  if (!SPEC || !RECORDS) { console.error("SPEC and RECORDS are required"); process.exit(2); }
  try {
    let doc = null;
    // The agent's own folder, or a spec.json, which is still read for one
    // transition; the folder is the spec it states.
    try { doc = existsSync(SPEC) ? loadSpec(SPEC) : null; } catch { doc = null; }
    if (!looksLikeSpec(doc)) {
      console.log(JSON.stringify({ ok: false, code: 3, reply: NOT_A_SPEC }));
      process.exitCode = 3;
    } else {
      const d = declaredOf(doc);
      const out = join(RECORDS, "declared.json");
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, JSON.stringify(d, null, 2) + "\n");
      console.log(JSON.stringify({ ok: true, code: 0, declared: out, said: summary(d) }));
    }
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
