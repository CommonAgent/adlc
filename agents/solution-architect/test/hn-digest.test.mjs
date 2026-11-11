// A keyless public service the owner approves is a system of the record,
// bound to the service itself (standards/architecture-standard.md, section
// 2), and the spending limit the owner sets is in the header.
//   node --test test/hn-digest.test.mjs
//
// The case is build b_6e496a709479 (hn-digest, 2026-11-11), with the model's
// answer replayed: nothing here reaches a network or a model. What is pinned:
// the first round asks for the Hacker News API with its address in the
// question; "egress-1: yes" makes it the system hacker-news, bound to itself
// at that address with no key, read, and the approval, in every environment,
// and the record is finished; "egress-1: no" leaves it out; a later round
// with only a change keeps the binding; and the finished record is the one
// the spec writer's Design is tested on.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseRecord, questionsIn } from "../scripts/architecture-record.mjs";
import { ROOT, fixture, runJob, workspace } from "./helpers.mjs";

const STATEMENT = "An agent that reads the current top stories on Hacker News, keeps the ones about a topic the caller names, writes one sentence about each, and hands back a short Markdown digest.";
const ANSWER = fixture("hn-digest.answer.json");
const HN = "https://hacker-news.firebaseio.com/v0";
const BOUND = { public: true, product: "itself", address: HN, key: "none", access: "read", approved: "egress-1" };

/** Two rounds: the statement, then the owner's answers with the record. */
function twoRounds(answers) {
  const ws = workspace();
  const first = runJob({ ws, name: "a", text: STATEMENT, answers: [ANSWER] });
  const second = runJob({ ws, name: "b", text: answers, files: [[join(first.job, "out", "architecture-record.md"), "text/markdown"]], answers: [ANSWER] });
  return { ws, first, second };
}

test("the first round asks for the public service with its address, and binds nothing to it yet", () => {
  const ws = workspace();
  const r = runJob({ ws, text: STATEMENT, answers: [ANSWER] });
  assert.equal(r.steps.check.status, 0, JSON.stringify(r.steps));
  const h = parseRecord(r.record);
  assert.deepEqual(h.systems, ["text-reasoning"]);
  assert.equal(h.done, false);
  assert.equal(h.cost_limit, "");
  const q = questionsIn(r.record).find((x) => x.key === "egress-1");
  assert.match(q.question, /^May this agent reach public Hacker News API \(a public service with no key at https:\/\/hacker-news\.firebaseio\.com\/v0, reached to read\)/);
  assert.match(q.question, /With a yes it becomes the system hacker-news, bound to the service itself at that address/);
});

