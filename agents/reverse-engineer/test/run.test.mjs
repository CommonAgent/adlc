// The job as the runtime requirements start it: node, the run command's own
// arguments with the host's placeholders filled in, a job folder holding
// message.txt, and the codebase attached as a gzip tar the way per_file says.
// The package is laid out the way the builder lays it out (each skill's
// scripts and references from plugin.json under skills/<slug>/), so a script
// missing from plugin.json fails here and not on a host. The model is a stand-in
// on 127.0.0.1 reached through the four model settings and the shared caller.
//   node --test test/run.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { pack } from "../scripts/archive.mjs";
import { AGENT, FIXTURES, codebase } from "./helpers.mjs";
import { checkDelivered } from "./delivered-formats.test.mjs";

const json = (p) => JSON.parse(readFileSync(p, "utf8"));
const RUN = json(join(AGENT, "agent-runtime-requirements.json")).run["reverse-engineer"];
const PLUGIN = json(join(AGENT, "plugin.json"));

function host() {
  const root = mkdtempSync(join(tmpdir(), "reverse-engineer-run-"));
  const pkg = "reverse-engineer";
  for (const name of ["plugin.json", "agent-runtime-requirements.json", "agent-descriptor.json"]) {
    mkdirSync(join(root, "home", pkg), { recursive: true });
    writeFileSync(join(root, "home", pkg, name), readFileSync(join(AGENT, name)));
  }
  for (const [slug, { scripts = [], references = [] }] of Object.entries(PLUGIN.extensions["net.agentdoc.package"].build.skills)) {
    for (const s of scripts) {
      const to = join(root, "home", pkg, "skills", slug, "scripts", basename(s));
      mkdirSync(dirname(to), { recursive: true });
      writeFileSync(to, readFileSync(join(AGENT, s)));
    }
    for (const r of references) {
      const to = join(root, "home", pkg, "skills", slug, "references", basename(r));
      mkdirSync(dirname(to), { recursive: true });
      writeFileSync(to, readFileSync(join(AGENT, r)));
    }
  }
  return { root, home: join(root, "home"), pkg, records: join(root, "records"), work: join(root, "work") };
}

function run(h, { id = "job-1", message = "", files = [], env = {} } = {}) {
  const jobDir = join(h.root, "jobs", id);
  mkdirSync(jobDir, { recursive: true });
  writeFileSync(join(jobDir, "message.txt"), message);
  const fill = (s, more = {}) => s.replaceAll("{home}", h.home).replaceAll("{package}", h.pkg).replaceAll("{job_dir}", jobDir)
    .replaceAll("{records}", h.records).replaceAll("{work}", h.work).replaceAll("{file_path}", more.path ?? "").replaceAll("{file_media_type}", more.type ?? "");
  const argv = RUN.command.map((s) => fill(s));
  for (const f of files) for (const s of RUN.per_file) argv.push(fill(s, f));
  const [cmd, ...args] = argv;
  assert.equal(cmd, "node");
  const passed = {};
  for (const k of ["PATH", "Path", "SystemRoot", "ComSpec", "PATHEXT", "TEMP", "TMP", "HOME", "USERPROFILE"]) if (process.env[k]) passed[k] = process.env[k];
  return new Promise((resolve) => {
    const p = spawn(process.execPath, args, { env: { ...passed, ...env } });
    let out = ""; let err = "";
    p.stdout.on("data", (b) => { out += b; });
    p.stderr.on("data", (b) => { err += b; });
    p.on("close", (status) => {
      let doc;
      assert.doesNotThrow(() => { doc = JSON.parse(out.trim()); }, `stdout is one JSON object, got: ${out}\n${err}`);
      resolve({ status, doc, jobDir, recordsDir: join(h.records, id) });
    });
  });
}

