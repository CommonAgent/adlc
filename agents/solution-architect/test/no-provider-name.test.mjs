// No provider or model name in anything this agent hands back (technical debt
// 641; AgentMesh never says which AI provider stands behind the House Stack).
// What it hands back is the record, what is still open, what changed, the
// reply and the list of pieces. This test reads all of them with its own list
// of provider and model words, not the scripts' list, so a script that forgets
// a word cannot also make the test forget it. It also reads the package's own
// references and examples, which the model is shown and a reader opens.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseRecord } from "../scripts/architecture-record.mjs";
import { forbiddenIn } from "../scripts/check-record.mjs";
import { BUILD_WORDS, KEY_POINTS, ROOT, answerFile, fixture, readJson, runJob, workspace } from "./helpers.mjs";

/** Provider and model words, as a reader would recognise them. */
const PROVIDERS = /\b(?:google|gemini|gemma|anthropic|claude|openai|chatgpt|gpt|vertex|bedrock|elevenlabs|mistral|llama|deepseek|qwen|grok|cohere|opus|sonnet|haiku)\b/gi;
const providersIn = (text) => [...String(text ?? "").matchAll(PROVIDERS)].map((m) => m[0]);

/** Everything one job hands back, as one text per piece. */
function handedBack(r) {
  const out = { reply: r.reply ?? "" };
  for (const f of ["architecture-record.md", "still-open.md", "what-changed.md"]) {
    const p = join(r.job, "out", f);
    if (existsSync(p)) out[f] = readFileSync(p, "utf8");
  }
  const pieces = join(r.job, "pieces.json");
  if (existsSync(pieces)) out["pieces.json"] = readFileSync(pieces, "utf8");
  for (const s of Object.values(r.steps ?? {})) if (s?.out?.reply) out[`a step's reply`] = s.out.reply;
  return out;
}

function assertNoProvider(r, what) {
  assert.ok(r.steps.check?.status === 0, `${what}: ${JSON.stringify(r.steps)}`);
  for (const [piece, text] of Object.entries(handedBack(r))) {
    assert.deepEqual(providersIn(text), [], `${what}: ${piece} names a provider or a model:\n${text}`);
  }
}

const SETTLED = [fixture("build-settled.json"), "application/vnd.agentmesh.settled-answers+json"];

test("a Build an agent request hands back no provider or model name", () => {
  const ws = workspace();
  assertNoProvider(runJob({ ws, text: BUILD_WORDS, files: [SETTLED], answers: [fixture("count-words.answer.json")] }), "with the build's settled answers");
});

