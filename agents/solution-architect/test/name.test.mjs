// Naming the systems: the one model call, asked at most twice, and what code
// takes back out of its answer. The call goes through the shared model caller,
// from the four MODEL_* settings, and only in a protocol the package declares.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { calledFor, declaredProtocols, nameTheSystems, requestParts, TRIES } from "../scripts/name.mjs";
import { callerFor, modelSettings, requestFor } from "../scripts/model-caller.mjs";
import { MODEL_NAME_RE } from "../scripts/standard.mjs";
import { KEY_POINTS, ROOT, fixture, readJson } from "./helpers.mjs";

const defaults = readJson(fixture("../../references/house-stack.json"));
const asked = (over = {}) => ({ statement: KEY_POINTS, defaults, answers: {}, ...over });
const answer = () => readJson(fixture("key-points.answer.json"));
const replying = (...docs) => { let i = 0; const seen = []; return { seen, ask: async (p) => { seen.push(p); const d = docs[Math.min(i, docs.length - 1)]; i += 1; return { text: typeof d === "string" ? d : JSON.stringify(d), answered_by: "test" }; } }; };

test("one sound answer is one call, and the commitments in it become questions", async () => {
  const r = replying(answer());
  const out = await nameTheSystems({ ask: r.ask, asked: asked() });
  assert.equal(out.calls, 1);
  assert.deepEqual(out.architecture.systems.map((s) => s.name), ["text-reasoning"]);
  assert.deepEqual(out.questions.map((q) => q.key).sort(), ["egress-1", "limit-cost"]);
});

test("an answer with findings is asked once more with them, and never a third time", async () => {
  const bad = answer();
  bad.formats[1].kind = "application/json";
  const r = replying(bad, bad, bad);
  const out = await nameTheSystems({ ask: r.ask, asked: asked() });
  assert.equal(out.calls, TRIES);
  assert.equal(r.seen.length, 2);
  assert.match(r.seen[1], /WHAT WAS WRONG WITH YOUR LAST ANSWER[\s\S]*bare application\/json/);
  assert.ok(out.findings.some((f) => /bare application\/json/.test(f)));
});

test("a fenced answer is read, and an answer that is not JSON stops the step in words", async () => {
  const out = await nameTheSystems({ ask: replying("```json\n" + JSON.stringify(answer()) + "\n```").ask, asked: asked() });
  assert.equal(out.architecture.systems[0].name, "text-reasoning");
  await assert.rejects(nameTheSystems({ ask: replying("I think it needs a database").ask, asked: asked() }), /did not answer with JSON/);
});

test("a request this role does not do is declined", async () => {
  const out = await nameTheSystems({ ask: replying({ declined: "design", reply: "That is the Design stage's." }).ask, asked: asked() });
  assert.equal(out.declined, "design");
  assert.match(out.reply, /Design/);
});

test("a system the statement does not call for is asked, never added", () => {
  const arch = { systems: [{ name: "text-reasoning", called_for: "writes the key points" }, { name: "mail", called_for: "send the points by email", why: "to send them" }] };
  const out = calledFor(arch, { statement: KEY_POINTS });
  assert.deepEqual(out.arch.systems.map((s) => s.name), ["text-reasoning"]);
  assert.equal(out.questions[0].key, "system-mail");
  const granted = calledFor(arch, { statement: KEY_POINTS, answers: { "system-mail": "yes" } });
  assert.deepEqual(granted.arch.systems.map((s) => s.name), ["text-reasoning", "mail"]);
  const kept = calledFor(arch, { statement: KEY_POINTS, earlierSystems: ["mail"] });
  assert.equal(kept.arch.systems.length, 2, "a system the earlier record already named stands");
});

