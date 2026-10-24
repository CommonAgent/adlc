// The builder's filing may propose the instruction an update is installed
// with (debt 57), and a proposal that carries anything but names and plain
// values is refused before it leaves the host.
//   node --test fleet-manager/agentbuilder/request.test.mjs
//
// request.py is the one filer the fleet runs; these call it the way the host
// does, through python3, and read what it prints.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const REQUEST = join(HERE, "request.py");
const python = (args, env = {}) => spawnSync("python3", args, { encoding: "utf8", env: { ...process.env, ...env } });
const proposalOf = (path) => python(["-c", "import sys, json; sys.path.insert(0, sys.argv[1]); import request; print(json.dumps(request.read_proposal(sys.argv[2])))", HERE, path]);

const SONNET = {
  model: "google-vertex-anthropic/claude-sonnet-5-5@default",
  credentials: { "text-reasoning": "vertex-claude-endpoint" },
  settings: { "text-reasoning": { TEXT_MODEL: "google-vertex-anthropic/claude-sonnet-5-5" } },
};

test("a proposal names a model, credential names and settings, and nothing named is no proposal", () => {
  const dir = mkdtempSync(join(tmpdir(), "request-args-"));
  try {
    const at = join(dir, "args.json");
    writeFileSync(at, JSON.stringify(SONNET));
    const r = proposalOf(at);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout), SONNET);
    const none = proposalOf("");
    assert.equal(none.stdout.trim(), "null");
    writeFileSync(at, JSON.stringify({ settings: {} }));
    assert.equal(proposalOf(at).stdout.trim(), "null", "an empty proposal is none");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a proposal carrying a key where a name belongs, or anything else, stops the filing with one JSON line", () => {
  const dir = mkdtempSync(join(tmpdir(), "request-args-"));
  try {
    const at = join(dir, "args.json");
    writeFileSync(at, JSON.stringify({ ...SONNET, credentials: { "text-reasoning": "sk-ant-api03 pasted here" } }));
    const pasted = python([REQUEST], { DEPLOY_ARGS: at });
    assert.equal(pasted.status, 1);
    assert.match(JSON.parse(pasted.stdout.trim()).error, /credentials\.text-reasoning must be a credential name, never a value/);
    writeFileSync(at, JSON.stringify({ ...SONNET, admit: ["someone"] }));
    const extra = python([REQUEST], { DEPLOY_ARGS: at });
    assert.equal(extra.status, 1);
    assert.match(JSON.parse(extra.stdout.trim()).error, /may carry model, credentials and settings, not admit/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
