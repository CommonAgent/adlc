// The lifecycle API (lifecycle-api.schema.json, version 0.4.9) and its check
// (lifecycle-api-check.mjs). This checks that the schema names a definition
// for every request and answer, that a build in the contract's shape passes,
// that each rule the check holds catches the answer that breaks it, that
// the roles and stages answers hold to stages.json, and that the check never sends
// the key elsewhere or prints it.
//   node --test standards/test/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SCHEMA, STATES, validate, stageIds, stageRoles, stageFacts, drawnState, checkMe, checkBuildList, checkBuild, checkTries, checkError, checkRoles, checkStages, run, checkArtifacts, checkProducts, checkProduct, checkStageWorkspace, checkMessages, checkMessageReply, checkBossMessages, checkBossReply, checkBossCommitments, stageCadences, checkFeatures, checkFeature, checkFeatureDecision, featuresOfTest, FEATURE_COLUMNS, checkFeatureApproveAll, AS_BUILT_PARTS } from "../lifecycle-api-check.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CHECK = join(HERE, "..", "lifecycle-api-check.mjs");
const IDS = stageIds();
// Where the fixtures put their work: Requirements and Code, by index, since
// stages.json 1.4.0 puts Reverse engineering (number 0) before Requirements.
const R = IDS.indexOf("requirements");
const C = IDS.indexOf("code");
const SR = stageRoles();
const SF = stageFacts();
const AT = "2026-10-31T09:15:00Z";
const KEY = "key_for_the_test_0123456789";

const blank = (stage) => ({ stage, state: "not_offered", holder: null, runs: 0, rounds: [], given: "", handed_back: { words: [], files: [] }, done_when_met: null, log: [], where: null });

function build(id = "b1") {
  const stages = IDS.map(blank);
  const at = (s) => stages.find((x) => x.stage === s);
  Object.assign(at("requirements"), {
    state: "done", holder: { kind: "reference_agent", name: "spec-writer" }, runs: 2, done_when_met: true,
    rounds: [{ n: 2, at: AT, label: "Draft 2", verdict: "approved", back: false, words: "Approved." }, { n: 1, at: AT, label: "Draft 1", verdict: "changes", back: true, words: "Say what it refuses." }],
    given: "Count the words in a passage.",
    handed_back: { words: ["The statement of the job."], files: [{ path: "spec/agent-descriptor.json", size: 2107, link: `/v1/lifecycle/builds/${id}/files?path=spec%2Fagent-descriptor.json` }] },
    log: [{ at: AT, said: "The spec was approved." }],
  });
  Object.assign(at("code"), {
    state: "waiting_on_you", holder: { kind: "your_agent", name: "your coding agent, on you/word-tally" }, runs: 1, done_when_met: null,
    rounds: [{ n: 1, at: AT, label: "Push 1", verdict: "passed", back: false, words: "The gate passed." }],
    where: { kind: "pull_request", url: "https://github.com/you/word-tally/pull/1", head: "772a7e4", check: { title: "The gate passed", words: "Every test passed.", items: ["fence", "suite"], passed: true } },
  });
  Object.assign(at("acceptance"), { state: "not_started", holder: { kind: "person", name: "you" } });
  return {
    build: {
      id, name: "word-tally", does: "Counts the words in a passage.", version: "0.1.0", handle: "word-tally.you@example.com",
      stages,
      actions: [
        { stage: "code", name: "accept", label: "Accept the pull request", needs: [] },
        { stage: "code", name: "stop", label: "Stop", needs: [{ name: "words", label: "Why", kind: "words", optional: true }] },
      ],
      log: [{ at: AT, said: "Started." }],
      can_try: { pull_request: true, installed: false },
    },
  };
}

const list = () => ({ builds: [{ id: "b1", name: "word-tally", does: "Counts the words in a passage.", version: "0.1.0", at: { stage: "code", state: "waiting_on_you" }, updated: AT }] });
const tries = () => ({ tries: [{ id: "t1", say: "one two", against: "pull_request", answer: "2", ms: 35000, at: AT, kept: false, sent_back: false }] });
const me = () => ({ account: { email: "you@example.com", name: "You" }, service: { name: "Example" } });

test("the schema is version 0.4.10 on /v1/lifecycle, with a definition for every request and answer", () => {
  assert.equal(SCHEMA.version, "0.4.10");
  assert.equal(SCHEMA.basePath, "/v1/lifecycle");
  assert.equal(SCHEMA.$schema, "https://json-schema.org/draft/2020-12/schema");
  const refs = [SCHEMA.errors, ...SCHEMA.operations.flatMap((o) => [o.request, o.answer])].filter((r) => typeof r === "string" && r.startsWith("#"));
  assert.ok(refs.length >= 18);
  for (const r of refs) assert.ok(SCHEMA.$defs[r.replace("#/$defs/", "")], `${r} is not defined`);
  const walk = (v) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { if (k === "$ref") assert.ok(SCHEMA.$defs[x.replace("#/$defs/", "")], `${x} is not defined`); else walk(x); }
  };
  walk(SCHEMA.$defs);
  for (const o of SCHEMA.operations) assert.ok(["GET", "POST", "PUT", "DELETE"].includes(o.method) && o.path.startsWith("/") && o.does, JSON.stringify(o));
});

test("answers in the contract's shape pass", () => {
  assert.deepEqual(checkMe(me()), []);
  assert.deepEqual(checkBuildList(list(), IDS), []);
  assert.deepEqual(checkBuild(build(), IDS, "b1"), []);
  assert.deepEqual(checkTries(tries()), []);
  assert.deepEqual(checkError({ error: "There is no build with that id." }), []);
  assert.deepEqual(checkError({ error: "Too many tries today.", tries_today: 30, tries_cap: 30 }), []);
  assert.deepEqual(validate("TryAnswer", { try: { id: "t1", say: "x", against: "installed", answer: "y", ms: 12, at: AT } }), []);
  assert.deepEqual(validate("TryListAnswer", tries().tries.map((t) => ({ try: t }))[0]), []);
  assert.deepEqual(validate("StartRequest", { does: "Count the words." }), []);
  assert.deepEqual(validate("ActionRequest", { repository: "you/word-tally" }), []);
  assert.deepEqual(validate("TryRequest", { say: "one two", against: "pull_request", offering: "count" }), []);
});

test("a field the schema does not name is allowed, since the contract grows by adding fields", () => {
  const b = build();
  b.build.later = { anything: true };
  b.build.stages[0].later = 1;
  assert.deepEqual(checkBuild(b, IDS, "b1"), []);
});

test("a build's end state, its pause and archive are optional fields of the list and the build, added in 0.1", () => {
  // Without them, as a service answered before they were added, still passes.
  assert.deepEqual(checkBuildList(list(), IDS), []);
  const l = list();
  l.builds[0].at.summary = "Waiting on you at Code";
  l.builds.push({ id: "b2", name: "vowel-tally", does: "Counts vowels.", version: "0.1.0", at: { stage: "requirements", state: "stopped", summary: "Stopped at Requirements" }, archived: true, updated: AT });
  assert.deepEqual(checkBuildList(l, IDS), []);
  const b = build();
  Object.assign(b.build, { summary: "Installed · paused: failed conformance", paused: { at: AT, why: "The conformance check failed." }, archived: false });
  b.build.actions.push({ stage: "conformance", name: "resume_agent", label: "Resume the agent", needs: [] });
  b.build.stages.find((s) => s.stage === "conformance").state = "refused";
  assert.deepEqual(checkBuild(b, IDS, "b1"), []);
  b.build.paused = null;
  assert.deepEqual(checkBuild(b, IDS, "b1"), []);
  // Wrong types are caught.
  l.builds[1].archived = "yes";
  l.builds[1].at.summary = 3;
  const lp = checkBuildList(l, IDS).join("\n");
  assert.match(lp, /builds\[1\]\.archived: is string, not boolean/);
  assert.match(lp, /builds\[1\]\.at\.summary: is integer, not string/);
  b.build.paused = { why: "no time" };
  assert.match(checkBuild(b, IDS, "b1").join("\n"), /paused: has no at/);
  // The list's operation says how archived builds are asked for.
  assert.match(SCHEMA.operations.find((o) => o.method === "GET" && o.path === "/builds").does, /\?archived=1/);
});

test("the schema catches a wrong shape", () => {
  const b = build();
  b.build.stages[R].state = "finished";
  b.build.stages[R].handed_back.files[0].size = "2 KB";
  delete b.build.actions[0].needs;
  b.build.stages[C].holder = { kind: "robot", name: "x" };
  b.build.log[0].at = "yesterday";
  b.build.stages[C].where.check.passed = "yes";
  delete b.build.can_try;
  const p = checkBuild(b, IDS, "b1").join("\n");
  assert.match(p, new RegExp(`stages\\[${R}\\]\\.state: is "finished", not one of`));
  assert.match(p, /files\[0\]\.size: is string, not integer/);
  assert.match(p, /actions\[0\]: has no needs/);
  assert.match(p, /holder.*kind: is "robot"/);
  assert.match(p, /log\[0\]\.at: is "yesterday", not an ISO 8601 time/);
  assert.match(p, /check\.passed: is string, not boolean or null/);
  assert.match(p, /build: has no can_try/);
});

test("a time must carry a zone and be a real date", () => {
  const b = build();
  b.build.log[0].at = "2026-10-31T09:15:00";
  b.build.stages[R].log[0].at = "2026-13-45T09:15:00Z";
  const p = checkBuild(b, IDS, "b1");
  assert.equal(p.length, 2, p.join("\n"));
});

test("a build lists every stage of stages.json once, and no other", () => {
  const missing = build();
  missing.build.stages = missing.build.stages.filter((s) => s.stage !== "cost");
  assert.match(checkBuild(missing, IDS).join("\n"), /does not list cost/);
  const twice = build();
  twice.build.stages.push(blank("docs"));
  assert.match(checkBuild(twice, IDS).join("\n"), /"docs" appears more than once/);
  const other = build();
  other.build.stages.push(blank("lunch"));
  assert.match(checkBuild(other, IDS).join("\n"), /"lunch" is not a stage in stages\.json/);
});

test("rounds are newest first", () => {
  const b = build();
  b.build.stages[R].rounds.reverse();
  assert.match(checkBuild(b, IDS).join("\n"), new RegExp(`stages\\[${R}\\]\\.rounds\\[1\\]: rounds are newest first`));
});

test("an action acts only at a stage the build offers", () => {
  const b = build();
  b.build.actions.push({ stage: "monitor", name: "watch", label: "Watch it", needs: [] });
  assert.match(checkBuild(b, IDS).join("\n"), /"watch" acts at monitor, a stage the build does not offer/);
});

test("a need may say it is optional, as true or false and nothing else", () => {
  const b = build();
  b.build.actions[1].needs[0].optional = "yes";
  assert.equal(checkBuild(b, IDS).length, 1);
  b.build.actions[1].needs[0].optional = false;
  assert.deepEqual(checkBuild(b, IDS), []);
});

test("the build list names a stage of stages.json, and reading a build answers with that build", () => {
  const l = list();
  l.builds[0].at.stage = "lunch";
  assert.match(checkBuildList(l, IDS).join("\n"), /"lunch" is not a stage/);
  assert.match(checkBuild(build("b2"), IDS, "b1").join("\n"), /not the build asked for/);
});

// A service in the contract's shape, at https://svc.example/v1/lifecycle/.
function service({ broken = false, echo = false } = {}) {
  const seen = [];
  const answer = (status, body) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  const fetch = async (url, init) => {
    const u = new URL(url);
    seen.push({ url: u.href, auth: init?.headers?.authorization ?? null });
    if (init?.headers?.authorization !== `Bearer ${KEY}`) return answer(401, { error: "No key." });
    const p = u.pathname.replace("/v1/lifecycle/", "");
    if (p === "roles") return answer(200, roles());
    if (p === "stages") return answer(200, stagesAnswer());
    if (p === "me") return echo ? answer(403, { error: `The key ${KEY} may not read this.` }) : answer(200, me());
    if (p === "builds") return answer(200, list());
    if (p === "builds/b1") {
      const b = build();
      if (broken) b.build.stages[R].rounds.reverse();
      b.build.stages[R].handed_back.files.push({ path: "elsewhere.txt", size: 1, link: "https://other.example/elsewhere.txt" });
      return answer(200, b);
    }
    if (p === "builds/b1/tries") return answer(200, tries());
    if (p === "builds/b1/files") return answer(200, "{}");
    return answer(404, { error: "Not here." });
  };
  return { fetch, seen };
}

test("the check reads a service in the contract's shape and finds nothing wrong", async () => {
  const s = service();
  const lines = [];
  const r = await run({ base: "https://svc.example/v1/lifecycle", key: KEY, ids: IDS, fetch: s.fetch, say: (l) => lines.push(l) });
  assert.deepEqual(r.problems, []);
  assert.equal(r.calls, 7);
  assert.deepEqual(s.seen.map((x) => new URL(x.url).pathname), ["/v1/lifecycle/me", "/v1/lifecycle/roles", "/v1/lifecycle/stages", "/v1/lifecycle/builds", "/v1/lifecycle/builds/b1", "/v1/lifecycle/builds/b1/tries", "/v1/lifecycle/builds/b1/files"]);
  assert.ok(s.seen.every((x) => x.auth === `Bearer ${KEY}`));
});

test("the check never sends the key to another site", async () => {
  const s = service();
  const lines = [];
  await run({ base: "https://svc.example/v1/lifecycle/", key: KEY, ids: IDS, fetch: s.fetch, allFiles: true, say: (l) => lines.push(l) });
  assert.ok(s.seen.every((x) => new URL(x.url).origin === "https://svc.example"));
  assert.ok(lines.some((l) => l.startsWith("skip https://other.example/")));
});

