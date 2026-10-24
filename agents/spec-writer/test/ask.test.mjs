// The reply: what was drafted, what is still open, and what nobody checked.
//   node --test test/ask.test.mjs
//
// Two things have to be true of every reply this agent sends. The draft goes
// whatever happens, because a spec missing its name is still most of the work
// and reading it is what lets somebody answer the question about the name.
// And a draft that is short of something never arrives looking complete: an
// invented name reaching the mesh is the failure this whole step exists to
// stop.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ASK_ORDER, draftLine, questionsFor, replyText, stillOpen } from "../scripts/ask.mjs";
import { NEEDS } from "../scripts/asked.mjs";

const SPEC = {
  name: "fleet-watcher",
  jobs: [
    { slug: "report", title: "Report", offered: true },
    { slug: "read-the-platform" }, { slug: "read-the-spend" }, { slug: "write-the-report" },
  ],
};

test("the questions are asked identity, then authority, then money", () => {
  assert.deepEqual(ASK_ORDER, ["name", "systems", "price"]);
  // Taken from the checklist rather than restated here, so the two cannot
  // drift into two different orders.
  assert.deepEqual(ASK_ORDER, NEEDS.filter((n) => n.settled_by === "the person").map((n) => n.key));
  const asked = questionsFor([{ key: "price" }, { key: "systems" }, { key: "name" }]);
  assert.deepEqual(asked.map((q) => q.key), ["name", "systems", "price"]);
});

test("a blank with no question of its own gets the standing one", () => {
  const [only] = questionsFor([{ key: "name" }]);
  assert.equal(only.question, NEEDS.find((n) => n.key === "name").ask);
  assert.match(only.question, /cannot be changed later without a redeploy/);
});

test("a question the model wrote better than the standing one is kept", () => {
  const [only] = questionsFor([{ key: "price", question: "This reads the ledger once an hour. Flat, or free?" }]);
  assert.equal(only.question, "This reads the ledger once an hour. Flat, or free?");
});

test("a blank nobody has a standing question for still gets asked", () => {
  const [only] = questionsFor([{ key: "harness" }]);
  assert.equal(only.key, "harness");
  assert.ok(only.question.length > 0, "a blank came back with nothing to ask");
});

test("the draft is named in one line, and an unnamed one says so", () => {
  assert.equal(draftLine(SPEC), "The draft is fleet-watcher, which offers Report, in three steps.");
  assert.equal(draftLine({ ...SPEC, name: "" }), "The draft offers Report, in three steps, and has no name yet.");
  assert.equal(draftLine({ jobs: [{ slug: "r", title: "Report", offered: true }] }), "The draft offers Report, and has no name yet.");
  assert.match(draftLine({}), /^The draft offers one job/);
});

test("the open questions come second, before anything about checking", () => {
  const said = replyText({
    spec: { ...SPEC, name: "" },
    blanks: [{ key: "name" }, { key: "price" }],
    verdict: "The builder refuses this spec: the spec names no name.",
  });
  const first = said.indexOf("still open");
  assert.ok(first > 0 && first < said.indexOf("The builder"), "the checking came before the thing to act on");
  // Counted in words and capitalised, because "2 things are still open" reads
  // like a form and this is a sentence somebody has to act on.
  assert.match(said, /Two things are still open/);
});

test("each question is on its own line", () => {
  const said = replyText({ spec: SPEC, blanks: [{ key: "name" }, { key: "systems" }, { key: "price" }] });
  for (const key of ["name", "systems", "price"]) {
    assert.match(said, new RegExp(`\\n${key}: `), `${key} is not on a line of its own`);
  }
});

test("the reply says plainly that nothing was guessed", () => {
  const said = replyText({ spec: SPEC, blanks: [{ key: "name" }] });
  assert.match(said, /I have not guessed at it/);
  assert.match(said, /a name becomes a handle somebody is stuck with/);
  assert.match(said, /not finished until this is settled/);
});

test("nothing open says so, and does not leave the reader looking for a question", () => {
  const said = replyText({ spec: SPEC, blanks: [] });
  assert.match(said, /Nothing is left open/);
  assert.ok(!said.includes("still open"));
  assert.deepEqual(stillOpen([]), []);
});