test("the House Stack's model is bound as the platform's, never by its provider", () => {
  const ws = workspace();
  const r = runJob({ ws, text: KEY_POINTS, answers: [fixture("key-points.answer.json")] });
  assertNoProvider(r, "bound to the House Stack");
  const h = parseRecord(r.record);
  for (const env of ["dev", "test", "production"]) assert.deepEqual(h.bindings["text-reasoning"][env], { product: "platform", provided_by: "platform" });
  assert.match(r.record, /^\| text-reasoning \| platform \(AgentMesh's models\), platform default \|/m);
});

test("platform defaults attached from the live vocabulary, which name the provider, still hand back none", () => {
  const ws = workspace();
  const vocab = readJson(join(ROOT, "references", "house-stack.json"));
  const live = { ...vocab, systems: vocab.systems.map((s) => (["text-reasoning", "image-reading"].includes(s.name) ? { ...s, house: { ...s.house, product: "google-gemini" } } : s.name === "speech-to-text" ? { ...s, house: { ...s.house, product: "google-speech-to-text" } } : s.name === "text-to-speech" ? { ...s, house: { ...s.house, product: "google-gemini-speech" } } : s)) };
  const p = join(ws.root, "vocabulary.json");
  writeFileSync(p, JSON.stringify(live));
  const r = runJob({ ws, text: KEY_POINTS, files: [[p, "application/vnd.agentmesh.stack-vocabulary+json"]], answers: [fixture("key-points.answer.json")] });
  assertNoProvider(r, "with the live vocabulary attached");
});

test("a revision of a House Stack record hands back no provider name in what changed", () => {
  const ws = workspace();
  const first = runJob({ ws, name: "a", text: KEY_POINTS, answers: [fixture("key-points.answer.json")] });
  const second = runJob({ ws, name: "b", text: "limit-cost: at most 2 USD a day\negress-1: yes", files: [[join(first.job, "out", "architecture-record.md"), "text/markdown"]], answers: [fixture("key-points.answer.json")] });
  assertNoProvider(second, "a revision");
  assert.ok(existsSync(join(second.job, "out", "what-changed.md")));
});

test("a provider the person or the model names is not handed back", () => {
  const ws = workspace();
  const doc = readJson(fixture("count-words.answer.json"));
  doc.systems[0].why = "Gemini reads untidy text well, and so would Claude.";
  doc.decisions[0].weighed = "an answer written by GPT";
  const words = `${BUILD_WORDS}\n\nmore from the person: "Use Gemini if you can."`;
  assertNoProvider(runJob({ ws, name: "a", text: words, files: [SETTLED], answers: [answerFile(ws, "named", doc)] }), "named, with settled answers");
  assertNoProvider(runJob({ ws, name: "b", text: words, answers: [answerFile(ws, "named2", doc)] }), "named, with the House Stack");
});

test("the organization's own model product is its own choice, and stays", () => {
  const ws = workspace();
  const stack = { bindings: [{ system: "text-reasoning", product: "anthropic", provided_by: "customer", environments: { development: {}, staging: {}, production: {} } }] };
  const p = join(ws.root, "stack.json");
  writeFileSync(p, JSON.stringify(stack));
  const r = runJob({ ws, text: KEY_POINTS, files: [[p, "application/vnd.agentmesh.stack+json"]], answers: [fixture("key-points.answer.json")] });
  assert.equal(r.steps.check.status, 0, JSON.stringify(r.steps));
  assert.deepEqual(parseRecord(r.record).bindings["text-reasoning"].production, { product: "anthropic", provided_by: "customer" });
});

test("a record naming the House Stack's provider is not delivered", () => {
  const vocabulary = [{ name: "text-reasoning", house: { covered: true, product: "google-gemini", label: "AgentMesh's models" } }];
  const leaked = "---\nrecord: architecture-record-v1\nbindings:\n  text-reasoning:\n    dev: google-gemini (platform)\n---\n";
  assert.ok(forbiddenIn(leaked, undefined, { vocabulary }).some((f) => /provider/.test(f)), "a House Stack model product is a provider's name");
  assert.ok(forbiddenIn("The model is Gemini.", undefined, { vocabulary }).some((f) => /provider/.test(f)));
  assert.deepEqual(forbiddenIn("dev: anthropic (customer)", undefined, { vocabulary, allowed: ["anthropic"] }), [], "the organization's own product is its choice");
});

test("the package's references, examples and documents name no House Stack provider", () => {
  const houseProducts = /google-gemini|google-speech-to-text|google-gemini-speech/;
  const files = ["README.md", "rules.md", join("references", "a-record-that-works.md"), ...readdirSync(join(ROOT, "skills")).map((s) => join("skills", s, "SKILL.md"))];
  for (const f of files) {
    const text = readFileSync(join(ROOT, f), "utf8");
    assert.doesNotMatch(text, houseProducts, `${f} names a House Stack provider's product`);
  }
  assert.deepEqual(providersIn(readFileSync(join(ROOT, "references", "a-record-that-works.md"), "utf8")), [], "the example record the model is shown names no provider");
  const vocab = readJson(join(ROOT, "references", "house-stack.json"));
  for (const s of vocab.systems.filter((x) => ["text-reasoning", "image-reading", "speech-to-text", "text-to-speech"].includes(x.name))) {
    assert.equal(s.house.product, "platform", `the copy of the platform's defaults names ${s.name}'s House Stack product only as the platform's`);
  }
});
