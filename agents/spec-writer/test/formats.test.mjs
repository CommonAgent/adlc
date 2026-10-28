// The format rules (owner, 2026-10-27): what each piece is, in a format
// somebody can read.
//   node --test test/formats.test.mjs
//
// What is worth pinning. The drafting step holds every draft to three rules
// before the builder sees it: no bare application/json, a convention sketched
// on every Markdown piece, and who gives each input (given_by). The model is
// told the rules in its instruction, and told them again as findings when its
// first draft breaks one. A revision of a released agent keeps a piece it
// already sends as bare JSON, because converting it is its own decision. The
// builder refuses a new agent's bare JSON whatever this step said. And the
// reply says which formats were drafted, because a format is drafted rather
// than asked and a reader is owed the part they did not choose.
//
// Nothing here touches a network or a model: the call is a function the test
// hands in, and the builder is the real one beside this package.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  GIVEN_BY, checkDraft, checkSpec, conventionHeadings, earlierBareJson, formatProblems, isBareJson,
} from "../scripts/check-spec.mjs";
import { INSTRUCTION, askForSpec } from "../scripts/draft.mjs";
import { formatsLine, replyText } from "../scripts/ask.mjs";
import { checkBuilds } from "../scripts/builds.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const env = { BUILD_PY: join(HERE, "..", "..", "package-maker", "build.py") };
const specOf = (name) => JSON.parse(readFileSync(join(HERE, "fixtures", `${name}.spec.json`), "utf8"));
const clone = (o) => JSON.parse(JSON.stringify(o));

const how = { control: "script", intelligence: "none", cost: "none", contract: "full" };
const ABOUT = "Markdown: a header `source, read_at`, then `## Key points` with one bullet per point, then `## Not read`.";
/** The small agent the rules are about: a page in, key points out for a person to review. */
const KEY_POINTS = {
  name: "key-points", version: "0.1.0", description: "Lists the key points a web page makes, for a person to review.",
  jobs: [{
    slug: "list-the-key-points", title: "List the key points", offered: true, how,
    when: "when somebody wants the points a web page makes, to read before they decide",
    good: "A Markdown list of the points the page itself makes, each one sentence in the page's own terms, with the page's address and when it was read at the top, and nothing the page does not say.",
    empty: "If the page cannot be read or says nothing, the list is not written and the reply says which, naming the address that was tried.",
    does: "Reads one web page and lists the points it makes for a person to review.",
    inputs: [{ name: "page", kind: "url", required: true, given_by: "person" }],
    outputs: [{ name: "key points", kind: "text/markdown", when: "per_task", about: ABOUT }],
  }],
  refuses: Array.from({ length: 4 }, (_, i) => `refusing act ${i}, because it is not this agent's to do, and it says so instead`),
  records: [{ name: "the signed job manifest" }],
  price: { model: "free" },
  systems: [],
};

test("the instruction tells the model the format rules before it drafts", () => {
  assert.match(INSTRUCTION, /Content one agent hands another, or a person reviews, is "text\/markdown"/);
  assert.match(INSTRUCTION, /a short header for the few structured\n  fields, then fixed headings/);
  assert.match(INSTRUCTION, /JSON is only for exact typed data that code consumes and a person never\n  reads/);
  assert.match(INSTRUCTION, /application\/vnd\.agentmesh\.<name>\+json/);
  assert.match(INSTRUCTION, /Never a bare "application\/json"/);
  assert.match(INSTRUCTION, /"given_by" is "person", "agent" or "either"/);
  assert.match(INSTRUCTION, /never decide it for them/);
  assert.ok(!/such as application\/json/.test(INSTRUCTION), "the instruction still holds bare JSON up as the example kind");
});

test("a draft with a Markdown piece, a specific kind and given_by passes clean", () => {
  assert.deepEqual(checkDraft(KEY_POINTS), []);
  assert.deepEqual(conventionHeadings(ABOUT), ["## Key points", "## Not read"]);
  assert.deepEqual(GIVEN_BY, ["person", "agent", "either"]);
});

test("bare application/json is a finding on an input or an output, parameters and all", () => {
  assert.equal(isBareJson("application/json"), true);
  assert.equal(isBareJson("application/json; charset=utf-8"), true);
  assert.equal(isBareJson("application/vnd.agentmesh.key-points+json"), false);
  const bad = clone(KEY_POINTS);
  bad.jobs[0].outputs[0] = { name: "key points", kind: "application/json", when: "per_task" };
  const found = formatProblems(bad);
  assert.equal(found.length, 1);
  assert.match(found[0], /output "key points" is bare application\/json/);
  assert.match(found[0], /text\/markdown with a convention/);
  const vendor = clone(KEY_POINTS);
  vendor.jobs[0].outputs[0] = { name: "key points", kind: "application/vnd.agentmesh.key-points+json", about: "`{points, source}`" };
  assert.deepEqual(formatProblems(vendor), []);
});