test("answers from a previous round are named back", () => {
  const said = replyText({ spec: SPEC, blanks: [], answered: ["name", "price"] });
  assert.match(said, /Two answers from your last message went in: name, price\./);
});

test("what was drafted rather than asked for is pointed at", () => {
  const said = replyText({ spec: SPEC, blanks: [], notes: "the refusals and the records, which you never mentioned" });
  assert.match(said, /read this part hardest: the refusals and the records, which you never mentioned\./);
  // And a note that already ends in a stop does not get a second one.
  assert.doesNotMatch(replyText({ spec: SPEC, notes: "the refusals." }), /refusals\.\./);
});

test("findings that survived two goes are delivered with the draft, not instead of it", () => {
  const said = replyText({ spec: SPEC, blanks: [], findings: ["the spec names 0 refusals"] });
  assert.match(said, /this still stands: the spec names 0 refusals/);
  assert.match(said, /delivered as it is, so you can see it and say what to fix/);
  assert.match(said, /^The draft is fleet-watcher/, "the draft was withheld because of a finding");
});

test("what the job went without rides on the end of the reply", () => {
  const said = replyText({
    spec: SPEC, blanks: [],
    wentWithout: "This job went ahead without rules.md: it drafted the refusals from the request alone.",
  });
  assert.match(said, /This job went ahead without rules\.md/);
});

test("a reply with everything in it still reads in one pass", () => {
  const said = replyText({
    spec: { ...SPEC, name: "" },
    blanks: [{ key: "name" }, { key: "systems" }, { key: "price" }],
    notes: "the refusals",
    verdict: "The builder refuses this spec: the spec names no name.",
    findings: ["the spec names 0 refusals"],
    wentWithout: "This job went ahead without rules.md: it drafted the refusals from the request alone.",
    answered: ["price"],
  });
  // Every part present, in the order the file promises: what it is, what to
  // do, what was checked, then the caveats.
  const at = (s) => said.indexOf(s);
  assert.ok(at("The draft offers") === 0);
  assert.ok(at("still open") < at("The builder"));
  assert.ok(at("The builder") < at("read this part hardest"));
  assert.ok(at("read this part hardest") < at("went ahead without"));
  assert.ok(!said.includes("undefined") && !said.includes("[object"));
});

test("the reply never claims a draft will not build", () => {
  // Found by reading a real run: some blanks stop the builder and some do not,
  // and the builder's own verdict is in the same reply. "It will not build
  // until these are settled", three sentences above "The builder takes this
  // spec", is the kind of contradiction that makes a reader stop believing
  // the rest of it.
  const said = replyText({
    spec: SPEC, blanks: [{ key: "systems" }],
    verdict: "The builder takes this spec.",
  });
  assert.ok(!said.includes("will not build"), said);
  assert.match(said, /not finished until this is settled/);
  assert.match(said, /The builder takes this spec\./);
});

test("one open question is written as one, not as some of them", () => {
  assert.match(replyText({ spec: SPEC, blanks: [{ key: "name" }] }), /I have not guessed at it:/);
  assert.match(replyText({ spec: SPEC, blanks: [{ key: "name" }, { key: "price" }] }), /I have not guessed at any of them:/);
  assert.match(replyText({ spec: SPEC, blanks: [{ key: "name" }, { key: "price" }] }), /until these are settled/);
});

test("the reply says which of the agent's own files went, or that none did and why", async () => {
  const { filesLine } = await import("../scripts/ask.mjs");
  const went = replyText({ spec: SPEC, files: ["agent-descriptor.json", "agent-runtime-requirements.json", "plugin.json", "skills/a/SKILL.md", "skills/b/SKILL.md"] });
  assert.match(went, /The agent's own files are delivered, the layout a package is built from: agent-descriptor.json, agent-runtime-requirements.json, plugin.json and two SKILL.md files./);
  assert.match(filesLine(["plugin.json", "skills/a/SKILL.md"]), /and one SKILL.md\.$/);
  assert.match(replyText({ spec: SPEC, files: [] }), /No files are delivered with this draft, because the builder did not make a package of it/);
  // A round that never reached the builder says nothing about files.
  assert.doesNotMatch(replyText({ spec: SPEC }), /files are delivered/);
  assert.doesNotMatch(went, /spec\.json/);
});
