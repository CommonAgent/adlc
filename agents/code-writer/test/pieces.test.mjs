// The pieces: what the adapter signs, which is the provenance the door checks.
//   node --test test/pieces.test.mjs
//
// Worth pinning: nothing is filed unless the verdict says done, so a stopped
// job leaves no pieces list for anything downstream to mistake for a
// delivery; every script goes with the sentence it wrote about itself; and
// nothing is written until every copy has a source.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { STEP_OF, aboutOf, fill, plan, scriptsIn } from "../scripts/pieces.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, "..", "scripts", "pieces.mjs");
const ADD = "// Adds two numbers, and refuses anything that is not one.\n//\n//   needs: node >= 22\n//   A=<n> B=<n> node add.mjs\nexport function add(a, b) { return a + b; }\n";

const folder = (body) => {
  const at = mkdtempSync(join(tmpdir(), "code-writer-pieces-"));
  try { return body(at); } finally { rmSync(at, { recursive: true, force: true }); }
};

test("a script's sentence about itself is its opening comment, without the needs and command lines", () => {
  assert.equal(aboutOf(ADD, "scripts/add.mjs"), "add.mjs: Adds two numbers, and refuses anything that is not one.");
  assert.equal(aboutOf("export const x = 1;\n", "scripts/x.mjs"), "x.mjs, a script that says nothing about itself");
});

test("nothing is planned unless the verdict says done, and every script goes with the account and the run record", () => {
  assert.throws(() => plan({ workspace: "/w", verdict: { done: false, said: "The rounds are used up." }, scripts: [{ path: "scripts/a.mjs", text: "" }] }), /nothing is delivered: The rounds are used up\./);
  assert.throws(() => plan({ workspace: "/w", verdict: { done: true }, scripts: [] }), /no script to deliver/);
  const { entries, copies } = plan({ workspace: "/w", verdict: { done: true }, scripts: [{ path: "scripts/add.mjs", text: ADD }, { path: "scripts/deep/x.mjs", text: "// deep\n" }], accountPath: "/r/account.md", runsPath: "/r/runs.json" });
  assert.deepEqual(entries.map((e) => [e.name, e.step, e.path, e.media_type]), [
    ["add.mjs", STEP_OF.script, "out/scripts/add.mjs", "text/javascript"],
    ["x.mjs", STEP_OF.script, "out/scripts/deep/x.mjs", "text/javascript"],
    ["the account", STEP_OF.account, "out/account.md", "text/markdown"],
    ["the run record", STEP_OF.runs, "out/runs.json", "application/vnd.agentmesh.code-runs+json"],
  ]);
  assert.match(entries[0].about, /^add\.mjs: Adds two numbers/);
  assert.deepEqual(entries[0].produced_from, ["the spec", "the suite"]);
  assert.equal(copies[0].from, join("/w", "scripts/add.mjs"));
  const bare = plan({ workspace: "/w", verdict: { done: true }, scripts: [{ path: "scripts/a.mjs", text: "" }] });
  assert.equal(bare.entries.length, 1, "no account and no run record means neither is listed");
});

test("nothing is written until every copy has a source, and then every piece is under out/ with pieces.json beside them", () => {
  folder((at) => {
    const ws = join(at, "ws");
    const job = join(at, "job");
    mkdirSync(join(ws, "scripts"), { recursive: true });
    mkdirSync(job, { recursive: true });
    writeFileSync(join(ws, "scripts", "add.mjs"), ADD);
    assert.deepEqual(scriptsIn(ws).map((s) => s.path), ["scripts/add.mjs"]);
    const missing = plan({ workspace: ws, verdict: { done: true }, scripts: [{ path: "scripts/add.mjs", text: ADD }], accountPath: join(at, "nope.md") });
    assert.throws(() => fill(job, missing), /the account is not at/);
    assert.equal(existsSync(join(job, "pieces.json")), false);
    assert.equal(existsSync(join(job, "out")), false);
    const listed = fill(job, plan({ workspace: ws, verdict: { done: true }, scripts: scriptsIn(ws) }));
    assert.equal(listed.length, 1);
    assert.equal(readFileSync(join(job, "out", "scripts", "add.mjs"), "utf8"), ADD);
    assert.deepEqual(JSON.parse(readFileSync(join(job, "pieces.json"), "utf8")).map((e) => e.name), ["add.mjs"]);
  });
});

test("as a process it exits 3 and files nothing when the verdict is not done, and files the pieces when it is", () => {
  folder((at) => {
    const ws = join(at, "ws");
    const job = join(at, "job");
    const records = join(at, "records");
    mkdirSync(join(ws, "scripts"), { recursive: true });
    mkdirSync(job, { recursive: true });
    mkdirSync(records, { recursive: true });
    writeFileSync(join(ws, "scripts", "add.mjs"), ADD);
    writeFileSync(join(records, "workspace.json"), JSON.stringify({ folder: ws }));
    writeFileSync(join(records, "verdict.json"), JSON.stringify({ done: false, said: "The rounds are used up." }));
    const no = spawnSync("node", [script], { encoding: "utf8", env: { ...process.env, JOB_DIR: job, RECORDS: records } });
    assert.equal(no.status, 3);
    assert.match(JSON.parse(no.stdout).reply, /^Nothing is delivered: The rounds are used up\./);
    assert.equal(existsSync(join(job, "pieces.json")), false);
    writeFileSync(join(records, "verdict.json"), JSON.stringify({ done: true }));
    writeFileSync(join(records, "account.md"), "I wrote it.\n");
    writeFileSync(join(records, "runs.json"), JSON.stringify({ runs: [] }));
    const yes = spawnSync("node", [script], { encoding: "utf8", env: { ...process.env, JOB_DIR: job, RECORDS: records } });
    assert.equal(yes.status, 0, yes.stderr);
    assert.match(yes.stdout, /^3 pieces listed at/);
    assert.equal(readFileSync(join(job, "out", "account.md"), "utf8"), "I wrote it.\n");
    const wrong = spawnSync("node", [script], { encoding: "utf8", env: { ...process.env, JOB_DIR: "", RECORDS: "" } });
    assert.equal(wrong.status, 2);
  });
});
