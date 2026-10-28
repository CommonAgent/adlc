// The job as the runtime requirements start it: node, the run command's own
// arguments with the host's placeholders filled in, a job folder holding
// message.txt, and the attached files passed the way per_file says. The
// package is laid out the way the builder lays it out (each skill's scripts
// from plugin.json under skills/<slug>/), so a script missing from plugin.json
// fails here and not on a host. The ledger is a real HTTP server on this
// machine, reached through LEDGER_TOKEN and MESH_API_BASE as a host binds them.
//   run: node --test test/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { changeFiles, descriptor } from "./helpers.mjs";
import { checkDelivered } from "./delivered-formats.test.mjs";

const AGENT = join(dirname(fileURLToPath(import.meta.url)), "..");
const json = (p) => JSON.parse(readFileSync(p, "utf8"));
const RUN = json(join(AGENT, "agent-runtime-requirements.json")).run["agent-change"];
const PLUGIN = json(join(AGENT, "plugin.json"));
const DESCRIPTOR = json(join(AGENT, "agent-descriptor.json"));

function host() {
  const root = mkdtempSync(join(tmpdir(), "impact-analyst-run-"));
  const pkg = "impact-analyst";
  for (const [slug, { scripts = [], references = [] }] of Object.entries(PLUGIN.extensions["net.agentdoc.package"].build.skills)) {
    for (const s of [...scripts, ...references]) {
      const to = join(root, "home", pkg, "skills", slug, s);
      mkdirSync(dirname(to), { recursive: true });
      writeFileSync(to, readFileSync(join(AGENT, s)));
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
  for (const f of files) {
    const at = join(h.root, "attached", id, f.name);
    mkdirSync(dirname(at), { recursive: true });
    writeFileSync(at, f.text ?? JSON.stringify(f.doc));
    for (const s of RUN.per_file) argv.push(fill(s, { path: at, type: f.type ?? "" }));
  }
  const [cmd, ...args] = argv;
  assert.equal(cmd, "node");
  return new Promise((resolve) => {
    const p = spawn(process.execPath, args, { env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot ?? "", ...env } });
    let out = ""; let err = "";
    p.stdout.on("data", (b) => { out += b; });
    p.stderr.on("data", (b) => { err += b; });
    p.on("close", (status) => {
      let doc;
      assert.doesNotThrow(() => { doc = JSON.parse(out.trim()); }, `stdout is one JSON object, got: ${out}\n${err}`);
      resolve({ status, doc, jobDir, recordsDir: join(h.records, id), stderr: err });
    });
  });
}

/** A ledger on this machine that answers the two doors the analyst uses. */
async function ledgerServer(key = "test-ledger-key") {
  const items = [];
  const server = createServer((req, res) => {
    const send = (status, body) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    if (req.headers.authorization !== `Bearer ${key}`) return send(401, { error: "Authentication required" });
    const u = new URL(req.url, "http://x");
    if (req.method === "GET" && u.pathname === "/v1/operator/debt") return send(200, { total: items.length, items: items.filter((i) => u.searchParams.getAll("against").includes(i.against)) });
    if (req.method === "POST" && u.pathname === "/v1/operator/debt/items") {
      let b = "";
      req.on("data", (c) => { b += c; });
      req.on("end", () => { const body = JSON.parse(b); const item = { number: items.length + 1, state: "open", ...body }; items.push(item); send(201, { ok: true, item }); });
      return undefined;
    }
    return send(404, { error: "no such door" });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { items, key, base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}

const removeVerdict = () => descriptor("2.0.0", (d) => { d.offerings[0].outputs = d.offerings[0].outputs.filter((o) => o.name !== "verdict"); return d; });

test("the run command reports, files what is owed in the ledger, and lists the report as the job's one piece", async () => {
  const h = host();
  const ledger = await ledgerServer();
  try {
    const r = await run(h, { message: "what changed: the verdict is no longer handed back", files: changeFiles(descriptor(), removeVerdict()), env: { LEDGER_TOKEN: ledger.key, MESH_API_BASE: ledger.base } });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.doc.reply, /2 breaking, 0 change of behavior, 1 compatible/);
    assert.match(r.doc.reply, /I filed 2 dependency debt items in the ledger: #1 owed to org_a, #2 owed to org_c/);
    assert.equal(ledger.items.length, 2);
    const pieces = json(join(r.jobDir, "pieces.json"));
    assert.deepEqual(pieces.map((p) => [p.name, p.media_type, p.path, p.step]), [["impact report", "text/markdown", "out/impact-report.md", "write-the-report"]]);
    const filed = json(join(r.recordsDir, "filed.json"));
    assert.deepEqual(filed.items.map((i) => [i.owed_to, i.state, i.number]), [["org_a", "filed", 1], ["org_c", "filed", 2]]);
    const again = await run(h, { id: "job-2", files: changeFiles(descriptor(), removeVerdict()), env: { LEDGER_TOKEN: ledger.key, MESH_API_BASE: ledger.base } });
    assert.match(again.doc.reply, /already in the ledger for this same change, so nothing was filed twice: #1, #2/);
    assert.equal(ledger.items.length, 2);
  } finally { await ledger.close(); }
});

test("the report is what its declared kind and convention say: Markdown with the header's fields and every heading", async () => {
  const h = host();
  const r = await run(h, { files: changeFiles(descriptor(), removeVerdict()) });
  const text = readFileSync(join(r.jobDir, "out", "impact-report.md"), "utf8");
  const out = DESCRIPTOR.offerings[0].outputs.find((o) => o.name === "impact report");
  assert.equal(out.kind, "text/markdown");
  const ticks = [...out.about.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  const fields = ticks[0].split(",").map((f) => f.trim());
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  assert.ok(fm, "the report opens with its front matter");
  for (const f of fields) assert.match(fm[1], new RegExp(`^${f}:`, "m"), `the header has ${f}`);
  for (const hd of ticks.filter((t) => t.startsWith("## "))) assert.match(text, new RegExp(`^${hd}$`, "m"), `the report has ${hd}`);
  assert.doesNotThrow(() => { try { JSON.parse(text); assert.fail("it is JSON"); } catch (e) { if (e.code === "ERR_ASSERTION") throw e; } });
  assert.deepEqual(checkDelivered(r.jobDir, { declaration: DESCRIPTOR, undeclared: true }), [], "the test writer's delivered-formats check passes");
});

test("without a ledger the report still comes, what is owed is listed, and the reply says it was not filed and why", async () => {
  const h = host();
  const r = await run(h, { files: changeFiles(descriptor(), removeVerdict()) });
  assert.equal(r.status, 0);
  assert.match(r.doc.reply, /2 items owed are not filed, because this host binds no ledger key/);
  assert.match(r.doc.reply, /went ahead without/);
  const text = readFileSync(join(r.jobDir, "out", "impact-report.md"), "utf8");
  assert.match(text, /2 dependency debt items against/);
  assert.equal(json(join(r.recordsDir, "went-without.json")).entries.length >= 1, true);
});

test("without two declarations or a dependents list it stops with what it needs and writes no report", async () => {
  const h = host();
  const r = await run(h, { files: [{ name: "one.json", doc: descriptor(), type: "application/json" }] });
  assert.equal(r.status, 3);
  assert.match(r.doc.reply, /only one agent declaration came/);
  assert.match(r.doc.reply, /no list of what depends on the agent came/);
  assert.match(r.doc.reply, /application\/vnd\.agentmesh\.dependents\+json/);
  const usage = await new Promise((resolve) => {
    const p = spawn(process.execPath, [join(AGENT, "scripts", "analyze.mjs")]);
    let out = "";
    p.stdout.on("data", (b) => { out += b; });
    p.on("close", (status) => resolve({ status, doc: JSON.parse(out) }));
  });
  assert.equal(usage.status, 2);
});

test("files are known by what they hold: a declaration sent as plain JSON is read as one, and a file that is not JSON is named", async () => {
  const h = host();
  const files = changeFiles(descriptor(), removeVerdict()).map((f) => ({ ...f, type: "application/json" }));
  files.push({ name: "notes.txt", text: "not json at all", type: "text/plain" });
  const r = await run(h, { files });
  assert.equal(r.status, 0, r.stderr);
  const text = readFileSync(join(r.jobDir, "out", "impact-report.md"), "utf8");
  assert.match(text, /running\.json was sent as application\/json and read as application\/vnd\.agentmesh\.agent-descriptor\+json/);
  assert.match(r.doc.reply, /notes\.txt/);
});

test("the running version is the lower agent_version, whichever comes first", async () => {
  const h = host();
  const files = changeFiles(descriptor(), removeVerdict());
  [files[0], files[1]] = [files[1], files[0]];
  const r = await run(h, { files });
  assert.equal(r.doc.running, "1.0.0");
  assert.equal(r.doc.changed, "2.0.0");
});
