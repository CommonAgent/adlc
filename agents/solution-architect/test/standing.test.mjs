// Standing assets (the architecture standard, section 10): for each kind of
// output a person reads, the record decides which of the organization's
// standing assets apply, each with its reason, or says none and why.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRecord, renderRecord } from "../scripts/architecture-record.mjs";
import { doneOf, forbiddenIn, recordOf } from "../scripts/check-record.mjs";
import { answersIn } from "../scripts/asked.mjs";
import { isPersonFacing, kindMatches, loadSchemas, standingAssetsOf, standingProblems } from "../scripts/standing.mjs";

const table = loadSchemas();
const BRAND = "https://schemas.agentmesh.ai/brand/v1";
const STYLE = "https://schemas.agentmesh.ai/style-guide/v1";
const TEMPLATES = "https://schemas.agentmesh.ai/media-templates/v1";
const out = (piece, kind) => ({ direction: "out", piece, kind, why: "w" });

test("the list is read from standards/ when run from source", () => {
  assert.ok(table, "standards/standing-asset-schemas.json was not found");
  assert.ok(table.schemas.some((s) => s.schema === BRAND));
  assert.ok(kindMatches("image/png", "image/*"));
  assert.ok(kindMatches("text/markdown; charset=utf-8", "text/markdown"));
  assert.ok(!kindMatches("application/vnd.agentmesh.x+json", "text/markdown"));
  assert.ok(isPersonFacing("video/mp4", table));
  assert.ok(!isPersonFacing("application/vnd.agentmesh.points+json", table));
});

test("a one-page announcement in Markdown reads the style guide and the brand profile, each with its reason", () => {
  const sa = standingAssetsOf([out("the announcement", "text/markdown"), { direction: "in", piece: "the product facts", kind: "text", given_by: "person" }], table);
  assert.deepEqual(sa.schemas, [BRAND, STYLE]);
  assert.equal(sa.none, null);
  assert.equal(sa.outputs.length, 1, "an input is not an output a person reads");
  const o = sa.outputs[0];
  assert.deepEqual(o.classes, ["written copy"]);
  assert.match(o.assets.find((a) => a.schema === STYLE).why, /voice/);
  assert.match(o.assets.find((a) => a.schema === BRAND).why, /name/);
  assert.deepEqual(standingProblems(sa, table), []);
});

test("a page is written copy and visual, and the brand profile is decided once with both reasons", () => {
  const sa = standingAssetsOf([out("the page", "text/html")], table);
  assert.deepEqual(sa.schemas, [BRAND, STYLE]);
  const brand = sa.outputs[0].assets.filter((a) => a.schema === BRAND);
  assert.equal(brand.length, 1);
  assert.match(brand[0].why, /name.*; and .*look/);
  assert.deepEqual(sa.outputs[0].classes, ["written copy", "visual"]);
});

test("a film reads the brand profile and the media templates", () => {
  assert.deepEqual(standingAssetsOf([out("the film", "video/mp4")], table).schemas, [BRAND, TEMPLATES]);
});

test("an agent that hands back only data code reads declares none, and the record says why", () => {
  const sa = standingAssetsOf([out("the points", "application/vnd.agentmesh.points+json")], table);
  assert.deepEqual(sa.schemas, []);
  assert.match(sa.none, /no output is read by a person/);
  assert.deepEqual(standingProblems(sa, table), []);
});

test("the person's answer that none apply stands, with their reason", () => {
  const { answers } = answersIn("standing-assets: none, because the announcement is internal and plain");
  assert.equal(answers["standing-assets"], "none, because the announcement is internal and plain");
  const sa = standingAssetsOf([out("the announcement", "text/markdown")], table, answers["standing-assets"]);
  assert.deepEqual(sa.schemas, []);
  assert.equal(sa.none, "the person said none apply, because the announcement is internal and plain");
});

test("an asset of an unknown kind, or none without a reason, is a problem", () => {
  assert.match(standingProblems({ outputs: [], schemas: ["https://schemas.example/x/v1"], none: null }, table)[0], /not a known kind/);
  assert.match(standingProblems({ outputs: [], schemas: [], none: "" }, table)[0], /does not say why/);
});

test("the record carries the section and the header line, and the header reads back", () => {
  const sa = standingAssetsOf([out("the announcement", "text/markdown")], table);
  const rec = recordOf({
    asked: { statement: "an agent that writes a one-page product announcement for a person to review", answers: {} },
    named: { architecture: { title: "announcement", kind: { kind: "plugin-on-harness", why: "default" }, formats: [out("the announcement", "text/markdown")], decisions: [] } },
    bound: { environments: ["dev"], systems: [] },
    table,
  });
  assert.deepEqual(rec.standing_assets, sa);
  const text = renderRecord(rec);
  assert.match(text, /^standing_assets: \[https:\/\/schemas\.agentmesh\.ai\/brand\/v1, https:\/\/schemas\.agentmesh\.ai\/style-guide\/v1\]$/m);
  assert.match(text, /## Standing assets\n\n- \*\*the announcement\*\* \(`text\/markdown`, written copy\): the style guide/);
  assert.deepEqual(parseRecord(text).standing_assets, [BRAND, STYLE]);
  assert.deepEqual(forbiddenIn(text, table), [], "a known schema is a name, not an address");
  assert.ok(forbiddenIn(text.replace(BRAND, "https://evil.example/brand"), table).length, "any other address still is");
  assert.equal(doneOf(rec, [], table).problems.length, 0);
});

test("a record that says none reads back as an empty list, and one written before the section as not said", () => {
  const none = renderRecord({ title: "t", statement: "s", environments: [], systems: [], decisions: [], questions: [], kind: { kind: "k", why: "w" }, standing_assets: { outputs: [], schemas: [], none: "no output is read by a person" } });
  assert.match(none, /^standing_assets: none$/m);
  assert.match(none, /- None, because no output is read by a person\./);
  assert.deepEqual(parseRecord(none).standing_assets, []);
  const before = renderRecord({ title: "t", statement: "s", environments: [], systems: [], decisions: [], questions: [], kind: { kind: "k", why: "w" } });
  assert.equal(parseRecord(before).standing_assets, null);
  assert.match(before, /## Standing assets\n\nNot decided: the list of standing-asset kinds was not read/);
});

test("without the list, nothing is decided and the record is not done, rather than a false none", () => {
  assert.equal(standingAssetsOf([out("the film", "video/mp4")], null), null);
  const rec = recordOf({
    asked: { statement: "an agent that makes a film", answers: {} },
    named: { architecture: { title: "film", kind: { kind: "plugin-on-harness", why: "default" }, formats: [out("the film", "video/mp4")], decisions: [] } },
    bound: { environments: ["dev"], systems: [] },
    table: null,
  });
  assert.equal(rec.standing_assets, null);
  assert.ok(doneOf(rec, [], null).problems.includes("the standing assets are not decided"));
  assert.doesNotMatch(renderRecord(rec), /None, because/);
});

test("a person's answer that is not a none is said in the record, and the house rule stands", () => {
  const sa = standingAssetsOf([out("the announcement", "text/markdown")], table, "brand only, no style guide");
  assert.deepEqual(sa.schemas, [BRAND, STYLE]);
  assert.match(sa.note, /only "none, because \.\.\." changes this section/);
  const text = renderRecord({ title: "t", statement: "s", environments: [], systems: [], decisions: [], questions: [], kind: { kind: "k", why: "w" }, standing_assets: sa });
  assert.match(text, /- Note: the person answered "brand only, no style guide"/);
});
