// The gathering step: what arrived, recorded without judging it.
//   node --test test/asked.test.mjs
//
// The thing worth pinning here is the absence of opinion. This step decides
// nothing about what the request settles, because that is a judgment and it
// belongs to the step that calls a model. What it must get right is that a
// fact is a fact: an attached spec is told apart from any other JSON, a file
// that is not there is recorded as not there rather than dropped, and the
// three things nobody can invent are marked as the person's to answer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  ASKED_OF_PERSON, KINDS, NEEDS, NOTHING_ASKED, TEXT_CAP, isText, kindOf, looksLikeDescriptor, looksLikeSpec,
  oneFile, parseFiles, readingOf, summary, revisionIn, earlierDraft, NO_DRAFT_TO_REVISE,
} from "../scripts/asked.mjs";
import { dirname, join as pjoin } from "node:path";
import { fileURLToPath } from "node:url";
const ASKED_SCRIPT = pjoin(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "asked.mjs");

const SPEC = JSON.stringify({
  name: "publisher", version: "0.1.0",
  jobs: [{ slug: "publish", title: "Publish", offered: true }],
});

const work = () => {
  const dir = mkdtempSync(join(tmpdir(), "spec-writer-"));
  const at = (name, body) => { const p = join(dir, name); writeFileSync(p, body); return p; };
  return { dir, at, drop: () => rmSync(dir, { recursive: true, force: true }) };
};

test("a spec is told apart from any other JSON by what is in it, not its name", () => {
  const w = work();
  try {
    // The name proves nothing: a file called spec.json can hold anything, and
    // a spec can arrive called anything at all.
    const real = w.at("whatever.json", SPEC);
    const fake = w.at("spec.json", JSON.stringify({ name: "publisher", jobs: [] }));
    assert.equal(oneFile({ path: real, media_type: "application/json" }).kind, "a spec");
    assert.equal(oneFile({ path: fake, media_type: "application/json" }).kind, "data");
    assert.equal(looksLikeSpec(JSON.parse(SPEC)), true);
    assert.equal(looksLikeSpec({ name: "x", jobs: [{ title: "no slug" }] }), false);
    assert.equal(looksLikeSpec({ jobs: [{ slug: "a" }] }), false, "a spec with no name is not a spec");
  } finally { w.drop(); }
});

test("a descriptor is not a spec, and neither is broken JSON", () => {
  const w = work();
  try {
    const desc = w.at("d.json", JSON.stringify({ agent: "Uxyz", offerings: [{ id: "publish" }] }));
    assert.equal(oneFile({ path: desc, media_type: "application/json" }).kind, "a descriptor");
    assert.equal(looksLikeDescriptor({ agent: "U", offerings: [] }), true);
    const broken = w.at("b.json", "{ not json");
    assert.equal(oneFile({ path: broken, media_type: "application/json" }).kind, "data");
  } finally { w.drop(); }
});

test("scripts, documents and images are told apart by extension and type", () => {
  assert.equal(kindOf("place.mjs"), "a script");
  assert.equal(kindOf("check.py"), "a script");
  assert.equal(kindOf("rules.md"), "a document");
  assert.equal(kindOf("notes.txt", "text/plain"), "a document");
  assert.equal(kindOf("shot.png", "image/png"), "an image");
  assert.equal(kindOf("logo.bin", "image/svg+xml"), "an image", "the type answers when the extension does not");
  assert.equal(kindOf("thing.bin"), "something else");
  for (const k of new Set([kindOf("a.mjs"), kindOf("a.md"), kindOf("a.png"), kindOf("a.bin")])) {
    assert.ok(KINDS.includes(k), `${k} is not one of the declared kinds`);
  }
});

test("a file that is not there is recorded as not there, never dropped", () => {
  const w = work();
  try {
    const reading = readingOf({ text: "watch the fleet", files: [{ path: join(w.dir, "gone.md") }] });
    assert.equal(reading.attached.length, 1, "a missing attachment vanished from the record");
    assert.equal(reading.attached[0].missing, true);
    assert.equal(reading.attached[0].kind, null, "a file nobody opened was given a kind");
    assert.deepEqual(reading.missing_files, ["gone.md"]);
    // An attachment the sender believes they sent and this agent never opened
    // is exactly the thing that has to be visible.
    assert.match(summary(reading), /1 named and not there: gone\.md/);
  } finally { w.drop(); }
});

