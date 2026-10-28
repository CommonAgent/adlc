// derive-test.py: the derive-test offering shows the test a package gives rise
// to, and sends nothing (fix pass, 2026-10-28).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, "..", "derive-test.py");
const PY = process.platform === "win32" ? "python" : "python3";

function packageIn(dir) {
  const pkg = join(dir, "src", "shop-desk");
  mkdirSync(join(pkg, "skills", "answer"), { recursive: true });
  writeFileSync(join(pkg, "plugin.json"), JSON.stringify({ name: "shop-desk" }));
  writeFileSync(join(pkg, "agent-descriptor.json"), JSON.stringify({
    format: "agent-descriptor-v1", agent_version: "1.1.0", does: "Answers order questions.",
    refusals: "Does not look up another shop's orders.\nDoes not refund.", escalates: ["A chargeback"],
    records: [{ name: "each answer", file: "*/answer.json" }], offerings: [],
  }));
  const tar = spawnSync(PY, ["-c", "import sys,tarfile; t=tarfile.open(sys.argv[1],'w:gz'); t.add(sys.argv[2], arcname='shop-desk'); t.close()", join(dir, "job", "shop-desk.tar.gz"), pkg]);
  assert.equal(tar.status, 0, String(tar.stderr));
}

test("a package handed to the job gives its cases and a derived-test piece; nothing is sent", () => {
  const dir = mkdtempSync(join(tmpdir(), "derive-"));
  try {
    mkdirSync(join(dir, "job"));
    packageIn(dir);
    const p = spawnSync(PY, [SCRIPT, "--job", join(dir, "job")], { encoding: "utf8" });
    assert.equal(p.status, 0, p.stderr + p.stdout);
    assert.match(p.stdout, /## The test for shop-desk/);
    assert.match(p.stdout, /4 cases: 1 capability, 1 escalation, 2 refusal/);
    assert.match(p.stdout, /Nothing was sent/);
    const spec = JSON.parse(readFileSync(join(dir, "job", "out", "derived-test.json"), "utf8"));
    assert.deepEqual(spec.cases.map((c) => c.id), ["refuse-1", "refuse-2", "escalate-1", "skill-answer"]);
    assert.equal(JSON.parse(readFileSync(join(dir, "job", "pieces.json"), "utf8"))[0].media_type, "application/vnd.agentmesh.conformance-test+json");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("with no package and no agent named, it says what it needs", () => {
  const dir = mkdtempSync(join(tmpdir(), "derive-"));
  try {
    mkdirSync(join(dir, "job"));
    const p = spawnSync(PY, [SCRIPT, "--job", join(dir, "job"), "--prompt", "derive-test please"], { encoding: "utf8" });
    assert.equal(p.status, 1);
    assert.match(p.stdout, /Attach the agent's package/);
    assert.equal(existsSync(join(dir, "job", "out")), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
