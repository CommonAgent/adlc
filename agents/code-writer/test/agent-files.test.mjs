// The agent's own files, which is what the spec writer delivers since 0.3.0.
//   node --test test/agent-files.test.mjs
//
// What is pinned: among the attachments, the agent's own files
// (agent-descriptor.json, agent-runtime-requirements.json, plugin.json and a
// SKILL.md per skill) are found by content and preferred to a spec.json; the
// workspace holds them as they arrived, pinned by digest, and no spec.json;
// the check reads the spec they state and the builder builds the workspace as
// the agent's folder; and the delivery check lays them out beside the
// delivered scripts, where a suite reads them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { sortAttachments } from "../scripts/workspace.mjs";
import { verify } from "../scripts/verify.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const BUILD = join(here, "..", "..", "package-maker", "build.py");
const CONVERT = join(here, "..", "..", "package-maker", "convert.py");
const SPEC = {
  name: "adder", version: "0.1.0", description: "Adds two numbers.",
  jobs: [{ slug: "add", title: "Add", offered: true, scripts: ["scripts/add.mjs"],
    when: "when two numbers need adding", good: "their sum, exactly", empty: "say that no numbers came",
    how: { control: "script", intelligence: "none", cost: "none", contract: "full" } }],
  refuses: ["adding anything that is not a number"], records: ["the sum it gave"],
};
const SUITE = '// adds\nimport { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { readFileSync } from "node:fs";\nimport { add } from "../scripts/add.mjs";\n'
  + 'test("two and two are four", () => { assert.equal(add(2, 2), 4); });\n'
  + 'test("the declaration beside the package is the one this tests", () => { assert.equal(JSON.parse(readFileSync(new URL("../agent-descriptor.json", import.meta.url), "utf8")).offerings[0].id, "add"); });\n';
const ADD = "// adds two numbers\nexport function add(a, b) { return a + b; }\n";

const folder = (body) => {
  const at = mkdtempSync(join(tmpdir(), "code-writer-agent-files-"));
  try { return body(at); } finally { rmSync(at, { recursive: true, force: true }); }
};

/** The agent's own files for SPEC, written by convert.py, as attachments
 *  named the way pieces arrive. */
function agentAttachments(at, dir) {
  const src = join(at, "src");
  mkdirSync(join(src, "scripts"), { recursive: true });
  writeFileSync(join(src, "spec.json"), JSON.stringify(SPEC));
  writeFileSync(join(src, "scripts", "add.mjs"), "");
  const r = spawnSync("python3", [CONVERT, join(src, "spec.json"), join(src, "agent")], { encoding: "utf8" });
  assert.equal(JSON.parse(r.stdout.trim()).ok, true, r.stdout + r.stderr);
  mkdirSync(dir, { recursive: true });
  const out = [];
  const put = (rel, sent) => { const p = join(dir, `${out.length}-Ab12cdEF-${sent}`); writeFileSync(p, readFileSync(join(src, "agent", rel))); out.push(p); };
  put("agent-descriptor.json", "agent-descriptor.json");
  put("agent-runtime-requirements.json", "agent-runtime-requirements.json");
  put("plugin.json", "plugin.json");
  put("skills/add/SKILL.md", "add.SKILL.md");
  return out;
}

test("the agent's files are sorted out of the attachments by content and preferred to a spec", () => {
  folder((at) => {
    const files = agentAttachments(at, join(at, "in"));
    const spec = join(at, "in", "9-Zz98yxWV-spec.json");
    writeFileSync(spec, JSON.stringify({ ...SPEC, name: "other" }));
    const suite = join(at, "in", "8-Qq77wwEE-add.test.mjs");
    writeFileSync(suite, SUITE);
    const sorted = sortAttachments([spec, ...files, suite]);
    assert.equal(sorted.spec, null);
    assert.ok(sorted.agent);
    assert.deepEqual(Object.keys(sorted.agent.skills), ["add"]);
    assert.deepEqual(sorted.suite.map((f) => f.path), ["test/add.test.mjs"]);
    // The spec that came with them is set aside, not laid out as the prototype.
    assert.deepEqual(sorted.code, []);
  });
});

test("as a process: the workspace holds the agent's files and no spec.json, the check builds it as the agent's folder, and the delivery check passes", () => {
  folder((at) => {
    const inDir = join(at, "job", "in");
    const files = [...agentAttachments(at, inDir)];
    const suite = join(inDir, "8-Qq77wwEE-add.test.mjs");
    writeFileSync(suite, SUITE);
    files.push(suite);
    const ws = join(at, "ws"); const records = join(at, "records");
    const lay = spawnSync("node", [join(here, "..", "scripts", "workspace.mjs")], { encoding: "utf8",
      env: { ...process.env, WORKSPACE: ws, RECORDS: records, FILES: files.join(",") } });
    assert.equal(lay.status, 0, lay.stdout + lay.stderr);
    assert.equal(existsSync(join(ws, "spec.json")), false, "a spec.json was written");
    for (const rel of ["agent-descriptor.json", "agent-runtime-requirements.json", "plugin.json", "skills/add/SKILL.md"]) {
      assert.ok(existsSync(join(ws, rel)), rel);
    }
    const record = JSON.parse(readFileSync(join(records, "workspace.json"), "utf8"));
    assert.ok(record.digests["agent-descriptor.json"], "the declaration is not pinned");
    assert.ok(record.digests["skills/add/SKILL.md"]);
    assert.deepEqual(record.scripts.map((s) => s.path), ["scripts/add.mjs"]);

    writeFileSync(join(ws, "scripts", "add.mjs"), ADD);
    const check = spawnSync("node", [join(here, "..", "scripts", "check.mjs")], { encoding: "utf8",
      env: { ...process.env, WORKSPACE: ws, RECORDS: records, BUILDER: BUILD } });
    assert.equal(check.status, 0, check.stdout + check.stderr);
    assert.match(check.stdout, /the suite passes, 2 of 2/);
    assert.match(check.stdout, /The builder takes the package\./);

    // The delivery check, as the host runs it over the finished job.
    mkdirSync(join(at, "job", "out", "scripts"), { recursive: true });
    writeFileSync(join(at, "job", "out", "scripts", "add.mjs"), ADD);
    const v = verify(join(at, "job"));
    assert.equal(v.ok, true, v.said);
    assert.match(v.said, /passes against the delivered scripts, 2 of 2/);
  });
});
