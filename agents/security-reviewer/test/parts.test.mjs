// The parts a review is made of, each on its own: the archive reader, the
// program tracer, the architecture record reader, the assessment's rules, the
// one judgment (with a stand-in model), the credential list it shares with the
// publisher, and this agent's own files.
//   run: node --test test/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { AGENT, filesOf, json, PLUGIN, smallPackage, tarGz } from "./helpers.mjs";
import { cleanPath, packageRoot, readTar } from "../scripts/tar.mjs";
import { fromFiles } from "../scripts/read-package.mjs";
import { isTest, matchReaches, stripComments, traceOne } from "../scripts/trace-programs.mjs";
import { readArchitecture, spendingLimit } from "../scripts/architecture.mjs";
import { assess, hasReason, splitRefusal } from "../scripts/assess.mjs";
import { credentialsIn, SECRETS } from "../scripts/secrets.mjs";
import { itemsOf, weigh } from "../scripts/weigh.mjs";
import { reviewMarkdown } from "../scripts/write-review.mjs";
import { isArchitectureRecord, scrub } from "../scripts/review-package.mjs";

const filesMap = (o) => new Map(Object.entries(o).map(([k, v]) => [k, Buffer.from(v)]));

test("the archive is read in memory, its top folder taken off, and a path that climbs out of it is not read", () => {
  const got = readTar(tarGz({ "a.json": "{}", "skills/x/scripts/y.mjs": "1" }, { top: "pkg", extra: [{ name: "../out", type: "0" }, { name: "pkg/l", type: "2" }] }));
  assert.equal(got.error, "");
  assert.deepEqual(got.climbing, ["../out"]);
  assert.deepEqual(got.links, ["pkg/l"]);
  const { files, top } = packageRoot(new Map([...got.files, ["pkg/plugin.json", Buffer.from("{}")]]));
  assert.equal(top, "pkg");
  assert.ok(files.has("skills/x/scripts/y.mjs"));
  assert.deepEqual(cleanPath("/etc/passwd"), { path: "/etc/passwd", climbs: true });
  assert.deepEqual(cleanPath("./a//b/./c"), { path: "a/b/c", climbs: false });
  assert.match(readTar(Buffer.from([0x1f, 0x8b, 1, 2, 3])).error, /not a gzip file that unpacks/);
});

test("a name over a hundred characters is read whole, through the ustar prefix", () => {
  const long = `skills/${"a".repeat(60)}/scripts/${"b".repeat(60)}.mjs`;
  assert.ok(readTar(tarGz({ [long]: "x" })).files.has(long));
});

test("the declaration is read from both halves, each system's facts kept apart", () => {
  const d = fromFiles(filesMap(filesOf(smallPackage((p) => { Object.assign(p.requirements.systems[0], { credential: "k", env: "K_KEY", spends: { unit: "calls" } }); return p; }))));
  assert.equal(d.name, "weather-reader");
  const s = d.systems[0];
  assert.deepEqual([s.name, s.access, s.kind, s.credential, s.env, s.spends.unit, s.inDescriptor, s.inRequirements], ["weather-service", "read", "service", "k", "K_KEY", "calls", true, true]);
  assert.deepEqual(d.refusals.length, 2);
  assert.deepEqual(d.programs, ["skills/read-the-weather/scripts/read.mjs"]);
});

test("comments and regular expressions are not code that reaches anything; strings are kept", () => {
  const code = [
    "// fetch(\"https://in-a-comment.example-a.io\")",
    "/* https://in-a-block.example-b.io */",
    "const re = /fetch\\(\"https:\\/\\/in-a-pattern.example-c.io\"/g; const q = /[\"'`]/;",
    "const u = \"https://kept.example-d.io/x\"; await fetch(u);",
    "const half = a / b / c;",
  ].join("\n");
  const out = stripComments(code, "x.mjs");
  assert.equal(out.split("\n").length, 5, "line numbers are kept");
  assert.ok(!out.includes("in-a-comment") && !out.includes("in-a-block") && !out.includes("in-a-pattern"));
  assert.ok(out.includes("https://kept.example-d.io/x"));
  assert.ok(out.includes("a / b / c"), "a division is not a pattern");
  const t = traceOne("x.mjs", code);
  assert.deepEqual(t.hosts.map((h) => [h.host, h.line]), [["in-a-comment.example-a.io", 1], ["kept.example-d.io", 4]], "stripping decides calls, never addresses: every address in the raw text counts");
  assert.deepEqual(t.written.map((h) => h.host), ["in-a-block.example-b.io"]);
  assert.equal(t.open.length, 1, "fetch(u) is a call to an address it was handed");
  assert.equal(stripComments("# https://x.example-e.io\nurl = 'https://y.example-f.io' # a\n", "a.py").includes("x.example-e.io"), false);
});

