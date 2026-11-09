// What a draft reaches over the network, declared the way the security
// reviewer reads it (scripts/reaches.mjs).
//   node --test test/reaches.test.mjs
//
// No model and no network: each case is a small draft written here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ADDRESS_SETTING, FETCHING, addressSettingsOf, hostOf, reachProblems, sameAddress } from "../scripts/reaches.mjs";
import { checkDraft } from "../scripts/check-spec.mjs";
import { addressesLine } from "../scripts/ask.mjs";
import { agentFilesOf, runtimeOf } from "../scripts/files.mjs";
import { checkBuilds } from "../scripts/builds.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

const tides = (settings, needs = "reads the day's tide table from the public tide service at tides.example.org") => ({
  name: "tide-service", access: "read", kind: "service", needs, ...(settings ? { settings } : {}),
});
const ADDRESS = { env: "TIDE_SERVICE_ADDRESS", purpose: "where the public tide service answers, its base address", default: "https://tides.example.org/v2" };
const spec = (...systems) => ({ systems });

test("a public read with an address setting, its real address as the default and its host in needs, passes", () => {
  assert.deepEqual(reachProblems(spec(tides([ADDRESS]))), []);
  assert.deepEqual(addressSettingsOf(spec(tides([ADDRESS]))), [{ system: "tide-service", env: "TIDE_SERVICE_ADDRESS", default: "https://tides.example.org/v2", credential: false }]);
});

test("a public read with no address setting is a finding that names a setting to declare", () => {
  const found = reachProblems(spec(tides(null, "reads the day's tide table")));
  assert.equal(found.length, 1);
  assert.match(found[0], /system tide-service is reached over the network and declares no address setting/);
  assert.match(found[0], /such as TIDE_SERVICE_ADDRESS/);
  assert.match(found[0], /the word fetches/);
});

test("a service that fetches whatever address it is handed needs no address setting", () => {
  const pages = { name: "linked-pages", access: "read", kind: "service", needs: "fetches each page a forecast links to, at the address the forecast gives" };
  assert.deepEqual(reachProblems(spec(pages)), []);
  // The same words the security reviewer reads as fetching what it is handed.
  assert.ok(FETCHING.test(pages.needs));
  assert.ok(!FETCHING.test("to request the full page linked from each story"), "request is not fetch: the reviewer refused the rebuild on it");
});

test("an address setting with no default address, on a public read, is a finding", () => {
  for (const d of [undefined, "", "tides.example.org", "the tide service"]) {
    const found = reachProblems(spec(tides([{ ...ADDRESS, default: d }])));
    assert.equal(found.length, 1, JSON.stringify(d));
    assert.match(found[0], /the address setting TIDE_SERVICE_ADDRESS has no default address/);
  }
});

test("needs that does not name the default's host is a finding, because the reviewer matches a destination by its reason", () => {
  const found = reachProblems(spec(tides([ADDRESS], "reads the day's tide table")));
  assert.equal(found.length, 1);
  assert.match(found[0], /its needs does not name tides\.example\.org/);
});

test("a product somebody binds with a credential, a model system and draft-host are not held to it", () => {
  const db = { name: "database", access: "read", kind: "service", credential: "db-key", env: "DATABASE_KEY", needs: "reads the customer list" };
  const model = { name: "text-reasoning", access: "trigger", kind: "model", protocols: ["anthropic-messages"], needs: "judges" };
  const host = { name: "draft-host", access: "write", kind: "service", needs: "places the page" };
  const folder = { name: "brand-assets", access: "read", kind: "directory", needs: "the palette" };
  assert.deepEqual(reachProblems(spec(db, model, host, folder)), []);
});

