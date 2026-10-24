// Does a draft carry what a good spec carries?
//   node --test test/check-spec.test.mjs
//
// The check that matters most is the first one: run this over the eight specs
// that already produced working agents. A checker that fails a spec which
// shipped is a checker nobody will believe, and one that passes everything is
// not a check. Five of the eight pass clean and three do not, and those three
// are named here with what is actually thin about them, so that loosening the
// rule to make them pass has to be a deliberate act rather than a quiet one.
//
// The eight are copies under test/fixtures/, taken at commit dc606116 with
// draft-host rewritten in its brokered form (no credential, env or settings,
// as it has been since 2026-09-28), and not the live packages beside this one: a sibling that is mended later (as
// explainer-maker's was) would change what this suite sees, and a suite that
// reads outside its own package cannot run anywhere the package is copied to.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DOES_MAX, EMPTY_MIN, GOOD_MIN, REFUSES_MIN, WHEN_MAX,
  checkSpec, containerProblems, isKind, jobProblems, kindProblems, recordProblems, refusalProblems, systemProblems,
} from "../scripts/check-spec.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, "fixtures");
const specOf = (name) => JSON.parse(readFileSync(join(FIXTURES, `${name}.spec.json`), "utf8"));

const CLEAN = ["brand-reader", "brief-writer", "explainer-critic", "process-runner", "publisher"];

test("every spec that already produced a working agent passes, or is named here", () => {
  for (const name of CLEAN) {
    assert.deepEqual(checkSpec(specOf(name)), [], `${name} shipped and this check fails it`);
  }
});

test("the three that do not pass are thin in ways the reference already names", () => {
  // explainer-maker: four steps carry no `does`. The reference lists this
  // under where the existing eight are thin, and it is the same four.
  const maker = checkSpec(specOf("explainer-maker"));
  assert.equal(maker.length, 4);
  assert.ok(maker.every((p) => /no does$/.test(p)), maker.join(" | "));

  // quiz-maker: one refusal names a category rather than an act. "The tricks
  // that test reading rather than knowing" is a rule. A reader cannot tell
  // from it whether a given request falls under it, which is what a refusal
  // is for.
  const quiz = checkSpec(specOf("quiz-maker"));
  assert.equal(quiz.length, 1);
  assert.match(quiz[0], /begins "The"/);

  // video-watcher: one refusal is the act alone, with no why and no what
  // happens instead. A buyer reading it does not learn what becomes of a
  // forty minute video.
  const watcher = checkSpec(specOf("video-watcher"));
  assert.equal(watcher.length, 1);
  assert.match(watcher[0], /is 7 words/);
});

test("a job missing any of its four sentences is named, one line each", () => {
  const bare = { slug: "do-it", how: { control: "script", intelligence: "none", cost: "none", contract: "full" } };
  const problems = jobProblems(bare);
  for (const k of ["when", "good", "empty", "does"]) {
    assert.ok(problems.some((p) => p === `job do-it: no ${k}`), `${k} was not named`);
  }
});

test("the lengths are bounds on shape, and each says why", () => {
  const how = { control: "script", intelligence: "none", cost: "none", contract: "full" };
  const long = { slug: "j", how, good: "x ".repeat(GOOD_MIN), empty: "y ".repeat(EMPTY_MIN), does: "z",
                 when: "w ".repeat(WHEN_MAX + 1) };
  assert.match(jobProblems(long).join(" "), /when is \d+ words; it is read by somebody choosing between jobs/);
  const short = { slug: "j", how, when: "w", good: "too short", empty: "y ".repeat(EMPTY_MIN), does: "z" };
  assert.match(jobProblems(short).join(" "), /good is 2 words; it describes the artifact/);
  const chatty = { slug: "j", how, when: "w", good: "x ".repeat(GOOD_MIN), empty: "y ".repeat(EMPTY_MIN),
                   does: "z ".repeat(DOES_MAX + 1) };
  assert.match(jobProblems(chatty).join(" "), /does is \d+ words; it is one line/);
});

