// The process checker (process-check.mjs): an Agent Processes 0.9.2 document
// read for the §17.1 conformance items a program can see, and for the four
// tests of §20.1 where a program can see them. A document that conforms and
// shows none of the findings passes; each rule the check holds is shown here
// catching the document that breaks it, with the section it cites.
//   node --test standards/test/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkProcess, parseDocument, digestOf, shapeDigestOf, shapeOf, SPEC_VERSION } from "../process-check.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CHECK = join(HERE, "..", "process-check.mjs");

import { GOOD } from "./fixtures.mjs";


const check = (text, opts) => checkProcess(text, opts);
const sections = (r) => r.failures.map((f) => f.section);
const tests = (r) => r.findings.map((f) => f.test);
const failsAt = (text, section, re) => {
  const r = check(text);
  const hit = r.failures.find((f) => f.section === section && (!re || re.test(f.text)));
  assert.ok(hit, `no failure at ${section}${re ? ` matching ${re}` : ""}: ${JSON.stringify(r.failures)}`);
  return r;
};
const findsAs = (text, name, re) => {
  const r = check(text);
  const hit = r.findings.find((f) => f.test === name && (!re || re.test(f.text)));
  assert.ok(hit, `no finding ${name}${re ? ` matching ${re}` : ""}: ${JSON.stringify(r.findings)}`);
  return r;
};
const swap = (from, to) => { assert.ok(GOOD.includes(from), `the fixture has no ${from}`); return GOOD.replace(from, to); };

test("a document that conforms and has no findings passes", () => {
  const r = check(GOOD);
  assert.deepEqual(r.failures, []);
  assert.deepEqual(r.findings, []);
  assert.equal(r.conforms, true);
  assert.equal(r.clean, true);
  assert.equal(r.document.id, "research/explore-a-topic");
  assert.equal(r.document.version, "v3");
  assert.deepEqual(r.document.phases.map((p) => p.name), ["plan-the-angles", "write-the-cards", "approve-the-cards", "publish-the-cards"]);
  assert.deepEqual(r.document.carries.map((c) => [c.name, c.required]), [["topic", true], ["reader", false]]);
});

test("the parse reads phases, handoffs, deviations and the trigger's items the way the process runner does", () => {
  const d = parseDocument(GOOD);
  const p = d.phases.find((x) => x.name === "approve-the-cards");
  assert.equal(p.form, "human");
  assert.equal(p.owner, "editor (person)");
  assert.deepEqual(p.after, ["write-the-cards"]);
  assert.equal(p.automation, "never");
  assert.deepEqual(d.handoffs[0].from, ["plan-the-angles"]);
  assert.deepEqual(d.handoffs[0].to, ["write-the-cards"]);
  assert.equal(d.handoffs[0].key, "angles");
  assert.deepEqual(d.deviations.map((x) => [x.from, x.to, x.key]), [["approve-the-cards", "write-the-cards", "changes"]]);
  assert.equal(d.goal.startsWith("five cards on the topic"), true);
});

test("the digest is the sha256 of the text, the same whatever the line ends", () => {
  assert.match(digestOf(GOOD), /^sha256:[0-9a-f]{64}$/);
  assert.equal(digestOf(GOOD.replace(/\n/g, "\r\n")), digestOf(GOOD));
  assert.notEqual(digestOf(GOOD + "x"), digestOf(GOOD));
});

test("it checks against Agent Processes 0.9.2", () => {
  assert.equal(SPEC_VERSION, "0.9.2");
});

