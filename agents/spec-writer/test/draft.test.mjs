// The drafting step: the one call that spends money.
//   node --test test/draft.test.mjs
//
// Nothing here touches the network. The call is a function the test hands in,
// which is what lets the two things that matter be pinned: that a model is
// asked twice at most and the second ask carries what was wrong with the
// first, and that the three things nobody may invent come back as blanks even
// when the model forgets to report them.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  INSTRUCTION, MODEL, TRIES, answerFrom, blanksOf, draftRequest, modelOf, requestParts, wentWithoutOf,
} from "../scripts/draft.mjs";

const ASKED = {
  asked: "v1",
  said: "an agent that watches the fleet and says who went quiet",
  attached: [{ name: "notes.md", kind: "a document", media_type: "text/markdown" }],
  missing_files: [],
};

const how = { control: "script", intelligence: "none", cost: "none", contract: "full" };
const sentences = {
  when: "when somebody needs to know which agents are answering",
  good: "A report naming every agent, when it last answered, and what it has spent against its declared ceiling, with anything unknown said as unknown.",
  empty: "If the platform will not say when an agent last answered, the report says so for that agent rather than reporting it as quiet.",
  does: "Reads the platform and reports who answered and what they spent.",
};
const GOOD_SPEC = {
  name: "watcher", version: "0.1.0",
  jobs: [{ slug: "report", title: "Report", offered: true, how, ...sentences }],
  refuses: Array.from({ length: 4 }, (_, i) => `refusing act ${i}, because it is not this agent's to do, and it says so instead`),
  // No went-without.json: this fixture ships no scripts, so declaring a record
  // nothing can write is itself a finding now.
  records: [{ name: "the signed job manifest" }],
  price: { model: "flat", amount_micro: 100000, currency: "USD" },
  systems: [],
};

test("the model is a setting, and the default is the current generation", () => {
  assert.equal(MODEL, "google-vertex-anthropic/claude-sonnet-5-5");
  assert.equal(modelOf({}), MODEL);
  assert.equal(modelOf({ TEXT_MODEL: "gemini-3.8-flash-cyber" }), "gemini-3.8-flash-cyber");
  assert.equal(modelOf({ TEXT_MODEL: "  " }), MODEL, "a blank setting is not a model");
  assert.equal(draftRequest({ env: { TEXT_MODEL: "x" } }).model, "x");
});

test("the request is the instruction, the request, the reference, and a spec that works", () => {
  const parts = requestParts({ asked: ASKED, reference: "# what a good spec carries", worked: '{"name":"publisher"}' });
  assert.equal(parts[0], INSTRUCTION);
  const joined = parts.join("\n");
  assert.match(joined, /WHAT THEY ASKED FOR[\s\S]*watches the fleet/);
  assert.match(joined, /WHAT CAME WITH IT[\s\S]*notes\.md \(a document, text\/markdown\)/);
  assert.match(joined, /WHAT A GOOD SPEC CARRIES/);
  assert.match(joined, /A WHOLE SPEC THAT WORKS/);
  // The order matters: what they asked for comes before what a good one looks
  // like, so the reference is read as a form to fill and not as the subject.
  assert.ok(joined.indexOf("WHAT THEY ASKED FOR") < joined.indexOf("WHAT A GOOD SPEC CARRIES"));
});

test("a file named and not there is said, with the instruction not to pretend", () => {
  const parts = requestParts({ asked: { ...ASKED, missing_files: ["rules.md"] } });
  const joined = parts.join("\n");
  assert.match(joined, /NAMED AND NOT THERE[\s\S]*rules\.md/);
  assert.match(joined, /Do not write the spec as though these arrived/);
});

test("the person's own answers outrank anything drafted for them", () => {
  const joined = requestParts({ asked: ASKED, answers: { name: "fleet-watcher" }, reference: "ref" }).join("\n");
  assert.match(joined, /THEY HAVE SINCE ANSWERED[\s\S]*name: fleet-watcher/);
  assert.ok(joined.indexOf("THEY HAVE SINCE ANSWERED") < joined.indexOf("WHAT A GOOD SPEC CARRIES"));
});

