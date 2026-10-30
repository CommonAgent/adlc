// An agent's own files, read the way the builder reads them.
//   node --test test/agent-folder.test.mjs
//
// What is pinned: identifying an agent folder; extracting the slug from
// frontmatter; parsing SKILL.md sections in builder order; classifying agent
// files by content; selecting agent files among arbitrary attachments;
// laying out agent files into the standard hierarchy; and projecting an agent
// folder into a full spec document.
// Nothing here touches a network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DESCRIPTOR_FILE, MANIFEST_FILE, RUNTIME_FILE, agentFileKind, agentFilesAmong, agentFilesAmongTexts, isAgentFolder,
  layOutAgentFiles, loadSpec, readAgentFolder, skillSections, skillSlugOf, specOfFolder,
} from "../scripts/agent-folder.mjs";

const folder = (body) => {
  const at = mkdtempSync(join(tmpdir(), "code-writer-af-"));
  try { return body(at); } finally { rmSync(at, { recursive: true, force: true }); }
};

const SKILL_MD = `---
name: inspect
---
## When to use this
When files need inspection.

## What a good result looks like
A clean inspection report.

## When it comes back empty
When nothing was provided.

## How to do it
Run node inspect.mjs

## Scripts
- scripts/inspect.mjs
`;

test("skillSlugOf extracts the single slug from frontmatter", () => {
  assert.equal(skillSlugOf(SKILL_MD), "inspect");
  assert.equal(skillSlugOf("---\ninvalid: true\n---\n"), null);
  assert.equal(skillSlugOf("No frontmatter"), null);
});

test("skillSections parses headings in the builder's order", () => {
  const sections = skillSections(SKILL_MD);
  assert.equal(sections["When to use this"], "When files need inspection.");
  assert.equal(sections["What a good result looks like"], "A clean inspection report.");
  assert.equal(sections["When it comes back empty"], "When nothing was provided.");
  assert.equal(sections["How to do it"], "Run node inspect.mjs");
});

test("agentFileKind identifies files by content and not by name", () => {
  assert.deepEqual(agentFileKind(SKILL_MD), { kind: "skill", slug: "inspect" });
  assert.equal(agentFileKind('{"format": "agent-descriptor-v1"}')?.kind, "descriptor");
  assert.equal(agentFileKind('{"format": "agent-runtime-requirements-v1"}')?.kind, "runtime");
  assert.equal(agentFileKind('{"extensions": {"net.agentdoc.package": {}}}')?.kind, "manifest");
  assert.equal(agentFileKind('{"just": "json"}'), null);
  assert.equal(agentFileKind("plain text"), null);
});

test("isAgentFolder detects a valid agent directory", () => {
  folder((at) => {
    assert.equal(isAgentFolder(at), false);
    writeFileSync(join(at, MANIFEST_FILE), JSON.stringify({ name: "a" }));
    writeFileSync(join(at, DESCRIPTOR_FILE), JSON.stringify({ format: "agent-descriptor-v1" }));
    assert.equal(isAgentFolder(at), true);
  });
});

test("agentFilesAmongTexts identifies and groups agent files", () => {
  const entries = [
    { key: "1", text: JSON.stringify({ format: "agent-descriptor-v1", agent_version: "1.0.0", offerings: [{ id: "inspect" }] }) },
    { key: "2", text: JSON.stringify({ format: "agent-runtime-requirements-v1" }) },
    { key: "3", text: JSON.stringify({ name: "agent", version: "1.0.0", extensions: { "net.agentdoc.package": { build: {} } } }) },
    { key: "4", text: SKILL_MD },
  ];
  const found = agentFilesAmongTexts(entries);
  assert.ok(found);
  assert.equal(found.descriptor, "1");
  assert.equal(found.runtime, "2");
  assert.equal(found.manifest, "3");
  assert.equal(found.skills["inspect"], "4");
});

test("layOutAgentFiles writes files into their canonical layout", () => {
  folder((at) => {
    const src = join(at, "src");
    const dest = join(at, "dest");
    mkdirSync(src, { recursive: true });

    writeFileSync(join(src, "d.json"), JSON.stringify({ format: "agent-descriptor-v1", agent_version: "1.0.0" }));
    writeFileSync(join(src, "r.json"), JSON.stringify({ format: "agent-runtime-requirements-v1" }));
    writeFileSync(join(src, "m.json"), JSON.stringify({ name: "pkg", version: "1.0.0", extensions: { "net.agentdoc.package": { build: {} } } }));
    writeFileSync(join(src, "s.md"), SKILL_MD);

    const found = {
      descriptor: join(src, "d.json"),
      runtime: join(src, "r.json"),
      manifest: join(src, "m.json"),
      skills: { inspect: join(src, "s.md") },
    };

    layOutAgentFiles(found, dest);

    assert.ok(readFileSync(join(dest, DESCRIPTOR_FILE)));
    assert.ok(readFileSync(join(dest, RUNTIME_FILE)));
    assert.ok(readFileSync(join(dest, MANIFEST_FILE)));
    assert.ok(readFileSync(join(dest, "skills", "inspect", "SKILL.md")));
  });
});

test("specOfFolder and loadSpec project an agent folder into a full spec document", () => {
  folder((at) => {
    writeFileSync(join(at, DESCRIPTOR_FILE), JSON.stringify({
      format: "agent-descriptor-v1",
      agent_version: "0.2.0",
      offerings: [{ id: "inspect", name: "Inspect", does: "Checks files." }],
      records: [{ name: "rec", when: "per_task", file: "*/rec.json" }],
    }));
    writeFileSync(join(at, RUNTIME_FILE), JSON.stringify({
      format: "agent-runtime-requirements-v1",
      runtimes: [{ name: "node", version: ">=22" }],
    }));
    writeFileSync(join(at, MANIFEST_FILE), JSON.stringify({
      name: "inspector",
      version: "0.2.0",
      description: "Inspects things.",
      extensions: { "net.agentdoc.package": { build: { skills: { inspect: { scripts: ["scripts/inspect.mjs"] } } } } },
    }));
    mkdirSync(join(at, "skills", "inspect"), { recursive: true });
    writeFileSync(join(at, "skills", "inspect", "SKILL.md"), SKILL_MD);

    const spec = specOfFolder(at);
    assert.equal(spec.name, "inspector");
    assert.equal(spec.version, "0.2.0");
    assert.equal(spec.jobs.length, 1);
    assert.equal(spec.jobs[0].slug, "inspect");
    assert.equal(spec.jobs[0].when, "When files need inspection.");
    assert.equal(spec.jobs[0].good, "A clean inspection report.");

    const loaded = loadSpec(at);
    assert.deepEqual(loaded, spec);
  });
});