test("§21.1: the shape digest is the sha256 of the text with the bindings: block left out", () => {
  const shape = shapeOf(GOOD);
  assert.doesNotMatch(shape, /^bindings:/m);
  assert.doesNotMatch(shape, /roster:|systems:|data:/);
  assert.match(shape, /^policy:/m);
  assert.match(shape, /^deviations:/m);
  // Only the bindings block's lines go: every other line stays, in order.
  const shapeLines = shape.split("\n");
  const gone = GOOD.split("\n").filter((l) => !shapeLines.includes(l));
  assert.deepEqual(gone.map((l) => l.trim().split(/\s+/)[0]), ["bindings:", "roster:", "in", "systems:", "data:"]);
  assert.equal(shapeDigestOf(GOOD), digestOf(shape));
  assert.equal(shapeDigestOf(GOOD.replace(/\n/g, "\r\n")), shapeDigestOf(GOOD));
  // Who holds a role and which systems it uses are not the shape.
  assert.equal(shapeDigestOf(swap("roster:  angle-planner, card-writer", "roster:  angle-planner.acme@example.com, card-writer")), shapeDigestOf(GOOD));
  assert.equal(shapeDigestOf(swap("systems: the team's page (write)", "systems: the team's wiki (write)")), shapeDigestOf(GOOD));
  // Everything else is.
  assert.notEqual(shapeDigestOf(swap("after: write-the-cards   automation: never", "after: write-the-cards   automation: supervised")), shapeDigestOf(GOOD));
  assert.notEqual(shapeDigestOf(swap("[changes]", "[redo]")), shapeDigestOf(GOOD));
  assert.notEqual(shapeDigestOf(swap("carries: reader - who the result is for, optional", "carries: reader - who the result is for, required")), shapeDigestOf(GOOD));
});

test("§21.1: the check reports the shape digest a test case pins, and the text's own digest beside it", () => {
  const r = check(GOOD);
  assert.equal(r.digest, shapeDigestOf(GOOD));
  assert.equal(r.text_digest, digestOf(GOOD));
  assert.notEqual(r.digest, r.text_digest);
});

test("§6.7.1: a deviation line may end with limit: <n>, the most times one run takes it", () => {
  const at = "is wrong, and the cards are written again\n";
  const own = check(swap(at, `${at}    limit: 3\n`));
  assert.deepEqual(own.failures, []);
  assert.deepEqual(own.findings, []);
  assert.equal(own.document.deviations[0].limit, 3);
  assert.doesNotMatch(own.document.deviations[0].text, /limit/);
  const trailing = check(swap(at, at.replace("\n", "   limit: 2\n")));
  assert.deepEqual(trailing.failures, []);
  assert.deepEqual(trailing.findings, []);
  assert.equal(trailing.document.deviations[0].limit, 2);
  assert.equal(check(GOOD).document.deviations[0].limit, null);
  failsAt(swap(at, `${at}    limit: 0\n`), "§6.7.1", /limit/);
  failsAt(swap(at, `${at}    limit: three\n`), "§6.7.1", /limit/);
});

test("a limit: line under a handoff is still a line the specification does not define (§20.3)", () => {
  findsAs(swap("with its question\n", "with its question\n    limit: 3\n"), "undefined-line", /limit: 3/);
});

// §17.1, item by item.

test("§3: each required part is carried", () => {
  for (const [part, from, to] of [
    ["trigger", /^trigger: .*\n(\s+carries:.*\n\s+required\n\s+carries:.*\n)/m, ""],
    ["goal", /^goal: .*\n.*\n/m, ""],
    ["handoffs", /^handoffs:\n(  .*\n|    .*\n)*/m, ""],
  ]) {
    const r = check(GOOD.replace(from, to));
    assert.ok(r.failures.some((f) => f.section === "§3" && f.text.includes(`${part}:`)), `${part}: ${JSON.stringify(r.failures)}`);
  }
  failsAt(GOOD.replace(/^phases:\n[\s\S]*?(?=^handoffs:)/m, ""), "§3", /phases:/);
  const none = check("owner: me\n");
  assert.equal(none.conforms, false);
  assert.ok(none.failures.some((f) => f.section === "§3" && /PROCESS:/.test(f.text)));
});

test("§4: a version beside the id, an id of the form team/slug, an owner, concurrency and a goal", () => {
  failsAt(swap("research/explore-a-topic   v3", "research/explore-a-topic"), "§4", /version/);
  failsAt(swap("research/explore-a-topic   v3", "Research/Explore A Topic   v3"), "§4", /id/);
  failsAt(swap("owner: head of research          effective: 2026-11-01", "effective: 2026-11-01"), "§4", /owner/);
  failsAt(GOOD.replace(/^concurrency: .*\n.*\n/m, ""), "§4", /concurrency/);
  // A reference process: blanks where the organization's parts go, and an id under ref/.
  const ref = swap("research/explore-a-topic   v3", "ref/res/explore-a-topic   v1").replace("owner: head of research          effective: 2026-11-01", "from: ref/res/explore-a-topic v1\nowner: <who>                     effective: <date>");
  assert.deepEqual(check(ref).failures, []);
});

