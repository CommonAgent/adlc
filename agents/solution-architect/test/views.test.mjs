// The architecture's views (standards/architecture-standard.md 2.0.0,
// sections 12 to 17): what code draws from the kind, the skills and the
// systems, and what it holds the model's words to.
//   node --test test/views.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { CALLER, componentsOf, connectorsOf, decisionOf, driversOf, flowOf, runtimeOf, skillsOf, specOfferings, statesLimit, viewProblems } from "../scripts/views.mjs";
import { findingsOf, repaired } from "../scripts/standard.mjs";
import { readingOf } from "../scripts/asked.mjs";
import { fixture, readJson } from "./helpers.mjs";

const HN = "https://hacker-news.firebaseio.com/v0";
const answer = () => readJson(fixture("hn-digest.answer.json"));
const SYSTEMS = [
  { name: "text-reasoning", plain: "text reasoning", capability: "text: one plain sentence for each story", access: "trigger", why: "a judgment",
    bindings: { dev: { product: "platform", label: "AgentMesh's models", provided_by: "platform" } } },
  { name: "hacker-news", plain: "public Hacker News API", access: "read", why: "To read the current top stories", public: { address: HN, approved: "egress-1" },
    bindings: { dev: { public: true, product: "itself", address: HN, key: "none", access: "read" } } },
];

/** The views as check-record.mjs draws them for the hn-digest answer. */
function views(a = answer(), { systems = SYSTEMS, asked = [], spec = null, kind = "plugin-on-harness" } = {}) {
  const components = componentsOf({ kind, skills: skillsOf(a, spec), parts: a.parts, systems, asked });
  const { flow, left } = flowOf(a.flow, components);
  const connectors = connectorsOf({ kind, components, systems, asked, formats: a.formats, settings: a.settings, flow });
  return { components, connectors, flow, left, runtime: runtimeOf({ kind, systems, environments: ["dev"] }), drivers: driversOf({ limits: { ...a.limits, cost: { limit: "1 USD per day" } }, spec, extra: a.drivers }), decisions: a.decisions.map(decisionOf) };
}

test("the components: the harness from the kind, the skill and its script, the script's parts, and the two outside systems", () => {
  const { components } = views();
  assert.deepEqual(components.map((c) => [c.id, c.kind, c.within ?? null]), [
    ["harness", "harness", null],
    ["skill-topic-digest", "skill", "harness"],
    ["script-topic-digest", "script", "skill-topic-digest"],
    ["hacker-news-client", "part", "script-topic-digest"],
    ["topic-filter", "part", "script-topic-digest"],
    ["sentence-writer", "part", "script-topic-digest"],
    ["digest-writer", "part", "script-topic-digest"],
    ["text-reasoning", "system", null],
    ["hacker-news", "system", null],
  ]);
  assert.equal(components.find((c) => c.kind === "script").name, "scripts/topic-digest.mjs");
  for (const c of components) assert.ok(c.responsibility, `${c.id} has a responsibility`);
  assert.equal(components.find((c) => c.id === "harness").from, "the kind", "code writes what the kind alone decides");
});

