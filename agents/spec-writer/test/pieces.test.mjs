// Filing the pieces: the agent's own files, only as the builder made them.
//   node --test test/pieces.test.mjs
//
// What is pinned: the pieces are the agent's own files (agent-descriptor.json,
// agent-runtime-requirements.json, plugin.json and a SKILL.md per skill) and
// the open questions, listed with the steps that made them, and never a
// spec.json; a draft whose bytes no longer match the digest draft.mjs recorded
// is refused with a sentence that says so and nothing is filed, which is what
// stops a harness's hand edit (its file tool cuts lines over 2000 characters)
// from reaching anybody, and so is a file changed after builds.mjs kept it;
// a record with no digest, written before there was one, still delivers; and
// a draft the builder did not take delivers no files. The INSTRUCTION the
// model is given also carries the four things container and keyless specs got
// wrong.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { draftChanged, pieceNameOf, plan } from "../scripts/pieces.mjs";
import { INSTRUCTION, digestOf } from "../scripts/draft.mjs";
import { checkBuilds } from "../scripts/builds.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PIECES = join(HERE, "..", "scripts", "pieces.mjs");
const BUILD_PY = join(HERE, "..", "..", "package-maker", "build.py");
const PUBLISHER = JSON.parse(readFileSync(join(HERE, "fixtures", "publisher.spec.json"), "utf8"));
const sha = (t) => createHash("sha256").update(t).digest("hex");
const LONG = JSON.stringify({ name: "x", jobs: [{ slug: "a", instructions: "word ".repeat(900) }] }, null, 2) + "\n";
const FILES = [
  { path: "agent-descriptor.json", sha256: "d" },
  { path: "agent-runtime-requirements.json", sha256: "r" },
  { path: "plugin.json", sha256: "m" },
  { path: "skills/read-it/SKILL.md", sha256: "s" },
];

test("a draft that still matches its recorded digest is not changed, and one with no digest recorded is taken as it is", () => {
  assert.equal(digestOf(LONG), sha(LONG));
  assert.equal(draftChanged(Buffer.from(LONG), { draft_sha256: sha(LONG) }), null);
  assert.equal(draftChanged(Buffer.from(LONG), null), null);
  assert.equal(draftChanged(Buffer.from(LONG), { calls: "v1" }), null);
});

test("a draft cut or edited after the drafting step is named as changed, and the reply says only draft.mjs writes one", () => {
  const cut = LONG.split("\n").map((l) => l.slice(0, 2000)).join("\n");
  assert.notEqual(cut, LONG);
  const said = draftChanged(Buffer.from(cut), { draft_sha256: sha(LONG) });
  assert.match(said, /changed after the drafting step wrote it/);
  assert.match(said, /only draft\.mjs writes a draft/);
});

test("the agent's own files and the open questions are listed by the steps that made them, and no spec.json", () => {
  const { entries, copies } = plan({ files: FILES, filesDir: "/r/agent", blanks: [{ key: "name", question: "What is it called?" }] });
  assert.deepEqual(entries.map((e) => [e.name, e.step, e.path]), [
    ["agent-descriptor.json", "draft-the-spec", "out/agent/agent-descriptor.json"],
    ["agent-runtime-requirements.json", "draft-the-spec", "out/agent/agent-runtime-requirements.json"],
    ["plugin.json", "draft-the-spec", "out/agent/plugin.json"],
    ["read-it.SKILL.md", "draft-the-spec", "out/agent/skills/read-it/SKILL.md"],
    ["what is still open", "ask-what-is-missing", "out/still-open.md"],
  ]);
  assert.deepEqual(entries.map((e) => e.media_type), [
    "application/vnd.agentmesh.agent-descriptor+json", "application/vnd.agentmesh.agent-runtime-requirements+json",
    "application/vnd.agentmesh.agent-plugin+json", "text/markdown", "text/markdown",
  ]);
  assert.equal(copies.at(-1).text, "# What is still open\n\n- `name`: What is it called?\n");
  assert.ok(!entries.some((e) => /spec\.json/.test(e.name + e.path)));
  assert.equal(copies[0].sha256, "d");
  assert.equal(pieceNameOf("skills/a-b/SKILL.md"), "a-b.SKILL.md");
  assert.equal(pieceNameOf("plugin.json"), "plugin.json");
});

test("a draft the builder did not take delivers no files, only what is still open", () => {
  const { entries } = plan({ files: [], blanks: [{ key: "price", question: "?" }] });
  assert.deepEqual(entries.map((e) => e.name), ["what is still open"]);
  assert.deepEqual(plan({}).entries, []);
});