test("an attached spec is named at the top of the record", () => {
  const w = work();
  try {
    const reading = readingOf({
      text: "like this one but for quizzes",
      files: [{ path: w.at("old.json", SPEC), media_type: "application/json" }, { path: w.at("r.md", "# rules") }],
    });
    assert.deepEqual(reading.spec_attached, ["old.json"]);
    assert.match(summary(reading), /a spec came with it: old\.json/);
  } finally { w.drop(); }
});

test("the checklist is whole every time, and nothing is marked settled", () => {
  const reading = readingOf({ text: "a thing that reads invoices" });
  assert.equal(reading.needs.length, NEEDS.length);
  assert.equal(reading.needs.length, 13);
  // This step judges nothing. A "settled" flag here would be a decision made
  // without a model, by a script that read no further than the word count.
  for (const n of reading.needs) {
    assert.deepEqual(Object.keys(n), ["key", "what", "settled_by"]);
    assert.ok(!("settled" in n));
  }
  assert.deepEqual(reading.needs.map((n) => n.key), NEEDS.map((n) => n.key));
});

test("three things are the person's to answer, and each carries the question", () => {
  assert.deepEqual(ASKED_OF_PERSON, ["name", "systems", "price"]);
  for (const key of ASKED_OF_PERSON) {
    const need = NEEDS.find((n) => n.key === key);
    assert.ok(need.ask && need.ask.length > 40, `${key} is asked of the person with no question written`);
  }
  // Everything else can be drafted and put to them for correction. Inventing
  // a name, a price or an access grant is worse than asking for it.
  for (const n of NEEDS.filter((x) => x.settled_by === "drafting")) assert.ok(!n.ask);
});

test("nothing to work from is this step's stop, before any model is woken", () => {
  const reading = readingOf({ text: "   ", files: [] });
  assert.equal(reading.words, 0);
  assert.equal(reading.attached.length, 0);
  assert.match(NOTHING_ASKED, /Say what you want the agent to do/);
  // And the words are counted honestly, so one word is not nothing.
  assert.equal(readingOf({ text: "invoices" }).words, 1);
});

test("FILES is read as path::media_type, and a bare path still works", () => {
  assert.deepEqual(parseFiles("/a/b.md::text/markdown, /c/d.json::application/json"), [
    { path: "/a/b.md", media_type: "text/markdown" },
    { path: "/c/d.json", media_type: "application/json" },
  ]);
  assert.deepEqual(parseFiles("/a/b.md"), [{ path: "/a/b.md", media_type: "" }]);
  assert.deepEqual(parseFiles(""), []);
  assert.deepEqual(parseFiles(undefined), []);
  // A Windows path carries a colon of its own, so the LAST :: is the seam.
  assert.deepEqual(parseFiles("C:/x/y.json::application/json"), [{ path: "C:/x/y.json", media_type: "application/json" }]);
});

test("the request is kept as it arrived, not tidied", () => {
  const messy = "  i want\n\nsomething that WATCHES the fleet  ";
  const reading = readingOf({ text: messy });
  assert.equal(reading.said, messy, "the request was edited before it was recorded");
  assert.equal(reading.words, 7);
});

test("run from the shell, it writes the record the next step reads", () => {
  const w = work();
  try {
    const records = join(w.dir, "records", "job1");
    const job = join(w.dir, "job");
    mkdirSync(job, { recursive: true });
    const text = w.at("message.txt", "an agent that watches the fleet and says who went quiet");
    const spec = w.at("old.json", SPEC);
    const r = spawnSync(process.execPath, [join(import.meta.dirname, "..", "scripts", "asked.mjs")], {
      encoding: "utf8",
      env: { ...process.env, JOB_DIR: job, RECORDS: records, TEXT_FILE: text, FILES: `${spec}::application/json` },
    });
    assert.equal(r.status, 0, r.stderr);
    const said = JSON.parse(r.stdout);
    assert.equal(said.ok, true);
    const doc = JSON.parse(readFileSync(join(records, "asked.json"), "utf8"));
    assert.equal(doc.asked, "v1");
    assert.deepEqual(doc.spec_attached, ["old.json"]);
    assert.equal(doc.needs.length, 13);
  } finally { w.drop(); }
});