test("an address that is a name and not a place is not a reach, and a host built from a value is still seen", () => {
  const t = traceOne("x.mjs", "const NS = \"http://www.w3.org/2000/svg\";\nconst door = `https://${where}-aiplatform.googleapis.com/v1`;\nawait fetch(door);\n");
  assert.deepEqual(t.hosts.map((h) => h.host), ["aiplatform.googleapis.com"]);
});

test("each address is matched by evidence: the platform's own address for a declared system, a reason that names it, the record's egress; nothing else", () => {
  const traced = [traceOne("a.mjs", "const A = \"https://generativelanguage.googleapis.com/v1\";\nconst B = \"https://api.acme-crm.io/v2\";\nconst C = \"https://up.example-status.io\";\nconst D_URL = \"https://nowhere-declared.io/x\";\n")];
  const systems = [{ name: "text-reasoning", access: "trigger", needs: "to judge", kind: "service" }, { name: "crm", access: "read", needs: "to read accounts from acme-crm.io, the customer list", kind: "service" }];
  const m = matchReaches({ traced, systems, egressHosts: ["example-status.io"] });
  const by = Object.fromEntries(m.reaches.map((r) => [r.host, r.system]));
  assert.equal(by["generativelanguage.googleapis.com"], "text-reasoning");
  assert.equal(by["api.acme-crm.io"], "crm");
  assert.equal(by["up.example-status.io"], "(further destination)");
  assert.deepEqual(m.unmatched.map((u) => u.host), ["nowhere-declared.io"]);
  const none = matchReaches({ traced, systems: [] });
  assert.ok([...none.unmatched, ...none.written].some((u) => u.host === "generativelanguage.googleapis.com"), "a model address is the platform's only for a package that declares the model, or reads the model it is given");
  const given = matchReaches({ traced: [traceOne("b.mjs", "const MODEL_URL = \"https://generativelanguage.googleapis.com/v1\";\nconst m = process.env.AGENT_MODEL;\n")], systems: [] });
  assert.equal(given.reaches[0]?.system, "(the model it is given)");
  assert.equal(given.undeclaredModel, true);
});

test("a credential variable no system declares is seen; the host's own variables and the model's placed key are not credentials asked for", () => {
  const traced = [traceOne("a.mjs", "const a = process.env.SHOP_API_KEY; const b = process.env.AGENT_MODEL; const c = env.CEILING_TEXT_REASONING; const d = process.env.GOOGLE_GENERATIVE_AI_API_KEY; const e = process.env.DECLARED_TOKEN;")];
  const m = matchReaches({ traced, systems: [{ name: "x", env: "DECLARED_TOKEN", needs: "", access: "read" }] });
  assert.deepEqual(m.credentialVars.map((v) => v.name), ["SHOP_API_KEY"]);
  assert.deepEqual(m.modelKeys.map((v) => v.name), ["GOOGLE_GENERATIVE_AI_API_KEY"]);
});

test("a browser that routes none of its requests is seen, and one that routes them is said to", () => {
  assert.equal(traceOne("a.mjs", "import { chromium } from 'playwright-core';\nconst b = await chromium.launch();\nawait page.goto(u);").routes, false);
  assert.equal(traceOne("a.mjs", "import { chromium } from 'playwright-core';\nconst b = await chromium.launch();\nawait context.route('**/*', f);\nawait page.goto(u);").routes, true);
});

test("tests are not the agent at work", () => {
  assert.ok(isTest("test/a.test.mjs") && isTest("skills/x/scripts/b.test.mjs") && !isTest("scripts/test-runner.mjs"));
});

test("a refusal is split into the act and the reason after it; a reason is a few words", () => {
  assert.deepEqual(splitRefusal("Naming an agent. A name is a handle somebody is stuck with."), { act: "Naming an agent", reason: "A name is a handle somebody is stuck with." });
  assert.deepEqual(splitRefusal("Signing anything"), { act: "Signing anything", reason: "" });
  assert.ok(hasReason("to read the forecast"));
  assert.ok(!hasReason("records") && !hasReason("-") && !hasReason(""));
});

