// The lifecycle cites one version of the Common Agent Specification, the one
// standards/common-agent-pin.json names. This checks the pin's shape, and reads
// every text file under agents/ and standards/ for a citation of a Common
// Agent version ("Common Agent 0.39.0", "common-agent-spec 0.30.0-draft",
// "common-agent-v0.28.0-draft"). A citation of any other version fails, unless
// it is history or a divergence named below, so a new version is adopted on
// purpose: read what changed, update the citations, re-pin.
//
// A citation is history when it says what an older version changed, or uses
// that version as a boundary: "before Common Agent 0.30.0-draft", "its name
// since Common Agent 0.30.0-draft", "Common Agent 0.16.0-draft renamed this
// member". Those stay true whatever the pin is, so they are not drift.
//
// The pin carries no copy of SPEC.md. The specification is published at a tag
// in its own repository under its own license, and the pin's digest lets
// anyone check the bytes at that tag; a copy here would be a second spelling
// that this test could only check against itself.
//
// Left out of the reading, by name:
//   - every records/ folder: build records of what happened, kept as written;
//   - every fixtures/ folder: documents copied verbatim from elsewhere (a
//     package as it was published, a conformance file as its standard
//     published it), whose words are their source's;
//   - node_modules/ and .git/, which are not the lifecycle's own words;
//   - this file, which quotes the divergences it names.
//   node --test standards/test/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const SELF = relative(REPO, fileURLToPath(import.meta.url)).split(sep).join("/");
const pin = JSON.parse(readFileSync(join(REPO, "standards", "common-agent-pin.json"), "utf8"));

const SKIP_DIRS = new Set(["records", "fixtures", "node_modules", ".git"]);
const BINARY = /\.(png|jpe?g|gif|webp|ico|svg|woff2?|ttf|otf|zip|tgz|gz|tar|pdf|mp3|mp4|wav|webm|mov)$/i;

// Cites a version that the pinned one no longer supports, left for the owner
// to decide rather than rewritten. Each names the file, the citation as it
// reads, and why it cannot move to the pin by a change of text alone. When a
// divergence is settled, its entry leaves this list.
export const DIVERGENCES = [];

// A version of the specification is 0.x.y so far, with -draft before 0.38.0,
// and a section number never starts with 0, so "Common Agent 12.4.1" is a
// section of the pinned version and "Common Agent 0.39.0" is a version. The
// pinned version itself is always read as one, whatever its number.
const PINNED = pin.version.replace(/\./g, "\\.");
const VERSION = String.raw`(${PINNED}|0\.\d+\.\d+(?:-draft)?|\d+\.\d+\.\d+-draft)(?![\d.]*\d)`;
const CITE = new RegExp(String.raw`\bcommon[- ]agent(?:[- ]spec(?:ification)?)?(?: standard)?,?[ \t]+v?${VERSION}|\bcommon-agent-v${VERSION}`, "gi");
const HISTORY_BEFORE = /\b(?:before|since|until|(?:left|removed|renamed|added)\b[^.;:()]{0,30}\bin)[ \t]+$/i;
const HISTORY_AFTER = /^[ \t,)]*(?:still[ \t]+)?(?:renamed|removed|gave|keeps|kept|reads|left|dropped|added|introduced|moved)\b/i;

const numbers = (v) => v.replace(/-draft$/, "").split(".").map(Number);
const older = (a, b) => {
  const [x, y] = [numbers(a), numbers(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i];
  return false;
};

/** A file's text with each line break, and the comment marks that open the
 *  next line, read as one space, so a citation split across lines reads whole. */
const joined = (text) => text.replace(/\r?\n[ \t]*(?:\/\/+|#+:?|\*(?!\/)|--)?[ \t]*/g, " ");

function* files(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) yield* files(join(dir, e.name)); }
    else if (e.isFile() && !BINARY.test(e.name)) yield join(dir, e.name);
  }
}

/** Every citation of a Common Agent version under agents/ and standards/. */
export function citations() {
  const out = [];
  for (const top of ["agents", "standards"]) {
    for (const p of files(join(REPO, top))) {
      const file = relative(REPO, p).split(sep).join("/");
      if (file === SELF) continue;
      const raw = readFileSync(p);
      if (raw.includes(0)) continue;
      const text = joined(raw.toString("utf8"));
      for (const m of text.matchAll(CITE)) {
        out.push({ file, version: m[1] ?? m[2], at: text.slice(m.index, m.index + 60), before: text.slice(Math.max(0, m.index - 50), m.index), after: text.slice(m.index + m[0].length, m.index + m[0].length + 30) });
      }
    }
  }
  return out;
}

test("the pin names one published version, its tag, and the digest of its SPEC.md", () => {
  assert.equal(pin.common_agent_pin, "v1");
  assert.ok(typeof pin.about === "string" && pin.about.trim(), "about says what the pin is for");
  assert.match(pin.version, /^\d+\.\d+\.\d+$/, "a published version, not a draft");
  assert.equal(pin.tag, `common-agent-v${pin.version}`);
  assert.equal(pin.repository, "CommonAgent/common-agent-standards");
  assert.equal(pin.path, "common-agent/SPEC.md");
  assert.match(pin.sha256, /^sha256:[0-9a-f]{64}$/);
  assert.deepEqual(Object.keys(pin).sort(), ["about", "common_agent_pin", "path", "repository", "sha256", "tag", "version"]);
});

test("every Common Agent version cited under agents/ and standards/ is the pinned one, history, or a named divergence", () => {
  const found = citations();
  assert.ok(found.some((c) => c.version === pin.version), "the reading finds citations of the pinned version");
  const drift = [];
  for (const c of found) {
    if (c.version === pin.version) continue;
    if (DIVERGENCES.some((d) => d.file === c.file && c.at.startsWith(d.cite))) continue;
    const history = HISTORY_BEFORE.test(c.before) || HISTORY_AFTER.test(c.after);
    if (history && older(c.version, pin.version)) continue;
    drift.push(`${c.file}: "${c.at.trim()}"`);
  }
  assert.deepEqual(drift, [], `cite Common Agent ${pin.version}, or say what the older version changed:\n${drift.join("\n")}`);
});

test("each named divergence is still there, so a settled one leaves the list", () => {
  const found = citations();
  for (const d of DIVERGENCES) {
    assert.ok(found.some((c) => c.file === d.file && c.at.startsWith(d.cite)), `${d.file} no longer cites "${d.cite}": take it off DIVERGENCES`);
  }
});

