// Filing the pieces: the draft goes out only as the drafting step wrote it.
//   node --test test/pieces.test.mjs
//
// What is pinned: the spec and the open questions are listed with the steps
// that made them; a draft whose bytes no longer match the digest draft.mjs
// recorded is refused with a sentence that says so and nothing is filed, which
// is what stops a harness's hand edit (its file tool cuts lines over 2000
// characters) from reaching anybody; and a record with no digest, written
// before there was one, still delivers. The INSTRUCTION the model is given now
// also carries the four things container and keyless specs got wrong.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { draftChanged, plan } from "../scripts/pieces.mjs";
import { INSTRUCTION, digestOf } from "../scripts/draft.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PIECES = join(HERE, "..", "scripts", "pieces.mjs");
const sha = (t) => createHash("sha256").update(t).digest("hex");
const LONG = JSON.stringify({ name: "x", jobs: [{ slug: "a", instructions: "word ".repeat(900) }] }, null, 2) + "\n";

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

test("the spec and the open questions are listed by the steps that made them", () => {
  const { entries } = plan({ draftPath: "/r/draft.json", blanks: [{ key: "name", question: "What is it called?" }] });
  assert.deepEqual(entries.map((e) => [e.name, e.step]), [["spec.json", "draft-the-spec"], ["still-open.txt", "ask-what-is-missing"]]);
  assert.throws(() => plan({}), /no draft to deliver/);
});

test("run as a command, a changed draft files nothing and exits 1 with the reason as the reply", () => {
  const dir = mkdtempSync(join(tmpdir(), "spec-writer-pieces-"));
  try {
    const records = join(dir, "records"); const job = join(dir, "job");
    mkdirSync(records, { recursive: true }); mkdirSync(job, { recursive: true });
    writeFileSync(join(records, "draft.json"), LONG.replace("word", "WORD"));
    writeFileSync(join(records, "calls.json"), JSON.stringify({ calls: "v1", draft_sha256: sha(LONG) }));
    const r = spawnSync(process.execPath, [PIECES], { env: { ...process.env, JOB_DIR: job, RECORDS: records }, encoding: "utf8" });
    assert.equal(r.status, 1);
    assert.match(JSON.parse(r.stdout.trim()).reply, /changed after the drafting step/);
    assert.equal(existsSync(join(job, "pieces.json")), false);

    writeFileSync(join(records, "draft.json"), LONG);
    const ok = spawnSync(process.execPath, [PIECES], { env: { ...process.env, JOB_DIR: job, RECORDS: records }, encoding: "utf8" });
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal(readFileSync(join(job, "out", "spec.json"), "utf8"), LONG);
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
