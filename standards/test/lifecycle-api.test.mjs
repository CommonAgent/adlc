// The lifecycle API (lifecycle-api.schema.json, version 0.1) and its check
// (lifecycle-api-check.mjs). This checks that the schema names a definition
// for every request and answer, that a build in the contract's shape passes,
// that each rule the check holds catches the answer that breaks it, and that
// the check never sends the key elsewhere or prints it.
//   node --test standards/test/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SCHEMA, validate, stageIds, checkMe, checkBuildList, checkBuild, checkTries, checkError, run } from "../lifecycle-api-check.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CHECK = join(HERE, "..", "lifecycle-api-check.mjs");
const IDS = stageIds();
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

test("the schema is version 0.1 on /v1/lifecycle, with a definition for every request and answer", () => {
  assert.equal(SCHEMA.version, "0.1");
  assert.equal(SCHEMA.basePath, "/v1/lifecycle");
  assert.equal(SCHEMA.$schema, "https://json-schema.org/draft/2020-12/schema");
  const refs = [SCHEMA.errors, ...SCHEMA.operations.flatMap((o) => [o.request, o.answer])].filter((r) => typeof r === "string" && r.startsWith("#"));
  assert.ok(refs.length >= 14);
  for (const r of refs) assert.ok(SCHEMA.$defs[r.replace("#/$defs/", "")], `${r} is not defined`);
  const walk = (v) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { if (k === "$ref") assert.ok(SCHEMA.$defs[x.replace("#/$defs/", "")], `${x} is not defined`); else walk(x); }
  };
  walk(SCHEMA.$defs);
  for (const o of SCHEMA.operations) assert.ok(["GET", "POST"].includes(o.method) && o.path.startsWith("/") && o.does, JSON.stringify(o));
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
  b.build.stages[0].state = "finished";
  b.build.stages[0].handed_back.files[0].size = "2 KB";
  delete b.build.actions[0].needs;
  b.build.stages[5].holder = { kind: "robot", name: "x" };
  b.build.log[0].at = "yesterday";
  b.build.stages[5].where.check.passed = "yes";
  delete b.build.can_try;
  const p = checkBuild(b, IDS, "b1").join("\n");
  assert.match(p, /stages\[0\]\.state: is "finished", not one of/);
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
  b.build.stages[0].log[0].at = "2026-13-45T09:15:00Z";
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
  b.build.stages[0].rounds.reverse();
  assert.match(checkBuild(b, IDS).join("\n"), /stages\[0\]\.rounds\[1\]: rounds are newest first/);
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
    if (p === "me") return echo ? answer(403, { error: `The key ${KEY} may not read this.` }) : answer(200, me());
    if (p === "builds") return answer(200, list());
    if (p === "builds/b1") {
      const b = build();
      if (broken) b.build.stages[0].rounds.reverse();
      b.build.stages[0].handed_back.files.push({ path: "elsewhere.txt", size: 1, link: "https://other.example/elsewhere.txt" });
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
  assert.equal(r.calls, 5);
  assert.deepEqual(s.seen.map((x) => new URL(x.url).pathname), ["/v1/lifecycle/me", "/v1/lifecycle/builds", "/v1/lifecycle/builds/b1", "/v1/lifecycle/builds/b1/tries", "/v1/lifecycle/builds/b1/files"]);
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