test("the check reports a broken answer and never prints the key, even when the service says it", async () => {
  const lines = [];
  const r = await run({ base: "https://svc.example/v1/lifecycle/", key: KEY, ids: IDS, fetch: service({ broken: true, echo: true }).fetch, say: (l) => lines.push(l) });
  const all = [...lines, ...r.problems].join("\n");
  assert.match(all, /GET me: answered 403/);
  assert.match(all, /rounds are newest first/);
  assert.ok(!all.includes(KEY), "the key was printed");
  assert.match(all, /\[key\]/);
});

test("the command line refuses a key given on it, and runs without one only to say so", () => {
  const go = (args, env = {}) => {
    try {
      execFileSync(process.execPath, [CHECK, ...args], { env: { ...process.env, ADLC_API_KEY: "", ...env }, stdio: "pipe" });
      return { code: 0, err: "" };
    } catch (e) { return { code: e.status, err: String(e.stderr) }; }
  };
  const a = go(["https://svc.example/v1/lifecycle/", "--key", KEY]);
  assert.equal(a.code, 2);
  assert.match(a.err, /never on the command line/);
  assert.ok(!a.err.includes(KEY));
  const b = go(["https://svc.example/v1/lifecycle/"]);
  assert.equal(b.code, 2);
  assert.match(b.err, /No key/);
  const c = go(["https://svc.example/v1/lifecycle/", KEY]);
  assert.equal(c.code, 2);
  assert.ok(!c.err.includes(KEY));
});

test("a build may carry its run's timeline, one bar per step per round, and a bar must say its kind and times", () => {
  const b = build();
  b.build.timeline = [
    { phase: "write-the-architecture", round: 0, holder: "solution-architect.platform@agentmesh.ai", kind: "agent", start: AT, end: "2026-10-31T09:19:00Z", duration_ms: 240000, status: "closed" },
    { phase: "approve-the-spec", round: 0, holder: null, kind: "person", start: "2026-10-31T09:20:00Z", end: null, duration_ms: null, status: "gated" },
  ];
  assert.deepEqual(checkBuild(b, IDS, "b1"), []);
  const late = build();
  late.build.timeline = [...b.build.timeline].reverse();
  assert.ok(checkBuild(late, IDS, "b1").some((x) => /ordered by start/.test(x)), "bars out of order are refused");
  const bad = build();
  bad.build.timeline = [{ phase: "x", round: 0, holder: null, kind: "waiting", start: AT, end: null, duration_ms: null, status: "gated" }];
  assert.ok(checkBuild(bad, IDS, "b1").length > 0, "a bar of an unknown kind is refused");
  const answer = { timeline: b.build.timeline, totals: { total_ms: 300000, by_kind_ms: { agent: 240000, person: 60000, external: 0 }, share: { agent: 0.8, person: 0.2, external: 0 } } };
  assert.deepEqual(validate("TimelineAnswer", answer), []);
});

// Version 0.2: who holds each role, and evidence from holders outside the
// service. The roles answer as a service with its own reference agents gives
// it: each role at its default, the requester the person who asked, and the
// roles it runs no agent for unbound.
function roles({ unbound = ["agent-critic", "impact-analyst"] } = {}) {
  return {
    roles: SR.roles.map((r) => {
      const ref = r.reference_agent ? { kind: "reference_agent", name: r.name, handle: `${r.id}.platform@example.com` } : null;
      let binding = null, from = "unbound";
      if (r.id === "requester") { binding = { role: r.id, holder: { kind: "person", name: "the person who asked" } }; from = "default"; }
      else if (ref && !unbound.includes(r.id)) { binding = { role: r.id, holder: ref }; from = "default"; }
      return { role: r.id, name: r.name, contract: r.contract, offering: r.offering, stages: r.stages, binding, from, reference_agent: ref };
    }),
  };
}
const role = (body, id) => body.roles.find((r) => r.role === id);

test("stages.json's roles are the ones the check reads", () => {
  assert.ok(SR.roles.length >= 19);
  assert.deepEqual(SR.byStage.acceptance, ["requester"]);
  assert.deepEqual(SR.byStage.review, ["code-critic"]);
});

test("a roles answer in the contract's shape passes, with bindings for the org and for a project", () => {
  assert.deepEqual(checkRoles(roles(), SR), []);
  const r = roles();
  Object.assign(role(r, "code-critic"), { from: "org", binding: { role: "code-critic", holder: { kind: "contracted", name: "A review supplier", handle: "reviews.supplier@example.com" }, scope: { org: true }, since: AT, by: "you@example.com" } });
  Object.assign(role(r, "security-reviewer"), { from: "project", binding: { role: "security-reviewer", holder: { kind: "outside_tool", name: "Our scanner", evidence: { formats: ["sarif"], where: "the scanner's report on each pull request" } }, scope: { project: "billing" }, since: AT, by: "you@example.com" } });
  Object.assign(role(r, "code-writer"), { from: "org", binding: { role: "code-writer", holder: { kind: "your_agent", name: "Our coding agent", handle: "coder.you@example.com" }, scope: { org: true }, since: AT, by: "you@example.com" } });
  r.project = "billing";
  assert.deepEqual(checkRoles(r, SR), []);
  assert.deepEqual(validate("RoleBindingRequest", { holder: role(r, "code-critic").binding.holder }), []);
});

test("the roles answer lists every role of stages.json once, as stages.json names it, and no other", () => {
  const r = roles();
  r.roles = r.roles.filter((x) => x.role !== "watcher");
  r.roles.push({ ...role(r, "publisher") }, { ...role(r, "publisher"), role: "barista" });
  role(r, "catalog").offering = "catalog";
  role(r, "catalog").contract = "https://example.com/catalog";
  role(r, "test-writer").stages = ["test", "code"];
  const p = checkRoles(r, SR).join("\n");
  assert.match(p, /does not list watcher/);
  assert.match(p, /"publisher" appears more than once/);
  assert.match(p, /"barista" is not a role in stages\.json/);
  assert.match(p, /offering: is "catalog", not role-catalog/);
  assert.match(p, /contract: is "https:\/\/example\.com\/catalog"/);
  assert.match(p, /stages: are test, code, not test/);
});

test("the requester is always held by a person", () => {
  const r = roles();
  role(r, "requester").binding.holder = { kind: "your_agent", name: "An approver", handle: "approver.you@example.com" };
  assert.match(checkRoles(r, SR).join("\n"), /the requester is always held by a person/);
  const u = roles();
  Object.assign(role(u, "requester"), { binding: null, from: "unbound" });
  assert.match(checkRoles(u, SR).join("\n"), /the requester is always held by a person/);
});

test("from is project, org, default or unbound, and says the truth about the binding", () => {
  const r = roles();
  role(r, "watcher").from = "inherited";
  assert.match(checkRoles(r, SR).join("\n"), /from: is "inherited", not one of project, org, default, unbound/);
  const a = roles();
  role(a, "agent-critic").from = "default";
  assert.match(checkRoles(a, SR).join("\n"), /has no binding, so it is unbound, not default/);
  const b = roles();
  role(b, "publisher").from = "unbound";
  assert.match(checkRoles(b, SR).join("\n"), /is unbound, but it has a binding/);
  const c = roles();
  Object.assign(role(c, "publisher"), { from: "project" });
  role(c, "publisher").binding.scope = { org: true };
  Object.assign(role(c, "watcher"), { from: "org" });
  role(c, "watcher").binding.scope = { project: "billing" };
  const p = checkRoles(c, SR).join("\n");
  assert.match(p, /a project binding names its project/);
  assert.match(p, /an org binding says \{ "org": true \}/);
});

test("a binding to an agent on the mesh names its handle, and one to a person or an outside tool names none", () => {
  const r = roles();
  Object.assign(role(r, "code-critic"), { from: "org", binding: { role: "code-critic", holder: { kind: "contracted", name: "A supplier" }, scope: { org: true } } });
  Object.assign(role(r, "watcher"), { from: "org", binding: { role: "watcher", holder: { kind: "outside_tool", name: "Our tracing", handle: "x@example.com" }, scope: { org: true } } });
  const p = checkRoles(r, SR).join("\n");
  assert.match(p, /a contracted holder names its handle/);
  assert.match(p, /an? outside_tool holder has no handle/);
});

test("a holder's kind and its evidence formats come from the lists, and anything else is refused", () => {
  assert.deepEqual(validate("Holder", { kind: "outside_tool", name: "Scanner", evidence: { formats: ["sarif", "cyclonedx"] } }), []);
  assert.match(validate("Holder", { kind: "vendor", name: "x" }).join("\n"), /kind: is "vendor"/);
  assert.match(validate("Holder", { kind: "outside_tool", name: "x", evidence: { formats: ["junit"] } }).join("\n"), /formats\[0\]: is "junit"/);
  assert.match(validate("Holder", { kind: "outside_tool", name: "x", evidence: { where: "here" } }).join("\n"), /evidence: has no formats/);
});

test("the schema's evidence formats are stages.json's, and its operations for roles and evidence are there", () => {
  const formats = JSON.parse(readFileSync(join(HERE, "..", "stages.json"), "utf8")).evidence_formats.map((f) => f.id);
  assert.deepEqual(SCHEMA.$defs.EvidenceFormat.enum, formats);
  const op = (m, path) => SCHEMA.operations.find((o) => o.method === m && o.path === path);
  assert.equal(op("GET", "/roles")?.answer, "#/$defs/RolesAnswer");
  assert.equal(op("PUT", "/roles/{role}")?.request, "#/$defs/RoleBindingRequest");
  assert.equal(op("DELETE", "/roles/{role}")?.answer, "#/$defs/RolesAnswer");
  assert.equal(op("POST", "/builds/{id}/evidence")?.request, "#/$defs/EvidenceRequest");
  for (const o of [op("GET", "/roles"), op("PUT", "/roles/{role}"), op("DELETE", "/roles/{role}")]) assert.match(o.does, /\?project=<name>/);
  for (const s of ["not_started", "working", "waiting_on_you", "done", "refused", "stopped", "not_offered", "not_bound", "not_applicable"]) assert.ok(SCHEMA.$defs.State.enum.includes(s), s);
  assert.deepEqual(SCHEMA.$defs.Holder.properties.kind.enum, ["reference_agent", "your_agent", "contracted", "person", "outside_tool"]);
});

test("evidence is handed back as a JSON value or a base64 string, in a listed format", () => {
  assert.deepEqual(validate("EvidenceRequest", { stage: "security", format: "sarif", name: "scan.sarif", content: { version: "2.1.0", runs: [] } }), []);
  assert.deepEqual(validate("EvidenceRequest", { stage: "package", format: "cyclonedx", name: "bom.json", content: "eyJib21Gb3JtYXQiOiJDeWNsb25lRFgifQ==" }), []);
  const p = validate("EvidenceRequest", { stage: "security", format: "pdf", name: "", content: 3 }).join("\n");
  assert.match(p, /format: is "pdf"/);
  assert.match(p, /name: is empty/);
  assert.match(p, /content: is integer/);
  assert.match(validate("EvidenceRequest", { stage: "security", format: "sarif", name: "x" }).join("\n"), /has no content/);
});

test("a build may carry its project, the new states, and the evidence read onto a stage", () => {
  const b = build();
  b.build.project = "billing";
  const at = (s) => b.build.stages.find((x) => x.stage === s);
  Object.assign(at("security"), {
    state: "done", holder: { kind: "outside_tool", name: "Our scanner", role: "security-reviewer", evidence: { formats: ["sarif"] } }, done_when_met: true,
    evidence: [{ format: "sarif", name: "scan.sarif", at: AT, summary: "0 errors, 2 warnings", file: { path: "evidence/scan.sarif", size: 812, link: "/v1/lifecycle/builds/b1/files?path=evidence%2Fscan.sarif" } }],
  });
  at("eval").state = "not_bound";
  at("review").state = "not_applicable";
  assert.deepEqual(checkBuild(b, IDS, "b1"), []);
  assert.deepEqual(validate("StartRequest", { does: "Count the words.", project: "billing" }), []);
  at("security").evidence[0].format = "pdf";
  delete at("security").evidence[0].summary;
  const p = checkBuild(b, IDS, "b1").join("\n");
  assert.match(p, /evidence\[0\]\.format: is "pdf"/);
  assert.match(p, /evidence\[0\]: has no summary/);
});

test("nobody acts at a stage that is not bound or not applicable", () => {
  for (const state of ["not_bound", "not_applicable"]) {
    const b = build();
    b.build.stages.find((s) => s.stage === "eval").state = state;
    b.build.actions.push({ stage: "eval", name: "grade", label: "Grade it", needs: [] });
    assert.match(checkBuild(b, IDS, "b1").join("\n"), /"grade" acts at eval, a stage the build does not offer/, state);
  }
});

test("a not_bound stage has no holder, and its role is unbound in the roles answer", () => {
  const unbound = new Set(["agent-critic"]);
  const b = build();
  b.build.stages.find((s) => s.stage === "eval").state = "not_bound";
  assert.deepEqual(checkBuild(b, IDS, "b1", { unbound, byStage: SR.byStage }), []);
  b.build.stages.find((s) => s.stage === "eval").holder = { kind: "person", name: "someone" };
  assert.match(checkBuild(b, IDS, "b1").join("\n"), /is not_bound, so nobody holds it, but it names a holder/);
  const held = build();
  held.build.project = "billing";
  held.build.stages.find((s) => s.stage === "review").state = "not_bound";
  assert.match(checkBuild(held, IDS, "b1", { unbound, byStage: SR.byStage }).join("\n"), /review is not_bound, but the roles answer for project billing has code-critic held/);
});