test("after egress-1: yes the record names hacker-news, bound to itself in every environment, and is finished with the cost limit", () => {
  const { second } = twoRounds("egress-1: yes\nlimit-cost: 1 USD per day, across every job");
  assert.equal(second.steps.check.status, 0, JSON.stringify(second.steps));
  const h = parseRecord(second.record);
  assert.deepEqual(h.systems, ["text-reasoning", "hacker-news"]);
  for (const env of ["dev", "test", "production"]) assert.deepEqual(h.bindings["hacker-news"][env], BOUND);
  assert.equal(h.done, true);
  assert.equal(h.questions, 0);
  assert.equal(h.cost_limit, "1 USD per day, across every job");
  assert.match(second.record, /^- `hacker-news` \(public Hacker News API\), read, a public service with no key, which the owner approved/m);
  assert.match(second.record, /^### Decision \d+\. Bind hacker-news to the service itself in dev, test and production$/m);
  assert.match(second.record, /None beyond the derived set/, "an approved service is a system, not a further destination");
  // The record the spec writer's Design is tested on is this one.
  let theirs = null;
  try { theirs = readFileSync(join(ROOT, "..", "spec-writer", "test", "fixtures", "hn-digest", "architecture-record.md"), "utf8"); } catch { return; }
  assert.equal(theirs, second.record);
});

// The record describes the software architecture (the standard's 2.0.0,
// sections 12 to 17): its components, connectors, runtime, data flow,
// drivers and decisions about structure, with no limit as a decision.
test("the finished record carries the components, connectors, runtime, data flow, drivers and decisions about structure", () => {
  const { second } = twoRounds("egress-1: yes\nlimit-cost: 1 USD per day, across every job");
  const r = second.record;
  const section = (h) => r.split(`\n## ${h}\n`)[1].split("\n## ")[0];
  const components = section("Components");
  for (const id of ["harness", "skill-topic-digest", "script-topic-digest", "hacker-news-client", "topic-filter", "sentence-writer", "digest-writer", "text-reasoning", "hacker-news"]) assert.match(components, new RegExp(`\\(\`${id}\`\\)`), id);
  assert.match(components, /^ {4}- \*\*scripts\/topic-digest\.mjs\*\* \(`script-topic-digest`\), a script:/m, "the script sits within its skill");
  const connectors = section("Connectors");
  assert.match(connectors, /^- `harness` to `script-topic-digest`: by command: node scripts\/topic-digest\.mjs, started once per job, with the job's input and the settings stories_to_read and stories_in_digest as flags/m);
  assert.match(connectors, /^- `hacker-news-client` to `hacker-news`, read: over HTTPS, with no key/m);
  assert.match(connectors, /^- `sentence-writer` to `text-reasoning`, trigger: through the shared model caller \(scripts\/model-caller\.mjs\) and its four settings, MODEL_NAME, MODEL_ENDPOINT, MODEL_KEY and MODEL_PROTOCOL/m);
  assert.match(connectors, /^- `script-topic-digest` to `caller`: .*the digest \(`text\/markdown`\)\.$/m);
  const runtime = section("Runtime and deployment");
  assert.match(runtime, /no service of its own/);
  for (const env of ["dev", "test", "production"]) assert.match(runtime, new RegExp(`^- ${env}: \`text-reasoning\` on platform \\(AgentMesh's models\\), a platform default; \`hacker-news\` on the service itself at ${HN.replace(/[./]/g, "\\$&")}, no key, read\\.$`, "m"));
  assert.deepEqual([...section("Data flow").matchAll(/^\d+\. `[^`]+` to `[^`]+`, ([^:]+):/gm)].map((m) => m[1]), ["the topic", "the topic and the two settings", "the top story ids", "each story's item", "the stories", "the kept stories", "each kept story's title", "one sentence per story", "the stories and their sentences", "the digest"]);
  assert.match(section("Drivers"), /^- \*\*Cost\*\* \(`cost`\): 1 USD per day, across every job\. The person set it in an answer \(limit-cost: 1 USD per day, across every job\)\. Cited by decisions 1 and 2\.$/m);
  const decisions = section("Decisions");
  assert.match(decisions, /^Decisions 1 to 5 choose the agent's structure\. Decisions 6 to 8 are rulings/m);
  for (const d of ["Code controls the job, and the model writes only the sentences", "Run as a package on a harness, once per job", "Read the story items in parallel, a bounded number at a time", "Answer with the digest in the reply, and store nothing"]) {
    const one = decisions.split(`. ${d}\n`)[1].split("\n### ")[0];
    assert.match(one, /^Context: /m, d);
    assert.match(one, /^Drivers: `[a-z]+` \(/m, d);
    assert.match(one, /^Alternatives:\n\n- .+: not chosen, because /m, d);
    assert.match(one, /^Consequences:\n\n- /m, d);
  }
  assert.doesNotMatch(r, /^### Decision \d+\. Limit what the agent spends/m, "a limit is a driver, never a decision");
  assert.match(r, /^cost_limit: "1 USD per day, across every job"$/m, "the Design still reads the cost limit from the header");
});

test("egress-1: no leaves the service out, and the record is finished without it", () => {
  const { second } = twoRounds("egress-1: no\nlimit-cost: 1 USD per day, across every job");
  assert.equal(second.steps.check.status, 0, JSON.stringify(second.steps));
  const h = parseRecord(second.record);
  assert.deepEqual(h.systems, ["text-reasoning"]);
  assert.equal(h.done, true);
  assert.match(second.record, /^### Decision \d+\. The agent does not reach public Hacker News API$/m);
});

test("a later round with only a change keeps the service bound to itself", () => {
  const { ws, second } = twoRounds("egress-1: yes\nlimit-cost: 1 USD per day, across every job");
  const third = runJob({ ws, name: "c", text: "Say the digest is for the owner's morning.", files: [[join(second.job, "out", "architecture-record.md"), "text/markdown"]], answers: [ANSWER] });
  assert.equal(third.steps.check.status, 0, JSON.stringify(third.steps));
  const h = parseRecord(third.record);
  assert.deepEqual(h.systems, ["text-reasoning", "hacker-news"]);
  assert.deepEqual(h.bindings["hacker-news"].production, BOUND);
  assert.equal(h.done, true);
  assert.equal(h.cost_limit, "1 USD per day, across every job");
});
