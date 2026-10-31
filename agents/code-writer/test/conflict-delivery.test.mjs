// A conflict reaches the build that asked (technical debt 636).
//   node --test test/conflict-delivery.test.mjs
//
// What is pinned: when the writer stops on a test that cannot pass without
// breaking what the spec says, records/conflict.md is delivered as the one
// piece, out/conflict.md, so the build that asked can show it to the person
// and offer to send the suite back to the test writer. Before this the host's
// delivery check refused a folder with no scripts, and the conflict's words
// never left the code writer's host. A conflict piece with scripts beside it,
// or an empty one, is still refused. A coding agent holding Code through a
// pull request is told in AGENTS.md exactly what to do: write
// records/conflict.md naming the test and the line, commit and push it to the
// branch, change nothing else, and wait for the tests to come back revised.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { plan } from "../scripts/pieces.mjs";
import { verify } from "../scripts/verify.mjs";
import { replyText } from "../scripts/report.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const SPEC = { name: "adder", version: "0.1.0", jobs: [{ slug: "add", offered: true, scripts: ["scripts/add.mjs"] }] };
const SUITE = '// adds\nimport { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { add } from "../scripts/add.mjs";\ntest("two and two are five", () => { assert.equal(add(2, 2), 5); });\n';
const CONFLICT = "# Conflict\n\ntest/add.test.mjs, \"two and two are five\", expects 5; the spec says add returns the sum, which is 4.\n";

function job({ out = {} } = {}) {
  const at = mkdtempSync(join(tmpdir(), "code-writer-conflict-"));
  mkdirSync(join(at, "in"), { recursive: true });
  writeFileSync(join(at, "in", "0-Ab3dEf9h-spec.json"), JSON.stringify(SPEC));
  writeFileSync(join(at, "in", "1-Zy8xWv7u-add.test.mjs"), SUITE);
  for (const [rel, text] of Object.entries(out)) { mkdirSync(dirname(join(at, rel)), { recursive: true }); writeFileSync(join(at, rel), text); }
  return at;
}
const withJob = (opts, body) => { const at = job(opts); try { return body(at); } finally { rmSync(at, { recursive: true, force: true }); } };

test("a job that stopped on a conflict files the conflict as its one piece, and nothing else", () => {
  const p = plan({ workspace: "/w", verdict: { done: false, said: "Round 2: 1 of 1 fails." }, scripts: [{ path: "scripts/add.mjs", text: "x" }], conflictPath: "/r/conflict.md" });
  assert.deepEqual(p.entries.map((e) => [e.name, e.path, e.media_type, e.step]), [["the conflict", "out/conflict.md", "text/markdown", "write-the-scripts"]]);
  assert.deepEqual(p.copies.map((c) => [c.from, c.to]), [["/r/conflict.md", "out/conflict.md"]]);
  assert.match(p.entries[0].about, /cannot pass without breaking what the spec says/);
  assert.throws(() => plan({ workspace: "/w", verdict: { done: false, said: "the rounds are used up" }, scripts: [] }), /nothing is delivered/, "without a conflict, a job not done still delivers nothing");
  const done = plan({ workspace: "/w", verdict: { done: true }, scripts: [{ path: "scripts/add.mjs", text: "// adds\n" }], conflictPath: "/r/conflict.md" });
  assert.ok(!done.entries.some((e) => e.path === "out/conflict.md"), "a job that is done delivers scripts, not a conflict");
});

test("the host's delivery check takes a conflict with no scripts, and says it is a conflict", () => {
  withJob({ out: { "out/conflict.md": CONFLICT } }, (at) => {
    const v = verify(at);
    assert.equal(v.ok, true, v.said);
    assert.equal(v.conflict, true);
    assert.match(v.said, /stopped on a conflict/);
  });
});

test("an empty conflict, or a conflict with scripts beside it, is refused", () => {
  withJob({ out: { "out/conflict.md": "  \n" } }, (at) => {
    const v = verify(at);
    assert.equal(v.ok, false);
    assert.match(v.said, /no scripts were delivered/);
  });
  withJob({ out: { "out/conflict.md": CONFLICT, "out/scripts/add.mjs": "export const add = (a, b) => a + b;\n" } }, (at) => {
    const v = verify(at);
    assert.equal(v.ok, false);
    assert.match(v.said, /scripts or a conflict, never both/);
  });
});

test("the reply on a conflict says the conflict goes with it and the build can send the suite back", () => {
  const r = replyText({ workspace: { scripts: ["scripts/add.mjs"] }, runs: [{ pass: 0, fail: 1, tests: 1 }], verdict: { done: false }, conflict: CONFLICT });
  assert.match(r, /^Stopped without delivering after 1 round: a test cannot pass without breaking what the spec says\./);
  assert.match(r, /two and two are five/);
  assert.match(r, /conflict\.md goes with this reply/);
  assert.match(r, /Send back to Test/);
});

test("AGENTS.md tells a coding agent exactly how to stop on a conflict and what happens next", () => {
  const t = readFileSync(join(here, "..", "references", "agents-md-template.md"), "utf8");
  const rule = t.split(/\n(?=\d+\. )/).find((x) => /^3\. /.test(x)) ?? "";
  assert.match(rule, /records\/conflict\.md/);
  assert.match(rule, /test file/i);
  assert.match(rule, /the test's name/i);
  assert.match(rule, /line/);
  assert.match(rule, /commit/i);
  assert.match(rule, /push/i);
  assert.match(rule, /nothing else/i);
  assert.match(rule, /Send back to Test/);
  assert.match(rule, /revised/i);
  assert.match(t, /## When a test is wrong/);
});