test("the check asks for the roles of a build's project, once, and holds its not_bound stages to them", async () => {
  const seen = [];
  const answer = (body) => new Response(JSON.stringify(body), { status: 200 });
  const fetch = async (url) => {
    const u = new URL(url);
    seen.push(u.pathname + u.search);
    const p = u.pathname.replace("/v1/lifecycle/", "");
    if (p === "me") return answer(me());
    if (p === "stages") return answer(stagesAnswer({ project: u.searchParams.get("project") }));
    if (p === "roles") {
      // The project binds the code critic; the organization leaves it unbound.
      const r = u.searchParams.get("project") === "billing" ? roles({ unbound: ["agent-critic", "impact-analyst"] }) : roles({ unbound: ["agent-critic", "impact-analyst", "code-critic"] });
      if (u.searchParams.get("project")) r.project = u.searchParams.get("project");
      return answer(r);
    }
    if (p === "builds") return answer({ builds: [...list().builds, { ...list().builds[0], id: "b2" }] });
    if (p === "builds/b1" || p === "builds/b2") {
      const b = build(p.slice(7));
      b.build.project = "billing";
      b.build.stages.find((s) => s.stage === "review").state = "not_bound";
      return answer(b);
    }
    if (p.endsWith("/tries")) return answer(tries());
    return answer({});
  };
  const r = await run({ base: "https://svc.example/v1/lifecycle/", key: KEY, ids: IDS, fetch });
  assert.equal(seen.filter((x) => x === "/v1/lifecycle/roles?project=billing").length, 1, seen.join("\n"));
  assert.equal(r.problems.filter((x) => /review is not_bound, but the roles answer for project billing has code-critic held/.test(x)).length, 2, r.problems.join("\n"));
});

// Version 0.3: which stages the lifecycle uses. The stages answer as a service
// gives it with nothing chosen: every stage used, at the default, and the
// stages it cannot build without marked, with words.
const NEEDED = ["requirements", "test", "code", "package", "release", "deploy", "acceptance"];
function stagesAnswer({ project = null } = {}) {
  return {
    project,
    stages: SF.map((s) => ({
      stage: s.id, name: s.name, phase: s.phase, roles: s.role_ids, used: true, from: "default",
      can_leave_out: !NEEDED.includes(s.id),
      ...(NEEDED.includes(s.id) ? { why_not: `${s.name} is needed to make the package; this service cannot build without it.` } : {}),
    })),
  };
}
const choice = (body, id) => body.stages.find((s) => s.stage === id);

test("the schema names the stages operations, the not_used state and the build's lifecycle", () => {
  const op = (m, path) => SCHEMA.operations.find((o) => o.method === m && o.path === path);
  assert.equal(op("GET", "/stages")?.answer, "#/$defs/StagesAnswer");
  assert.equal(op("PUT", "/stages/{stage}")?.request, "#/$defs/StageChoiceRequest");
  assert.equal(op("PUT", "/stages/{stage}")?.answer, "#/$defs/StagesAnswer");
  assert.equal(op("DELETE", "/stages/{stage}")?.answer, "#/$defs/StagesAnswer");
  for (const o of [op("GET", "/stages"), op("PUT", "/stages/{stage}"), op("DELETE", "/stages/{stage}")]) assert.match(o.does, /\?project=<name>/);
  assert.match(op("PUT", "/stages/{stage}").does, /400.*403.*409/);
  assert.ok(STATES.includes("not_used"));
  assert.match(SCHEMA.$defs.State.description, /not_applicable comes first, then not_used, then every other state/);
  assert.ok(SCHEMA.$defs.Build.properties.lifecycle);
  assert.ok(!SCHEMA.$defs.Build.required.includes("lifecycle"), "lifecycle is optional, so a 0.2 build still passes");
  // Additive: every 0.2 state is still there, in the same order.
  assert.deepEqual(STATES.slice(0, 9), ["not_started", "working", "waiting_on_you", "done", "refused", "stopped", "not_offered", "not_bound", "not_applicable"]);
});

test("a stages answer in the contract's shape passes, for the organization and for a project", () => {
  assert.deepEqual(checkStages(stagesAnswer(), SF), []);
  const s = stagesAnswer({ project: "billing" });
  Object.assign(choice(s, "impact"), { used: false, from: "org" });
  Object.assign(choice(s, "docs"), { used: false, from: "project" });
  Object.assign(choice(s, "security"), { used: true, from: "project" });
  s.updated_at = AT;
  assert.deepEqual(checkStages(s, SF, "billing"), []);
  assert.deepEqual(validate("StageChoiceRequest", { used: false }), []);
  assert.match(validate("StageChoiceRequest", {}).join("\n"), /has no used/);
  assert.match(validate("StageChoiceRequest", { used: "no" }).join("\n"), /used: is string, not boolean/);
});