test("the two combinations the builder refuses are caught while the model still has the draft", () => {
  const base = { slug: "j", when: "w", good: "x ".repeat(GOOD_MIN), empty: "y ".repeat(EMPTY_MIN), does: "z" };
  // The builder refuses both of these too, but its refusal arrives after a
  // package has been assembled. Here it arrives in time to be fixed.
  const improvised = jobProblems({ ...base, how: { control: "model", intelligence: "open", cost: "metered", contract: "full" } });
  assert.match(improvised.join(" "), /the shape that fails/);
  const launcher = jobProblems({ ...base, how: { control: "script", intelligence: "open", cost: "metered", contract: "full" } });
  assert.match(launcher.join(" "), /a model with a launcher/);
  // And a job with no how at all.
  assert.match(jobProblems(base).join(" "), /no how; every job says control, intelligence, cost and contract/);
});

test("a refusal is an act, as a gerund, with a reason after it", () => {
  const enough = (n) => Array.from({ length: n }, (_, i) => `refusing thing ${i}, because it would be wrong, and it is said so plainly`);
  assert.deepEqual(refusalProblems(enough(REFUSES_MIN)), []);
  assert.match(refusalProblems([]).join(" "), new RegExp(`at least ${REFUSES_MIN}`));
  const rule = [...enough(REFUSES_MIN - 1), "Be careful with credentials, because they are dangerous and must not leak"];
  assert.match(refusalProblems(rule).join(" "), /begins "Be"; a refusal names an act as a gerund/);
  const curt = [...enough(REFUSES_MIN - 1), "publishing anything at all"];
  assert.match(refusalProblems(curt).join(" "), /is 4 words; a refusal says the act, then why/);
  // An object refusal is read the same way as a string one.
  assert.deepEqual(refusalProblems(enough(REFUSES_MIN).map((what) => ({ what }))), []);
});

test("the manifest is on every spec, and what a job went without travels with the means to write it", () => {
  const writes = { jobs: [{ scripts: ["scripts/a.mjs", "scripts/went-without.mjs"] }] };
  const silent = { jobs: [{ scripts: ["scripts/a.mjs"] }] };
  const both = [{ name: "what it did not have", file: "*/went-without.json" }, { name: "the signed job manifest" }];
  const manifestOnly = [{ name: "the signed job manifest" }];

  assert.deepEqual(recordProblems(both, writes), []);
  assert.deepEqual(recordProblems(manifestOnly, silent), []);

  // A record declared and never written is worse than one absent: the
  // conformance checker audits a package against its own declarations and
  // goes looking for it. Five packages ended up in exactly that state because
  // this check used to demand the record from everybody.
  assert.match(recordProblems(both, silent).join(" "), /nothing can write it/);
  assert.match(recordProblems(manifestOnly, writes).join(" "), /ships went-without\.mjs and no record/);

  assert.match(recordProblems([{ name: "something else", file: "*/other.json" }], silent).join(" "), /signed job manifest/);
});

test("the name has to be a handle, because that is what it becomes", () => {
  const ok = specOf("publisher");
  assert.deepEqual(checkSpec({ ...ok, name: "Spec Writer" }).filter((p) => p.includes("handle")).length, 1);
  assert.equal(checkSpec({ ...ok, name: "spec-writer" }).length, 0);
  assert.equal(checkSpec({ ...ok, name: "9lives" }).filter((p) => p.includes("handle")).length, 1);
});

test("a spec where nothing is offered has not said what a caller orders", () => {
  const s = specOf("publisher");
  const noneOffered = { ...s, jobs: s.jobs.map((j) => ({ ...j, offered: false })) };
  assert.match(checkSpec(noneOffered).join(" "), /no job is marked offered/);
});

test("a spec with no price has not decided, and free is a decision", () => {
  const s = specOf("publisher");
  const { price: _drop, ...noPrice } = s;
  assert.match(checkSpec(noPrice).join(" "), /no price/);
  assert.deepEqual(checkSpec({ ...s, price: { model: "free" } }), []);
});

test("nonsense in is one sentence out, not a stack trace", () => {
  assert.deepEqual(checkSpec(null), ["the draft is not an object"]);
  assert.deepEqual(checkSpec([]), ["the draft is not an object"]);
  assert.match(checkSpec({ name: "x" }).join(" "), /the spec has no jobs/);
});

