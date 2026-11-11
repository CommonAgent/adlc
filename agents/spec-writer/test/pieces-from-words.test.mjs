// The pieces an offering takes and hands back go from the person's words into
// the spec, and from the spec into the files; an offering with none is asked.
//   node --test test/pieces-from-words.test.mjs
//
// No model and no network: the stand-in models are functions in this file.
// In build b_393a1f45c7a4 (hn-digest, 2026-11-11) Jeff answered at
// Requirements: "The input is named topic ... The output is named digest
// ...". The words named nothing the spec had, so no edit to its pieces could
// land; the approved spec had no inputs and no outputs, the Design wrote both
// empty and asked nothing, and the code critic refused the script that
// delivered "digest". What is pinned: such an answer opens the features'
// pieces, and the input and the output land in the spec whole (spec-v1
// 1.2.0: name, kind, whether it is required, who gives it, its shape in
// words); the Design declares them with the spec's about; and a spec with no
// output, or one that never says the input, makes the Design ask, in blanks
// and in still-open.md.
import { test } from "node:test";
import assert from "node:assert/strict";
import { namedTargets } from "../scripts/revise.mjs";
import { writeTheSpec } from "../scripts/spec.mjs";
import { validateSpec } from "../scripts/spec-v1.mjs";
import { structureOf } from "../scripts/structure.mjs";
import { designFromSpec } from "../scripts/draft.mjs";
import { agentFilesOf } from "../scripts/files.mjs";
import { plan } from "../scripts/pieces.mjs";
import { proseFor } from "./as-built-fixture.mjs";

const ANSWER = "The input is named topic: plain text, one subject such as databases. The output is named digest: Markdown text in the job reply, a header 'Topic digest, <read_at>', then '## Stories' with one list item per story: title as a link, points, and one sentence on why it matters.";

const TOPIC = { name: "topic", kind: "text", required: true, given_by: "either", about: "One subject to read the top stories about, such as databases." };
const DIGEST = { name: "digest", kind: "text/markdown", about: "Markdown in the job reply: a header `Topic digest, <read_at>`, then `## Stories` with one list item per story, its title as a link, its points and one sentence on why it matters." };

/** The approved spec of the case: no interfaces and no pieces. */
const SPEC = () => ({
  format: "spec-v1",
  product: { name: "hn-digest", version: "0.1.0", kind: "agent" },
  purpose: "Reads the top stories on Hacker News about a topic and writes a short digest of them.",
  source: { kind: "account" },
  features: [{
    id: "F1", name: "Write the digest", does: "Writes a short digest of the top stories about one topic.",
    requirements: [{ id: "F1.R1", shall: "The agent shall write one sentence for each story in the digest.", kind: "behavior", priority: "must", source: { said: "one sentence on why it matters" }, verify: "test" }],
    acceptance: [{ id: "F1.A1", gherkin: "Scenario: a digest\n  Given the top stories about databases\n  When the digest is written\n  Then it has one sentence per story", checks: ["F1.R1"] }],
  }],
  constraints: [],
  systems: [],
  settings: [],
  price: "free",
  open: [],
});

const revisionOf = (spec, words) => ({
  said: words,
  revision: { how: "sent back with changes", answers: { said: words } },
  attached: [{ name: "spec.json", kind: "the spec", media_type: "application/vnd.agentmesh.spec+json", text: JSON.stringify(spec, null, 2) }],
});

const prose = async (req) => ({ text: JSON.stringify(proseFor(req.body.contents[0].parts.map((p) => p.text).join("\n\n"))) });

test("words that name an input and an output the spec does not have open the features' pieces, and only them", () => {
  assert.deepEqual([...namedTargets(ANSWER, SPEC())], ["F1.pieces"]);
  const withOutput = SPEC();
  withOutput.features[0].outputs = [DIGEST];
  assert.deepEqual([...namedTargets("The output is digest, as before.", withOutput)], [], "a piece the spec has is not a new one");
});

test("a revision answer that names an input and an output lands in the spec, each whole", async () => {
  const prompts = [];
  const call = async (req) => {
    prompts.push(req.body.contents[0].parts.map((p) => p.text).join("\n\n"));
    return { text: JSON.stringify({ edits: [{ set: "F1.pieces", value: { inputs: [TOPIC], outputs: [DIGEST] } }], notes: "the pieces the answer names" }) };
  };
  const out = await writeTheSpec({ asked: revisionOf(SPEC(), ANSWER), call });
  assert.equal(out.mode, "revision");
  assert.deepEqual(out.revised.targets, ["F1.pieces"]);
  assert.match(prompts[0], /set the pieces of the feature it belongs to/);
  assert.deepEqual(out.spec.features[0].inputs, [TOPIC]);
  assert.deepEqual(out.spec.features[0].outputs, [DIGEST]);
  assert.deepEqual(validateSpec(out.spec), [], "spec-v1 1.2.0 carries required and given_by");
  assert.equal(out.spec.features[0].does, SPEC().features[0].does, "nothing else of the feature changed");
});

test("the Design declares the spec's input and output by name and kind, with the spec's about, and asks nothing about them", async () => {
  const spec = SPEC();
  spec.features[0].inputs = [TOPIC];
  spec.features[0].outputs = [DIGEST];
  const built = structureOf(spec);
  assert.deepEqual(built.asks, []);
  const out = await designFromSpec({ spec, call: prose, table: null });
  const job = out.spec.jobs[0];
  assert.deepEqual(job.inputs, [{ name: "topic", kind: "text", required: true, given_by: "either", about: TOPIC.about }]);
  assert.deepEqual(job.outputs, [{ name: "digest", kind: "text/markdown", when: "per_task", about: DIGEST.about }]);
  assert.ok(!out.design.prose_written.some((k) => /\.(?:inputs|outputs):/.test(k)), "the model does not write an about the spec gives");
  assert.ok(!out.blanks.some((b) => /^(?:inputs|outputs)-/.test(b.key)));
  const desc = JSON.parse(agentFilesOf(out.spec)["agent-descriptor.json"]);
  assert.deepEqual(desc.offerings[0].outputs.map((o) => [o.name, o.kind, o.about]), [["digest", "text/markdown", DIGEST.about]]);
  assert.deepEqual(desc.offerings[0].inputs.map((i) => [i.name, i.kind, i.given_by]), [["topic", "text", "either"]]);
});

test("a spec with no outputs makes the Design ask, in blanks and in still-open.md", async () => {
  const out = await designFromSpec({ spec: SPEC(), call: prose, table: null });
  const keys = out.blanks.map((b) => b.key);
  assert.ok(keys.includes("outputs-write-the-digest"), keys.join(", "));
  assert.ok(keys.includes("inputs-write-the-digest"), "a spec that never says what the job takes is asked too");
  assert.match(out.blanks.find((b) => b.key === "outputs-write-the-digest").question, /names nothing write-the-digest hands back/);
  const open = plan({ blanks: out.blanks }).copies.find((c) => c.to === "out/still-open.md");
  assert.ok(open, "still-open.md is written");
  assert.match(open.text, /outputs-write-the-digest/);
  // An inputs list the spec states empty says the job takes nothing.
  const none = SPEC();
  none.features[0].inputs = [];
  none.features[0].outputs = [DIGEST];
  assert.deepEqual(structureOf(none).asks, []);
});