/** A records folder as the four steps leave it, with the builder's own files. */
function recordsFrom(dir, spec) {
  const records = join(dir, "records"); const job = join(dir, "job");
  mkdirSync(records, { recursive: true }); mkdirSync(job, { recursive: true });
  const text = JSON.stringify(spec, null, 2) + "\n";
  writeFileSync(join(records, "draft.json"), text);
  writeFileSync(join(records, "calls.json"), JSON.stringify({ calls: "v1", draft_sha256: sha(text) }));
  const r = checkBuilds({ spec, env: { BUILD_PY }, keep: join(records, "agent") });
  assert.equal(r.ok, true, JSON.stringify(r.problems));
  writeFileSync(join(records, "builds.json"), JSON.stringify({ builds: "v1", ...r }));
  return { records, job, text, r };
}
const runPieces = (job, records) => spawnSync(process.execPath, [PIECES], { env: { ...process.env, JOB_DIR: job, RECORDS: records }, encoding: "utf8" });

test("run as a command, the builder's files are filed by their bytes, and a changed draft files nothing and exits 1 with the reason as the reply", () => {
  const dir = mkdtempSync(join(tmpdir(), "spec-writer-pieces-"));
  try {
    const { records, job, text, r } = recordsFrom(dir, PUBLISHER);
    writeFileSync(join(records, "draft.json"), text.replace("publisher", "PUBLISHER"));
    const bad = runPieces(job, records);
    assert.equal(bad.status, 1);
    assert.match(JSON.parse(bad.stdout.trim()).reply, /changed after the drafting step/);
    assert.equal(existsSync(join(job, "pieces.json")), false);

    writeFileSync(join(records, "draft.json"), text);
    const ok = runPieces(job, records);
    assert.equal(ok.status, 0, ok.stderr);
    const listed = JSON.parse(readFileSync(join(job, "pieces.json"), "utf8"));
    assert.deepEqual(listed.map((e) => e.path), r.files.list.map((f) => `out/agent/${f.path}`));
    for (const f of r.files.list) assert.equal(sha(readFileSync(join(job, "out", "agent", f.path))), f.sha256, f.path);
    assert.equal(existsSync(join(job, "out", "spec.json")), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a file changed after the builder made it is not delivered, and the reply says so", () => {
  const dir = mkdtempSync(join(tmpdir(), "spec-writer-pieces-edit-"));
  try {
    const { records, job } = recordsFrom(dir, PUBLISHER);
    const p = join(records, "agent", "agent-descriptor.json");
    writeFileSync(p, readFileSync(p, "utf8").replace("{", "{ "));
    const r = runPieces(job, records);
    assert.equal(r.status, 1);
    assert.match(JSON.parse(r.stdout.trim().split(/\r?\n/)[0]).reply, /changed after the builder made it/);
    assert.equal(existsSync(join(job, "pieces.json")), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the drafting instruction says what a kind is, where an address goes, what a refusal is, and what a container spec carries", () => {
  assert.match(INSTRUCTION, /"array of \.\.\." and "list of \.\.\." are\nnot kinds/);
  assert.match(INSTRUCTION, /No address goes anywhere in "systems"/);
  assert.match(INSTRUCTION, /draft-host is brokered/);
  assert.match(INSTRUCTION, /A refusal is something the agent will NOT do/);
  assert.match(INSTRUCTION, /third-party-framework or mesh-coded/);
  assert.match(INSTRUCTION, /put "container" in "blanks"/);
});

test("a container agent's draft makes no files, and its checked spec goes as spec.json, the one this agent still delivers", () => {
  const dir = mkdtempSync(join(tmpdir(), "spec-writer-pieces-container-"));
  try {
    const spec = { name: "box-agent", version: "0.1.0", description: "Answers in a box.", kind: "mesh-coded",
      container: { repository: "https://github.com/example/box-agent", commit: "0123456789abcdef0123456789abcdef01234567", dockerfile: "Dockerfile", placement: "service", holds_own_key: true },
      jobs: [{ slug: "answer", title: "Answer", offered: true, when: "when asked", good: "an answer", empty: "say so", how: { control: "script", intelligence: "none", cost: "none", contract: "full" } }],
      refuses: ["guessing"], records: ["the answer"] };
    const records = join(dir, "records"); const job = join(dir, "job");
    mkdirSync(records, { recursive: true }); mkdirSync(job, { recursive: true });
    const text = JSON.stringify(spec, null, 2) + "\n";
    writeFileSync(join(records, "draft.json"), text);
    const r = checkBuilds({ spec, env: { BUILD_PY }, keep: join(records, "agent") });
    assert.equal(r.ok, true, JSON.stringify(r.problems));
    assert.equal(r.container, true);
    assert.equal(r.files, undefined);
    writeFileSync(join(records, "builds.json"), JSON.stringify({ builds: "v1", ...r }));
    const ok = runPieces(job, records);
    assert.equal(ok.status, 0, ok.stderr);
    const listed = JSON.parse(readFileSync(join(job, "pieces.json"), "utf8"));
    assert.deepEqual(listed.map((e) => [e.name, e.path, e.media_type]), [["the container spec", "out/spec.json", "application/vnd.agentmesh.agent-spec+json"]]);
    assert.equal(readFileSync(join(job, "out", "spec.json"), "utf8"), text);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