test("§4: from: names a reference process or another organization's document, each with a version", () => {
  assert.deepEqual(check(swap("owner: head", "from: ref/res/explore-a-topic v2\nowner: head")).failures, []);
  assert.deepEqual(check(swap("owner: head", "from: northwind.example research/explore-a-topic v3\nowner: head")).failures, []);
  failsAt(swap("owner: head", "from: the old one\nowner: head"), "§4", /from:/);
});

test("§4: confidential-under: at most once, as an identifier, a version and a sha256 digest", () => {
  const ok = `confidential-under: nda_7k3pxw9c2r4tmq8d v1 sha256:${"a".repeat(64)}\n`;
  assert.deepEqual(check(swap("trigger:", `${ok}trigger:`)).failures, []);
  failsAt(swap("trigger:", `${ok}${ok}trigger:`), "§4", /more than once/);
  failsAt(swap("trigger:", "confidential-under: the usual one\ntrigger:"), "§4", /confidential-under/);
});

test("§5.4: every item the trigger carries has a name no other item has, and says required or optional", () => {
  const twice = swap("carries: reader - who the result is for, optional", "carries: topic - who the result is for, optional");
  const r = failsAt(twice, "§5.4", /topic/);
  assert.ok(r.findings.some((f) => f.test === "carries-not-unique"));
  failsAt(swap("who the result is for, optional", "who the result is for"), "§5.4", /required or optional/);
  failsAt(swap("carries: reader -", "carries: The Reader -"), "§5.4", /key/);
});

test("§5.1: more than one watch: line is joined by and or or", () => {
  const two = swap("         carries: topic", "         watch: record=<request> system=<inbox> change=<a request arrives>\n         watch: every=<week>\n         carries: topic");
  failsAt(two, "§5.1", /joined/);
  const joined = swap("         carries: topic", "         watch: record=<request> system=<inbox> change=<a request arrives>\n         or watch: every=<week>\n         carries: topic");
  assert.deepEqual(check(joined).failures, []);
});

test("§6.1: every phase line names its phase, in lowercase kebab, once", () => {
  failsAt(swap("  write-the-cards   - harness", "  Write_The_Cards   - harness"), "§6.1", /Write_The_Cards/);
  failsAt(swap("  publish-the-cards - system", "  write-the-cards - system"), "§6.1", /more than once/);
  failsAt(swap("  plan-the-angles   - harness:", "  plan-the-angles   harness:"), "§6.1", /names no phase/);
});

test("§6.3: a phase resolves to one of the five forms, and a harness: phase names its output", () => {
  failsAt(swap("- system: the approved cards", "- robot: the approved cards"), "§6.3", /publish-the-cards/);
  failsAt(swap("- harness: the five angles worth a card, each with\n                      the question it answers", "- harness:"), "§6.3", /output/);
  // The earlier form, runs <name>:, is a harness: phase and still conforms.
  assert.deepEqual(check(swap("- harness: the five angles", "- runs plan-angles: the five angles")).failures, []);
});

test("§6.3.1: a phase that runs a process cites it by id and version, is not a gate, and runs no chain back to itself", () => {
  const runs = (line) => swap("- system: the approved cards published to the team's\n                      page", line);
  assert.deepEqual(check(runs("- runs process research/publish-a-page v2: the cards\n                      published, with the publication record")).failures, []);
  failsAt(runs("- runs process publish-a-page: the cards published"), "§6.3.1", /id and version/);
  failsAt(runs("- runs process research/explore-a-topic v3: the cards published"), "§6.3.1", /itself/);
  failsAt(runs("- runs process research/publish-a-page v2: the cards published").replace("after: approve-the-cards   automation: autonomous", "after: approve-the-cards   automation: never"), "§6.3.1", /never/);
  // Through a chain: the inner document runs this one again.
  const inner = `PROCESS: publish a page   id: research/publish-a-page   v2
owner: head of research   effective: 2026-11-01
trigger: another process hands over finished cards
concurrency: one run at a time
goal: the cards published, with the publication record
phases:
  publish - runs process research/explore-a-topic v3: five cards
            owner: page-publisher   after: trigger   automation: autonomous
handoffs:
  publish -> the submitting process: the publication record
bindings:
  roster: page-publisher is an agent
  systems: none
  data: the cards
measures:
  quality gate: every card is on the page
`;
  const r = check(runs("- runs process research/publish-a-page v2: the cards published"), { inner: [inner] });
  assert.ok(r.failures.some((f) => f.section === "§6.3.1" && /comes back/.test(f.text)), JSON.stringify(r.failures));
});

