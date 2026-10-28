// The standards folder holds its own form: the audit checklist's entries
// carry every member in order with values from their lists, ids are unique,
// and the list of standing-asset kinds names each schema once, as an https
// URL with the version in it.
//   node --test standards/test/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const STANDARDS = join(HERE, "..");
const read = (name) => readFileSync(join(STANDARDS, name), "utf8");

const MEMBERS = ["id", "says", "why", "kind", "check", "fixed-by", "level", "applies", "evidence"];
const KINDS = ["design-time", "run-time", "stage-record"];
const FIXED_BY = ["requirements", "architecture", "design", "test", "code", "package", "deploy", "docs"];
const LEVELS = ["warn", "refuse"];

/** Each check's YAML block as an ordered list of [member, value]. The blocks
 *  are flat, one member a line, so a line is split at its first ": ". The
 *  first block is the form itself, with placeholders, and is left out. */
export function checksOf(text) {
  const blocks = [...text.matchAll(/```yaml\n([\s\S]*?)```/g)].map((m) => m[1]);
  return blocks.slice(1).map((b) => b.split("\n").filter((l) => l.trim()).map((l) => {
    const at = l.indexOf(": ");
    return at < 0 ? [l, ""] : [l.slice(0, at), l.slice(at + 2)];
  }));
}

test("every check carries the members of the form, in order, with values from their lists", () => {
  const checks = checksOf(read("audit-checklist.md"));
  assert.ok(checks.length >= 9, `${checks.length} checks`);
  const ids = new Set();
  for (const pairs of checks) {
    assert.deepEqual(pairs.map(([k]) => k), MEMBERS, JSON.stringify(pairs));
    const c = Object.fromEntries(pairs);
    for (const [k, v] of pairs) {
      assert.ok(v.trim(), `${c.id}: ${k} is empty`);
      // A plain YAML value may not hold ": " or start with a character YAML reads as syntax.
      assert.ok(!v.includes(": ") && !/^[\[{&*!|>'"%@`#]/.test(v), `${c.id}: ${k} would not parse as a plain YAML value`);
    }
    assert.match(c.id, /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/);
    assert.ok(!ids.has(c.id), `${c.id} is listed twice`);
    ids.add(c.id);
    assert.ok(KINDS.includes(c.kind), `${c.id}: kind ${c.kind}`);
    assert.ok(FIXED_BY.includes(c["fixed-by"]), `${c.id}: fixed-by ${c["fixed-by"]}`);
    assert.ok(LEVELS.includes(c.level), `${c.id}: level ${c.level}`);
    assert.match(c.check, /^(stage-record:[a-z-]+|[a-z][a-z0-9]*(-[a-z0-9]+)*)$/, `${c.id}: check ${c.check}`);
    assert.match(c.applies, /^new agents from \d{4}-\d{2}-\d{2}; existing agents from (\d{4}-\d{2}-\d{2}|not set)$/, `${c.id}: applies`);
  }
});

test("the checklist covers the checks the lifecycle plan names", () => {
  const ids = new Set(checksOf(read("audit-checklist.md")).map((p) => Object.fromEntries(p).id));
  for (const id of ["descriptor-stored-signed", "descriptor-person-members", "specific-kinds", "people-read-markdown",
    "no-model-names", "revisions-declared", "can-use-known-schema", "can-use-without", "person-facing-declares-library",
    "reads-standing-assets", "present-dev-and-prod", "stage-record-package"]) {
    assert.ok(ids.has(id), `no check ${id}`);
  }
});

// The names the Agent Auditor registers (lifecycle item 4b). A check named
// otherwise is reported "not checked" until the auditor registers it, and
// each one is listed for the auditor in NEW_CHECKS below, never silently.
const REGISTERED = new Set(["package-maker-format-rules", "no-model-literals", "can-use-declared", "descriptor-floor",
  "descriptor-signed", "descriptor-matches-package", "versions-dev-prod", "registered",
  ...["requirements", "architecture", "design", "impact", "source", "test", "code", "review", "security", "package",
    "build-record", "descriptor", "deployment-record", "conformance"].map((a) => `stage-record:${a}`)]);
const NEW_CHECKS = new Set(["descriptor-person-members", "delivered-formats", "revisions-declared", "standing-assets-cited",
  "stage-record:docs"]);

test("every check names a test the auditor registers, or one listed as new for it", () => {
  for (const pairs of checksOf(read("audit-checklist.md"))) {
    const c = Object.fromEntries(pairs);
    assert.ok(REGISTERED.has(c.check) || NEW_CHECKS.has(c.check), `${c.id}: ${c.check} is neither registered nor listed as new`);
  }
});

test("the checklist's header says what a standing asset says about itself", () => {
  const head = read("audit-checklist.md").match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(head, "no header");
  const keys = head[1].split("\n").map((l) => l.split(":")[0]);
  assert.deepEqual(keys, ["schema", "name", "owner", "layer", "approved_by", "approved_at"]);
  assert.match(head[1], /^schema: https:\/\/schemas\.agentmesh\.ai\/audit-checklist\/v1$/m);
});

test("the list of standing-asset kinds names each schema once, versioned in its URL", () => {
  const list = JSON.parse(read("standing-asset-schemas.json"));
  assert.equal(list.standing_asset_schemas, "v1");
  const seen = new Set();
  for (const s of list.schemas) {
    assert.match(s.schema, /^https:\/\/[a-z0-9.-]+\/\S+\/v\d+$/);
    assert.ok(!seen.has(s.schema), `${s.schema} twice`);
    seen.add(s.schema);
    assert.ok(s.kind && s.for, s.schema);
  }
  for (const k of ["brand", "style-guide", "glossary", "media-templates"]) {
    assert.ok(seen.has(`https://schemas.agentmesh.ai/${k}/v1`), k);
  }
});
