// The parts the agent is made of agree with each other: the descriptor, the
// runtime requirements, plugin.json and the skills, and the shared file kept
// the same as every other package's.
//   run: node --test test/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const AGENT = join(dirname(fileURLToPath(import.meta.url)), "..");
const json = (p) => JSON.parse(readFileSync(join(AGENT, p), "utf8"));
const D = json("agent-descriptor.json");
const R = json("agent-runtime-requirements.json");
const P = json("plugin.json");
const SKILLS = P.extensions["net.agentdoc.package"].build.skills;

test("one version, and every job and step has a skill with its scripts", () => {
  assert.equal(D.agent_version, P.version);
  const ids = D.offerings.flatMap((o) => [o.id, ...(o.steps ?? []).map((s) => s.id)]);
  assert.deepEqual(Object.keys(SKILLS).sort(), [...ids].sort());
  for (const [slug, { scripts = [], references = [] }] of Object.entries(SKILLS)) {
    assert.ok(existsSync(join(AGENT, "skills", slug, "SKILL.md")), `${slug} has a SKILL.md`);
    for (const f of [...scripts, ...references]) assert.ok(existsSync(join(AGENT, f)), `${slug}: ${f}`);
  }
  assert.ok(R.run[D.offerings[0].id], "the offering has a run command");
});

test("the offering's skill carries every script, and every script it imports is carried with it", () => {
  const all = new Set(SKILLS["watch-the-fleet"].scripts);
  for (const f of all) {
    for (const m of readFileSync(join(AGENT, f), "utf8").matchAll(/from "\.\/([a-z-]+\.mjs)"/g)) assert.ok(all.has(`scripts/${m[1]}`), `${f} imports ${m[1]}`);
  }
  for (const [slug, { scripts = [] }] of Object.entries(SKILLS)) {
    const mine = new Set(scripts);
    for (const f of scripts) for (const m of readFileSync(join(AGENT, f), "utf8").matchAll(/from "\.\/([a-z-]+\.mjs)"/g)) {
      assert.ok(mine.has(`scripts/${m[1]}`), `${slug}: ${f} imports ${m[1]}, which the skill does not carry`);
    }
  }
});

test("every kind is specific: no bare application/json, and every input says who gives it", () => {
  const pieces = D.offerings.flatMap((o) => [o, ...(o.steps ?? [])]).flatMap((j) => [...(j.inputs ?? []), ...(j.outputs ?? [])]);
  for (const p of pieces) {
    assert.notEqual(p.kind, "application/json", `${p.name} is bare application/json`);
    assert.ok(["text", "identifier", "url", "document"].includes(p.kind) || /^[a-z]+\/[a-z0-9.+-]+$/.test(p.kind), `${p.name}: ${p.kind}`);
  }
  for (const j of D.offerings.flatMap((o) => [o, ...(o.steps ?? [])])) for (const i of j.inputs ?? []) assert.ok(["person", "agent", "either"].includes(i.given_by), `${j.id}: ${i.name} says who gives it`);
});

test("it calls no model, reads one system, and names no model anywhere", () => {
  assert.deepEqual(D.systems.map((s) => [s.name, s.access]), [["the-platform", "read"]]);
  assert.deepEqual(R.systems.map((s) => [s.name, s.kind, s.credential, s.env]), [["the-platform", "service", "watch-read-key", "WATCH_TOKEN"]]);
  assert.deepEqual(R.systems[0].settings.map((s) => s.env), ["MESH_API_BASE", "WATCH_AGENTS", "INCIDENT_RECORDER", "ANSWER_SECONDS"]);
  for (const o of D.offerings) for (const j of [o, ...(o.steps ?? [])]) {
    assert.deepEqual(j.how, { control: "script", intelligence: "none", cost: "none", contract: "full" }, j.id);
  }
  const files = [...new Set(Object.values(SKILLS).flatMap((s) => [...(s.scripts ?? []), ...(s.references ?? [])]))];
  for (const f of files) assert.doesNotMatch(readFileSync(join(AGENT, f), "utf8"), /\b(claude|gemini|gpt-\d|sonnet|opus|haiku)\b/i, f);
  for (const slug of Object.keys(SKILLS)) assert.doesNotMatch(readFileSync(join(AGENT, "skills", slug, "SKILL.md"), "utf8"), /\b(claude|gemini|gpt-\d|sonnet|opus|haiku)\b/i, slug);
});

test("the platform reads are GETs only, and the only key is the read key", () => {
  const src = readFileSync(join(AGENT, "scripts", "platform.mjs"), "utf8");
  assert.match(src, /method: "GET"/);
  assert.doesNotMatch(src, /method: "(POST|PUT|PATCH|DELETE)"/);
  for (const f of SKILLS["watch-the-fleet"].scripts) {
    const text = readFileSync(join(AGENT, f), "utf8");
    assert.doesNotMatch(text, /credits\/purchase|\/budget|\/allowance\b/, f);
    for (const m of text.matchAll(/process\.env\.([A-Z_]+)|env\.([A-Z_]+)/g)) {
      assert.ok(["WATCH_AGENTS", "MESH_API_BASE", "WATCH_TOKEN", "INCIDENT_RECORDER", "ANSWER_SECONDS", "AGENTMESH_BIN"].includes(m[1] ?? m[2]), `${f} reads ${m[1] ?? m[2]}`);
    }
  }
});

test("went-without.mjs is the same file the other packages keep", () => {
  const mine = readFileSync(join(AGENT, "scripts", "went-without.mjs"), "utf8");
  assert.equal(mine, readFileSync(join(AGENT, "..", "spec-writer", "scripts", "went-without.mjs"), "utf8"));
});

test("the report names the version that wrote it", async () => {
  const { WATCHER } = await import("../scripts/write-report.mjs");
  assert.equal(WATCHER, `watcher ${P.version}`);
});

test("the pieces it files are declared outputs, by name or as <output> (<file>)", async () => {
  const { plan } = await import("../scripts/pieces.mjs");
  const declared = new Set(D.offerings[0].outputs.map((o) => o.name));
  const { entries } = plan({ reportPath: "r", recordPath: "w", alarms: [{ agent: "a", file: "watch-platform-a.jsonl", path: "p" }] });
  for (const e of entries) assert.ok(declared.has(e.name.replace(/ \(.*\)$/, "")), e.name);
});

test("the install file carries no address, account identifier or credential, as the image emitter requires", async () => {
  const { forbiddenIn } = await import("../../image/emit-image.mjs");
  assert.deepEqual(forbiddenIn(JSON.stringify(R), "the install file"), []);
});