test("the three that may never be invented are named in the instruction", () => {
  assert.match(INSTRUCTION, /never invent/);
  for (const w of ["name", "price", "access to any system"]) assert.ok(INSTRUCTION.includes(w), w);
  // And the default shape, so a draft does not put a model in control by habit.
  assert.match(INSTRUCTION, /Default every job to a program/);
  // The first real run declared no systems for an agent the ask said reads
  // the platform's activity record, and called nothing open. An empty list is
  // an answer only when the request names nothing outside the agent's folder.
  assert.match(INSTRUCTION, /only when the request names\nnothing outside the agent's own folder/);
  assert.match(INSTRUCTION, /Never answer that question with an empty list/);
});

test("an answer is read whether it arrived fenced or bare", () => {
  const body = JSON.stringify({ spec: { name: "watcher" }, blanks: [], notes: "" });
  assert.deepEqual(answerFrom(body).spec, { name: "watcher" });
  assert.deepEqual(answerFrom("```json\n" + body + "\n```").spec, { name: "watcher" });
  assert.deepEqual(answerFrom("```\n" + body + "\n```").spec, { name: "watcher" });
});

test("an answer that is not one says which way it was not one", () => {
  assert.throws(() => answerFrom(""), /answered with nothing/);
  assert.throws(() => answerFrom("sure, here you go"), /did not answer with JSON/);
  assert.throws(() => answerFrom("[1,2]"), /JSON that is not an object/);
  assert.throws(() => answerFrom('{"blanks":[]}'), /carries no spec/);
});

test("a blank with no key is dropped rather than carried as an empty question", () => {
  const out = answerFrom(JSON.stringify({
    spec: { name: "watcher" },
    blanks: [{ key: "name", question: "what is it called?" }, { question: "orphan" }, null],
  }));
  assert.deepEqual(out.blanks, [{ key: "name", question: "what is it called?" }]);
});

test("a model that forgot to report a blank does not thereby settle it", () => {
  // This is the failure worth guarding: the draft looks complete, somebody
  // approves it, and an invented name is on the mesh.
  const invented = blanksOf({ ...GOOD_SPEC, name: "Watcher Of Things" }, []);
  assert.deepEqual(invented.map((b) => b.key), ["name"]);
  assert.ok(invented[0].question.length > 40, "a blank came back with no question to ask");
  const noPrice = blanksOf({ ...GOOD_SPEC, price: undefined }, []);
  assert.deepEqual(noPrice.map((b) => b.key), ["price"]);
});

test("an empty systems list is an answer, and an absent one is not", () => {
  // Most agents reach nothing outside their own folder, and saying so is a
  // decision. Never having decided is the blank.
  assert.deepEqual(blanksOf(GOOD_SPEC, []), []);
  assert.deepEqual(blanksOf({ ...GOOD_SPEC, systems: undefined }, []).map((b) => b.key), ["systems"]);
});

test("what the model said is kept, and what it missed is added beside it", () => {
  const said = [{ key: "price", question: "the model's own wording" }];
  const out = blanksOf({ ...GOOD_SPEC, name: "Nope", price: undefined }, said);
  assert.deepEqual(out.map((b) => b.key).sort(), ["name", "price"]);
  assert.equal(out.find((b) => b.key === "price").question, "the model's own wording");
});

test("a clean draft is one call, and nothing is asked twice for nothing", async () => {
  const { askForSpec } = await import("../scripts/draft.mjs");
  let calls = 0;
  const out = await askForSpec({
    asked: ASKED,
    call: async () => { calls += 1; return JSON.stringify({ spec: GOOD_SPEC, blanks: [] }); },
  });
  assert.equal(calls, 1);
  assert.equal(out.tried_again, false);
  assert.deepEqual(out.findings, []);
});

test("a draft with something wrong is asked once more, carrying what was wrong", async () => {
  const { askForSpec } = await import("../scripts/draft.mjs");
  const sent = [];
  const thin = { ...GOOD_SPEC, refuses: [] };
  const out = await askForSpec({
    asked: ASKED,
    call: async (request) => {
      sent.push(request.body.contents[0].parts.map((p) => p.text).join("\n"));
      return JSON.stringify({ spec: sent.length === 1 ? thin : GOOD_SPEC, blanks: [] });
    },
  });
  assert.equal(sent.length, 2);
  assert.equal(out.tried_again, true);
  assert.deepEqual(out.findings, []);
  assert.ok(!sent[0].includes("WHAT WAS WRONG"), "the first ask carried findings from nowhere");
  assert.match(sent[1], /WHAT WAS WRONG WITH YOUR LAST DRAFT[\s\S]*at least 4/);
  assert.match(sent[1], /Change nothing else/);
});

test("two goes and then it stands, with what still stands said out loud", async () => {
  const { askForSpec } = await import("../scripts/draft.mjs");
  let calls = 0;
  const thin = { ...GOOD_SPEC, refuses: [] };
  const out = await askForSpec({
    asked: ASKED,
    call: async () => { calls += 1; return JSON.stringify({ spec: thin, blanks: [] }); },
  });
  // A model told twice that it wrote no refusals will not write them on the
  // third ask, and the person is owed the draft plus the truth about it
  // rather than another two minutes of waiting.
  assert.equal(calls, TRIES);
  assert.equal(calls, 2);
  assert.equal(out.findings.length, 1);
  assert.match(out.findings[0], /at least 4/);
  assert.equal(out.spec.name, "watcher", "the draft was thrown away rather than delivered with its faults named");
});

test("no call at all is a plain refusal, not a crash", async () => {
  const { askForSpec } = await import("../scripts/draft.mjs");
  await assert.rejects(() => askForSpec({ asked: ASKED }), /needs a call/);
});

test("what a document says reaches the model, not just its name", () => {
  const asked = { ...ASKED, attached: [{ name: "notes.md", kind: "a document", media_type: "text/markdown", text: "It reads the ledger nightly and says who went quiet.", text_chars: 52 }] };
  const joined = requestParts({ asked, reference: "ref" }).join("\n");
  assert.match(joined, /WHAT CAME WITH IT[\s\S]*notes\.md \(a document/);
  assert.match(joined, /NOTES\.MD, A DOCUMENT, AS ATTACHED ---\n[\s\S]*reads the ledger nightly/);
  // What they sent is read before what a good one looks like, for the same
  // reason the request is: the reference is a form to fill, not the subject.
  assert.ok(joined.indexOf("AS ATTACHED") < joined.indexOf("WHAT A GOOD SPEC CARRIES"));
});

test("a cut attachment says it was cut, and how long the whole was", () => {
  const asked = { ...ASKED, attached: [{ name: "big.txt", kind: "a document", text: "abc", text_chars: 90000, cut: true }] };
  const joined = requestParts({ asked }).join("\n");
  assert.match(joined, /cut here; the whole file is 90000 characters/);
});

test("a spec they attached goes to the model as the thing to revise, after their answers", () => {
  const spec = JSON.stringify({ name: "watcher", version: "0.1.0", jobs: [{ slug: "watch" }] });
  const asked = { ...ASKED, attached: [
    { name: "notes.md", kind: "a document", text: "notes" },
    { name: "spec.json", kind: "a spec", media_type: "application/json", text: spec, text_chars: spec.length },
  ] };
  const joined = requestParts({ asked, answers: { price: "flat, five dollars" }, reference: "ref" }).join("\n");
  assert.match(joined, /A SPEC THEY ATTACHED: spec\.json ---\n[\s\S]*"name": ?"watcher"/);
  assert.match(joined, /keep everything they did not ask to change/);
  // Their answers, then the draft those answers change, then the reference.
  assert.ok(joined.indexOf("THEY HAVE SINCE ANSWERED") < joined.indexOf("A SPEC THEY ATTACHED"));
  assert.ok(joined.indexOf("A SPEC THEY ATTACHED") < joined.indexOf("WHAT A GOOD SPEC CARRIES"));
  // The spec is handed over once, not also pasted in as an ordinary attachment.
  assert.equal((joined.match(/"name": ?"watcher"/g) ?? []).length, 1);
  assert.match(joined, /NOTES\.MD, A DOCUMENT, AS ATTACHED/);
});

test("an attachment whose text was not read is named and nothing more", () => {
  const asked = { ...ASKED, attached: [{ name: "diagram.png", kind: "an image", media_type: "image/png" }] };
  const joined = requestParts({ asked }).join("\n");
  assert.match(joined, /diagram\.png \(an image, image\/png\)/);
  assert.doesNotMatch(joined, /AS ATTACHED/);
});

test("a file that never arrived and an attachment that was cut are both said as went-without, with what was done instead", () => {
  const asked = {
    ...ASKED,
    missing_files: ["rules.md"],
    attached: [
      { name: "notes.md", kind: "a document", text: "short", text_chars: 5 },
      { name: "everything.txt", kind: "a document", text: "x", text_chars: 90000, cut: true },
    ],
  };
  const went = wentWithoutOf(asked);
  assert.equal(went.length, 2, "the short attachment is not a thing gone without");
  assert.equal(went[0].wanted, "rules.md");
  assert.match(went[0].did, /^wrote the spec from what did arrive/, "did reads after \"it\"");
  assert.equal(went[1].wanted, "the whole of everything.txt");
  assert.match(went[1].did, /^read its first 40,000 characters/);
  assert.match(went[1].why, /90,000 characters/);
  assert.deepEqual(wentWithoutOf({ ...ASKED, missing_files: [] }), [], "nothing missing, nothing said");
});

test("a revision is drafted from the attached draft and its answers, and never from an answer alone", () => {
  const spec = { name: "incident-recorder", version: "0.1.0", jobs: [{ slug: "record-incident" }] };
  const attached = [{ name: "spec.json", kind: "a spec", media_type: "application/json", text: JSON.stringify(spec) }];
  const asked = { said: "here is your answer\nthe price is free", attached, missing_files: [], revision: { how: "relayed answer", answers: { said: "the price is free" } } };
  const joined = requestParts({ asked, answers: { said: "the price is free" } }).join("\n");
  assert.match(joined, /THE DRAFT THEY ARE ANSWERING ABOUT: spec\.json/);
  assert.match(joined, /This is a revision, not a new request\. The agent to write is the one this spec names/);
  assert.match(joined, /THEY HAVE SINCE ANSWERED[\s\S]*the price is free/);
  assert.throws(() => requestParts({ asked: { ...asked, attached: [] } }), /no draft came with it/);
});
