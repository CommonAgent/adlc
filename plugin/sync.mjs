// Carry the ADLC agents' own checks and generators into the kit.
//
// A build folder gets one folder of code, .adlc/, and that code is the
// agents' own: the spec writer's generators and rules, the solution
// architect's bindings and record, the test writer's and the code writer's
// checks. This script copies each file the kit imports (an entry file and
// everything it imports, found by reading the imports) from agents/ into
// kit/<agent>/scripts/, and the standards and references they read into
// kit/<agent>/references/. Nothing is rewritten on the way: a carried file is
// its master's bytes, and test/carried.test.mjs holds it there.
//
//   needs: node >= 22
//   node plugin/sync.mjs           write the carried copies
//   node plugin/sync.mjs --check   say which copies differ, and exit 1 if any
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const KIT = join(HERE, "kit");

/** What the kit imports from each agent. Everything those files import comes
 *  with them. */
export const ENTRIES = {
  "spec-writer": ["structure.mjs", "files.mjs", "can-use.mjs", "check-spec.mjs", "spec-check.mjs", "spec-v1.mjs", "architecture-record.mjs", "design.mjs", "declared.mjs", "given.mjs"],
  "solution-architect": ["name.mjs", "check-record.mjs", "bind.mjs", "standing.mjs"],
  "test-writer": ["check-suite.mjs", "spec-rules.mjs", "suite-rules.mjs", "kept-interfaces.mjs"],
  "code-writer": ["check.mjs", "workspace.mjs"],
};

/** The standards and references the carried files read, by where the kit
 *  keeps each and where its master is. An agent reads a standard from its own
 *  references/ folder when it is packed, and that is where the kit puts it. */
export const REFERENCES = {
  "spec-writer/references/plugin-manifest-schema.json": "agents/spec-writer/references/plugin-manifest-schema.json",
  "spec-writer/references/spec.schema.json": "standards/spec.schema.json",
  "spec-writer/references/standing-asset-schemas.json": "standards/standing-asset-schemas.json",
  "solution-architect/references/house-stack.json": "agents/solution-architect/references/house-stack.json",
  "solution-architect/references/standing-asset-schemas.json": "standards/standing-asset-schemas.json",
  "solution-architect/references/architecture-standard.md": "standards/architecture-standard.md",
  "solution-architect/references/a-record-that-works.md": "agents/solution-architect/references/a-record-that-works.md",
  "test-writer/references/delivered-formats.test.mjs": "agents/test-writer/references/delivered-formats.test.mjs",
  "test-writer/references/records-per-job.test.mjs": "agents/test-writer/references/records-per-job.test.mjs",
  "test-writer/references/worked-values.test.mjs": "agents/test-writer/references/worked-values.test.mjs",
  "test-writer/references/printed-reply.test.mjs": "agents/test-writer/references/printed-reply.test.mjs",
  "test-writer/references/kept-interfaces.test.mjs": "agents/test-writer/references/kept-interfaces.test.mjs",
  "test-writer/references/a-suite-that-works.test.mjs": "agents/test-writer/references/a-suite-that-works.test.mjs",
  "test-writer/references/what-a-good-suite-carries.md": "agents/test-writer/references/what-a-good-suite-carries.md",
  // The image tools, for the local AgentMesh (kit/local.mjs): the emitter
  // turns the package into an image's build context, with the entrypoint
  // that answers one message and the lockfile check it copies in.
  "image/emit-image.mjs": "agents/image/emit-image.mjs",
  "image/one-message.mjs": "agents/image/one-message.mjs",
  "image/check-lockfile.mjs": "agents/image/check-lockfile.mjs",
  "common-agent-pin.json": "standards/common-agent-pin.json",
  "stages.json": "standards/stages.json",
};