test("a kind is one of four words or one media type, and anything else is named with the input it sits on", () => {
  for (const k of ["text", "identifier", "url", "document", "application/json", "image/png", "application/octet-stream"]) assert.equal(isKind(k), true, k);
  for (const k of ["array of application/octet-stream", "json", "file", "list of urls", "", null]) assert.equal(isKind(k), false, String(k));
  const job = { slug: "convert", inputs: [{ name: "the files", kind: "array of application/octet-stream" }], outputs: [{ name: "result", kind: "application/json" }] };
  const found = kindProblems(job);
  assert.equal(found.length, 1);
  assert.match(found[0], /job convert: input "the files" has kind "array of application\/octet-stream", which is not a kind/);
  assert.match(found[0], /several files of one kind are one input/);
});

test("an address anywhere in a system is refused before the builder refuses the whole package", () => {
  const withAddress = [{ name: "text-reasoning", access: "read", needs: "n", kind: "service", credential: "k", env: "K",
    settings: [{ env: "BASE", purpose: "the base address, https://api.example.com by default" }] }];
  const found = systemProblems(withAddress);
  assert.equal(found.length, 1);
  assert.match(found[0], /system text-reasoning: settings\[0\]\.purpose carries an address/);
  assert.match(found[0], /a public read that needs no key is a system with access read, no credential and no settings/);
  const keyless = [{ name: "public-page", access: "read", needs: "to read a public page", kind: "service", leaves: true }];
  assert.deepEqual(systemProblems(keyless), []);
});

test("draft-host is brokered, so a draft-host entry carrying a credential, a variable or settings is named", () => {
  assert.deepEqual(systemProblems([{ name: "draft-host", access: "write", needs: "to place the files", kind: "service" }]), []);
  const keyed = systemProblems([{ name: "draft-host", access: "write", needs: "n", kind: "service", credential: "draft-host-writer", env: "DRAFT_HOST_CREDENTIAL" }]);
  assert.equal(keyed.length, 1);
  assert.match(keyed[0], /system draft-host is brokered/);
});

test("a container spec names no scripts, pins a whole commit and carries no secret value, and a package spec is not held to any of it", () => {
  const base = { name: "adk-demo", version: "0.1.0", kind: "third-party-framework", jobs: [{ slug: "answer" }] };
  assert.match(containerProblems(base).join(" "), /carries a container block/);
  const good = { ...base, container: { repository: "https://github.com/o/r", path: "agents/demo", commit: "a".repeat(40), dockerfile: "Dockerfile", holds_own_key: true, secrets: [{ env: "API_KEY", purpose: "the key" }] } };
  assert.deepEqual(containerProblems(good), []);
  const bad = { ...good, jobs: [{ slug: "answer", scripts: ["scripts/a.mjs"] }], container: { ...good.container, commit: "main", holds_own_key: false, secrets: [{ env: "API_KEY", purpose: "the key", value: "x" }] } };
  const found = containerProblems(bad).join(" | ");
  assert.match(found, /job answer: a third-party-framework agent's code lives in its own repository, so a job names no scripts/);
  assert.match(found, /container\.commit is the full 40-character commit/);
  assert.match(found, /container\.holds_own_key is true/);
  assert.match(found, /container\.secrets: API_KEY carries a value/);
  assert.deepEqual(containerProblems(specOf("publisher")), []);
});

test("the worked spec every draft is shown passes the whole check", () => {
  const worked = JSON.parse(readFileSync(join(HERE, "..", "references", "a-spec-that-works.json"), "utf8"));
  assert.deepEqual(checkSpec(worked), []);
});

test("job_seconds outside what the builder takes is a problem, and inside it is not", () => {
  const worked = JSON.parse(readFileSync(join(HERE, "..", "references", "a-spec-that-works.json"), "utf8"));
  for (const bad of [30, 7201, 90.5, "300"]) {
    assert.ok(checkSpec({ ...worked, job_seconds: bad }).some((p) => /job_seconds .* from 60 to 7200/.test(p)), String(bad));
  }
  assert.deepEqual(checkSpec({ ...worked, job_seconds: 60 }), []);
});