test("the architecture record is read by its headings: systems, egress, limits, decisions", () => {
  const a = readArchitecture([
    "# Architecture record", "## The systems", "- `crm`: Salesforce in production", "- email: SendGrid", "| System | Dev |", "|---|---|", "| database | Postgres |",
    "## Egress", "Production: api.vendor-one.io, to send the invoices. Dev needs none beyond the derived set.",
    "## Limits", "- Spending limit: $40 per month", "- Answers within 30 seconds",
    "## Decisions", "1. x", "- Salesforce because it is what the sales team uses.",
  ].join("\n"));
  assert.deepEqual(a.systems.sort(), ["crm", "database", "email"]);
  assert.deepEqual(a.egress.hosts, ["api.vendor-one.io"]);
  assert.ok(a.egress.none);
  assert.deepEqual(a.limits, ["Spending limit: $40 per month"]);
  assert.equal(readArchitecture("").given, false);
});

test("the owner's spending limit is a line of its own; a number in passing is not a limit, and none is none", () => {
  assert.deepEqual(spendingLimit("spending limit: 5 USD per day"), { said: "5 USD per day", from: "the message" });
  assert.deepEqual(spendingLimit("- Budget: $12 a month"), { said: "$12 a month", from: "the message" });
  assert.equal(spendingLimit("It cost me 5 USD last time."), null);
  assert.equal(spendingLimit("spending limit: none"), null);
  assert.equal(spendingLimit("spending limit: soon"), null);
  assert.deepEqual(spendingLimit("", { limits: ["Spending limit: $40 per month"] }), { said: "Spending limit: $40 per month", from: "the architecture record's limits" });
});

test("an architecture record is told from the package's own Markdown by its name or first heading", () => {
  assert.ok(isArchitectureRecord("architecture-record.md", "x"));
  assert.ok(isArchitectureRecord("notes.md", "# Architecture record: the weather reader\n"));
  assert.ok(!isArchitectureRecord("ARCHITECTURE.md", "# Architecture\nHow the code is laid out.\n"), "a package's own ARCHITECTURE.md is not the record");
  assert.ok(!isArchitectureRecord("SKILL.md", "# Read the weather\n"));
  assert.ok(!isArchitectureRecord("agent-descriptor.json", "# Architecture"));
});

test("a message is recorded with anything that looks like a credential left out", () => {
  const key = `AKIA${"Z".repeat(16)}`;
  assert.ok(!scrub(`my key is ${key} ok`).includes(key));
  assert.match(scrub(`my key is ${key} ok`), /left out/);
});

test("the credential list is the publisher's, behaving the same on every kind it names", async () => {
  const { SECRETS: publisher } = await import("../../publisher/scripts/inspect.mjs");
  // Each sample is put together at run time, so this file carries none of
  // them and a review of this agent's own source does not find one here.
  const D = "-".repeat(5);
  const samples = [
    `${D}BEGIN RSA PRIVATE KEY${D}`, `{"type": "service${"_"}account"}`, `"private${"_"}key": "${D}BEGIN`, `AKIA${"A".repeat(16)}`,
    `aws_secret_access_key = ${"x".repeat(24)}`, `SU${"A".repeat(56)}`, `${D}BEGIN ENCRYPTED PRIVATE KEY${D}`,
    "a page about authentication that says secret", "AKIA is a prefix",
  ];
  assert.equal(SECRETS.length, publisher.length);
  for (const s of samples) {
    const ours = SECRETS.find((x) => x.find.test(s))?.what ?? null;
    const theirs = publisher.find((x) => x.find.test(s))?.what ?? null;
    assert.equal(ours, theirs, s);
  }
  const found = credentialsIn(filesMap({ "a.txt": `x\n${D}BEGIN OPENSSH PRIVATE KEY${D}\n`, "b.bin": `\0\0${D}BEGIN OPENSSH PRIVATE KEY${D}` }));
  assert.deepEqual(found, [{ file: "a.txt", line: 2, what: "a private key" }]);
});

const assessed = (change) => {
  const d = fromFiles(filesMap(filesOf(smallPackage(change))));
  return { d, a: assess({ declared: d, traced: { reaches: [], unmatched: [], openFetches: [], unmatchedOpen: [], credentialVars: [], undeclaredCommands: [], browsers: [] }, arch: readArchitecture(""), limit: { said: "1 USD", from: "the message" } }) };
};

test("each reach, spend and never-do carries its reason; what holds each bound is said", () => {
  const { a } = assessed();
  assert.equal(a.verdict, "passed");
  assert.ok(a.neverDos.every((n) => n.reason && n.held_by));
  assert.ok(a.spends.every((s) => s.reason && s.enforced_by));
  const egress = a.neverDos.find((n) => /^Reaching an address/.test(n.act));
  assert.match(egress.held_by, /enforced by none/, "the review does not call open egress enforced");
});