test("the stages answer lists every stage of stages.json once, in order, as stages.json names it", () => {
  const s = stagesAnswer();
  s.stages = s.stages.filter((x) => x.stage !== "cost");
  s.stages.push({ ...choice(s, "docs") }, { ...choice(s, "docs"), stage: "lunch" });
  choice(s, "impact").name = "Impact analysis";
  choice(s, "source").phase = "make";
  choice(s, "review").roles = ["code-critic", "security-reviewer"];
  const p = checkStages(s, SF).join("\n");
  assert.match(p, /does not list cost/);
  assert.match(p, /"docs" appears more than once/);
  assert.match(p, /"lunch" is not a stage in stages\.json/);
  assert.match(p, /name: is "Impact analysis", not Impact/);
  assert.match(p, /phase: is "make", not define/);
  assert.match(p, /roles: are code-critic, security-reviewer, not code-critic/);
  const swapped = stagesAnswer();
  [swapped.stages[0], swapped.stages[1]] = [swapped.stages[1], swapped.stages[0]];
  assert.match(checkStages(swapped, SF).join("\n"), /not in stages\.json's order/);
});

test("the stages answer names the project asked about, and a choice comes from a project only when one was asked about", () => {
  assert.match(checkStages(stagesAnswer(), SF, "billing").join("\n"), /body\.project: is null, not the project asked about \("billing"\)/);
  assert.match(checkStages(stagesAnswer({ project: "billing" }), SF).join("\n"), /body\.project: is "billing", not the project asked about \(null\)/);
  const noProject = stagesAnswer();
  delete noProject.project;
  assert.match(checkStages(noProject, SF).join("\n"), /body: has no project/);
  const s = stagesAnswer();
  Object.assign(choice(s, "docs"), { used: false, from: "project" });
  assert.match(checkStages(s, SF).join("\n"), /comes from a project, but no project was asked about/);
  const bad = stagesAnswer();
  choice(bad, "docs").from = "unbound";
  assert.match(checkStages(bad, SF).join("\n"), /from: is "unbound", not one of project, org, default/);
});

test("a stage the service cannot leave out says why not and is used, and a stage at the default is used", () => {
  const s = stagesAnswer();
  delete choice(s, "code").why_not;
  choice(s, "test").why_not = "  ";
  Object.assign(choice(s, "deploy"), { used: false, from: "org" });
  Object.assign(choice(s, "docs"), { used: false, from: "default" });
  const p = checkStages(s, SF).join("\n");
  assert.match(p, /cannot leave out code, so it says why not/);
  assert.match(p, /cannot leave out test, so it says why not/);
  assert.match(p, /cannot leave out deploy, so it is used/);
  assert.match(p, /is at the default, which uses every stage, but it is not used/);
  const missing = stagesAnswer();
  delete choice(missing, "docs").can_leave_out;
  assert.match(checkStages(missing, SF).join("\n"), /has no can_leave_out/);
});

test("a build may carry its lifecycle and not_used stages, which nobody holds and which never ran", () => {
  const b = build();
  b.build.project = "billing";
  b.build.lifecycle = { project: "billing", at: AT };
  const at = (s) => b.build.stages.find((x) => x.stage === s);
  Object.assign(at("impact"), { state: "not_used", given: "Not part of this build's lifecycle (billing)." });
  Object.assign(at("docs"), { state: "not_used", given: "Not part of this build's lifecycle (org default)." });
  assert.deepEqual(checkBuild(b, IDS, "b1"), []);
  const own = build();
  own.build.lifecycle = { project: null, at: AT };
  assert.deepEqual(checkBuild(own, IDS, "b1"), []);
  // The rules a not_used stage keeps.
  at("impact").holder = { kind: "reference_agent", name: "impact-analyst" };
  at("docs").runs = 2;
  b.build.actions.push({ stage: "impact", name: "approve", label: "Approve", needs: [] });
  const p = checkBuild(b, IDS, "b1").join("\n");
  assert.match(p, /is not_used, so nobody holds it, but it names a holder/);
  assert.match(p, /is not_used, so it has run 0 times, not 2/);
  assert.match(p, /"approve" acts at impact, a stage the build does not offer/);
});

test("a build's lifecycle names the build's own project and when it took the choice", () => {
  const other = build();
  other.build.project = "billing";
  other.build.lifecycle = { project: "payroll", at: AT };
  assert.match(checkBuild(other, IDS, "b1").join("\n"), /lifecycle\.project: is "payroll", not the build's project \("billing"\)/);
  const none = build();
  none.build.lifecycle = { project: "billing", at: AT };
  assert.match(checkBuild(none, IDS, "b1").join("\n"), /lifecycle\.project: is "billing", not the build's project \(null\)/);
  const bad = build();
  bad.build.lifecycle = { at: "yesterday" };
  const p = checkBuild(bad, IDS, "b1").join("\n");
  assert.match(p, /lifecycle: has no project/);
  assert.match(p, /lifecycle\.at: is "yesterday", not an ISO 8601 time/);
});

test("a state a client does not know reads as not_offered, the rule since 0.2", () => {
  for (const s of STATES) assert.equal(drawnState(s), s);
  assert.equal(drawnState("paused_by_policy"), "not_offered");
  // A client that knows only 0.2 draws a not_used stage as not_offered.
  const v02 = ["not_started", "working", "waiting_on_you", "done", "refused", "stopped", "not_offered", "not_bound", "not_applicable"];
  assert.equal(drawnState("not_used", v02), "not_offered");
  assert.equal(drawnState("done", v02), "done");
  // The check holds the same rule: an action at a stage in a state it does not
  // know is at a stage the build does not offer, and the state itself is reported.
  const b = build();
  b.build.stages.find((s) => s.stage === "eval").state = "paused_by_policy";
  b.build.actions.push({ stage: "eval", name: "grade", label: "Grade it", needs: [] });
  const p = checkBuild(b, IDS, "b1").join("\n");
  assert.match(p, /"grade" acts at eval, a stage the build does not offer/);
  assert.match(p, /state: is "paused_by_policy", not one of/);
});

test("the check reads the stages for the organization and, once, for each project a build names", async () => {
  const seen = [];
  const answer = (body) => new Response(JSON.stringify(body), { status: 200 });
  const fetch = async (url) => {
    const u = new URL(url);
    seen.push(u.pathname + u.search);
    const p = u.pathname.replace("/v1/lifecycle/", "");
    if (p === "me") return answer(me());
    if (p === "roles") return answer({ ...roles(), ...(u.searchParams.get("project") ? { project: u.searchParams.get("project") } : {}) });
    if (p === "stages") {
      const s = stagesAnswer({ project: u.searchParams.get("project") });
      // The project's answer says it is about another project.
      if (u.searchParams.get("project")) s.project = "payroll";
      return answer(s);
    }
    if (p === "builds") return answer({ builds: [...list().builds, { ...list().builds[0], id: "b2" }] });
    if (p === "builds/b1" || p === "builds/b2") {
      const b = build(p.slice(7));
      b.build.project = "billing";
      b.build.lifecycle = { project: "billing", at: AT };
      return answer(b);
    }
    if (p.endsWith("/tries")) return answer(tries());
    return answer({});
  };
  const r = await run({ base: "https://svc.example/v1/lifecycle/", key: KEY, ids: IDS, fetch });
  assert.equal(seen.filter((x) => x === "/v1/lifecycle/stages").length, 1, seen.join("\n"));
  assert.equal(seen.filter((x) => x === "/v1/lifecycle/stages?project=billing").length, 1, seen.join("\n"));
  assert.deepEqual(r.problems, ["GET stages?project=billing: body.project: is \"payroll\", not the project asked about (\"billing\")"]);
});

test("a service that does not answer the stages operation fails the 0.3 check, and says so", async () => {
  const s = service();
  const fetch = async (url, init) => (new URL(url).pathname.endsWith("/stages") ? new Response(JSON.stringify({ error: "Not here." }), { status: 404 }) : s.fetch(url, init));
  const r = await run({ base: "https://svc.example/v1/lifecycle/", key: KEY, ids: IDS, fetch });
  assert.deepEqual(r.problems, ["GET stages: answered 404: Not here."]);
});

// Version 0.4: products, stage workspaces, each stage's chat, and the build's artifacts.

const artifacts = () => [
  { id: "statement", stage: "requirements", name: "Statement of the job", by: "spec writer", state: "made", kind: "statement", version: "v2", at: AT,
    summary: { agent: "word-tally 0.1.0", offerings: [{ name: "Count words", does: "Counts the words in a passage." }], refuses: ["anything but text"], records: ["what the job went without"], price: "free", open: [] },
    files: [{ path: "spec/agent-descriptor.json", size: 2107, link: "/v1/lifecycle/builds/b1/files?path=spec%2Fagent-descriptor.json" }] },
  { id: "suite", stage: "test", name: "The suite", by: "test writer", state: "made", kind: "suite", summary: { count: 2, tests: ["counts the words", "refuses an image"] } },
  { id: "programs", stage: "code", name: "The programs", by: "your coding agent", state: "made", kind: "programs", summary: { scripts: [{ path: "scripts/count.mjs", lines: 40, does: "counts the words" }], commit: "772a7e4", pr: { number: 1, url: "https://github.com/you/word-tally/pull/1" } } },
  { id: "findings", stage: "review", name: "Review findings", by: "code critic", state: "made", kind: "findings", summary: { open: [], verdict: "Nothing open." } },
  { id: "security", stage: "security", name: "Security record", by: "security reviewer", state: "made", kind: "security", digest: "sha256:ab", summary: { reach: ["folder work (write)"], spend: "nothing", never: ["reach the network"], verdict: "Passed." } },
  { id: "package", stage: "package", name: "The package", by: "package maker", state: "next", kind: "package" },
  { id: "build_record", stage: "release", name: "Signed build record", by: "package maker", state: "not_run", kind: "build_record", summary: { words: "This service holds no signing key." } },
  { id: "run_plan", stage: "deploy", name: "Run plan", by: "the service", state: "later", kind: "run_plan" },
];
const withArtifacts = () => { const b = build(); b.build.artifacts = artifacts(); return b; };

test("the schema names the 0.4 operations, the build's artifacts, and a definition for each", () => {
  const ops = SCHEMA.operations.map((o) => `${o.method} ${o.path}`);
  for (const o of ["GET /products", "GET /products/{name}", "GET /builds/{id}/stages/{stage}", "GET /products/{name}/stages/{stage}/messages", "POST /products/{name}/stages/{stage}/messages"]) assert.ok(ops.includes(o), o);
  assert.equal(SCHEMA.$defs.Build.properties.artifacts.items.$ref, "#/$defs/Artifact");
  assert.deepEqual(SCHEMA.$defs.Artifact.properties.state.enum, ["made", "next", "later", "not_made", "not_run"]);
  assert.ok(!SCHEMA.$defs.Message.properties.from.properties.kind.enum.includes("gate"), "a gate lives on its stage, not in the chat");
});

test("a build's artifacts in their kinds' shapes pass, and a wrong one is caught", () => {
  assert.deepEqual(checkBuild(withArtifacts(), IDS, "b1"), []);
  const bad = withArtifacts();
  bad.build.artifacts[1].summary = { tests: "two" };
  bad.build.artifacts[2].stage = "coding";
  bad.build.artifacts.push({ ...bad.build.artifacts[0] });
  delete bad.build.artifacts[6].summary;
  bad.build.artifacts[7].state = "soon";
  const p = checkBuild(bad, IDS, "b1");
  assert.ok(p.includes("body.build.artifacts[1].summary: has no count"), p.join("\n"));
  assert.ok(p.includes("body.build.artifacts[1].summary.tests: is string, not array"));
  assert.ok(p.includes('body.build.artifacts[2].stage: "coding" is not a stage in stages.json'));
  assert.ok(p.includes('body.build.artifacts[8].id: "statement" is used twice'));
  assert.ok(p.includes("body.build.artifacts[6]: is not_run, so its summary says why in words"));
  assert.ok(p.some((x) => x.startsWith('body.build.artifacts[7].state: is "soon"')));
  assert.deepEqual(checkArtifacts([{ id: "x", stage: "docs", name: "AgentDoc", by: "documenter", state: "made", kind: "agentdoc", summary: { words: "A page about the agent." } }], IDS), []);
});

const products = () => ({ products: [{ name: "word-tally", latest: { build: "b1", version: "0.1.0", state: "waiting_on_you", at: { stage: "code", state: "waiting_on_you", summary: "Waiting on you at Code" } }, versions: ["0.1.0"] }] });
const product = () => ({
  name: "word-tally",
  builds: [{ id: "b1", version: "0.1.0", state: "waiting_on_you", at: { stage: "code", state: "waiting_on_you" }, created: AT }],
  run_plan: { build: "b0", version: "0.0.9", at: AT, summary: { stages: [{ stage: "monitor", name: "Monitor", holder: "watcher", settings: "no settings", reads: "chosen" }, { stage: "eval", holder: null, settings: "no settings", reads: "not chosen" }] } },
  activity: [{ at: "2026-10-31T09:16:00Z", build: "b1", version: "0.1.0", stage: "code", words: "The gate passed 772a7e4." }, { at: AT, build: "b1", stage: "requirements", words: "You approved the spec." }],
});

test("the products and a product, with its builds, run plan and activity newest first", () => {
  assert.deepEqual(checkProducts(products()), []);
  assert.deepEqual(checkProduct(product(), "word-tally"), []);
  const twice = products(); twice.products.push(twice.products[0]);
  assert.deepEqual(checkProducts(twice), ['body.products: "word-tally" appears more than once']);
  const old = product(); old.activity.reverse();
  assert.deepEqual(checkProduct(old, "word-tally"), ["body.activity[1]: the feed is newest first, and this line is newer than the one above it"]);
  assert.deepEqual(checkProduct(product(), "other"), ['body.name: is "word-tally", not the product asked for (other)']);
  const state = products(); state.products[0].latest.state = "paused";
  assert.equal(checkProducts(state).length, 1);
});

const workspace = () => ({
  stage: "code", name: "Code", state: "waiting_on_you", holder: { kind: "your_agent", name: "your coding agent", handle: "coder.you@example.com" },
  given: ["statement", "suite"], outputs: [artifacts()[2]], done_when: "the suite passes",
  gate: { actions: ["accept", "stop"], state: "open", who_may: "Anyone may answer this gate." },
});

test("a stage workspace: its outputs are its own, what it was given was made, and an open gate's buttons are the build's", () => {
  assert.deepEqual(checkStageWorkspace(workspace(), IDS, "code", withArtifacts()), []);
  const answered = { ...workspace(), stage: "requirements", outputs: [artifacts()[0]], given: [], gate: { actions: ["approve", "changes", "stop"], state: "answered", answered: { by: "You", at: AT, action: "approve" }, who_may: "Anyone may answer this gate." } };
  assert.deepEqual(checkStageWorkspace(answered, IDS, "requirements", withArtifacts()), []);
  const bad = workspace();
  bad.outputs.push(artifacts()[0]);
  bad.given.push("package");
  bad.gate.actions.push("approve");
  assert.deepEqual(checkStageWorkspace(bad, IDS, "code", withArtifacts()), [
    "body.outputs[1]: is made at requirements, not at code",
    'body.given[2]: "package" is not an artifact the build made',
    'body.gate.actions[2]: "approve" is not an action the build offers at code',
  ]);
  assert.deepEqual(checkStageWorkspace(workspace(), IDS, "test"), ['body.stage: is "code", not the stage asked for (test)']);
  const noWho = workspace(); delete noWho.gate.who_may;
  assert.deepEqual(checkStageWorkspace(noWho, IDS, "code"), ["body.gate: has no who_may"]);
});

const said = (at, text) => ({ id: `m-${at}`, at, build: "b1", version: "0.1.0", from: { kind: "person", name: "You", stage: "test" }, to: { role: "test-writer" }, text });

test("a stage's chat is oldest first at that stage, and a reply's proposal is an action the build offers, with its needs", () => {
  const reply = { id: "m2", at: "2026-10-31T09:16:00Z", build: "b1", version: "0.1.0", from: { kind: "agent", name: "Test writer", role: "test-writer", stage: "test" }, text: "I would say an empty passage has no words." };
  assert.deepEqual(checkMessages({ messages: [said(AT, "What about an empty passage?"), reply] }, "test"), []);
  assert.deepEqual(checkMessages({ messages: [reply, said(AT, "Earlier.")] }, "test"), ["body.messages[1]: the chat is oldest first, and this message is older than the one above it"]);
  assert.deepEqual(checkMessages({ messages: [reply] }, "code"), ['body.messages[0].from.stage: is "test", not the stage asked about (code)']);
  const gate = { ...reply, from: { kind: "gate", name: "Gate", stage: "test" } };
  assert.equal(checkMessages({ messages: [gate] }, "test").length, 1, "a gate is not a message");

  const b = withArtifacts();
  b.build.actions.push({ stage: "code", name: "back_to_test", label: "Send back to Test", needs: [{ name: "changes", label: "What is wrong", kind: "words" }] });
  const proposes = { action: "back_to_test", needs: { changes: "Say an empty passage has no words." } };
  assert.deepEqual(checkMessageReply({ message: said(AT, "Change the suite."), reply: { ...reply, proposes } }, b), []);
  assert.deepEqual(checkMessageReply({ message: said(AT, "Change it."), reply: { ...reply, proposes: { action: "changes", needs: {} } } }, b), ['body.reply.proposes.action: "changes" is not an action the build offers now']);
  assert.deepEqual(checkMessageReply({ message: said(AT, "Change it."), reply: { ...reply, proposes: { action: "back_to_test", needs: {} } } }, b), ['body.reply.proposes.needs: has no changes, which "back_to_test" needs']);
  assert.equal(checkMessageReply({ message: said(AT, "x") }, b)[0], "body: has no reply");
});

// ---------- the boss (0.4.1) ----------

const T1 = "2026-10-31T09:20:00Z";
const T2 = "2026-10-31T09:21:00Z";
const person = (at, text, extra = {}) => ({ id: `p-${at}`, at, build: "b1", version: "0.1.0", from: { kind: "person", name: "You" }, text, ...extra });
const boss = (at, text, extra = {}) => ({ id: `s-${at}`, at, build: "b1", version: "0.1.0", from: { kind: "agent", name: "The boss", role: "boss" }, text, ...extra });
const plan = () => [
  { stage: "requirements", words: "The spec writer revises the statement.", gate: "You approve the spec. Anyone may answer this gate." },
  { stage: "test", words: "The test writer writes the suite." },
  { stage: "code", words: "Your coding harness writes the scripts.", gate: "You OK the code." },
];

test("the schema names the boss operations and a definition for each", () => {
  const ops = SCHEMA.operations.map((o) => `${o.method} ${o.path}`);
  for (const o of ["GET /products/{name}/boss/messages", "POST /products/{name}/boss/messages", "GET /products/{name}/boss/commitments"]) assert.ok(ops.includes(o), o);
  for (const o of SCHEMA.operations.filter((x) => x.path.includes("/boss/"))) for (const k of ["request", "answer"]) if (o[k]) assert.ok(SCHEMA.$defs[o[k].replace("#/$defs/", "")], o[k]);
  assert.deepEqual(SCHEMA.$defs.BossCommitment.properties.kind.enum, ["routed", "proposed", "started", "dropped"]);
});

test("the boss's conversation: oldest first, routes and plans at stages of stages.json, a plan in the lifecycle's order", () => {
  const routed = boss(T1, "I posted it in the Test chat.", { routed: { stage: "test", message_id: "t1", build: "b1" } });
  const planned = boss(T2, "Here is the plan.", { plan: plan(), proposes: { id: "x1", build: "b1", action: "start_version", needs: { version: "0.2.0" }, words: "Start version 0.2.0?", state: "open" } });
  assert.deepEqual(checkBossMessages({ messages: [person(AT, "The tests should cover an empty passage."), routed, planned] }, IDS), []);
  assert.deepEqual(checkBossMessages({ messages: [planned, routed] }, IDS), ["body.messages[1]: the conversation is oldest first, and this message is older than the one above it"]);
  const bad = boss(T1, "x", { routed: { stage: "coding", message_id: "t1", build: "b1" }, plan: [plan()[2], plan()[0], plan()[2]], proposes: { id: "x2", build: "b1", action: "start_version", needs: {} } });
  assert.deepEqual(checkBossMessages({ messages: [bad] }, IDS), [
    'body.messages[0].routed.stage: "coding" is not a stage in stages.json',
    "body.messages[0].plan[1]: requirements comes before the stage above it in the lifecycle, and a plan is in the lifecycle's order",
    "body.messages[0].plan[2]: code is in the plan twice",
    "body.messages[0].proposes.needs: has no version, which start_version needs",
  ]);
  const noStage = boss(T1, "x"); delete noStage.from.role; noStage.from = { kind: "agent" };
  assert.deepEqual(checkBossMessages({ messages: [noStage] }), ["body.messages[0].from: has no name"]);
});

test("a boss reply starts a build only on a confirmation, and proposes only an action the build offers, with its needs", () => {
  const started = boss(T1, "Started 0.2.0.", { started: { build: "b2", version: "0.2.0" } });
  assert.deepEqual(checkBossReply({ message: person(AT, "Yes, start it.", { confirms: "x1" }), reply: started }, IDS), []);
  assert.deepEqual(checkBossReply({ message: person(AT, "Start it."), reply: started }, IDS), ["body.reply.started: the boss started a build, and the person's message confirmed no proposal"]);
  const b = withArtifacts();
  b.build.actions.push({ stage: "code", name: "back_to_test", label: "Send back to Test", needs: [{ name: "changes", label: "What is wrong", kind: "words" }] });
  const ok = boss(T1, "Send it back?", { proposes: { id: "x3", build: "b1", action: "back_to_test", needs: { changes: "Cover an empty passage." } } });
  assert.deepEqual(checkBossReply({ message: person(AT, "Fix the suite."), reply: ok }, IDS, b), []);
  const off = boss(T1, "Change it?", { proposes: { id: "x4", build: "b1", action: "changes", needs: { changes: "x" } } });
  assert.deepEqual(checkBossReply({ message: person(AT, "x"), reply: off }, IDS, b), ['body.reply.proposes.action: "changes" is not an action the build offers now, and the proposal does not say when it will be']);
  assert.deepEqual(checkBossReply({ message: person(AT, "x"), reply: { ...off, proposes: { ...off.proposes, when: "When Requirements waits on you." } } }, IDS, b), []);
  // A proposal on another build is not held to this build's actions.
  assert.deepEqual(checkBossReply({ message: person(AT, "x"), reply: { ...off, proposes: { ...off.proposes, build: "b2" } } }, IDS, b), []);
  assert.equal(checkBossReply({ message: person(AT, "x") }, IDS)[0], "body: has no reply");
});

test("the boss's commitments: oldest first, each kind carrying what checks it against the record", () => {
  const c = (at, kind, extra) => ({ id: `c-${at}-${kind}`, at, kind, to: "the test writer, at Test", what: "Cover an empty passage.", build: "b1", version: "0.1.0", reply: "s1", ...extra });
  const all = [
    c(AT, "routed", { stage: "test", message_id: "t1" }),
    c(T1, "proposed", { to: "you", proposal: { id: "x1", build: "b1", action: "start_version", needs: { version: "0.2.0" } }, answer: { state: "taken", by: "You", at: T2 } }),
    c(T2, "started", { to: "you", build: "b2", version: "0.2.0", confirmation: { message_id: "p1", by: "You", at: T2 } }),
    c(T2, "dropped", { stage: "test", message_id: "t2" }),
  ];
  assert.deepEqual(checkBossCommitments({ commitments: all }, IDS), []);
  assert.deepEqual(checkBossCommitments({ commitments: [all[2], all[0]] }, IDS), ["body.commitments[1]: the list is oldest first, and this one is older than the one above it"]);
  assert.deepEqual(checkBossCommitments({ commitments: [c(AT, "routed", { stage: "test" }), c(AT, "proposed", {}), c(AT, "started", {}), c(AT, "dropped", { stage: "nowhere", message_id: "t3" })] }, IDS), [
    "body.commitments[0]: is routed, so it names the stage and the message posted there",
    "body.commitments[1]: is proposed, so it carries the proposal and the person's answer",
    "body.commitments[2]: is started, so it carries the confirmation it was started on",
    'body.commitments[3].stage: "nowhere" is not a stage in stages.json',
  ]);
  assert.equal(checkBossCommitments({ commitments: [{ ...all[0], kind: "promised" }] }).length, 1);
});

// ---------- 0.4.2: each stage's cadence, carried, and a product's setup and when_needed ----------

const CAD = stageCadences();
const setupItems = () => ["architecture", "source", "publish", "monitor", "eval", "incident", "cost", "update"].map((stage) => {
  const role = SR.byStage[stage][0];
  return stage === "monitor"
    ? { stage, name: "Monitor", role, project: null, state: "chosen", holder: { kind: "your_agent", name: "Our watcher", handle: "watcher.you@example.com" }, settings: { every: "5 minutes" }, since: "0.1.0", words: "Unchanged since 0.1.0" }
    : { stage, role, project: null, state: "not_chosen", holder: null, settings: {}, since: null, words: "Nobody chosen" };
});
const whenNeeded = () => ["reverse-engineering", "impact", "retract", "reconfigure", "rollback", "decommission"].map((stage) => (stage === "rollback"
  ? { stage, name: "Rollback", can_run: true, action: { build: "b1", name: "rollback", label: "Roll back to 0.0.9" } }
  : { stage, can_run: false, why_not: "This service does not run it." }));

test("the schema names a stage's cadence and a product's setup and when_needed lists, and they are stages.json's", () => {
  assert.deepEqual(SCHEMA.$defs.Cadence.enum, ["every_build", "setup", "when_needed"]);
  for (const d of ["Stage", "StageWorkspace"]) for (const k of ["cadence", "carried"]) assert.ok(SCHEMA.$defs[d].properties[k], `${d}.${k}`);
  for (const k of ["setup", "when_needed"]) assert.ok(SCHEMA.$defs.ProductAnswer.properties[k], `ProductAnswer.${k}`);
  assert.deepEqual(new Set(Object.values(CAD)), new Set(SCHEMA.$defs.Cadence.enum));
  assert.deepEqual(Object.keys(CAD), IDS);
});

test("a build's stages may carry their cadence, which is stages.json's, and carried only on a setup stage", () => {
  const b = build();
  for (const s of b.build.stages) s.cadence = CAD[s.stage];
  Object.assign(b.build.stages.find((s) => s.stage === "monitor"), { carried: { since: "0.1.0", build: "b0", words: "Unchanged since 0.1.0" } });
  assert.deepEqual(checkBuild(b, IDS, "b1"), []);
  const bad = structuredClone(b);
  bad.build.stages.find((s) => s.stage === "review").cadence = "setup";
  bad.build.stages.find((s) => s.stage === "code").carried = { since: "0.1.0", words: "Unchanged since 0.1.0" };
  const i = (id) => IDS.indexOf(id);
  assert.deepEqual(checkBuild(bad, IDS, "b1"), [
    `body.build.stages[${i("code")}].carried: code is not set up once (its cadence is every_build), so nothing is carried forward`,
    `body.build.stages[${i("review")}].cadence: is "setup", but stages.json gives review the cadence every_build`,
  ]);
  const noCad = structuredClone(b); noCad.build.stages[0].cadence = "sometimes";
  assert.ok(checkBuild(noCad, IDS, "b1").some((x) => x.startsWith("body.build.stages[0].cadence")));
  // A build without cadences, as a 0.4.1 service answers, still passes.
  assert.deepEqual(checkBuild(build(), IDS, "b1"), []);
});

test("a stage workspace carries the build's cadence for its stage", () => {
  const b = withArtifacts();
  for (const s of b.build.stages) s.cadence = CAD[s.stage];
  assert.deepEqual(checkStageWorkspace({ ...workspace(), cadence: "every_build" }, IDS, "code", b), []);
  assert.deepEqual(checkStageWorkspace({ ...workspace(), cadence: "setup" }, IDS, "code", b), [
    'body.cadence: is "setup", but stages.json gives code the cadence every_build',
    'body.cadence: is "setup", but the build\'s stage says "every_build"',
  ]);
  assert.deepEqual(checkStageWorkspace({ ...workspace(), carried: { since: "0.1.0", words: "Unchanged since 0.1.0" } }, IDS, "code"), ["body.carried: code is not set up once (its cadence is every_build), so nothing is carried forward"]);
});

test("a product's setup lists every setup stage once, in order, with its own role, a holder only when chosen, and a since from its builds", () => {
  const p = { ...product(), builds: [...product().builds, { id: "b0", version: "0.0.9", state: "done", at: { stage: "deploy", state: "done" } }] };
  p.builds[0].version = "0.1.0";
  assert.deepEqual(checkProduct({ ...p, setup: setupItems(), when_needed: whenNeeded() }, "word-tally"), []);
  // A product without the lists, as a 0.4.1 service answers, still passes.
  assert.deepEqual(checkProduct(p, "word-tally"), []);
  const short = setupItems().slice(1);
  assert.deepEqual(checkProduct({ ...p, setup: short }, "word-tally"), ["body.setup: lists source, publish, monitor, eval, incident, cost, update, not stages.json's setup stages in order (architecture, source, publish, monitor, eval, incident, cost, update)"]);
  const bad = setupItems();
  bad[0].role = "code-writer";
  bad[1].state = "chosen";
  bad[2].holder = { kind: "person", name: "Ana" };
  bad[4].since = "0.1.0";
  bad[3].since = "9.9.9";
  assert.deepEqual(checkProduct({ ...p, setup: bad }, "word-tally"), [
    "body.setup[0].role: code-writer does not hold architecture in stages.json",
    "body.setup[1]: is chosen, so it names its holder",
    "body.setup[2]: is not_chosen, so nobody holds it, but it names a holder",
    "body.setup[3].since: 9.9.9 is not a version of the product's builds",
    'body.setup[4].since: is "0.1.0", but a stage not_chosen has held nothing since a version',
  ]);
  const state = setupItems(); state[0].state = "maybe";
  assert.ok(checkProduct({ ...p, setup: state }, "word-tally").some((x) => x.startsWith("body.setup[0].state")));
});

test("a product's when_needed lists every when_needed stage once, in order: why not when it cannot run, its action when it can", () => {
  const bad = whenNeeded();
  delete bad[1].why_not;
  bad[2].action = { build: "b1", name: "retract", label: "Retract" };
  delete bad[4].action;
  bad[4].why_not = "It can.";
  assert.deepEqual(checkProduct({ ...product(), when_needed: bad }, "word-tally"), [
    "body.when_needed[1]: cannot run, so it says why_not",
    "body.when_needed[2]: cannot run, so it names no action",
    "body.when_needed[4]: can run, so it names the action that runs it",
    "body.when_needed[4]: can run, so it gives no why_not",
  ]);
  assert.deepEqual(checkProduct({ ...product(), when_needed: whenNeeded().reverse() }, "word-tally"), ["body.when_needed: lists decommission, rollback, reconfigure, retract, impact, reverse-engineering, not stages.json's when_needed stages in order (reverse-engineering, impact, retract, reconfigure, rollback, decommission)"]);
});

// ---------- features (0.4.3) ----------

const cell = (state, words, extra = {}) => ({ state, words, ...extra });
const row = (id, extra = {}) => ({
  id, name: "Count words", does: "Counts the words in a passage.", offering: "Count", state: "approved", backlog: false, badge: "new",
  cells: {
    spec: cell("done", "Spec v3", { link: { build: "b1", stage: "requirements", artifact: "statement", feature: id } }),
    tests: cell("done", "Tests 2/2", { tests: { passed: 2, total: 2 }, link: { build: "b1", stage: "test", artifact: "suite", feature: id } }),
    code: cell("done", "Passes 2/2", { tests: { passed: 2, total: 2 } }),
    review: cell("missing", "Not reviewed"),
    docs: cell("missing", "No docs yet"),
  },
  ...extra,
});
const matrix = (rows = [row("F1")]) => ({ product: "word-tally", build: "b1", version: "0.1.0", versions: [{ version: "0.1.0", build: "b1" }], columns: [...FEATURE_COLUMNS], features: rows });
const proposal = (extra = {}) => ({ proposal: "fp1", feature: "F2", name: "Empty passage", does: "Answers 0 for an empty passage.", offering: "Count", change: "new", state: "open", you_may_approve: true, approvers: [], ...extra });

test("the schema names the feature operations and a definition for each", () => {
  const ops = SCHEMA.operations.map((o) => `${o.method} ${o.path}`);
  for (const o of ["GET /builds/{id}/features", "POST /builds/{id}/features/{feature}/approve", "POST /builds/{id}/features/{feature}/not_now", "POST /builds/{id}/features/{feature}/ask", "GET /products/{name}/features", "GET /products/{name}/features/{feature}"]) assert.ok(ops.includes(o), o);
  assert.deepEqual(SCHEMA.$defs.FeatureCell.properties.state.enum, ["done", "stale", "missing", "failing"]);
  assert.deepEqual(SCHEMA.$defs.FeatureRow.properties.badge.enum, ["new", "changed", "unchanged"]);
  assert.deepEqual(FEATURE_COLUMNS, ["spec", "tests", "code", "review", "docs"]);
});

test("a test names its features in square brackets at the start of its name", () => {
  assert.deepEqual(featuresOfTest("[F3] counts an empty passage as none"), ["F3"]);
  assert.deepEqual(featuresOfTest("[F1, F2] counts and refuses"), ["F1", "F2"]);
  assert.deepEqual(featuresOfTest("counts the words [F1]"), []);
  assert.deepEqual(featuresOfTest("[not an id] x"), []);
  assert.deepEqual(featuresOfTest(undefined), []);
});

test("a statement may carry its features, and a feature id has its form", () => {
  const s = { agent: "word-tally 0.1.0", offerings: [{ name: "Count", does: "Counts." }], refuses: [], records: [], open: [], features: [{ id: "F1", name: "Count words", does: "Counts the words.", offering: "Count", state: "approved" }] };
  assert.deepEqual(validate("StatementSummary", s), []);
  s.features[0].id = "1 bad";
  assert.equal(validate("StatementSummary", s).length, 1);
});

test("a features matrix: five columns in order, each feature once, cells that agree with their tests and open their own feature", () => {
  assert.deepEqual(checkFeatures(matrix(), "b1"), []);
  const failing = row("F2", { badge: "changed", cells: { ...row("F2").cells, tests: cell("failing", "Tests 1/2", { tests: { passed: 1, total: 2 } }), code: cell("failing", "Passes 1/2", { tests: { passed: 1, total: 2 } }) } });
  const proposed = row("F3", { state: "proposed", backlog: true, badge: "new", cells: { ...row("F3").cells, spec: cell("missing", "Proposed, not approved"), tests: cell("missing", "No test names F3"), code: cell("stale", "Made before F3") } });
  assert.deepEqual(checkFeatures(matrix([row("F1"), failing, proposed])), []);
  const bad = matrix([row("F1"), row("F1", { cells: { ...row("F1").cells, tests: cell("failing", "Tests 2/2", { tests: { passed: 2, total: 2 } }), code: cell("done", "x", { tests: { passed: 1, total: 2 } }), review: cell("done", "x", { link: { build: "b1", artifact: "findings", feature: "F9" } }) } }), row("F4", { state: "proposed" })]);
  bad.columns = ["spec", "code", "tests", "review", "docs"];
  bad.version = "0.2.0";
  assert.deepEqual(checkFeatures(bad, "b2"), [
    'body.build: is "b1", not the build asked for (b2)',
    "body.columns: are spec, code, tests, review, docs, not spec, tests, code, review, docs in that order",
    "body.version: 0.2.0 (build b1) is not one of the product's versions",
    "body.features: F1 is a row more than once",
    "body.features[1].cells.tests: is failing, but every test naming F1 passed",
    "body.features[1].cells.code: is done, but 1 test naming F1 failed",
    "body.features[1].cells.review.link: opens F9, not F1",
    "body.features[2].cells.spec: F4 was never approved, so the spec does not carry it yet, and the cell is missing",
  ]);
  const wrongState = matrix([row("F1", { cells: { ...row("F1").cells, docs: cell("unknown", "x") } })]);
  assert.equal(checkFeatures(wrongState).length, 1);
});

test("a feature's history is oldest first, each entry linked to its message or artifact, and an approved feature was approved", () => {
  const entry = { id: "F1", name: "Count words", does: "Counts.", offering: "Count", state: "approved", backlog: false, approved: { by: "You", at: T1, build: "b1", version: "0.1.0" } };
  const history = [
    { at: AT, kind: "proposed", words: "The spec writer proposed it.", by: "Spec writer", build: "b1", version: "0.1.0", link: { kind: "message", stage: "requirements", message: "t1" } },
    { at: T1, kind: "approved", words: "Approved in the Requirements chat.", by: "You", build: "b1", version: "0.1.0", link: { kind: "message", stage: "requirements", message: "t1" } },
    { at: T2, kind: "tests", words: "2 tests name it in the suite v1.", build: "b1", version: "0.1.0", link: { kind: "artifact", artifact: "suite", feature: "F1" } },
  ];
  assert.deepEqual(checkFeature({ feature: entry, history }, "F1"), []);
  assert.deepEqual(checkFeature({ feature: entry, history: [history[2], { ...history[0], link: { kind: "message" } }, { ...history[2], link: { kind: "artifact" } }] }, "F2"), [
    'body.feature.id: is "F1", not the feature asked for (F2)',
    "body.history[1]: the history is oldest first, and this entry is older than the one above it",
    "body.history[1].link: is a message, so it names the message",
    "body.history[2].link: is an artifact, so it names the artifact",
    "body.history: the feature is approved, and its history has no approval",
  ]);
});

test("a feature proposal on a reply says how it was answered, and a decision reads as the decision taken", () => {
  const reply = { id: "t2", at: T1, build: "b1", version: "0.1.0", from: { kind: "agent", name: "Spec writer", stage: "requirements" }, text: "Shall I add it?", features: [proposal()] };
  assert.deepEqual(checkMessages({ messages: [reply] }, "requirements"), []);
  const answered = { ...reply, features: [proposal({ state: "approved" }), proposal({ feature: "F1", change: "changed", state: "asked" }), proposal({ feature: "F4", state: "not_now", answered: { decision: "approved", by: "You", at: T2 } }), proposal({ feature: "F4" })] };
  assert.deepEqual(checkMessages({ messages: [answered] }, "requirements"), [
    "body.messages[0].features[0]: is approved, so it says who answered it, when, and with approved",
    "body.messages[0].features[1]: is asked, so it says who asked whom, and when",
    "body.messages[0].features[1]: changes F1, so it says what the feature was",
    "body.messages[0].features[2]: is not_now, so it says who answered it, when, and with not_now",
    "body.messages[0].features: proposes F4 more than once in one reply",
  ]);
  assert.deepEqual(checkBossMessages({ messages: [{ id: "s1", at: T1, build: "b1", version: "0.1.0", from: { kind: "agent", name: "The boss", role: "boss" }, text: "x", features: [proposal({ state: "asked" })] }] }, IDS), ["body.messages[0].features[0]: is asked, so it says who asked whom, and when"]);
  const feature = (extra = {}) => ({ id: "F2", name: "Empty passage", does: "Answers 0.", offering: "Count", state: "approved", backlog: false, ...extra });
  assert.deepEqual(checkFeatureDecision({ feature: feature(), proposal: proposal({ state: "approved", answered: { decision: "approved", by: "You", at: T2 } }), statement: "v4" }, "approve"), []);
  assert.deepEqual(checkFeatureDecision({ feature: feature({ state: "proposed" }), proposal: proposal({ state: "open" }) }, "approve"), [
    "body.proposal.state: is open, after approve",
    "body.statement: an approval gives the statement of the job a new version, and the answer does not name it",
    "body.feature.state: the feature was approved, and is not",
  ]);
  assert.deepEqual(checkFeatureDecision({ feature: feature({ state: "proposed", backlog: true }), proposal: proposal({ state: "not_now", answered: { decision: "not_now", by: "You", at: T2 } }) }, "not_now"), []);
  assert.deepEqual(checkFeatureDecision({ feature: feature({ state: "proposed" }), proposal: proposal({ state: "not_now", answered: { decision: "not_now", by: "You", at: T2 } }) }, "not_now"), ["body.feature.backlog: the feature was left for later, so it is a backlog item"]);
  assert.deepEqual(checkFeatureDecision({ feature: feature({ state: "proposed" }), proposal: proposal({ state: "asked", you_may_approve: false, approvers: ["Ana Lee"], asked: { by: "Bo", at: T2, to: ["Ana Lee"] } }), told: ["Ana Lee"] }, "ask"), []);
  assert.deepEqual(checkFeatureDecision({ feature: feature({ state: "proposed" }), proposal: proposal({ state: "asked" }) }, "ask"), ["body.proposal: is asked, so it says who asked whom, and when", "body.told: an ask names who was asked"]);
});

test("a round may report its results per feature, and a Requirements gate the features it starts building with", () => {
  const b = withArtifacts();
  const code = b.build.stages.find((s) => s.stage === "code");
  const at = b.build.stages.indexOf(code);
  code.rounds[0].by_feature = [{ feature: "F1", passed: 2, total: 2 }];
  assert.deepEqual(checkBuild(b, IDS, "b1"), []);
  code.rounds[0].by_feature.push({ feature: "F2", passed: 3, total: 2 });
  assert.deepEqual(checkBuild(b, IDS, "b1"), [`body.build.stages[${at}].rounds[0].by_feature[1]: F2 passed 3 of 2 tests, more than it has`]);
  const f = (id) => ({ id, name: id, does: "x", offering: "Count" });
  const ws = { stage: "requirements", state: "waiting_on_you", holder: null, given: [], outputs: [], done_when: "x", gate: { actions: [], state: "open", who_may: "Anyone.", open: ["What should it cost?"], features: { approved: [f("F1")], to_approve: [f("F2")], backlog: [f("F3")] } } };
  assert.deepEqual(checkStageWorkspace(ws, IDS, "requirements"), []);
  ws.gate.features.backlog.push(f("F1"));
  assert.deepEqual(checkStageWorkspace(ws, IDS, "requirements"), ["body.gate.features: F1 is listed more than once"]);
  assert.deepEqual(checkStageWorkspace({ ...ws, stage: "code", gate: { ...ws.gate, features: { approved: [], to_approve: [], backlog: [] } } }, IDS, "code"), ["body.gate.features: a gate carries features only at Requirements, and this is code"]);
});

// ---------- 0.4.4: the guided setup and the when-needed actions ----------

const twoVersions = () => ({ ...product(), builds: [{ id: "b2", version: "0.2.0", state: "done", at: { stage: "deploy", state: "done" }, created: AT }, { id: "b1", version: "0.1.0", state: "done", at: { stage: "deploy", state: "done" }, created: AT }] });
const monitorForm = () => ({
  ask: "Who should monitor word-tally?", reference_agent: "watcher",
  fields: [
    { name: "every_minutes", label: "Check every", kind: "number", unit: "minutes", default: 5, min: 1 },
    { name: "alert_where", label: "Alert where", kind: "text", default: "the console" },
    { name: "at_ceiling", label: "At the ceiling", kind: "choice", options: ["pause it", "warn only"], default: "pause it" },
  ],
  shares: "The watcher holds Monitor and Cost: one holder for both, each with its own settings.",
});
const rollback = () => ({
  stage: "rollback", name: "Rollback", can_run: true,
  action: { build: "b2", name: "rollback", label: "Roll back", needs: [{ name: "to_version", label: "Go back to", kind: "choice", options: ["0.1.0"], default: "0.1.0" }, { name: "why", label: "Why", kind: "words" }] },
  confirm: {
    title: "Roll back word-tally to 0.1.0?", will: "The agent back on that version, why, and what can't be undone.", done_when: "It answers on the old version, and the side effects are named.",
    steps: ["Your runtime puts word-tally back on 0.1.0."], who_may: "Only Ana Lee (ana@example.com) may roll back word-tally.", you_may: false,
    from_version: "0.2.0", to_version: "0.1.0", cannot_undo: ["What word-tally 0.2.0 did while it ran stays done."],
  },
  last: { at: AT, by: "ana@example.com", ok: false, words: "Your runtime refused the rollback: read-only today.", version: "0.2.0", build: "b2" },
});
const withActions = () => ({
  ...twoVersions(),
  running: { build: "b2", version: "0.2.0", words: "0.2.0 runs" },
  setup: setupItems().map((x) => (x.stage === "monitor" ? { ...x, form: monitorForm() } : x)),
  when_needed: whenNeeded().map((x) => (x.stage === "rollback" ? rollback() : x)),
});

test("the schema names the setup form, the confirm card, the last run, the result and which version runs", () => {
  for (const d of ["SetupForm", "SetupField", "WhenNeededConfirm", "WhenNeededLast", "ActionResult"]) assert.ok(SCHEMA.$defs[d], d);
  assert.ok(SCHEMA.$defs.SetupItem.properties.form);
  for (const k of ["confirm", "last"]) assert.ok(SCHEMA.$defs.WhenNeededItem.properties[k], k);
  assert.ok(SCHEMA.$defs.WhenNeededItem.properties.action.properties.needs);
  for (const k of ["running", "retired"]) assert.ok(SCHEMA.$defs.ProductAnswer.properties[k], k);
  assert.ok(SCHEMA.$defs.BuildAnswer.properties.result);
  for (const k of ["options", "default"]) assert.ok(SCHEMA.$defs.Need.properties[k], k);
  assert.deepEqual(SCHEMA.$defs.SetupField.properties.kind.enum, ["number", "text", "choice"]);
  assert.match(SCHEMA.operations.find((o) => o.path === "/builds/{id}/actions/{name}").does, /when-needed action/);
});

test("a product with forms, confirm cards and a last run passes; one from 0.4.3 still does", () => {
  assert.deepEqual(checkProduct(withActions(), "word-tally"), []);
  assert.deepEqual(checkProduct({ ...twoVersions(), setup: setupItems(), when_needed: whenNeeded() }, "word-tally"), []);
  const answer = { ...build("b2"), result: { stage: "rollback", ok: true, words: "word-tally is back on 0.1.0.", cannot_undo: ["What it did stays done."], files: [] } };
  assert.deepEqual(validate("BuildAnswer", answer), []);
  assert.ok(validate("BuildAnswer", { ...build("b2"), result: { stage: "rollback", words: "no ok" } }).length);
});

test("a form's choice lists its options and its default is one; a number's default is a number; each field once", () => {
  const p = withActions();
  const f = p.setup.find((x) => x.stage === "monitor").form.fields;
  f[0].default = "five";
  f[2].default = "stop it";
  f.push({ name: "alert_where", label: "Again", kind: "choice" });
  assert.deepEqual(checkProduct(p, "word-tally"), [
    `body.setup[${p.setup.findIndex((x) => x.stage === "monitor")}].form.fields[0].default: is a number field, so its default is a number`,
    `body.setup[${p.setup.findIndex((x) => x.stage === "monitor")}].form.fields[2].default: "stop it" is not one of its options`,
    `body.setup[${p.setup.findIndex((x) => x.stage === "monitor")}].form.fields[3]: is a choice, so it lists its options`,
    `body.setup[${p.setup.findIndex((x) => x.stage === "monitor")}].form.fields: "alert_where" appears more than once`,
  ]);
  const kind = withActions(); kind.setup.find((x) => x.stage === "monitor").form.fields[0].kind = "slider";
  assert.ok(checkProduct(kind, "word-tally").some((x) => x.includes("form.fields[0].kind")));
});

test("a rollback's card names the version it goes back to and what can't be undone; only an item that can run has a card", () => {
  const i = whenNeeded().findIndex((x) => x.stage === "rollback");
  const p = withActions();
  const rb = p.when_needed[i];
  delete rb.confirm.to_version;
  rb.confirm.cannot_undo = [];
  rb.action.build = "b9";
  rb.action.needs[0].default = "0.0.1";
  rb.last.version = "9.9.9";
  p.when_needed[0].confirm = rollback().confirm;
  assert.deepEqual(checkProduct(p, "word-tally"), [
    "body.when_needed[0]: cannot run, so it has no confirm card",
    `body.when_needed[${i}].action.build: b9 is not one of the product's builds`,
    `body.when_needed[${i}].action.needs[0].default: "0.0.1" is not one of its options`,
    `body.when_needed[${i}].confirm: a rollback names the version it goes back to (to_version)`,
    `body.when_needed[${i}].confirm.cannot_undo: a rollback names what can't be undone, as the stage's own words ask`,
    `body.when_needed[${i}].last.version: 9.9.9 is not a version of the product's builds`,
  ]);
  const wrongTo = withActions(); wrongTo.when_needed[i].confirm.to_version = "0.0.1";
  assert.deepEqual(checkProduct(wrongTo, "word-tally"), [`body.when_needed[${i}].confirm.to_version: 0.0.1 is not a version of the product's builds`]);
  const noWho = withActions(); delete noWho.when_needed[i].confirm.who_may;
  assert.ok(checkProduct(noWho, "word-tally").some((x) => x.includes("who_may")));
});

test("a retired product runs nothing and none of its when-needed actions can run; running names one of its builds", () => {
  const retired = { at: AT, by: "ana@example.com", version: "0.2.0", why: "Replaced.", words: "Decommissioned at 0.2.0." };
  const off = whenNeeded().map((x) => ({ stage: x.stage, can_run: false, why_not: "word-tally is decommissioned." }));
  assert.deepEqual(checkProduct({ ...twoVersions(), running: null, retired, when_needed: off }, "word-tally"), []);
  const i = whenNeeded().findIndex((x) => x.stage === "rollback");
  assert.deepEqual(checkProduct({ ...withActions(), retired }, "word-tally"), [
    "body.running: the product is retired, so nothing of it runs",
    `body.when_needed[${i}]: the product is retired, so rollback cannot run`,
  ]);
  assert.deepEqual(checkProduct({ ...withActions(), running: { build: "b7", version: "0.7.0" } }, "word-tally"), ["body.running.build: b7 is not one of the product's builds"]);
});

// ---------- 0.4.5: features at every stage, and features listed after the build ----------

test("the schema names backfill and approve_all, and the shapes of a stage's features", () => {
  const ops = SCHEMA.operations.map((o) => `${o.method} ${o.path}`);
  for (const o of ["POST /builds/{id}/features/backfill", "POST /builds/{id}/features/approve_all"]) assert.ok(ops.includes(o), o);
  assert.deepEqual(SCHEMA.$defs.FeatureSliceItem.properties.state.enum, ["done", "to_do", "failing", "stale", "findings"]);
  assert.deepEqual(validate("FeatureApproveAllRequest", { proposals: [] }), ["body.proposals: has 0 items, fewer than 1"]);
  assert.deepEqual(validate("FeatureApproveAllRequest", { proposals: ["fp1"], message: "t2" }), []);
});

const slice = (stage, items, extra = {}) => ({ stage, covered: items.filter((x) => x.state === "done").length, total: items.length, words: `${items.filter((x) => x.state === "done").length} of ${items.length} features`, items, ...extra });

test("a build's stage counts its features, and its workspace lists them, one line each", () => {
  const b = withArtifacts();
  const test0 = b.build.stages.find((s) => s.stage === "code");
  const at = b.build.stages.indexOf(test0);
  test0.features = { covered: 1, total: 2, words: "1 of 2 features pass" };
  assert.deepEqual(checkBuild(b, IDS, "b1"), []);
  test0.features = { covered: 3, total: 2, words: "3 of 2" };
  assert.deepEqual(checkBuild(b, IDS, "b1"), [`body.build.stages[${at}].features: covers 3 of 2 features, more than it has`]);

  const ws = (features) => ({ stage: "test", state: "done", holder: null, given: [], outputs: [], done_when: "x", features });
  const good = slice("test", [{ id: "F1", name: "Count words", state: "done", words: "2 tests", tests: ["counts", "[F1] count"] }, { id: "F2", name: "Refuse images", state: "to_do", words: "No test yet: to do", tests: [] }], { untied: { words: "1 test not tied to a feature", items: ["the process contract requires --job"] } });
  assert.deepEqual(checkStageWorkspace(ws(good), IDS, "test"), []);
  const bad = slice("code", [{ id: "F1", name: "x", state: "to_do", words: "x", tests: ["a"] }, { id: "F1", name: "x", state: "done", words: "x", tests: [] }]);
  bad.stage = "test";
  assert.deepEqual(checkStageWorkspace(ws(bad), IDS, "test"), [
    "body.features.items: F1 is listed more than once",
    "body.features.items[0]: F1 has tests, so it is not to do",
    "body.features.items[1]: F1 has no test, so it is to do",
  ]);
  assert.deepEqual(checkStageWorkspace({ ...ws(good), stage: "code" }, IDS, "code"), ['body.features.stage: is "test", not code']);
  const code = slice("code", [{ id: "F1", name: "x", state: "done", words: "1 of 2 passing", passed: 1, of: 2 }, { id: "F2", name: "y", state: "failing", words: "3 of 2", passed: 3, of: 2 }]);
  assert.deepEqual(checkStageWorkspace({ ...ws(code), stage: "code" }, IDS, "code"), [
    "body.features.items[0]: is done, but 1 of its tests failed",
    "body.features.items[1]: F2 passed 3 of 2 tests, more than it has",
    "body.features.items[1]: is failing, but every test checking F2 passed",
  ]);
  const review = slice("review", [{ id: "F1", name: "x", state: "findings", words: "1 finding open", findings: [{ place: "test/count.test.mjs:12", claim: "x", open: false }] }]);
  assert.deepEqual(checkStageWorkspace({ ...ws(review), stage: "review" }, IDS, "review"), ["body.features.items[0]: has findings open, and names none"]);
  // The workspace's count is the build's stage's.
  const build1 = withArtifacts();
  build1.build.stages.find((s) => s.stage === "test").features = { covered: 2, total: 2, words: "2 of 2 features" };
  assert.deepEqual(checkStageWorkspace(ws(good), IDS, "test", build1), ['body.features.words: is "1 of 2 features", but the build\'s stage says "2 of 2 features"']);
});

test("a matrix row carries its pending proposal, where it came from and its tests; unmapped tests check no feature; backfill only with no features", () => {
  const m = matrix([row("F1", { tests: ["[F1] count"], from: { build: "b1", stage: "requirements", message: "t2" } }), row("F2", { state: "proposed", cells: { ...row("F2").cells, spec: cell("missing", "Proposed, not approved") }, pending: proposal() })]);
  m.unmapped = ["the process contract requires --job"];
  assert.deepEqual(checkFeatures(m, "b1"), []);
  m.unmapped.push("[F1] count");
  m.features[1].pending = proposal({ feature: "F3" });
  m.backfill = { offered: true, words: "The spec writer lists them." };
  assert.deepEqual(checkFeatures(m, "b1"), [
    'body.unmapped: "[F1] count" checks F1, so it is not unmapped',
    "body.features[1].pending: is a proposal of F3, not F2",
    "body.backfill: is offered, but the product has features already",
  ]);
  assert.deepEqual(checkFeatures({ ...matrix([]), backfill: { offered: true, words: "The spec writer lists the features of the statement of the job v4." }, words: "No features yet." }), []);
});

test("approve_all lists every proposal approved, each approved, and names the statement's one new version", () => {
  const entry = (id) => ({ id, name: id, does: "x", offering: "Count", state: "approved", backlog: false });
  const done = (id, f) => proposal({ proposal: id, feature: f, state: "approved", answered: { decision: "approved", by: "You", at: T2 }, tests: ["counts"] });
  assert.deepEqual(checkFeatureApproveAll({ approved: [done("fp1", "F1"), done("fp2", "F2")], features: [entry("F1"), entry("F2")], statement: "v5" }, ["fp1", "fp2"]), []);
  assert.deepEqual(checkFeatureApproveAll({ approved: [done("fp1", "F1"), proposal({ proposal: "fp3", feature: "F3" })], features: [{ ...entry("F1"), state: "proposed" }] }, ["fp1", "fp2"]), [
    "body.approved[1].state: is open, after approve_all",
    "body.approved: does not list the proposal fp2 it was asked to approve",
    "body.features[0].state: F1 was approved, and is not",
    "body.statement: approving gives the statement of the job a new version, and the answer does not name it",
  ]);
});

// ---------- 0.4.6: starting from existing code ----------

const part = (id, name, items, extra = {}) => ({ part: id, name, count: items.length, words: `${items.length} ${name.toLowerCase()}`, items, ...extra });
const asBuilt = (extra = {}) => ({
  id: "as_built", stage: "reverse-engineering", name: "As-built record", by: "reverse engineer", state: "made", kind: "as_built", version: "3f2a9c1", at: AT,
  summary: {
    source: { repository: "https://github.com/acme/word-tally", commit: "3f2a9c1d0e", ran: true, words: "Read and run at 3f2a9c1." },
    trigger: "adoption",
    parts: [
      part("behaviors", "Behaviors", ["B1 Counts the words: splits on spaces (scripts/count.mjs:4)"]),
      part("architecture", "Architecture as built", ["Entry point: scripts/count.mjs"]),
      part("interfaces", "Interfaces", ["Command: count <text>"]),
      part("dependencies", "Dependencies", []),
      part("tests_and_gaps", "Existing tests and gaps", ["Gap: what an empty passage gives was not determined"]),
    ],
    ...extra,
  },
});

test("the schema names bug and drop, the as_built kind and the start request's starting point", () => {
  const ops = SCHEMA.operations.map((o) => `${o.method} ${o.path}`);
  for (const o of ["POST /builds/{id}/features/{feature}/bug", "POST /builds/{id}/features/{feature}/drop"]) assert.ok(ops.includes(o), o);
  assert.ok(SCHEMA.$defs.Artifact.properties.kind.enum.includes("as_built"));
  assert.deepEqual(SCHEMA.$defs.AsBuiltPart.properties.part.enum, AS_BUILT_PARTS);
  assert.deepEqual(validate("StartRequest", { does: "Adopt the existing code of word-tally", name: "word-tally", starting_point: "existing-code", source: { repository: "https://github.com/acme/word-tally", commit: "3f2a9c1" } }), []);
  assert.deepEqual(validate("StartRequest", { does: "x", source: { folder: 3 } }), ["body.source.folder: is integer, not string"]);
});

test("an as_built artifact lists its five parts once, in order, and a drift record names the commit before", () => {
  assert.deepEqual(checkArtifacts([asBuilt()], IDS), []);
  const short = asBuilt(); short.summary.parts.pop();
  assert.deepEqual(checkArtifacts([short], IDS), ["body.artifacts[0].summary.parts: has 4 items, fewer than 5"]);
  const swapped = asBuilt(); [swapped.summary.parts[0], swapped.summary.parts[1]] = [swapped.summary.parts[1], swapped.summary.parts[0]];
  assert.deepEqual(checkArtifacts([swapped], IDS), ["body.artifacts[0].summary.parts: are architecture, behaviors, interfaces, dependencies, tests_and_gaps, not behaviors, architecture, interfaces, dependencies, tests_and_gaps in that order"]);
  assert.deepEqual(checkArtifacts([asBuilt({ trigger: "drift" })], IDS), ["body.artifacts[0].summary: is a drift record, so it names the commit it is described against (since)"]);
  assert.deepEqual(checkArtifacts([asBuilt({ trigger: "drift", since: "1a2b3c4" })], IDS), []);
});

test("a behavior as built answered bug keeps a fix item; one dropped says so; neither is approved by it", () => {
  const mark = { behavior: "B1", evidence: ["scripts/count.mjs:4"], commit: "3f2a9c1" };
  const fix = { id: "fx1", feature: "F2", behavior: "B1", name: "Empty passage", does: "Answers 1 for an empty passage.", state: "proposed", by: "You", at: T2 };
  const entry = { id: "F2", name: "Empty passage", does: "Answers 1 for an empty passage.", offering: "Count", state: "proposed", backlog: false, as_built: mark };
  const bug = proposal({ as_built: mark, state: "bug", answered: { decision: "bug", by: "You", at: T2 }, fix });
  assert.deepEqual(checkFeatureDecision({ feature: { ...entry, fix }, proposal: bug, fix }, "bug"), []);
  assert.deepEqual(checkFeatureDecision({ feature: entry, proposal: proposal({ state: "bug" }) }, "bug"), [
    "body.proposal: is bug, so it says who answered it, when, and with bug",
    "body.proposal: is bug, which only a behavior marked as built can be, and it is not marked",
    "body.proposal: is bug, so it carries the fix item kept for it",
    "body.fix: a bug keeps a fix item, and the answer does not carry it",
  ]);
  const dropped = proposal({ as_built: mark, state: "dropped", answered: { decision: "dropped", by: "You", at: T2 } });
  assert.deepEqual(checkFeatureDecision({ feature: { ...entry, dropped: { by: "You", at: T2 } }, proposal: dropped }, "drop"), []);
  assert.deepEqual(checkFeatureDecision({ feature: { ...entry, state: "approved" }, proposal: dropped }, "drop"), [
    "body.feature.state: a behavior answered drop is not approved by it",
    "body.feature.dropped: the behavior was dropped, and the feature does not say so",
  ]);
  // The matrix keeps the fix items, each of one of its features.
  const m = matrix([row("F1"), row("F2", { state: "proposed", cells: { ...row("F2").cells, spec: cell("missing", "A bug, kept as a fix item") }, as_built: mark, fix })]);
  m.fixes = [fix];
  assert.deepEqual(checkFeatures(m, "b1"), []);
  m.features[1].as_built = undefined;
  delete m.features[1].as_built;
  m.fixes.push({ ...fix, id: "fx2", feature: "F9" });
  assert.deepEqual(checkFeatures(m, "b1"), [
    "body.features[1]: has a fix item, which only a behavior marked as built can, and it is not marked",
    "body.fixes[1]: is a fix item of F9, which is not one of the matrix's features",
  ]);
});

test("a build and a product say the commit they knew; drift is true exactly when the code moved", () => {
  const b = withArtifacts();
  b.build.source = { starting_point: "existing-code", trigger: "adoption", repository: "https://github.com/acme/word-tally", commit: "3f2a9c1d0e", at: AT, words: "Adopted at 3f2a9c1." };
  assert.deepEqual(checkBuild(b, IDS, "b1"), []);
  const src = (extra) => ({ ...product(), source: { repository: "https://github.com/acme/word-tally", commit: "3f2a9c1d0e", build: "b1", version: "0.1.0", current: "9b1c2d4e5f", drift: true, words: "The code changed outside the lifecycle.", ...extra } });
  assert.deepEqual(checkProduct(src(), "word-tally"), []);
  assert.deepEqual(checkProduct(src({ current: null, drift: false, words: "The repository could not be read." }), "word-tally"), []);
  assert.deepEqual(checkProduct(src({ drift: false }), "word-tally"), ["body.source.drift: is false, but the repository is at 9b1c2d4e5f and the last build knew 3f2a9c1d0e"]);
  assert.deepEqual(checkProduct(src({ current: "3f2a9c1d0e", build: "b7" }), "word-tally"), ["body.source.drift: is true, but the commit read now is not a different one", "body.source.build: b7 is not one of the product's builds"]);
});

// ---------- 0.4.7: starting from an as-built record, and back_to_requirements ----------

test("a start request may bring an as-built record: a folder, or a repository, commit and path", () => {
  assert.deepEqual(validate("StartRequest", { does: "Rebuild word-tally from its as-built record", name: "word-tally", starting_point: "as-built-record", source: { folder: "/work/records/word-tally" } }), []);
  assert.deepEqual(validate("StartRequest", { does: "Rebuild word-tally from its as-built record", name: "word-tally", starting_point: "as-built-record", source: { repository: "acme/records", commit: "9b1c2d4", path: "word-tally/as-built" } }), []);
  assert.deepEqual(validate("StartRequest", { does: "x", starting_point: "as-built-record", source: { folder: "/r", path: 3 } }), ["body.source.path: is integer, not string"]);
  assert.match(SCHEMA.$defs.StartRequest.properties.starting_point.description, /as-built-record/);
  assert.match(SCHEMA.description, /Version 0\.4\.7 adds starting from an as-built record/);
});

test("a build started from an as-built record says where the record was read, and its as_built artifact says it was brought", () => {
  const b = withArtifacts();
  b.build.source = { starting_point: "as-built-record", repository: "https://github.com/acme/word-tally", commit: "3f2a9c1d0e", record: { folder: "/work/records/word-tally" }, at: AT, words: "Rebuilt from the as-built record of https://github.com/acme/word-tally at 3f2a9c1. The code is not taken on." };
  assert.deepEqual(checkBuild(b, IDS, "b1"), []);
  delete b.build.source.record;
  assert.deepEqual(checkBuild(b, IDS, "b1"), ["body.build.source: the build started from an as-built record, and does not say where the record was read (record)"]);
  const brought = asBuilt({ brought: { from: "/work/records/word-tally", words: "Brought from /work/records/word-tally. The code it describes is not taken on; Code writes the code fresh." } });
  assert.deepEqual(checkArtifacts([brought], IDS), []);
  assert.deepEqual(checkArtifacts([asBuilt({ brought: { from: "/r" } })], IDS), ["body.artifacts[0].summary.brought: has no words"]);
});

test("back_to_requirements is an action name, acts at Code, and asks for the person's words", () => {
  assert.match(SCHEMA.$defs.Action.properties.name.description, /back_to_requirements/);
  const words = { name: "changes", label: "What should change in the spec", kind: "words" };
  const b = build();
  b.build.actions.splice(1, 0, { stage: "code", name: "back_to_requirements", label: "Send back to Requirements", needs: [words] });
  assert.deepEqual(checkBuild(b, IDS, "b1"), []);
  b.build.actions[1] = { stage: "code", name: "back_to_requirements", label: "Send back to Requirements", needs: [{ ...words, optional: true }] };
  assert.deepEqual(checkBuild(b, IDS, "b1"), ["body.build.actions[1]: back_to_requirements asks for the person's words (a need of kind words that is not optional)"]);
  b.build.actions[1] = { stage: "requirements", name: "back_to_requirements", label: "Send back to Requirements", needs: [words] };
  assert.deepEqual(checkBuild(b, IDS, "b1"), ["body.build.actions[1]: back_to_requirements acts at Code, not at requirements"]);
});

// ---------- 0.4.8: the spec ----------

test("0.4.8: a spec artifact carries a SpecSummary, and one without its features is refused", () => {
  const spec = { id: "spec", stage: "requirements", name: "Spec", by: "spec writer", state: "made", kind: "spec", version: "v1", at: AT,
    summary: { product: "counter 0.1.0", purpose: "Counts the words in a passage.", features: [{ id: "F1", name: "count words", does: "Counts the words.", requirements: [{ id: "F1.R1", shall: "The agent shall count words split on whitespace.", kind: "behavior" }], acceptance: [{ id: "F1.A1", gherkin: "Scenario: three words\n  Given the passage \"a b c\"\n  When it is counted\n  Then the count is 3" }] }], interfaces: [], constraints: [], open: [] },
    files: [] };
  assert.deepEqual(checkArtifacts([spec], IDS), []);
  const { features, ...bare } = spec.summary;
  assert.ok(checkArtifacts([{ ...spec, summary: bare }], IDS).length > 0);
});

test("0.4.8: the spec schema (spec-v1) reuses ISO/IEC/IEEE 29148's verification methods and Gherkin scenarios", () => {
  const s = JSON.parse(readFileSync(new URL("../spec.schema.json", import.meta.url), "utf8"));
  assert.equal(s.properties.format.const, "spec-v1");
  assert.deepEqual(s.$defs.Requirement.properties.verify.enum, ["inspection", "analysis", "demonstration", "test"]);
  assert.match(s.$defs.Acceptance.properties.gherkin.pattern, /Scenario:/);
  assert.deepEqual(s.$defs.Feature.required, ["id", "name", "does", "requirements", "acceptance"]);
});

// ---------- 0.4.9: the holder's skills ----------

const skill = (name, description) => ({ name, description, text: `---
name: ${name}
description: ${description}
---

# ${name}
` });

test("0.4.9: a stage workspace's holder may list its skills, each with its SKILL.md in full, or say why it cannot", () => {
  const listed = { ...workspace(), holder: { kind: "reference_agent", name: "code-writer", role: "code-writer", skills: [skill("write-the-scripts", "to write the scripts"), skill("check-the-work", "once the scripts are written")] } };
  assert.deepEqual(checkStageWorkspace(listed, IDS, "code"), []);
  assert.deepEqual(checkStageWorkspace({ ...listed, holder: { ...listed.holder, skills: [] } }, IDS, "code"), []);
  const noted = { ...workspace(), holder: { ...workspace().holder, skills_note: "Its skills are whatever your coding agent has installed." } };
  assert.deepEqual(checkStageWorkspace(noted, IDS, "code"), []);
  // A 0.4.8 holder, with neither, still passes.
  assert.deepEqual(checkStageWorkspace(workspace(), IDS, "code"), []);
  const { text, ...bare } = skill("write-the-scripts", "to write the scripts");
  assert.ok(checkStageWorkspace({ ...listed, holder: { ...listed.holder, skills: [bare] } }, IDS, "code").length > 0, "a skill carries its SKILL.md");
  assert.ok(checkStageWorkspace({ ...listed, holder: { ...listed.holder, skills: [{ ...bare, name: "", text: "x" }] } }, IDS, "code").length > 0, "a skill has a name");
});

test("0.4.9: a holder lists each skill once, and lists its skills or says why it cannot, not both", () => {
  const twice = { ...workspace(), holder: { kind: "reference_agent", name: "code-writer", skills: [skill("check-the-work", "a"), skill("check-the-work", "b")] } };
  assert.deepEqual(checkStageWorkspace(twice, IDS, "code"), ['body.holder.skills: "check-the-work" is listed more than once']);
  const both = { ...workspace(), holder: { kind: "reference_agent", name: "code-writer", skills: [], skills_note: "Its skills cannot be seen." } };
  assert.deepEqual(checkStageWorkspace(both, IDS, "code"), ["body.holder: lists its skills and also says they cannot be seen (skills_note); it says one or the other"]);
  // The same rules hold wherever a holder is checked, such as a role's binding.
  const r = roles();
  Object.assign(role(r, "code-writer"), { from: "org", binding: { role: "code-writer", holder: { kind: "your_agent", name: "Our coding agent", handle: "coder.you@example.com", skills: [], skills_note: "Its skills cannot be seen." }, scope: { org: true }, since: AT, by: "you@example.com" } });
  const i = r.roles.findIndex((x) => x.role === "code-writer");
  assert.deepEqual(checkRoles(r, SR), [`body.roles[${i}].binding.holder: lists its skills and also says they cannot be seen (skills_note); it says one or the other`]);
});

// ---------- 0.4.10: each feature in a run of its own ----------

/** A version with two features, each made in a run of its own: F1 waits for the OK at Code, F2 is still at Test. */
function featureRuns() {
  const b = build();
  const stage = (s, state, label) => ({ ...blank(s), state, holder: { kind: "reference_agent", name: s === "test" ? "test-writer" : "code-writer" }, runs: 1, rounds: [{ n: 1, at: AT, label, verdict: "passed", back: false, words: "Passed." }] });
  const card = (id, name, s, state) => ({ id, feature: id, name: `${id} ${name}`, started: AT, at: { stage: s, state, summary: state === "waiting_on_you" ? "Waiting on you at Code" : "Working at Test" }, ended: false });
  const accept = { stage: "code", name: "accept", label: "OK the code: F1", needs: [], run: "F1" };
  b.build.feature_runs = [
    { ...card("F1", "Count words", "code", "waiting_on_you"), by: "you@example.com", stages: [stage("test", "done", "Round 1"), stage("code", "waiting_on_you", "Push 1")], actions: [accept], pull_request: { kind: "pull_request", url: "https://github.com/you/word-tally/pull/2", head: "1a2b3c4", check: null }, log: [{ at: AT, said: "The code waits for your OK." }], timeline: [] },
    { ...card("F2", "Count lines", "test", "working"), by: "you@example.com", stages: [stage("test", "working", "Round 1")], actions: [], pull_request: null, log: [], timeline: [] },
  ];
  b.build.actions = [accept, { stage: "code", name: "stop", label: "Stop", needs: [] }];
  b.build.timeline = [{ phase: "write-the-suite", round: 1, holder: "adlc/test-writer", kind: "agent", start: AT, end: AT, duration_ms: 0, status: "closed", run: "F1" }];
  return b;
}

test("0.4.10: a version answers each feature run, with its stages, its actions naming it, its pull request and its timeline; the list gives a card per run", () => {
  assert.deepEqual(checkBuild(featureRuns(), IDS, "b1"), []);
  // A build made in one run, with none of it, still passes.
  assert.deepEqual(checkBuild(build(), IDS, "b1"), []);
  const l = list();
  l.builds[0].feature_runs = featureRuns().build.feature_runs.map(({ id, feature, name, started, at, ended }) => ({ id, feature, name, started, at, ended }));
  assert.deepEqual(checkBuildList(l, IDS), []);
  const { at, ...bare } = l.builds[0].feature_runs[0];
  assert.ok(checkBuildList({ builds: [{ ...l.builds[0], feature_runs: [bare] }] }, IDS).length > 0, "a card says where its run is");
  const run = featureRuns();
  delete run.build.feature_runs[0].stages;
  assert.ok(checkBuild(run, IDS, "b1").length > 0, "a feature run carries its stages");
});

test("0.4.10: a feature run is named once, holds each stage once, names itself on its actions, and offers none once it ended; an action or a bar names a run the build has", () => {
  const twice = featureRuns();
  twice.build.feature_runs[1].id = "F1";
  assert.ok(checkBuild(twice, IDS, "b1").includes('body.build.feature_runs: the feature run "F1" is listed more than once'));
  const stages = featureRuns();
  stages.build.feature_runs[0].stages.push({ ...stages.build.feature_runs[0].stages[1] });
  stages.build.feature_runs[0].stages.push({ ...blank("nowhere") });
  const sp = checkBuild(stages, IDS, "b1");
  assert.ok(sp.includes('body.build.feature_runs[0].stages: the stage "code" is listed more than once'));
  assert.ok(sp.includes('body.build.feature_runs[0].stages: "nowhere" is not a stage in stages.json'));
  const other = featureRuns();
  other.build.feature_runs[0].actions[0] = { ...other.build.feature_runs[0].actions[0], run: "F2" };
  assert.ok(checkBuild(other, IDS, "b1").includes('body.build.feature_runs[0].actions[0]: "accept" is this run\'s, so it names it as run ("F1")'));
  const ended = featureRuns();
  ended.build.feature_runs[0].ended = true;
  assert.ok(checkBuild(ended, IDS, "b1").includes('body.build.feature_runs[0].actions[0]: "accept" is offered on a run that has ended'));
  const stray = featureRuns();
  stray.build.actions[0] = { ...stray.build.actions[0], run: "F9" };
  stray.build.timeline[0].run = "F9";
  assert.deepEqual(checkBuild(stray, IDS, "b1"), ['body.build.actions[0]: "accept" names the feature run "F9", which the build does not have', 'body.build.timeline[0]: names the feature run "F9", which the build does not have']);
  const notOffered = featureRuns();
  notOffered.build.actions[0] = { ...notOffered.build.actions[0], run: "F2" };
  assert.deepEqual(checkBuild(notOffered, IDS, "b1"), ['body.build.actions[0]: "accept" names the feature run F2, which does not offer it']);
});