test("an address setting is named the way the security reviewer reads one", () => {
  for (const ok of ["X_ADDRESS", "X_URL", "X_BASE", "X_ENDPOINT", "X_HOST"]) assert.ok(ADDRESS_SETTING.test(ok), ok);
  for (const no of ["HACKER_NEWS_API", "ADDRESS_X", "X_ADDR"]) assert.ok(!ADDRESS_SETTING.test(no), no);
  // The reviewer's own pattern, read from its source, so the two cannot drift.
  const reviewer = readFileSync(join(HERE, "..", "..", "security-reviewer", "scripts", "trace-programs.mjs"), "utf8");
  assert.ok(reviewer.includes(`const SETTING_NAME = ${ADDRESS_SETTING.toString()};`), "the security reviewer's SETTING_NAME is this pattern");
  assert.ok(reviewer.includes(`const FETCHING = ${FETCHING.toString()};`), "the security reviewer's FETCHING is this pattern");
});

test("an address setting's default is the one place an address may sit, and the install file never carries it", () => {
  const draft = { name: "tide-reader", jobs: [], systems: [tides([ADDRESS])] };
  assert.ok(!checkDraft(draft).some((f) => /carries an address/.test(f)), "a default is no address in the install file");
  const inPurpose = { ...draft, systems: [tides([{ ...ADDRESS, purpose: "the service, at https://tides.example.org/v2" }])] };
  assert.ok(checkDraft(inPurpose).some((f) => /settings\[0\]\.purpose carries an address/.test(f)));
  const runtime = JSON.stringify(runtimeOf(draft, [], draft.systems, []));
  assert.ok(!runtime.includes("://"), runtime);
  assert.match(runtime, /TIDE_SERVICE_ADDRESS/);
});

test("checkDraft carries the reach findings", () => {
  assert.ok(checkDraft({ name: "tide-reader", jobs: [], systems: [tides(null, "reads the tides")] }).some((f) => /declares no address setting/.test(f)));
});

test("the reply says which setting the install supplies, with its default", () => {
  assert.equal(addressesLine(spec(tides([ADDRESS]))),
    "The install supplies where each outside system is, and the scripts read it from there: TIDE_SERVICE_ADDRESS (tide-service), https://tides.example.org/v2 by default.");
  assert.equal(addressesLine(spec()), "");
});

test("two spellings of one address are the same address", () => {
  assert.equal(sameAddress("HTTPS://Tides.Example.org/v2/"), "https://tides.example.org/v2");
  assert.equal(hostOf("https://tides.example.org:8443/v2"), "tides.example.org");
});

test("the builder takes a draft with an address setting's default, and its install file and this agent's files leave the default out", () => {
  const how = { control: "script", intelligence: "none", cost: "none", contract: "full" };
  const draft = {
    name: "tide-reader", version: "0.1.0", description: "Reads the tides.", runtimes: [{ name: "node", version: ">=22" }], price: { model: "free" },
    jobs: [{ slug: "read-tides", title: "Read the tides", offered: true, how, when: "when tides are needed", good: "a file of every tide for the harbor today, with its time and height",
      empty: "nothing is written and the reply says why", does: "Reads the tides.", scripts: ["scripts/read-tides.mjs"], instructions: "Run it. The address is in TIDE_SERVICE_ADDRESS.",
      outputs: [{ name: "tides", kind: "application/vnd.agentmesh.tides+json", about: "The tides." }],
      run: { command: ["node", "{home}/{package}/skills/read-tides/scripts/read-tides.mjs"], reply: "json:reply" } }],
    systems: [tides([ADDRESS])],
    refuses: ["refusing to read a harbor nobody named, because it would guess"], records: [{ name: "the signed job manifest" }],
  };
  const dir = mkdtempSync(join(tmpdir(), "spec-writer-reaches-"));
  try {
    const r = checkBuilds({ spec: draft, env: { BUILD_PY: join(HERE, "..", "..", "package-maker", "build.py") }, keep: join(dir, "agent") });
    assert.equal(r.ok, true, JSON.stringify(r.problems));
    const theirs = readFileSync(join(dir, "agent", "agent-runtime-requirements.json"), "utf8");
    assert.ok(!theirs.includes("://"), theirs);
    assert.equal(agentFilesOf(draft)["agent-runtime-requirements.json"], theirs, "this agent's projection is the builder's, byte for byte");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