test("§6.4, §6.5, §7: every phase carries owner:, after: and an automation level from the list", () => {
  failsAt(swap("                      owner: card-writer\n", ""), "§6.4", /write-the-cards/);
  failsAt(swap("after: plan-the-angles   automation: autonomous", "automation: autonomous"), "§6.5", /after:/);
  failsAt(swap("after: plan-the-angles   automation: autonomous", "after: plan-the-angles"), "§7", /automation/);
  failsAt(swap("after: plan-the-angles   automation: autonomous", "after: plan-the-angles   automation: mostly"), "§7", /mostly/);
});

test("§6.5: at least one phase starts at the trigger, and after: names phases the document declares", () => {
  failsAt(swap("after: trigger        automation", "after: write-the-cards   automation"), "§6.5", /trigger/);
  failsAt(swap("after: plan-the-angles   automation", "after: plan-the-angle   automation"), "§6.5", /plan-the-angle\b/);
  // A join, a phase marked as not running in every run, and an exception edge all read.
  assert.deepEqual(check(swap("after: plan-the-angles   automation", "after: plan-the-angles + trigger   automation")).failures, []);
  assert.deepEqual(check(swap("after: write-the-cards   automation: never", "after: write-the-cards?   automation: never")).failures, []);
});

test("§6.5.2: the ? marker is written only in an after: value", () => {
  failsAt(swap("  write-the-cards -> approve-the-cards [cards]", "  write-the-cards? -> approve-the-cards [cards]"), "§6.5.2");
});

test("§6.7.2: the after: lines make no cycle", () => {
  failsAt(swap("after: trigger        automation", "after: approve-the-cards   automation"), "§6.7.2", /cycle/);
});

test("§6.7.1: a deviation names phases that exist on both sides; any is allowed on the left", () => {
  failsAt(swap("approve-the-cards -> write-the-cards [changes]", "approve-the-cards -> rewrite-the-cards [changes]"), "§6.7.1", /rewrite-the-cards/);
  assert.deepEqual(check(swap("approve-the-cards -> write-the-cards [changes]", "any -> write-the-cards [changes]")).failures, []);
});

test("§8.1, §8.2: a handoff says what crosses, and both sides name something that exists", () => {
  const r = failsAt(swap("plan-the-angles -> write-the-cards [angles]", "plan-the-angles -> write-cards [angles]"), "§8.2", /write-cards/);
  assert.ok(r.findings.some((f) => f.test === "handoff-unknown-phase" && /write-cards/.test(f.text)));
  failsAt(swap("plan-the-angles -> write-the-cards [angles]: the five angles, each\n    with its question", "plan-the-angles -> write-the-cards [angles]:"), "§8.1");
  failsAt(swap("plan-the-angles -> write-the-cards [angles]", "trigger -> write-the-cards [angles]"), "§8.2", /trigger/);
  // A counterparty role named in the roster may send; one the roster does not name may not.
  const inbound = (who) => swap("deviations:", `  ${who} -> plan-the-angles [brief]: the brief they sent\ndeviations:`);
  assert.deepEqual(check(inbound("editor (person)")).failures, []);
  failsAt(inbound("a stranger at the door"), "§8.2", /roster/);
});

