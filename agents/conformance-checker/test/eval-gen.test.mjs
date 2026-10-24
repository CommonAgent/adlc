// eval-gen.py reads the declarations from the package's draft Descriptor:
// agent-descriptor.json since Common Agent 0.30.0-draft, and descriptor.json
// in a package from before it, which must keep being checked.
// Run: node --test agents/conformance-checker/test/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const EVAL_GEN = join(HERE, "..", "eval-gen.py");
const python = ["python3", "python", "py"].find((b) => !spawnSync(b, ["--version"]).error);

const DESCRIPTOR = {
  format: "agent-descriptor-v1", agent_version: "1.0.0", does: "Reads a page.",
  offerings: [{ id: "read-it", name: "Read it", trial: { who: "anyone", limits: { per_day: 1 } } }],
  refusals: "Writing anywhere but its own folder.\nReaching any outside service.",
  escalates: ["A page it cannot read."],
  records: [{ name: "the answer", when: "per_task", file: "*/answer.json" }],
};

function pkg(files) {
  const dir = mkdtempSync(join(tmpdir(), "eval-gen-"));
  for (const [name, doc] of Object.entries(files)) writeFileSync(join(dir, name), JSON.stringify(doc, null, 2));
  return dir;
}

function gen(dir) {
  const r = spawnSync(python, [EVAL_GEN, dir], { encoding: "utf8" });
  // The tree digest is over the files as named, so it differs by name and
  // nothing else; the eval is the rest.
  try { const { package_tree_sha256: _t, ...rest } = JSON.parse(r.stdout); return rest; } finally { rmSync(dir, { recursive: true, force: true }); }
}

const manifest = (descriptorPath) => ({ name: "reader", version: "1.0.0", extensions: { "net.agentdoc.package": descriptorPath ? { descriptor: { path: descriptorPath } } : {} } });

test("a package under the current name and one under the former name make the same eval", { skip: !python && "no python" }, () => {
  const current = gen(pkg({ "plugin.json": manifest("agent-descriptor.json"), "agent-descriptor.json": DESCRIPTOR }));
  const former = gen(pkg({ "plugin.json": manifest("descriptor.json"), "descriptor.json": DESCRIPTOR }));
  const unpointed = gen(pkg({ "plugin.json": manifest(null), "agent-descriptor.json": DESCRIPTOR }));
  assert.ok(JSON.stringify(current).includes("Reaching any outside service"), JSON.stringify(current).slice(0, 300));
  assert.deepEqual(current, former);
  assert.deepEqual(unpointed, current);
});

test("with both names and no pointer the current one is read", { skip: !python && "no python" }, () => {
  const stale = { ...DESCRIPTOR, refusals: "Something only the stale copy says." };
  const both = gen(pkg({ "plugin.json": manifest(null), "agent-descriptor.json": DESCRIPTOR, "descriptor.json": stale }));
  assert.ok(JSON.stringify(both).includes("Reaching any outside service"));
  assert.ok(!JSON.stringify(both).includes("only the stale copy"));
});
