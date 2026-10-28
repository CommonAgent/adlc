// The Design starts from the architecture record (Agent Roles, the solution
// architect; agents/solution-architect/references/architecture-standard.md):
// the record is read by its header, handed to the drafting step with what the
// Design owes it, and a draft is held to the record's systems, so a system the
// record does not name goes back to the architect as a question.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { kindOf, readingOf } from "../scripts/asked.mjs";
import { ARCHITECTURE_RULE, askForSpec, fitToArchitecture, requestParts, wentWithoutOf } from "../scripts/draft.mjs";
import { architectureProblems, checkDraft } from "../scripts/check-spec.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ARCHITECT = join(HERE, "..", "..", "solution-architect");
const RECORD = readFileSync(join(ARCHITECT, "references", "a-record-that-works.md"), "utf8");

const how = { control: "script", intelligence: "called", cost: "metered", contract: "full" };
const sentences = {
  when: "when somebody's customers are due to renew and should hear about it first",
  good: "A short reminder in every due customer's inbox, and an account of who was sent one and who was skipped and why, which a person reads.",
  empty: "If no customer is due, nothing is sent and the account says that nobody was due rather than reporting a failure.",
  does: "Reads the list, writes each reminder and sends it.",
};
const system = (name, access) => ({ name, access, kind: "service", credential: `${name}-key`, env: `${name.toUpperCase().replace(/-/g, "_")}_KEY` });
const DRAFT = {
  name: "renewal-reminders", version: "0.1.0",
  jobs: [{ slug: "remind", title: "Remind", offered: true, how, ...sentences }],
  refuses: Array.from({ length: 4 }, (_, i) => `refusing act ${i}, because it is not this agent's to do, and it says so instead`),
  records: [{ name: "the signed job manifest" }],
  price: { model: "free" },
  systems: [system("database", "read"), system("mail", "write"), system("text-reasoning", "trigger")],
};

const askedWithRecord = () => {
  const dir = mkdtempSync(join(tmpdir(), "spec-arch-"));
  const at = join(dir, "architecture-record.md");
  writeFileSync(at, RECORD);
  return readingOf({ text: "Write a spec. what it should do: renewal reminders", files: [{ path: at, media_type: "text/markdown" }] });
};

test("an architecture record attached is told by its header and read", () => {
  assert.equal(kindOf("architecture-record.md", "text/markdown", RECORD), "an architecture record");
  const asked = askedWithRecord();
  assert.deepEqual(asked.architecture.systems, ["database", "mail", "text-reasoning"]);
  assert.deepEqual(asked.architecture.environments, ["dev", "test", "production"]);
  assert.equal(asked.architecture.kind, "plugin-on-harness");
  assert.equal(asked.architecture.done, true);
});

test("the drafting step is handed the record once, with what the Design owes it", () => {
  const joined = requestParts({ asked: askedWithRecord() }).join("\n");
  assert.equal(joined.split("record: architecture-record-v1").length - 1, 1, "the record is handed over once, not again as a document");
  assert.match(joined, /--- THE ARCHITECTURE RECORD: architecture-record\.md ---/);
  assert.ok(joined.includes(ARCHITECTURE_RULE));
  assert.match(ARCHITECTURE_RULE, /Declare exactly the systems it names/);
  assert.match(ARCHITECTURE_RULE, /put "architecture" in "blanks"/);
});

test("an unfinished record is handed over as unfinished, and its questions are left open", () => {
  const dir = mkdtempSync(join(tmpdir(), "spec-arch-"));
  const at = join(dir, "r.md");
  writeFileSync(at, RECORD.replace("done: yes", "done: no").replace("questions: 0", "questions: 2"));
  const joined = requestParts({ asked: readingOf({ text: "renewal reminders", files: [{ path: at, media_type: "text/markdown" }] }) }).join("\n");
  assert.match(joined, /The record is not finished: 2 questions are still open in it\. Leave them open/);
});

test("a draft is held to the record's systems, both ways", () => {
  const architecture = { systems: ["database", "mail", "text-reasoning"] };
  assert.deepEqual(architectureProblems(DRAFT, architecture), []);
  const extra = { ...DRAFT, systems: [...DRAFT.systems, system("files", "write")] };
  assert.match(architectureProblems(extra, architecture)[0], /declares the system files, which the architecture record does not name/);
  const short = { ...DRAFT, systems: DRAFT.systems.slice(1) };
  assert.match(architectureProblems(short, architecture)[0], /names the system database and the draft does not declare it/);
  assert.deepEqual(architectureProblems(extra, null), [], "no record, no such finding");
  assert.ok(checkDraft(extra, { architecture }).some((f) => /does not name/.test(f)));
});

test("a system the record does not name is taken out of the draft and asked of the architect", async () => {
  const asked = askedWithRecord();
  const extra = { ...DRAFT, systems: [...DRAFT.systems, system("files", "write")] };
  let calls = 0;
  const out = await askForSpec({ asked, call: async () => { calls += 1; return JSON.stringify({ spec: extra, blanks: [] }); } });
  assert.equal(calls, 2, "it is asked once more with the finding first");
  assert.deepEqual(out.spec.systems.map((s) => s.name), ["database", "mail", "text-reasoning"]);
  const blank = out.blanks.find((b) => b.key === "architecture");
  assert.match(blank.question, /The design needs files, which the architecture record does not name/);
  assert.match(blank.question, /goes back to the solution architect/);
  assert.ok(!out.findings.some((f) => /does not name/.test(f)), "the finding is answered by the blank");
});

test("a draft within the record is one call and asks nothing of the architect", async () => {
  const out = await askForSpec({ asked: askedWithRecord(), call: async () => JSON.stringify({ spec: DRAFT, blanks: [] }) });
  assert.equal(out.calls, 1);
  assert.ok(!out.blanks.some((b) => b.key === "architecture"));
  assert.equal(fitToArchitecture(DRAFT, { systems: ["database", "mail", "text-reasoning"] }).blank, null);
});

test("a new draft without a record says it chose the systems itself; a revision does not", () => {
  const without = wentWithoutOf({ asked: "v1", said: "x", attached: [], missing_files: [] });
  assert.equal(without[0].wanted, "an architecture record");
  assert.match(without[0].did, /send the statement to the solution architect first/);
  assert.deepEqual(wentWithoutOf({ asked: "v1", attached: [], missing_files: [], revision: { how: "answer" } }), []);
  assert.deepEqual(wentWithoutOf({ ...askedWithRecord(), missing_files: [] }).filter((w) => w.wanted === "an architecture record"), []);
});

test("this copy of the record reader is the solution architect's, byte for byte", () => {
  const theirs = join(ARCHITECT, "scripts", "architecture-record.mjs");
  if (!existsSync(theirs)) return;
  assert.equal(readFileSync(join(HERE, "..", "scripts", "architecture-record.mjs"), "utf8"), readFileSync(theirs, "utf8"));
});