/** A stand-in model speaking openai-chat, answering the node-app draft. */
async function modelStandIn() {
  const seen = [];
  const answer = readFileSync(join(FIXTURES, "answers", "node-app.json"), "utf8");
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const c of req) raw += c;
    seen.push({ url: req.url, headers: req.headers, body: JSON.parse(raw) });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: "x", model: "stand-in-model", choices: [{ index: 0, message: { role: "assistant", content: answer }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 20 } }));
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  return { endpoint: `http://127.0.0.1:${server.address().port}`, seen, close: () => new Promise((ok) => server.close(ok)) };
}

function attachedCodebase(h) {
  const cb = codebase("node-app");
  const archive = join(h.root, "attached", "greeter.tar.gz");
  mkdirSync(dirname(archive), { recursive: true });
  pack(cb.dir, archive);
  return { cb, file: { path: archive, type: "application/gzip" } };
}

test("the run command, from a laid-out package, describes an attached codebase through the shared caller", async () => {
  const h = host();
  const { cb, file } = attachedCodebase(h);
  const model = await modelStandIn();
  try {
    const r = await run(h, {
      message: `Describe this codebase.\nrepository: https://git.example.com/acme/greeter.git\ncommit: ${cb.commit}\nmay run: yes`,
      files: [file],
      env: { MODEL_NAME: "stand-in-model", MODEL_ENDPOINT: model.endpoint, MODEL_KEY: "test-key", MODEL_PROTOCOL: "openai-chat" },
    });
    assert.equal(r.status, 0, r.doc.reply);
    assert.equal(r.doc.ok, true);
    assert.equal(r.doc.read_mode, "read and run");
    assert.equal(model.seen.length, 3, "the architecture, behavior and test-coverage passes");
    assert.equal(model.seen[0].url, "/chat/completions");
    assert.equal(model.seen[0].body.model, "stand-in-model");
    assert.equal(model.seen[0].headers.authorization, "Bearer test-key");
    assert.doesNotMatch(JSON.stringify(model.seen[0].body), /test-key/, "the key is never in the body");
    const record = json(join(r.jobDir, "out", "as-built", "record.json"));
    assert.deepEqual([record.commit, record.commit_checked, record.counts.behaviors, record.made_by.version], [cb.commit, true, 3, PLUGIN.version]);
    assert.deepEqual(checkDelivered(r.jobDir), []);
    const pieces = json(join(r.jobDir, "pieces.json"));
    assert.deepEqual(pieces.map((p) => p.step), ["write-the-record", "draft-from-the-code", "draft-from-the-code", "draft-from-the-code", "list-the-dependencies", "check-the-evidence", "draft-from-the-code"]);
    const calls = json(join(r.recordsDir, "calls.json"));
    assert.deepEqual([calls.model, calls.service, calls.made, calls.passes.length], ["stand-in-model", "openai-chat", 3, 3]);
  } finally { await model.close(); }
});

test("with a protocol the package does not declare, nothing is sent and the drafted parts are gaps", async () => {
  const h = host();
  const { cb, file } = attachedCodebase(h);
  const model = await modelStandIn();
  try {
    const r = await run(h, {
      message: `repository: https://git.example.com/acme/greeter.git\ncommit: ${cb.commit}`,
      files: [file],
      env: { MODEL_NAME: "m", MODEL_ENDPOINT: model.endpoint, MODEL_KEY: "k", MODEL_PROTOCOL: "carrier-pigeon" },
    });
    assert.equal(r.status, 0, r.doc.reply);
    assert.equal(model.seen.length, 0);
    assert.match(r.doc.reply, /No model drafted from the code \(.*MODEL_PROTOCOL/);
    const record = json(join(r.jobDir, "out", "as-built", "record.json"));
    assert.equal(record.drafted, false);
    assert.ok(json(join(r.jobDir, "out", "as-built", "sbom.cdx.json")).components.length === 4);
  } finally { await model.close(); }
});

test("without the codebase it writes nothing and says what to send", async () => {
  const h = host();
  const r = await run(h, { message: "repository: https://git.example.com/acme/greeter.git\ncommit: abc1234" });
  assert.equal(r.status, 3);
  assert.match(r.doc.reply, /I need the codebase/);
});
