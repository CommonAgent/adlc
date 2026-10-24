// The reply: what was written, what the check said, what could not be tested.
//   node --test test/reply.test.mjs
//
// The order is the thing worth pinning. A reader who stops after two
// sentences has to have read what was written and what the check said about
// it, because that is what decides whether to use it. And a suite that passed
// against nothing has to be called not a suite before anything else is said
// about it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { replyText, wroteLine } from "../scripts/reply.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, "..", "scripts", "reply.mjs");

const DECLARED = { name: "watcher", version: "0.1.0" };
const SUITE = {
  files: [{ path: "test/read.test.mjs", tests: 6 }, { path: "test/say.test.mjs", tests: 3 }],
  could_not: [{ what: "the platform read", why: "nothing can stand in the platform." }, { what: "", why: "dropped" }],
  notes: "assumed the roster is JSON",
  findings: [],
  stand_ins: { scripts: 2, tests: 1, pass: 0, fail: 1, fails: true },
};
const CHECKED = { files: ["test/read.test.mjs", "test/say.test.mjs"], verdict: "Against empty stand-ins for the 2 scripts it names, the suite fails (0 of 1 pass), which is what a suite written before the scripts must do." };

test("the reply opens with what was written, then the verdict as the check wrote it, then what could not be tested", () => {
  const r = replyText({ declared: DECLARED, suite: SUITE, checked: CHECKED });
  const paras = r.split("\n\n");
  assert.equal(paras[0], "Wrote 9 tests in 2 files for watcher 0.1.0: read.test.mjs, say.test.mjs.");
  assert.equal(paras[1], CHECKED.verdict);
  assert.equal(paras[2], "It could not write a test for the platform read: nothing can stand in the platform.");
  assert.equal(paras[3], "It assumed: assumed the roster is JSON.");
  assert.match(paras[paras.length - 1], /^The scripts that meet this suite are the code writer's to write/);
  assert.doesNotMatch(r, /dropped/, "a could-not with nothing in it is not said");
});

test("when the checking step never ran, the writing step's own stand-in run is said instead", () => {
  const r = replyText({ declared: DECLARED, suite: SUITE, checked: null });
  assert.match(r.split("\n\n")[1], /^Against empty stand-ins for the 2 scripts it names, the suite fails \(0 of 1 pass\)/);
  const passed = replyText({ declared: DECLARED, suite: { ...SUITE, stand_ins: { scripts: 2, tests: 4, pass: 4, fail: 0, fails: false } } });
  assert.match(passed.split("\n\n")[1], /the suite passes \(4 of 4\), so it asserts nothing about the scripts\. It is not a suite yet\./);
});

test("findings that survived two goes are said as such, right after the verdict", () => {
  const r = replyText({ declared: DECLARED, suite: { ...SUITE, findings: ["nothing reaches scripts/say.mjs"] }, checked: CHECKED });
  assert.equal(r.split("\n\n")[2], "After two goes the suite still has 1 thing wrong with it, and it goes with that said: nothing reaches scripts/say.mjs.");
  const two = replyText({ declared: DECLARED, suite: { ...SUITE, findings: ["a", "b"] } });
  assert.match(two, /still has 2 things wrong with it, and it goes with those said: a; b\./);
});

test("what the job went without rides on the end, before the closing line", () => {
  const r = replyText({ declared: DECLARED, suite: SUITE, checked: CHECKED, wentWithout: "This job went ahead without one of the things it takes: the reference." });
  const paras = r.split("\n\n");
  assert.equal(paras[paras.length - 2], "This job went ahead without one of the things it takes: the reference.");
});

test("a check with no suite record says what was checked, and nothing at all is said plainly", () => {
  assert.equal(wroteLine(DECLARED, null, CHECKED), "Checked the suite of 2 files for watcher 0.1.0: read.test.mjs, say.test.mjs.");
  assert.equal(wroteLine(DECLARED, null, null), "Nothing was written for watcher 0.1.0.");
  assert.equal(wroteLine(null, { files: [{ path: "test/a.test.mjs", tests: 1 }] }), "Wrote 1 test in 1 file for the package: a.test.mjs.");
  const proved = replyText({ declared: DECLARED, checked: { ...CHECKED, verdict: "Against watcher's own scripts, all 9 pass. Broken one script at a time, the suite noticed every one of the 2." } });
  assert.match(proved, /^Checked the suite of 2 files[\s\S]*all 9 pass/);
});

test("as a process it exits 2 without RECORDS, and otherwise prints one JSON object whose reply is the whole answer", () => {
  const wrong = spawnSync("node", [script], { encoding: "utf8", env: { ...process.env, RECORDS: "" } });
  assert.equal(wrong.status, 2);
  const dir = mkdtempSync(join(tmpdir(), "test-writer-reply-"));
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "declared.json"), JSON.stringify(DECLARED));
    writeFileSync(join(dir, "suite.json"), JSON.stringify(SUITE));
    writeFileSync(join(dir, "checked.json"), JSON.stringify(CHECKED));
    const r = spawnSync("node", [script], { encoding: "utf8", env: { ...process.env, RECORDS: dir } });
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.ok, true);
    assert.match(out.reply, /^Wrote 9 tests in 2 files/);
    // No record at all is still a reply, not a crash.
    const bare = spawnSync("node", [script], { encoding: "utf8", env: { ...process.env, RECORDS: join(dir, "nowhere") } });
    assert.equal(bare.status, 0, bare.stderr);
    assert.match(JSON.parse(bare.stdout).reply, /^Nothing was written for the package\./);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