test("an access word that is not read, write or trigger is refused", () => {
  const { a } = assessed((p) => { p.descriptor.systems[0].access = "admin"; return p; });
  assert.equal(a.verdict, "refused");
  assert.ok(a.refusals.some((r) => /"admin", which is not one of read, write or trigger/.test(r)));
});

test("an authority word with nothing recording why is flagged", () => {
  const { a } = assessed((p) => { p.descriptor.offerings[0].authority = ["reads-systems", "sends-messages"]; return p; });
  assert.ok(!a.unreasoned.some((u) => /reads-systems/.test(u.permission)), "reads-systems has the read system's reason");
  assert.ok(a.unreasoned.some((u) => u.permission === "read-the-weather authority sends-messages"));
});

test("the one judgment: each recorded reason is put to the model once, its answer listed, and the verdict untouched", async () => {
  const { d, a } = assessed();
  const asked = [];
  const ask = async (prompt, options) => { asked.push({ prompt, options }); return { judgments: [{ id: "reach-1", holds: "holds", says: "Reading a forecast needs read access and no more." }, { id: "reach-2", holds: "bogus" }] }; };
  const w = await weigh({ a, pkg: { name: d.name }, env: { AGENT_MODEL: "configured/by-the-install" }, ask });
  assert.equal(asked.length, 1);
  assert.match(asked[0].prompt, /-----BEGIN ITEMS-----/);
  assert.match(asked[0].prompt, /forecast for the city/);
  assert.equal(asked[0].options.env.AGENT_MODEL, "configured/by-the-install", "the model is the one placed, never one named here");
  assert.equal(w.weighed.judgments[0].holds, "holds");
  assert.equal(w.weighed.judgments[1].holds, "thin", "an answer that is not one of the three is read as thin");
  assert.equal(w.weighed.judgments.length, itemsOf(a).length);
  const md = reviewMarkdown({ pkg: { name: d.name, version: d.version }, a, traced: null, weighed: w.weighed, reviewedAt: "t" });
  assert.match(md, /the reason accounts for it\. Reading a forecast/);
  assert.equal(a.verdict, "passed");
  const failed = await weigh({ a, pkg: {}, env: { AGENT_MODEL: "m" }, ask: async () => { throw new Error("Model call failed with status 503"); } });
  assert.match(failed.skipped, /could not be asked/);
});

test("this agent's own files: both halves name the same systems, every kind is specific, every input says who gives it", () => {
  const d = json(join(AGENT, "agent-descriptor.json"));
  const r = json(join(AGENT, "agent-runtime-requirements.json"));
  assert.deepEqual(d.systems.map((s) => s.name), r.systems.map((s) => s.name));
  for (const o of d.offerings) {
    for (const i of o.inputs) { assert.notEqual(i.kind, "application/json"); assert.ok(["person", "agent", "either"].includes(i.given_by), i.name); }
    for (const x of o.outputs) { assert.notEqual(x.kind, "application/json"); assert.ok(x.about, x.name); }
    assert.deepEqual(Object.keys(o.how).sort(), ["contract", "control", "cost", "intelligence"]);
    for (const s of o.steps) assert.deepEqual(Object.keys(s.how).sort(), ["contract", "control", "cost", "intelligence"]);
  }
  assert.equal(json(join(AGENT, "plugin.json")).version, d.agent_version);
});

test("no model is named in this agent's code: the model is the one the install placed", () => {
  for (const f of readdirSync(join(AGENT, "scripts"))) {
    const code = stripComments(readFileSync(join(AGENT, "scripts", f), "utf8"), f);
    assert.doesNotMatch(code, /["'`][^"'`\n]*(?:claude|gemini|gpt)-\d[^"'`\n]*["'`]/i, f);
  }
  assert.doesNotMatch(JSON.stringify(json(join(AGENT, "agent-runtime-requirements.json"))), /claude|gemini/i);
});

test("every script plugin.json names is in scripts/, and every script is named by a skill", () => {
  const skills = PLUGIN.extensions["net.agentdoc.package"].build.skills;
  const named = new Set(Object.values(skills).flatMap((s) => s.scripts));
  for (const s of named) assert.ok(readFileSync(join(AGENT, s)), s);
  for (const f of readdirSync(join(AGENT, "scripts"))) assert.ok(named.has(`scripts/${f}`), f);
});
