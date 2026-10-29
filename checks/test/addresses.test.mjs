// The address check: what counts as an address, which files are read, and
// the known list that only shrinks.
//   node --test checks/test/addresses.test.mjs
//
// What is worth pinning: the literal is Common Agent 12.10's (http, https, ws
// or wss in any case, then :// and a letter, a digit or [; or an address in
// 169.254.0.0/16), comments included, with its seven identifier prefixes
// excepted, plus the metadata server's host name on its own; a package
// source's scripts and the files its run commands name are read, and its tests,
// references and manifests are not; an address not on the list fails, a
// listed address that is gone fails, and an entry the base did not have
// fails. And the repository passes with its own list.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { addressesIn, filesRead, judge, readKnown, report, scan } from "../addresses.mjs";

function tree(files) {
  const root = mkdtempSync(join(tmpdir(), "addresses-"));
  for (const [p, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), typeof text === "string" ? text : JSON.stringify(text, null, 2));
  }
  return root;
}

test("the literal is 12.10's, comments included, plus the metadata host on its own", () => {
  assert.deepEqual(addressesIn('const a = "https://api.example.test/v1";'), ["https://api.example.test/v1"]);
  assert.deepEqual(addressesIn("// see https://docs.example.test/page."), ["https://docs.example.test/page"]);
  assert.deepEqual(addressesIn('"HTTP://127.0.0.1:8788/v1",'), ["HTTP://127.0.0.1:8788/v1"]);
  assert.deepEqual(addressesIn("ws://h/socket and wss://[::1]:9"), ["ws://h/socket", "wss://[::1]:9"]);
  assert.deepEqual(addressesIn("host = metadata.google.internal"), ["metadata.google.internal"]);
  assert.deepEqual(addressesIn('fetch("http://169.254.169.254/x"); deny 169.254.169.254'), ["http://169.254.169.254/x", "169.254.169.254"]);
  // Not literals under 12.10: a host filled in at run time, a scheme with no
  // host, an ellipsis, a bare address outside 169.254.0.0/16, and the
  // identifier prefixes.
  assert.deepEqual(addressesIn('`https://${host}/v1`, "https://" + x, "https://…", "0.0.0.0", 10.0.0.5, 1.2.3.4.5'), []);
  assert.deepEqual(addressesIn('"https://json-schema.org/draft/2020-12/schema" http://www.w3.org/2000/svg http://schemas.openxmlformats.org/x http://purl.org/dc'), []);
  assert.deepEqual(addressesIn("https://json-schema.org.evil.test/"), ["https://json-schema.org.evil.test/"]);
});

test("a package source's scripts and run files are read; its tests, references and manifests are not", () => {
  const root = tree({
    "agents/pkg/plugin.json": { $schema: "https://schema.example.test/plugin.json", description: "x" },
    "agents/pkg/agent-descriptor.json": { systems: [{ endpoint: "https://descriptor.example.test" }] },
    "agents/pkg/agent-runtime-requirements.json": { run: { job: { command: ["node", "{home}/{package}/skills/job/scripts/job.mjs", "{home}/{package}/bin/start.sh"] } } },
    "agents/pkg/bin/start.sh": "#!/bin/sh\ncurl https://run.example.test\n",
    "agents/pkg/bin/other.sh": "curl https://unnamed.example.test\n",
    "agents/pkg/scripts/call.mjs": "// see https://comment.example.test\nconst U = \"https://call.example.test/v1\";\n",
    "agents/pkg/scripts/package-lock.json": { resolved: "https://registry.example.test/x.tgz" },
    "agents/pkg/skills/job/scripts/extra.py": "URL = 'http://169.254.169.254/token'\n",
    "agents/pkg/references/example/scripts/x.mjs": "fetch('https://reference.example.test')",
    "agents/pkg/test/call.test.mjs": "fetch('https://test.example.test')",
    "agents/pkg/README.md": "https://readme.example.test",
    "agents/not-a-package/run.mjs": "fetch('https://unread.example.test')",
    "agents/image/emit.mjs": "const at = 'https://image.example.test';",
    "agents/image/catalogue.json": { at: "https://catalogue.example.test" },
    "agents/image/test/emit.test.mjs": "fetch('https://image-test.example.test')",
    "agents/image/README.md": "https://image-readme.example.test",
    "agents/package-maker/tool": "#!/usr/bin/env node\nfetch('https://tool.example.test')\n",
    "agents/package-maker/test_tool.py": "URL = 'https://pm-test.example.test'",
  });
  assert.deepEqual(filesRead(root), [
    "agents/image/catalogue.json", "agents/image/emit.mjs", "agents/package-maker/tool",
    "agents/pkg/bin/start.sh", "agents/pkg/scripts/call.mjs", "agents/pkg/skills/job/scripts/extra.py",
  ]);
  assert.deepEqual(scan(root).map((h) => `${h.file}:${h.at} ${h.address}`), [
    "agents/image/catalogue.json:2 https://catalogue.example.test",
    "agents/image/emit.mjs:1 https://image.example.test",
    "agents/package-maker/tool:2 https://tool.example.test",
    "agents/pkg/bin/start.sh:2 https://run.example.test",
    "agents/pkg/scripts/call.mjs:1 https://comment.example.test",
    "agents/pkg/scripts/call.mjs:2 https://call.example.test/v1",
    "agents/pkg/skills/job/scripts/extra.py:1 http://169.254.169.254/token",
  ]);
});

test("an address off the list fails, a listed address that is gone fails, and the list only shrinks", () => {
  const hits = [{ file: "a.mjs", at: 1, address: "https://x.test" }, { file: "a.mjs", at: 9, address: "https://x.test" }, { file: "b.mjs", at: 2, address: "https://new.test" }];
  const known = [{ file: "a.mjs", address: "https://x.test" }, { file: "c.mjs", address: "https://fixed.test" }];
  const base = [{ file: "a.mjs", address: "https://x.test" }];
  const j = judge(hits, known, base);
  assert.deepEqual(j.found.map((h) => h.address), ["https://new.test"]);
  assert.deepEqual(j.gone.map((k) => k.file), ["c.mjs"]);
  assert.deepEqual(j.added.map((k) => k.file), ["c.mjs"]);
  const words = report(j);
  assert.match(words[0], /^b\.mjs:2 writes the address https:\/\/new\.test\. A package carries no address of its own \(Common Agent 12\.6 rule 2/);
  assert.match(words[1], /c\.mjs no longer writes https:\/\/fixed\.test: take its entry off/);
  assert.match(words[2], /the list only shrinks/);
  assert.deepEqual(judge(hits.slice(0, 2), known.slice(0, 1)), { found: [], gone: [], added: [] });
});

test("the repository passes with its own list, and every entry says what it is", () => {
  const known = readKnown();
  assert.deepEqual(report(judge(scan(), known)), []);
  for (const k of known) assert.ok(k.what && k.what.length > 10, `${k.file} ${k.address} says what it is`);
  const keys = known.map((k) => `${k.file} ${k.address}`);
  assert.equal(new Set(keys).size, keys.length, "no entry is listed twice");
});