test("a Markdown piece with no convention in its about is a finding", () => {
  const bare = clone(KEY_POINTS);
  delete bare.jobs[0].outputs[0].about;
  assert.match(formatProblems(bare).join(" "), /is text\/markdown and its about sketches no convention/);
  bare.jobs[0].outputs[0].about = "Markdown with the key points.";
  assert.equal(formatProblems(bare).length, 1, "an about that names no heading sketches no convention");
});

test("an input that does not say who gives it is a finding, and so is a word that is not one of the three", () => {
  for (const given of [undefined, "somebody"]) {
    const s = clone(KEY_POINTS);
    if (given) s.jobs[0].inputs[0].given_by = given; else delete s.jobs[0].inputs[0].given_by;
    assert.match(formatProblems(s).join(" "), /input "page" does not say who gives it; given_by is person, agent, either/);
  }
});

test("the specs that shipped before the rules are measured by checkSpec, and the format rules name what they lack", () => {
  // checkSpec is unchanged: what a good spec carries. The format rules are
  // the drafting step's on top, and publisher, which shipped, breaks them.
  assert.deepEqual(checkSpec(specOf("publisher")), []);
  assert.ok(formatProblems(specOf("publisher")).some((p) => /bare application\/json/.test(p)));
});

test("a revision keeps a piece the earlier spec already sent as bare JSON, and holds a new piece to the rule", () => {
  const earlier = clone(KEY_POINTS);
  earlier.jobs[0].outputs.push({ name: "timings", kind: "application/json", when: "per_task" });
  const asked = { attached: [{ name: "spec.json", kind: "a spec", text: JSON.stringify(earlier) }] };
  assert.deepEqual([...earlierBareJson(asked)], ["outputs:timings"]);
  const revised = clone(earlier);
  revised.jobs[0].outputs.push({ name: "more", kind: "application/json", when: "per_task" });
  const found = formatProblems(revised, { earlier: earlierBareJson(asked) });
  assert.equal(found.length, 1);
  assert.match(found[0], /output "more" is bare application\/json/);
  // An agent's own descriptor is read the same way, offerings and their steps.
  const desc = { offerings: [{ id: "x", outputs: [{ name: "timings", kind: "application/json" }], steps: [{ id: "y", inputs: [{ name: "series", kind: "application/json" }] }] }] };
  assert.deepEqual([...earlierBareJson({ attached: [{ name: "agent-descriptor.json", kind: "an agent's own file", text: JSON.stringify(desc) }] })].sort(),
    ["inputs:series", "outputs:timings"]);
});

test("the drafting step asks again with the format findings, and the second draft is held to them", async () => {
  const bad = clone(KEY_POINTS);
  bad.jobs[0].outputs[0] = { name: "key points", kind: "application/json", when: "per_task" };
  const sent = [];
  const out = await askForSpec({
    asked: { asked: "v1", said: "an agent that lists a web page's key points for me to review", attached: [], missing_files: [] },
    call: async (request) => {
      sent.push(request.body.contents[0].parts.map((p) => p.text).join("\n"));
      return JSON.stringify({ spec: sent.length === 1 ? bad : KEY_POINTS, blanks: [] });
    },
  });
  assert.equal(sent.length, 2);
  assert.match(sent[1], /WHAT WAS WRONG WITH YOUR LAST DRAFT[\s\S]*output "key points" is bare application\/json/);
  assert.deepEqual(out.findings, []);
});

test("the reply says which formats were drafted and who gives each input", () => {
  assert.equal(formatsLine(KEY_POINTS),
    "The formats are drafted, so say if one should be different: it hands back key points as text/markdown; it takes page from a person.");
  assert.match(replyText({ spec: KEY_POINTS, blanks: [] }), /The formats are drafted, so say if one should be different/);
  assert.equal(formatsLine({ jobs: [{ slug: "a", offered: true }] }), "");
});

test("the builder takes the new agent's draft, and refuses it with a bare JSON output", () => {
  const r = checkBuilds({ spec: KEY_POINTS, env });
  assert.equal(r.checked, true);
  assert.equal(r.ok, true, JSON.stringify(r.problems));
  const bad = clone(KEY_POINTS);
  bad.jobs[0].outputs[0] = { name: "key points", kind: "application/json", when: "per_task" };
  const refused = checkBuilds({ spec: bad, env });
  assert.equal(refused.ok, false);
  assert.match(refused.problems.join(" "), /key-points is refused on its formats, because it is a new agent/);
});