test("the connectors: harness to script by command and flags, a model through the caller and its four settings, the public service over HTTPS, the digest as the reply", () => {
  const { connectors } = views();
  const one = (from, to) => connectors.find((k) => k.from === from && k.to === to);
  assert.match(one(CALLER, "harness").how, /a job message/);
  assert.match(one("harness", "script-topic-digest").how, /^by command: node scripts\/topic-digest\.mjs, started once per job, with the job's input and the settings stories_to_read and stories_in_digest as flags/);
  const model = one("sentence-writer", "text-reasoning");
  assert.equal(model.access, "trigger");
  for (const s of ["MODEL_NAME", "MODEL_ENDPOINT", "MODEL_KEY", "MODEL_PROTOCOL"]) assert.match(model.how, new RegExp(s));
  const hn = one("hacker-news-client", "hacker-news");
  assert.equal(hn.access, "read");
  assert.match(hn.how, /^over HTTPS, with no key, at the address its binding names/);
  assert.equal(hn.carries, "the top story ids and each story's item", "a connector carries what the flow says passes, either way");
  assert.match(one("script-topic-digest", CALLER).carries, /the digest \(`text\/markdown`\)/);
  assert.deepEqual(viewProblems({ ...views(), components: views().components }), []);
});

test("the runtime: per job under a harness, no service of its own, each system's binding in each environment", () => {
  const r = runtimeOf({ kind: "plugin-on-harness", systems: SYSTEMS, environments: ["dev", "test", "production"] });
  assert.equal(r.per_job, true);
  assert.equal(r.own_service, false);
  assert.match(r.runs, /no service of its own/);
  assert.deepEqual(r.environments.map((e) => e.environment), ["dev", "test", "production"]);
  assert.deepEqual(r.environments[0].systems, [
    { system: "text-reasoning", binding: "platform (AgentMesh's models), a platform default" },
    { system: "hacker-news", binding: `the service itself at ${HN}, no key, read` },
  ]);
  assert.equal(r.environments[1].systems[0].binding, "unbound: asked");
  assert.equal(runtimeOf({ kind: "mesh-coded" }).own_service, true);
});

test("the data flow reads each end as a component, a skill as its script, and leaves out a step to no component", () => {
  const { flow, left } = views();
  assert.deepEqual(flow.map((s) => s.data), ["the topic", "the topic and the two settings", "the top story ids", "each story's item", "the stories", "the kept stories", "each kept story's title", "one sentence per story", "the stories and their sentences", "the digest"]);
  assert.equal(flow[1].to, "script-topic-digest", "a step to the skill is a step to the script that does its work");
  assert.deepEqual(left, []);
  const refused = views(answer(), { systems: SYSTEMS.filter((s) => s.name !== "hacker-news") });
  assert.deepEqual(refused.left.map((s) => s.data), ["the top story ids", "each story's item"]);
  assert.ok(!refused.connectors.some((k) => k.to === "hacker-news"));
});

test("a service still asked is drawn as asked, so the flow reads before the owner answers", () => {
  const asked = [{ name: "hacker-news", access: "read", address: HN, key: "egress-1", plain: "public Hacker News API", why: "To read the current top stories" }];
  const v = views(answer(), { systems: SYSTEMS.filter((s) => s.name !== "hacker-news"), asked });
  assert.equal(v.components.find((c) => c.id === "hacker-news").asked, "egress-1");
  assert.match(v.connectors.find((k) => k.to === "hacker-news").how, /once the owner says yes in egress-1$/);
  assert.deepEqual(v.left, []);
});

test("the drivers: the four limits first, then the spec's constraints by id, then the statement's", () => {
  const spec = { constraints: [{ id: "C1", kind: "limit", shall: "The agent shall spend at most 1 USD per day." }] };
  const d = driversOf({ limits: answer().limits, spec, extra: answer().drivers });
  assert.deepEqual(d.map((x) => x.key), ["cost", "speed", "data", "trust", "C1", "readable"]);
  assert.equal(d[0].says, "", "a cost limit nobody set is not set");
  assert.equal(d[0].from, "asked (limit-cost)");
  assert.equal(d[4].from, "the spec, C1");
});

test("a spec's offerings are the skills; without one the answer's skills are", () => {
  assert.deepEqual(specOfferings({ offerings: ["topic-digest"] }), ["topic-digest"]);
  assert.deepEqual(specOfferings({ product: "hn-digest", offerings: [] }), ["hn-digest"], "a spec with one offering unnamed has one, named after the product");
  assert.deepEqual(skillsOf(answer(), { offerings: ["write-the-digest"] }).map((s) => [s.name, s.from]), [["write-the-digest", "the spec"]]);
  assert.deepEqual(skillsOf(answer()).map((s) => [s.name, s.from]), [["topic-digest", "the answer"]]);
  assert.equal(readingOf({ text: "Write the architecture.", files: [] }).spec, null, "no spec came, so none is read");
});

test("every component has a responsibility, every connector both ends, and the flow its steps", () => {
  const v = views();
  v.components[4] = { ...v.components[4], responsibility: "" };
  v.connectors.push({ from: "digest-writer", to: "nowhere", how: "x" });
  v.flow = [];
  assert.deepEqual(viewProblems(v), [
    "the component topic filter has no responsibility",
    "the connector from digest-writer to nowhere does not name both of its ends",
    "the data flow has no step",
  ]);
});

test("every decision about structure has its drivers, an alternative and its consequences; a ruling keeps its form", () => {
  const v = views();
  assert.deepEqual(viewProblems(v), []);
  v.decisions.push(decisionOf({ decided: "Use a queue", why: "x" }));
  v.decisions.push(decisionOf({ decided: "Cache the items", why: "x", drivers: ["latency"], alternatives: ["no cache"], consequences: ["a cache"] }));
  v.decisions.push(decisionOf({ decided: "Bind text-reasoning to platform in dev", why: "the House Stack", from_binding: "text-reasoning" }));
  assert.deepEqual(viewProblems(v), [
    'the decision "Use a queue" cites no driver',
    'the decision "Use a queue" weighs no alternative',
    'the decision "Use a queue" says no consequence',
    'the decision "Cache the items" cites latency, which is not one of the record\'s drivers',
  ]);
  const ruling = decisionOf({ decided: "The agent may reach public Hacker News API", why: "egress-1: yes" });
  assert.equal(ruling.kind, "ruling");
  assert.equal(ruling.drivers, undefined);
  const old = decisionOf({ decided: "Hand back Markdown", why: "a person reads it", weighed: "JSON", follows: "fixed headings" });
  assert.deepEqual([old.kind, old.alternatives, old.consequences], ["structure", [{ option: "JSON" }], ["fixed headings"]], "an answer in the earlier form reads as one alternative and one consequence");
  assert.equal(views(answer(), { systems: [] }).decisions.filter((d) => d.kind === "structure").length, 5);
});

test("no limit is a decision: it is a finding, it is taken out, and the record is not finished with one", () => {
  const drivers = driversOf({ limits: { cost: { limit: "1 USD per day" } } });
  for (const said of ["Limit what the agent spends to 1 USD per day", "Spend at most 1 USD a day", "Answer within 300 seconds", "1 USD per day"]) assert.ok(statesLimit({ decided: said }, drivers), said);
  for (const said of ["Answer with the digest in the reply, and store nothing", "Read the story items in parallel, a bounded number at a time", "Code controls the job, and the model writes only the sentences"]) assert.ok(!statesLimit({ decided: said }, drivers), said);
  const a = answer();
  a.decisions.push({ decided: "Limit what the agent spends to 1 USD per day", context: "x", drivers: ["cost"], why: "the owner said so", alternatives: ["2 USD"], consequences: ["a ceiling"] });
  const ctx = { statement: "An agent that reads the current top stories on Hacker News, keeps the ones about a topic the caller names, writes one sentence about each, and hands back a short Markdown digest." };
  assert.ok(findingsOf(a, ctx).some((f) => /only states a limit/.test(f)));
  const { arch, notes } = repaired(a, ctx);
  assert.ok(!arch.decisions.some((d) => /^Limit/.test(d.decided)));
  assert.ok(notes.some((n) => /a decision that only stated a limit/.test(n)));
  const v = views();
  v.decisions.push({ decided: "Limit what the agent spends to 1 USD per day", kind: "ruling", why: "x" });
  assert.ok(viewProblems(v).some((p) => /states a limit/.test(p)));
});

test("the answer's views are findings the second go is handed", () => {
  const ctx = { statement: "x" };
  assert.deepEqual(findingsOf(answer(), { ...ctx, statement: "writes one sentence about each" }).filter((f) => /skill|part|flow|decision|driver/.test(f)), []);
  const a = answer();
  delete a.skills;
  a.parts[0].responsibility = "";
  a.flow = [];
  a.decisions[0] = { decided: "Code controls the job", why: "bounded" };
  const f = findingsOf(a, ctx);
  for (const want of [/no skill is named/, /the part Hacker News client has no responsibility/, /the data flow is missing/, /"Code controls the job" has no context/, /"Code controls the job" cites no driver/, /"Code controls the job" weighs no alternative/, /"Code controls the job" says no consequence/]) {
    assert.ok(f.some((x) => want.test(x)), `${want} in ${f.join("; ")}`);
  }
  assert.ok(!findingsOf(a, { ...ctx, spec: { offerings: ["topic-digest"] } }).some((x) => /no skill is named/.test(x)), "a spec's offerings name the skills");
});

test("a spec attached is read for its offerings and its constraints", async () => {
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "architect-spec-"));
  const at = join(dir, "spec.json");
  writeFileSync(at, JSON.stringify({ format: "spec-v1", product: { name: "hn-digest", version: "0.1.0", kind: "agent" }, purpose: "Writes a Hacker News digest on a topic.", features: [{ id: "F1", name: "Write the digest", does: "Writes the digest.", offering: "topic-digest" }], constraints: [{ id: "C1", kind: "limit", shall: "The agent shall spend at most 1 USD per day.", verify: "inspection" }], open: [] }));
  const r = readingOf({ text: "Write the architecture.", files: [{ path: at, media_type: "application/json" }] });
  assert.equal(r.attached[0].kind, "the spec");
  assert.deepEqual(r.spec.offerings, ["topic-digest"]);
  assert.deepEqual(r.spec.constraints, [{ id: "C1", kind: "limit", shall: "The agent shall spend at most 1 USD per day." }]);
  assert.match(r.statement, /^Writes a Hacker News digest on a topic\./, "with nothing else to go on, the spec's purpose is the statement");
});