test("§8.3: + only on the sending side, / only on the receiving side", () => {
  failsAt(swap("plan-the-angles -> write-the-cards [angles]", "plan-the-angles -> write-the-cards + approve-the-cards [angles]"), "§8.3");
  failsAt(swap("plan-the-angles -> write-the-cards [angles]", "plan-the-angles / write-the-cards -> approve-the-cards [angles]"), "§8.3");
  assert.deepEqual(check(swap("plan-the-angles -> write-the-cards [angles]", "plan-the-angles -> write-the-cards / approve-the-cards [angles]")).failures, []);
});

test("§8.6: keys are lowercase and hyphenated, and no two handoff, deviation, record or run-scoped keys are the same", () => {
  failsAt(swap("[cards]", "[angles]"), "§8.6", /angles/);
  failsAt(swap("[changes]", "[cards]"), "§8.6", /cards/);
  failsAt(swap("[cards]", "[The_Cards]"), "§8.6", /The_Cards/);
});

test("§8.3, §8.6: one handoff written on a line per receiving phase keeps its one key", () => {
  const twice = swap("  publish-the-cards -> the team's page: the published cards", "  publish-the-cards -> the team's page: the published cards\n  approve-the-cards -> write-the-cards [approved-cards]: the same cards");
  assert.deepEqual(check(twice).failures, []);
  failsAt(swap("  publish-the-cards -> the team's page: the published cards", "  publish-the-cards -> the team's page: the published cards\n  plan-the-angles -> approve-the-cards [approved-cards]: the angles"), "§8.6", /approved-cards/);
});

test("§4, §15: a published reference block, with <team> in its id and the two blanks for owner and effective, is a reference process", () => {
  const ref = swap("id: research/explore-a-topic   v3", "id: <team>/explore-a-topic   v1").replace("owner: head of research          effective: 2026-11-01", "from: ref/res/explore-a-topic v1\nowner: <who>                     effective: <date>").replace("owner: editor (person)", "owner: <your editor role>");
  const r = check(ref);
  assert.equal(r.document.isReference, true);
  assert.deepEqual(r.failures, []);
  assert.deepEqual(r.findings, []);
  failsAt(ref.replace("from: ref/res/explore-a-topic v1\n", ""), "§4", /from:/);
});

test("§9: a run-scoped line carries from: and until:, names an owner, runs no process and has no after:", () => {
  const scoped = (line) => swap("handoffs:", `run-scoped:\n${line}\nhandoffs:`);
  assert.deepEqual(check(scoped("  status - harness: a weekly status note   owner: card-writer\n           every: <week>\n           from: trigger   until: run close")).failures, []);
  failsAt(scoped("  status - harness: a weekly status note   owner: card-writer\n           every: <week>"), "§9.1", /from: and until:/);
  failsAt(scoped("  status - runs process research/status v1: a note   owner: card-writer\n           from: trigger   until: run close"), "§9.1", /process/);
  failsAt(scoped("  status - harness: a note   owner: card-writer\n           from: trigger   until: run close   after: trigger"), "§9.4");
  failsAt(scoped("  status - harness: a note   owner: card-writer\n           from: nowhere-phase   until: run close"), "§9.3", /nowhere-phase/);
});

test("§10: the bindings carry roster:, systems: and data:, and every system an access word", () => {
  failsAt(swap("  data:    the topic as handed\n", ""), "§10", /data:/);
  failsAt(swap("the team's page (write)", "the team's page"), "§10.2", /access/);
  failsAt(swap("the team's page (write)", "the team's page (fly)"), "§10.2", /access/);
  assert.deepEqual(check(swap("the team's page (write)", "the team's page (write; read: reporting), the inbox (trigger)")).failures, []);
  assert.deepEqual(check(swap("the team's page (write)", "none")).failures, []);
  failsAt(swap("the team's page (write)", "the team's page (write, from: plan-the-angle)"), "§10.5", /plan-the-angle/);
});

test("§12.2: the measures name a quality gate", () => {
  failsAt(swap("  quality gate: every published card carries a source and the editor's\n                approval\n", ""), "§12.2");
});