test("a design step that needs a new system comes back as a question in a revision", async () => {
  const withMail = answer();
  withMail.systems.push({ name: "mail", plain: "a mail sender", access: "write", why: "the design's send step mails the points", called_for: "the send step mails the points" });
  const earlier = readFileSync(join(ROOT, "references", "a-record-that-works.md"), "utf8").replace("systems: [database, mail, text-reasoning]", "systems: [text-reasoning]");
  const out = await nameTheSystems({ ask: replying(withMail).ask, asked: asked({ revision: { change: "the send step mails the points" }, earlier: { text: earlier } }) });
  assert.ok(!out.architecture.systems.some((s) => s.name === "mail"));
  assert.ok(out.questions.some((q) => q.key === "system-mail"));
});

test("the prompt carries the statement, the reserved systems and the standard, and names no model", () => {
  const standard = readFileSync(join(ROOT, "..", "..", "standards", "architecture-standard.md"), "utf8");
  const text = requestParts({ asked: asked(), standard }).join("\n\n");
  assert.ok(text.includes(KEY_POINTS));
  assert.ok(text.includes("- text-reasoning:"));
  assert.ok(text.includes("## 3. Models are bound systems"));
  assert.equal([...text.matchAll(MODEL_NAME_RE)].length, 0);
});

test("the caller reads the model from configuration and refuses without one", () => {
  const endpoint = "http://127.0.0.1:9";
  assert.equal(modelSettings({}).name, "");
  assert.equal(modelSettings({ AGENT_MODEL: "x" }).name, "", "AGENT_MODEL is never read");
  assert.equal(modelSettings({ MODEL_NAME: "y", AGENT_MODEL: "x" }).name, "y");
  assert.throws(() => callerFor({ MODEL_ENDPOINT: endpoint, MODEL_PROTOCOL: "anthropic-messages", MODEL_KEY: "k" }), /MODEL_NAME is not set/);
  assert.doesNotThrow(() => callerFor({ MODEL_NAME: "some-model", MODEL_ENDPOINT: endpoint, MODEL_PROTOCOL: "anthropic-messages" }), "an unset MODEL_KEY is no refusal: the endpoint may need none");
  assert.deepEqual(declaredProtocols(), ["anthropic-messages", "openai-chat", "gemini"], "name.mjs reads the protocols its text-reasoning system declares");
  for (const protocol of declaredProtocols()) assert.doesNotThrow(() => callerFor({ MODEL_NAME: "some-model", MODEL_ENDPOINT: endpoint, MODEL_PROTOCOL: protocol, MODEL_KEY: "k" }, fetch, { protocols: declaredProtocols() }), protocol);
  assert.throws(() => callerFor({ MODEL_NAME: "some-model", MODEL_ENDPOINT: endpoint, MODEL_PROTOCOL: "bedrock", MODEL_KEY: "k" }, fetch, { protocols: declaredProtocols() }), /MODEL_PROTOCOL bedrock is not one this caller speaks/);
  // A narrower declared list, passed explicitly, is what the caller holds to.
  assert.throws(() => callerFor({ MODEL_NAME: "some-model", MODEL_ENDPOINT: endpoint, MODEL_PROTOCOL: "openai-chat", MODEL_KEY: "k" }, fetch, { protocols: ["anthropic-messages"] }), /MODEL_PROTOCOL openai-chat is not one this package's model system declares/);
  const r = requestFor("hi", modelSettings({ MODEL_NAME: "some-model", MODEL_ENDPOINT: `${endpoint}/`, MODEL_PROTOCOL: "anthropic-messages", MODEL_KEY: "k" }));
  assert.equal(r.url, `${endpoint}/v1/messages`);
  assert.equal(r.body.model, "some-model");
  assert.equal(r.headers["x-api-key"], "k");
  assert.ok(!JSON.stringify(r.body).includes("\"k\""), "the key is in a header only");
});

test("no script names a model on a line that is not a comment", () => {
  for (const f of ["asked.mjs", "name.mjs", "model-caller.mjs", "standard.mjs", "bind.mjs", "architecture-record.mjs", "check-record.mjs", "reply.mjs", "pieces.mjs"]) {
    const lines = readFileSync(join(ROOT, "scripts", f), "utf8").split("\n").filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l));
    for (const l of lines) assert.equal([...l.matchAll(MODEL_NAME_RE)].length, 0, `${f}: ${l}`);
  }
});
