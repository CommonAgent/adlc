#!/usr/bin/env node
// The process rules a reviewer holds an Agent Processes 0.9.2 document to
// (agentprocesses.ai/spec.html), on top of the process check
// (process-check.mjs), for the Review and Security stages of a build whose
// artifact is a process. Deterministic: no model.
//
//   four-tests          the four tests of §20.1, where a program can see them:
//                       the check's findings (an item carried twice, a handoff
//                       naming no phase, a gate nobody holds), and an extension
//                       line that changes the work (skips or answers an
//                       approval, sets a level or an order, or leaves out an
//                       item the trigger requires), which §20.3 sends back into
//                       the document
//   approval-level      which phases a person signs (§7: never, supervised,
//                       assisted, manual), and for each `never` gate whether the
//                       document says why: its words name a regulator, a
//                       contract, a customer, money or an act that cannot be
//                       undone, or a phase after it acts in the world
//   acts-in-the-world   which phases act in the world (§21.3: send to somebody
//                       outside, post or publish where others can read it, pay,
//                       sign on the organization's behalf), read from each
//                       phase's words and what it hands outside the process,
//                       and whether a person signs before each: the phase's own
//                       level has a person approve or act, or a phase it comes
//                       right after is a gate
//   outside-extensions  a line the specification does not define outside the
//                       extensions: block (§20.3)
//   conformance         each §17.1 item the document fails
//
// The code critic and the security reviewer carry this file and
// process-check.mjs byte for byte, and each writes the findings in its own
// format.
//
//   node standards/process-rules.mjs <document> [--json]
//   needs: node >= 22
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { checkProcess, afterValue } from "./process-check.mjs";

export const RULES = {
  "four-tests": "Agent Processes §20.1: what changes the work is in the document, and only what is the same for every run and only software needs is in an extension",
  "approval-level": "Agent Processes §7: a person signs a phase for a reason the document can name",
  "acts-in-the-world": "Agent Processes §21.3 and §7.1: a phase that sends, posts, publishes, pays or signs has a person's yes before it",
  "outside-extensions": "Agent Processes §20.3: no line the specification does not define outside the extensions: block",
  conformance: "Agent Processes §17.1: the document conforms",
};

/** The levels at which a person approves or acts in the phase itself (§7). */
export const PERSON_LEVELS = ["never", "supervised", "assisted", "manual"];

const squash = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

