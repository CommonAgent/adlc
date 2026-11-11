// The hn-digest case end to end at Security: the architect's record names
// hacker-news, bound to the service itself, and the Design's files declare it
// with its address as a setting.
//   node --test test/hn-digest.test.mjs
//
// The record and the two declaration files are the ones the solution
// architect and the spec writer make for build b_6e496a709479 (hn-digest,
// 2026-11-11): the spec writer's test/fixtures/hn-digest folder, which their
// tests hold equal to what each writes. What is pinned: a script that reads
// the address from the declared setting HACKER_NEWS_ADDRESS and fetches it
// passes, with hacker-news in both the record and the declaration and the
// spending limit read from the record; and a script that writes the address
// down instead is warned about, naming the file and the address.
// Nothing here touches a real network or model.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AGENT, frontMatter, host, run, tarGz } from "./helpers.mjs";

const FIX = join(AGENT, "..", "spec-writer", "test", "fixtures", "hn-digest");
const read = (name) => { try { return readFileSync(join(FIX, name), "utf8"); } catch { return null; } };
const SCRIPT = "skills/write-the-digest/scripts/write-the-digest.mjs";

/** The package the Design's files describe, with one script. */
function packageWith(script) {
  return {
    "agent-descriptor.json": read("agent-descriptor.json"),
    "agent-runtime-requirements.json": read("agent-runtime-requirements.json"),
    "plugin.json": JSON.stringify({ name: "hn-digest", version: "0.1.0", description: "Reads the top stories on Hacker News and writes a short digest of them." }, null, 2),
    "skills/write-the-digest/SKILL.md": "---\nname: write-the-digest\n---\n# Write the digest\n",
    [SCRIPT]: script,
  };
}

const reviewOf = (script) => {
  const h = host();
  return run(h, { message: "Review this package.", files: [
    { name: "hn-digest.tar.gz", bytes: tarGz(packageWith(script)) },
    { name: "architecture-record.md", bytes: Buffer.from(read("architecture-record.md")), type: "text/markdown" },
  ] });
};

test("a script that reads the declared address setting passes, with hacker-news in the record and the declaration", (t) => {
  if (!read("architecture-record.md")) return t.skip("the spec writer's fixtures are not beside this agent");
  const r = reviewOf([
    "// Read the top stories from the address the install places.",
    "const base = process.env.HACKER_NEWS_ADDRESS;",
    "export async function topStories() {",
    "  const res = await fetch(`${base}/topstories.json`);",
    "  return res.json();",
    "}",
  ].join("\n"));
  assert.equal(r.status, 0, r.stderr);
  const fm = frontMatter(r.review);
  assert.deepEqual(fm.refused_for, []);
  assert.equal(fm.verdict, "passed");
  assert.equal(fm.architecture_record, "given");
  assert.doesNotMatch(r.review, /not named in the architecture record/);
  assert.match(r.review, /^ {2}- system: "hacker-news"\n {4}access: "read"/m);
  assert.match(r.review, /^spending_limit: ".*1 USD per day, across every job/m);
  assert.match(r.review, /ceiling: "text-reasoning, per day"\n {4}limit: "1 USD \(suggested/);
});

test("a script that writes the address down instead is warned about, naming the file and the address", (t) => {
  if (!read("architecture-record.md")) return t.skip("the spec writer's fixtures are not beside this agent");
  const r = reviewOf([
    "const base = \"https://hacker-news.firebaseio.com/v0\";",
    "export async function topStories() {",
    "  const res = await fetch(`${base}/topstories.json`);",
    "  return res.json();",
    "}",
  ].join("\n"));
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.review, new RegExp(`${SCRIPT.replace(/[.]/g, "\\.")}[^\\n]*https://hacker-news\\.firebaseio\\.com/v0`));
});