// A real import or re-export begins its line; the words inside a message that
// tells a writer what to import do not.
const STATIC = /^[ \t]*(?:import|export)\s+(?:[^;'"`]*?\sfrom\s+)?["'](\.{1,2}\/[^"']+)["']/gm;
const DYNAMIC = /\bimport\s*\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g;
// Comments are taken out first: an example import in a comment is not one.
// Only a comment that begins its line is taken out: an import begins its line
// too, and a "/*" inside a line comment or a string ("test/*.test.mjs") is
// not the start of a block.
const uncommented = (text) => text.replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, "").replace(/^[ \t]*\/\/.*$/gm, "");
const importsOf = (text) => {
  const code = uncommented(text);
  return [...code.matchAll(STATIC), ...code.matchAll(DYNAMIC)].map((m) => m[1]);
};

/** An entry file and every file it imports, as paths under the repository. */
export function closureOf(agent, entries, root = ROOT) {
  const dir = join(root, "agents", agent, "scripts");
  const seen = new Set();
  const walk = (file) => {
    if (seen.has(file)) return;
    if (!existsSync(file)) throw new Error(`${relative(root, file)} is imported and is not there`);
    seen.add(file);
    for (const spec of importsOf(readFileSync(file, "utf8"))) walk(resolve(dirname(file), spec));
  };
  for (const e of entries) walk(join(dir, e));
  for (const f of seen) {
    if (!f.startsWith(dir + sep)) throw new Error(`${relative(root, f)} is outside ${agent}'s scripts, and a carried file imports it`);
  }
  return [...seen].sort();
}

/** Every carried file: where the kit keeps it, and its master. */
export function carried(root = ROOT) {
  const out = [];
  for (const [agent, entries] of Object.entries(ENTRIES)) {
    for (const f of closureOf(agent, entries, root)) {
      const name = relative(join(root, "agents", agent, "scripts"), f).split(sep).join("/");
      out.push({ kit: `${agent}/scripts/${name}`, master: relative(root, f).split(sep).join("/") });
    }
  }
  for (const [kit, master] of Object.entries(REFERENCES)) out.push({ kit, master });
  return out;
}

/** The carried copies that are not their master's bytes, and the files under
 *  a carried folder that no master stands behind. */
export function differences(root = ROOT, kit = KIT) {
  const want = carried(root);
  const out = [];
  for (const c of want) {
    const at = join(kit, c.kit);
    if (!existsSync(at)) out.push(`${c.kit} is not in the kit (its master is ${c.master})`);
    else if (!readFileSync(at).equals(readFileSync(join(root, c.master)))) out.push(`${c.kit} is not what ${c.master} is`);
  }
  const known = new Set(want.map((c) => c.kit));
  for (const agent of Object.keys(ENTRIES)) {
    const walk = (dir, rel) => {
      if (!existsSync(dir)) return;
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const r = `${rel}/${e.name}`;
        if (e.isDirectory()) walk(join(dir, e.name), r);
        else if (!known.has(r)) out.push(`${r} is in the kit and no master stands behind it`);
      }
    };
    walk(join(kit, agent), agent);
  }
  return out;
}

/** Write every carried copy, and take out what no master stands behind. */
export function sync(root = ROOT, kit = KIT) {
  for (const agent of Object.keys(ENTRIES)) rmSync(join(kit, agent), { recursive: true, force: true });
  const want = carried(root);
  for (const c of want) {
    const at = join(kit, c.kit);
    mkdirSync(dirname(at), { recursive: true });
    writeFileSync(at, readFileSync(join(root, c.master)));
  }
  return want;
}

const thisFile = process.argv[1] ? process.argv[1].replace(/\\/g, "/").split("/").pop() : "";
if (thisFile === "sync.mjs" && import.meta.url.endsWith("/plugin/sync.mjs")) {
  if (process.argv.includes("--check")) {
    const d = differences();
    for (const line of d) console.error(line);
    console.log(d.length ? `${d.length} carried file${d.length === 1 ? " differs" : "s differ"}; run node plugin/sync.mjs` : "every carried file is its master's bytes");
    process.exit(d.length ? 1 : 0);
  }
  const done = sync();
  console.log(`carried ${done.length} files into plugin/kit/`);
}