const ACTS = [
  ["pays", /\b(pays?|paid|paying|payments?|charges?d?|charging|refunds?(ed)?|transfers? (money|funds)|wires? (money|funds))\b/i],
  // Signing on the organization's behalf, not a record signed with a key.
  ["signs", /\b((counter)?sign(s|ed|ing)?\s+(the\s+|a\s+|an\s+|its\s+|their\s+)?(contract|agreement|purchase order|order|offer|filing|tax return|declaration|lease)s?\b|on\s+(the\s+)?(organi[sz]ation's|company's|owner's|client's|its|their|our)\s+behalf)/i],
  // A verb, never the noun: "the post on X" and "recent posts" are things read.
  ["posts", /\b(posted|posting|tweeted|tweeting)\b|(?<!\b(the|a|an|recent|each|every|this|that|its|their|of|new|latest)\s)\b(posts?|tweets?)\s+(it|them|this|that|the\s+\w+|publicly|to|on|in)\b/i],
  ["publishes", /\b(publish(es|ed|ing)?|broadcasts?|announc(es|ed|ing|e)|goes live|made public|released? to the public|listed (in|on) the (public |organi[sz]ation's )?catalog)\b/i],
  ["sends", /\b(sends?|sent|sending|emails?(ed)?|emailing|mails?(ed)?|mailing|texts?(ed)? (to|the)|messages? (sent )?to (customers?|clients?|the public|subscribers?|buyers?|suppliers?|vendors?|partners?|somebody|someone))\b/i],
];

/** How a phase's words say it acts in the world (§21.3), or null when they do not. */
export function actsHow(words) {
  const w = squash(words);
  for (const [how, re] of ACTS) if (re.test(w)) return how;
  return null;
}

const REASON = /\b(regulat\w*|law|legal|statut\w*|complian\w*|contract\w*|agreement|customer\w*|client\w*|public\w*|money|pay\w*|spend\w*|sign\w*|irreversib\w*|cannot be undone|can't be undone|no way back|point of no return|liab\w*|safety|privacy|personal data|consent)\b/i;
const CHANGES_WORK = /\b(skip(s|ped|ping)?|bypass(es|ed)?|auto-?approv\w*|approves? automatically|answer(s|ed)? (it|the gate|approve)|default(s|ed)?|instead of|runs? first|start(s)? at|automation|never|supervised|autonomous|after:)\b/i;

/**
 * Review a process document. Returns { document, digest, text_digest,
 * conforms, findings, signs, acts }: each finding { rule, line, phase?,
 * claim, consequence }, most consequential first.
 */
export function reviewProcess(text, { inner = [] } = {}) {
  const r = checkProcess(text, { inner });
  const d = r.document;
  const findings = [];
  const phases = new Map(d.phases.map((p) => [p.name, p]));
  const isGate = (p) => p && p.automation === "never";

  // What each phase comes right after, and every phase that comes after it.
  const before = new Map(d.phases.map((p) => [p.name, (p.after ?? []).map(afterValue).filter((v) => v.kind === "phase" && phases.has(v.name)).map((v) => v.name)]));
  const next = new Map(d.phases.map((p) => [p.name, d.phases.filter((q) => (before.get(q.name) ?? []).includes(p.name)).map((q) => q.name)]));
  const later = (name) => {
    const seen = new Set();
    const stack = [...(next.get(name) ?? [])];
    while (stack.length) { const n = stack.shift(); if (seen.has(n)) continue; seen.add(n); stack.push(...(next.get(n) ?? [])); }
    return [...seen];
  };

  // §21.3: which phases act in the world, by their words and by what they hand outside the process.
  const acts = [];
  for (const p of d.phases) {
    const out = d.handoffs.filter((h) => !h.malformed && (h.from ?? []).includes(p.name) && (h.to ?? []).some((t) => !phases.has(t)));
    const how = actsHow(p.output) ?? out.map((h) => actsHow(`${h.toText} ${h.text}`)).find(Boolean) ?? null;
    if (!how) continue;
    const own = PERSON_LEVELS.includes(p.automation);
    const gate = (before.get(p.name) ?? []).find((n) => isGate(phases.get(n))) ?? null;
    // Gated by the phase itself when a person approves or acts there, else by the gate it comes right after.
    acts.push({ phase: p.name, line: p.line, how, said: p.output, gated: own || !!gate, by: own ? p.name : gate });
    if (!own && !gate) {
      const after = (before.get(p.name) ?? []).join(" and ") || "the trigger";
      findings.push({
        rule: "acts-in-the-world", line: p.line, phase: p.name, weight: 0,
        claim: `${p.name} acts in the world (it ${how}: "${squash(p.output)}") and no person signs before it: it runs at ${p.automation} right after ${after}, which ${(before.get(p.name) ?? []).length ? "is not a gate" : "no person signs"}.`,
        consequence: `A run ${how === "pays" ? "pays" : how === "signs" ? "signs" : how === "sends" ? "sends to somebody outside" : how} on an agent's output with nobody having said yes, and nothing after it can take that back (§7.1); a test run must stand in for it (§21.3).`,
      });
    }
  }

  // §7: which phases a person signs, and whether the document says why.
  const signs = [];
  for (const p of d.phases.filter((x) => PERSON_LEVELS.includes(x.automation))) {
    const reason = REASON.exec(squash(p.output))?.[0] ?? null;
    const guards = later(p.name).find((n) => acts.some((a) => a.phase === n)) ?? null;
    const selfActs = acts.some((a) => a.phase === p.name);
    const justified = p.automation !== "never" || !!reason || !!guards || selfActs;
    signs.push({ phase: p.name, line: p.line, automation: p.automation, owner: p.owner, justified, why: reason ? `its words name ${reason}` : guards ? `${guards}, after it, acts in the world` : selfActs ? "it acts in the world itself" : p.automation !== "never" ? `a person ${p.automation === "supervised" ? "approves the agent's output" : "does the work"} at ${p.automation}` : null });
    if (!justified) {
      findings.push({
        rule: "approval-level", line: p.line, phase: p.name, weight: 2,
        claim: `${p.name} has a person sign every run (automation: never), and the document gives no reason: its words name no regulator, contract, customer, money or act that cannot be undone, and no phase after it acts in the world.`,
        consequence: "Every run waits on a person for nothing the document says the person protects, and a reader cannot tell whether the gate may ever be lowered (§7, §7.1).",
      });
    }
  }

  // §20.1, §20.3: the check's findings, by the rule each one breaks.
  const TEST = { "carries-not-unique": "test 1 (what a run is handed)", "handoff-unknown-phase": "test 1 (what passes between phases)", "gate-without-holder": "test 1 (which phases a person must sign)" };
  for (const f of r.findings) {
    const line = Number(/line (\d+)/.exec(f.text)?.[1] ?? 0);
    if (f.test === "undefined-line") {
      findings.push({ rule: "outside-extensions", line, weight: 3, claim: squash(f.text), consequence: "A runtime that does not know the line reads a different process from one that does, so the same document runs two ways; it belongs in an extension or out of the document (§20.3)." });
    } else {
      findings.push({ rule: "four-tests", line, weight: 1, claim: `It fails §20.1 ${TEST[f.test] ?? "test 1"}: ${squash(f.text)}`, consequence: "What changes the work has to be stated in the document, once and unambiguously, or a run cannot do what the owner signed." });
    }
  }
  // An extension line that changes the work (§20.1 test 1, §20.3).
  const required = new Set(d.carries.filter((c) => c.required).map((c) => c.name));
  for (const e of d.extensions) {
    e.lines.forEach((raw, i) => {
      const l = squash(raw);
      if (!l) return;
      const line = e.line + i + 1;
      const key = /^([a-z0-9][a-z0-9-]*):/.exec(l)?.[1] ?? null;
      if (/start-form/.test(e.name) && key && required.has(key) && /\bleft-out\b/.test(l)) {
        findings.push({ rule: "four-tests", line, weight: 1, claim: `It fails §20.1 test 1 (what a run is handed): the extension ${e.name} marks ${key} left-out, and the trigger requires ${key}.`, consequence: "A form that does not ask for a required item starts runs the trigger refuses, or fills it with something nobody handed the run; whether an item is required is said only by its carries: line." });
        return;
      }
      if (key && phases.has(key) && CHANGES_WORK.test(l.slice(key.length + 1))) {
        findings.push({ rule: "four-tests", line, weight: 1, claim: `It fails §20.1 test 1: the extension ${e.name} says "${l}", which changes the work at ${key}, so it is not an extension's to say.`, consequence: "A runtime that does not know the extension runs a different process from one that does (§20.3); who signs, in what order and at what level belongs in the document, where the owner signs it." });
      }
    });
  }
  for (const f of r.failures) findings.push({ rule: "conformance", line: Number(/line (\d+)/.exec(f.text)?.[1] ?? 0), weight: 4, claim: `${f.section} ${squash(f.text)}`, consequence: "A document that does not conform cannot be relied on to run the same way on every runtime (§17.1)." });

  findings.sort((a, b) => a.weight - b.weight || a.line - b.line);
  return {
    document: { id: d.id, version: d.version, name: d.name },
    digest: r.digest,
    text_digest: r.text_digest,
    conforms: r.conforms,
    findings: findings.map(({ weight: _w, ...f }) => f),
    signs,
    acts,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv.slice(2).find((a) => !a.startsWith("--"));
  if (!file) { console.error("usage: node process-rules.mjs <document> [--json]"); process.exit(2); }
  let text;
  try { text = readFileSync(file, "utf8"); } catch (e) { console.error(`could not read ${file}: ${e.message}`); process.exit(2); }
  const r = reviewProcess(text);
  if (process.argv.includes("--json")) console.log(JSON.stringify(r, null, 2));
  else {
    console.log(`${r.document.id} ${r.document.version} (${r.digest}): ${r.findings.length} finding${r.findings.length === 1 ? "" : "s"}`);
    for (const f of r.findings) console.log(`  [${f.rule}] line ${f.line}${f.phase ? ` ${f.phase}` : ""}: ${f.claim}`);
  }
  process.exit(r.findings.length ? 1 : 0);
}