test("what a text attachment says is carried to the drafting step, and an image's bytes are not", () => {
  const w = work();
  try {
    const doc = w.at("design.md", "# The watcher\nIt reads the ledger and says who went quiet.");
    const png = w.at("diagram.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]));
    const read = oneFile({ path: doc, media_type: "text/markdown" });
    assert.equal(read.kind, "a document");
    assert.match(read.text, /says who went quiet/);
    assert.equal(read.text_chars, read.text.length);
    assert.equal(read.cut, undefined, "a short file is not marked cut");
    const image = oneFile({ path: png, media_type: "image/png" });
    assert.equal(image.kind, "an image");
    assert.equal("text" in image, false, "an image is named, never read");
    assert.equal(isText("notes.pdf", "application/pdf"), false, "a PDF is a document and is not text");
    assert.equal(isText("check.mjs"), true);
    assert.equal(isText("photo.jpg"), false);
  } finally { w.drop(); }
});

test("a long attachment is cut at the cap and the record says so", () => {
  const w = work();
  try {
    const long = w.at("everything.txt", "x".repeat(TEXT_CAP + 500));
    const read = oneFile({ path: long, media_type: "text/plain" });
    assert.equal(read.text.length, TEXT_CAP);
    assert.equal(read.text_chars, TEXT_CAP + 500);
    assert.equal(read.cut, true);
  } finally { w.drop(); }
});

// ── a revision is answers about a draft, never a new request (2026-09-15) ──

test("a relayed answer, a send-back with changes and keyed answers are read as a revision; a request is not", () => {
  const relayed = revisionIn("run r-20260915-f17b phase write-the-spec: here is your answer\nthe price is free, no fee; the agent reaches no system\n(answered by the owner, process-runner.example)\nContinue the work and reply to the original message when it is delivered.");
  assert.equal(relayed.how, "relayed answer");
  assert.match(relayed.answers.said, /the price is free/);
  assert.doesNotMatch(relayed.answers.said, /Continue the work|answered by the owner|here is your answer/);
  const back = revisionIn("run r-1 phase approve-the-spec: changes: systems: none. price: free.");
  assert.equal(back.how, "sent back with changes");
  const keyed = revisionIn("name: incident-recorder\nprice: free\nsystems: none");
  assert.deepEqual(keyed.answers.name, "incident-recorder");
  assert.deepEqual(keyed.answers.price, "free");
  assert.equal(revisionIn("I want an agent called incident-recorder that records incidents."), null);
  assert.equal(readingOf({ text: "I want an agent." }).revision, undefined);
  assert.equal(readingOf({ text: "answer: free" }).revision.how, "answer");
});

test("the Build page's request names the agent and its price and is still a request, not a revision", () => {
  const request = [
    "Write a spec.", "", "what it should do: Replies pong to ping.", "",
    "The four answers, settled for this person:", "- which kind of agent: plugin-on-harness", "",
    "name: ping-pong", "price: free. It is the person's own agent.",
  ].join("\n");
  assert.equal(revisionIn(request), null);
  assert.equal(readingOf({ text: request }).revision, undefined);
  // An answer sent with the same opening is still an answer.
  assert.equal(revisionIn("Write a spec.\nwhat it should do: x\nanswer: free").how, "answer");
});

test("the newest earlier draft is found under the records root, and nothing when there is none", () => {
  const w = work();
  try {
    mkdirSync(pjoin(w.dir, "old"), { recursive: true }); mkdirSync(pjoin(w.dir, "new"), { recursive: true });
    writeFileSync(pjoin(w.dir, "old", "draft.json"), "{}"); writeFileSync(pjoin(w.dir, "new", "draft.json"), "{}");
    const mt = { [pjoin(w.dir, "old", "draft.json")]: 1, [pjoin(w.dir, "new", "draft.json")]: 2 };
    assert.equal(earlierDraft(w.dir, { mtime: (p) => mt[p] }), pjoin(w.dir, "new", "draft.json"));
    assert.equal(earlierDraft(pjoin(w.dir, "nowhere")), null);
  } finally { w.drop(); }
});

test("run as the harness runs it, a revision writes the answers, takes the earlier draft, and stops without any draft", () => {
  const w = work();
  try {
    const records = pjoin(w.dir, "records", "job-2");
    mkdirSync(pjoin(w.dir, "records", "job-1"), { recursive: true });
    writeFileSync(pjoin(w.dir, "records", "job-1", "draft.json"), SPEC);
    const text = w.at("m.txt", "run r-1 phase write-the-spec: here is your answer\nthe price is free\nContinue the work and reply to the original message when it is delivered.");
    const env = { ...process.env, JOB_DIR: w.dir, RECORDS: records, TEXT_FILE: text, FILES: "" };
    const r = spawnSync(process.execPath, [ASKED_SCRIPT], { env, encoding: "utf8" });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const out = JSON.parse(r.stdout.trim().split(/\r?\n/).pop());
    assert.match(out.said, /a revision \(relayed answer\)/);
    const asked = JSON.parse(readFileSync(pjoin(records, "asked.json"), "utf8"));
    assert.deepEqual(asked.spec_attached, ["draft.json"], "the earlier draft was taken as the one to revise");
    assert.equal(asked.revision.draft_from, pjoin(w.dir, "records", "job-1", "draft.json"));
    const answers = JSON.parse(readFileSync(pjoin(records, "answers.json"), "utf8"));
    assert.match(answers.said, /the price is free/);

    // No earlier draft anywhere: the step stops before a model is woken.
    const bare = pjoin(w.dir, "elsewhere", "job-9");
    const r2 = spawnSync(process.execPath, [ASKED_SCRIPT], { env: { ...env, RECORDS: bare }, encoding: "utf8" });
    assert.equal(r2.status, 3);
    assert.equal(JSON.parse(r2.stdout.trim().split(/\r?\n/).pop()).reply, NO_DRAFT_TO_REVISE);
  } finally { w.drop(); }
});

test("the agent's own files, sent back with answers, are a revision of the draft they describe", async () => {
  const { requestParts } = await import("../scripts/draft.mjs");
  const desc = JSON.stringify({ format: "agent-descriptor-v1", agent_version: "0.1.0", offerings: [{ id: "a" }] });
  const runtime = JSON.stringify({ format: "agent-runtime-requirements-v1", systems: [] });
  const manifest = JSON.stringify({ version: "0.1.0", extensions: { "net.agentdoc.package": { build: { skills: { a: {} } } } } });
  const skill = "---\nname: ab\ndescription: when\n---\n\n# A\n";
  const bodies = { "/f/0-abcdefgh-agent-descriptor.json": desc, "/f/rr.json": runtime, "/f/plugin.json": manifest, "/f/a.SKILL.md": skill };
  const io = { exists: (p) => p in bodies, read: (p) => bodies[p], size: (p) => bodies[p].length };
  assert.equal(kindOf("/f/x.json", "application/json", desc), "an agent's own file");
  assert.equal(kindOf("/f/x.json", "application/json", runtime), "an agent's own file");
  assert.equal(kindOf("/f/plugin.json", "application/json", manifest), "an agent's own file");
  assert.equal(kindOf("/f/a.SKILL.md", "text/markdown", skill), "an agent's own file");
  assert.ok(KINDS.includes("an agent's own file"));
  const reading = readingOf({ text: "answer: name: tone-teller", files: Object.keys(bodies).map((path) => ({ path })), io });
  assert.ok(reading.revision);
  assert.deepEqual(reading.spec_attached, []);
  assert.equal(reading.files_attached.length, 4);
  assert.match(summary(reading), /the agent's own files came with it/);
  const parts = requestParts({ asked: reading });
  assert.ok(parts.some((p) => p.includes("The agent's own files above, the ones this agent delivered, are the draft.")));
  assert.match(NO_DRAFT_TO_REVISE, /Attach the draft's files/);
  assert.doesNotMatch(NO_DRAFT_TO_REVISE, /spec\.json/);
});

test("run as the harness runs it, the agent's files sent back are read as the spec they state, and that is the draft revised", async () => {
  const { mkdtempSync, mkdirSync, copyFileSync, readFileSync: read, readdirSync, rmSync: rm, writeFileSync: write } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { specOfFolder } = await import("../../package-maker/agent-folder.mjs");
  const pub = pjoin(dirname(fileURLToPath(import.meta.url)), "..", "..", "publisher");
  const dir = mkdtempSync(pjoin(tmpdir(), "spec-writer-sent-back-"));
  try {
    const att = pjoin(dir, "att"); mkdirSync(att);
    const files = [];
    const put = (rel, sent) => { const p = pjoin(att, `${files.length}-Ab12cdEF-${sent}`); copyFileSync(pjoin(pub, rel), p); files.push(p); };
    put("agent-descriptor.json", "agent-descriptor.json");
    put("agent-runtime-requirements.json", "agent-runtime-requirements.json");
    put("plugin.json", "plugin.json");
    for (const slug of readdirSync(pjoin(pub, "skills"))) put(pjoin("skills", slug, "SKILL.md"), `${slug}.SKILL.md`);
    const records = pjoin(dir, "records", "job-2"); const job = pjoin(dir, "job"); mkdirSync(job, { recursive: true });
    const textFile = pjoin(dir, "message.txt"); write(textFile, "answer: price: free\n");
    const r = spawnSync(process.execPath, [ASKED_SCRIPT], { encoding: "utf8",
      env: { ...process.env, JOB_DIR: job, RECORDS: records, TEXT_FILE: textFile, FILES: files.join(",") } });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const asked = JSON.parse(read(pjoin(records, "asked.json"), "utf8"));
    assert.deepEqual(asked.spec_attached, ["sent-back.json"]);
    assert.equal(asked.revision.draft_from, "the attached files");
    assert.deepEqual(JSON.parse(read(pjoin(records, "sent-back.json"), "utf8")), specOfFolder(pub));
  } finally { rm(dir, { recursive: true, force: true }); }
});

test("an unnamed draft's files sent back are still the draft revised", async () => {
  const { mkdtempSync, writeFileSync: write, readFileSync: read, rmSync: rm, mkdirSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { agentFilesOf } = await import("../scripts/files.mjs");
  const spec = JSON.parse(read(pjoin(dirname(fileURLToPath(import.meta.url)), "fixtures", "publisher.spec.json"), "utf8"));
  delete spec.name;
  const dir = mkdtempSync(pjoin(tmpdir(), "spec-writer-unnamed-back-"));
  try {
    const files = Object.entries(agentFilesOf(spec)).map(([rel, text], i) => { const p = pjoin(dir, `${i}-Ab12cdEF-${rel.replace(/\//g, "_")}`); write(p, text); return p; });
    const records = pjoin(dir, "records", "j"); const job = pjoin(dir, "job"); mkdirSync(job, { recursive: true });
    const textFile = pjoin(dir, "m.txt"); write(textFile, "answer: name: tone-teller\n");
    const r = spawnSync(process.execPath, [ASKED_SCRIPT], { encoding: "utf8", env: { ...process.env, JOB_DIR: job, RECORDS: records, TEXT_FILE: textFile, FILES: files.join(",") } });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const asked = JSON.parse(read(pjoin(records, "asked.json"), "utf8"));
    assert.deepEqual(asked.spec_attached, ["sent-back.json"]);
    assert.equal(asked.attached.find((a) => a.name === "sent-back.json").kind, "a spec");
  } finally { rm(dir, { recursive: true, force: true }); }
});