test("§20.2: the extensions block is the last block, and each extension names itself and a version", () => {
  const ext = "extensions:\n  agentprocesses.ai/ext/start-form v1\n    topic: label \"What to explore\"\n";
  assert.deepEqual(check(GOOD + ext).failures, []);
  assert.deepEqual(check(GOOD + ext).findings, []);
  failsAt(GOOD.replace("policy:", `${ext}policy:`), "§20.2", /last/);
  failsAt(GOOD + "extensions:\n  agentprocesses.ai/ext/start-form\n    topic: label \"What\"\n", "§20.2", /version/);
});

// The four tests of §20.1, where a program can see them.

test("a line the specification does not define, outside the extensions: block, is a finding (§20.3)", () => {
  findsAs(GOOD.replace("policy:", "mapping-rules:\n  one thing\npolicy:"), "undefined-line", /mapping-rules/);
  // A limit: under a deviation is 0.9.2's (§6.7.1); under a handoff it is still undefined.
  findsAs(swap("    with its question", "    with its question\n    limit: 3"), "undefined-line", /limit: 3/);
  findsAs(swap("  data:    the topic as handed", "  data:    the topic as handed\n  mapping: plan-the-angles -> write-the-cards json"), "undefined-line", /mapping/);
  findsAs(swap("                      owner: card-writer", "                      owner: card-writer\n                      model: the big one"), "undefined-line", /model/);
  findsAs(swap("         carries: reader", "         form: a box\n         carries: reader"), "undefined-line", /form/);
  // The same lines inside the extensions block are the extension's own.
  const inside = GOOD + "extensions:\n  agentmesh.ai/ext/deviation-limits v1\n    changes: limit 3\n";
  assert.deepEqual(check(inside).findings, []);
});

test("a gate without a holder is a finding", () => {
  const r = findsAs(swap("                      owner: editor (person)\n", ""), "gate-without-holder", /approve-the-cards/);
  assert.ok(sections(r).includes("§6.4"));
  findsAs(swap("owner: editor (person)", "owner: <the editor>"), "gate-without-holder", /approve-the-cards/);
  // In a reference process a blank role is where the adopter puts the person.
  const ref = swap("research/explore-a-topic   v3", "ref/res/explore-a-topic   v1").replace("owner: head of research          effective: 2026-11-01", "from: ref/res/explore-a-topic v1\nowner: <who>                     effective: <date>").replace("owner: editor (person)", "owner: <your editor role>");
  assert.ok(!tests(check(ref)).includes("gate-without-holder"));
});

test("carries keys that are not unique, and handoffs naming phases that do not exist, are findings as well as failures", () => {
  findsAs(swap("carries: reader - who", "carries: topic - who"), "carries-not-unique", /topic/);
  findsAs(swap("-> publish-the-cards [approved-cards]", "-> publish-cards [approved-cards]"), "handoff-unknown-phase", /publish-cards/);
});

test("a document in a Markdown page is read from its fenced block", () => {
  const page = `# Explore a topic\n\nSome words.\n\n\`\`\`\n${GOOD}\`\`\`\n\nThe failure edges, in prose.\n`;
  assert.deepEqual(check(page).failures, []);
  assert.deepEqual(check(page).findings, []);
});

test("the command line: exit 0 for a clean document, 1 with what failed, 2 without a file; --json prints the result", () => {
  const dir = mkdtempSync(join(tmpdir(), "process-check-"));
  const good = join(dir, "good.process.txt");
  const bad = join(dir, "bad.process.txt");
  writeFileSync(good, GOOD);
  writeFileSync(bad, swap("after: plan-the-angles   automation", "after: plan-the-angle   automation"));
  const out = execFileSync(process.execPath, [CHECK, good], { encoding: "utf8" });
  assert.match(out, /conforms/);
  const r = spawnSync(process.execPath, [CHECK, bad], { encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /§6\.5/);
  assert.match(r.stdout, /plan-the-angle/);
  const j = spawnSync(process.execPath, [CHECK, bad, "--json"], { encoding: "utf8" });
  const parsed = JSON.parse(j.stdout);
  assert.equal(parsed.conforms, false);
  assert.equal(parsed.digest, shapeDigestOf(swap("after: plan-the-angles   automation", "after: plan-the-angle   automation")));
  assert.equal(spawnSync(process.execPath, [CHECK], { encoding: "utf8" }).status, 2);
});
