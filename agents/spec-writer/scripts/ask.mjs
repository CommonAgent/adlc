// The reply: what was drafted, what is still open, and what nobody checked.
//
// The draft always goes, even when it is not finished. A spec missing its name
// is still most of the work and reading it is what lets somebody answer the
// question about the name, so holding it back to ask first costs a round trip
// and gives nothing. What must never happen is the other thing: a draft that
// arrives looking complete when three of its parts were invented.
//
// The questions go near the top, under one line saying what was drafted,
// because they are the only part the reader has to act on. They are asked
// together rather than one per message: they are independent of each other,
// none of them blocks a run, and three messages a day apart to settle a name,
// a price and an access grant is a week spent on a form.
//
//   needs: node >= 22
//   DRAFT=<draft.json> BLANKS=<blanks.json> [BUILDS=<builds.json>]
//   [RECORDS=<records folder>] node ask.mjs
import { existsSync, readFileSync } from "node:fs";
import { NEEDS } from "./asked.mjs";
import { paragraph } from "./went-without.mjs";

const trim = (s) => String(s ?? "").trim();

/** The order questions are asked in: the agent's identity, then the authority
 *  it would hold, then the money. NEEDS already carries that order, so it is
 *  taken from there rather than restated and left to drift. */
export const ASK_ORDER = NEEDS.filter((n) => n.settled_by === "the person").map((n) => n.key);

/** The open questions, in that order, each in the words the checklist wrote
 *  for it. A blank the model reported with its own better question keeps that
 *  question; a blank with no question at all gets the standing one. */
export function questionsFor(blanks = []) {
  const byKey = new Map((blanks ?? []).filter((b) => b && trim(b.key)).map((b) => [trim(b.key), b]));
  const ordered = [
    ...ASK_ORDER.filter((k) => byKey.has(k)),
    ...[...byKey.keys()].filter((k) => !ASK_ORDER.includes(k)),
  ];
  return ordered.map((key) => {
    const need = NEEDS.find((n) => n.key === key);
    return { key, question: trim(byKey.get(key).question) || trim(need?.ask) || `What should ${trim(need?.what) || key} be?` };
  });
}

const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
// Written out, because a reply that opens "3 things are still open" reads
// like a form and this is a sentence somebody has to act on.
const many = (n, one, more) => `${WORDS[n] ?? n} ${n === 1 ? one : more ?? `${one}s`}`;
// A counted phrase that opens a sentence still opens it with a capital.
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** One line saying what the draft is, for somebody who has not opened it. */
export function draftLine(spec) {
  const jobs = Array.isArray(spec?.jobs) ? spec.jobs : [];
  const offered = jobs.filter((j) => j?.offered);
  const named = trim(spec?.name);
  const what = trim(offered[0]?.title) || trim(offered[0]?.slug) || "one job";
  const steps = jobs.length - offered.length;
  const inSteps = steps > 0 ? `, in ${many(steps, "step")}` : "";
  return named
    ? `The draft is ${named}, which offers ${what}${inSteps}.`
    : `The draft offers ${what}${inSteps}, and has no name yet.`;
}

/** The whole reply.
 *
 *  Order is deliberate: what it is, then what somebody has to do about it,
 *  then what was checked, then the caveats. A reader who stops after two
 *  sentences has still read the part that needs them. */
export function replyText({
  spec = null, blanks = [], notes = "", verdict = "", findings = [], wentWithout = "", answered = [],
} = {}) {
  const lines = [draftLine(spec)];
  const questions = questionsFor(blanks);

  if (questions.length) {
    const one = questions.length === 1;
    lines.push(
      `${one ? "One thing is still open" : `${cap(many(questions.length, "thing"))} are still open`}, `
      + `and I have not guessed at ${one ? "it" : "any of them"}: a name becomes a handle somebody is stuck with, `
      + "a price is your money, and access to a system is authority nobody can grant for you.");
    // On their own lines. Three questions run together in a paragraph is a
    // paragraph somebody answers one of.
    lines.push(questions.map((q) => `\n${q.key}: ${q.question}`).join("") + "\n");
    // Never "it will not build until these are settled". Some blanks stop the
    // builder and some do not, and the builder's own verdict is in this same
    // reply: a sentence claiming it will not build, three sentences above one
    // saying the builder took it, is the kind of contradiction that makes a
    // reader stop believing the rest.
    lines.push(`Answer in your own words and send it back. The draft is in the job folder in the meantime, and it is not finished until ${one ? "this is" : "these are"} settled.`);
  } else {
    lines.push("Nothing is left open. Everything the spec needs is settled.");
  }

  if (answered.length) {
    lines.push(`${cap(many(answered.length, "answer"))} from your last message went in: ${answered.join(", ")}.`);
  }
  if (trim(verdict)) lines.push(trim(verdict));
  if (findings.length) {
    lines.push(`The draft was written twice and ${findings.length === 1 ? "this still stands" : "these still stand"}: ${findings.join("; ")}. `
      + "It is delivered as it is, so you can see it and say what to fix.");
  }
  if (trim(notes)) {
    const said = trim(notes);
    lines.push(`Drafted rather than settled by what you asked for, so read this part hardest: ${said}${/[.!?]$/.test(said) ? "" : "."}`);
  }
  if (trim(wentWithout)) lines.push(trim(wentWithout));
  return lines.join(" ");
}

/** What a finished round leaves for the next one: the keys still open, so a
 *  later message can be matched to the question it answers. */
export function stillOpen(blanks = []) {
  return questionsFor(blanks).map((q) => q.key);
}

const thisFile = process.argv[1] ? process.argv[1].replace(/\\/g, "/").split("/").pop() : "";
if (thisFile && import.meta.url.endsWith(thisFile)) {
  const { DRAFT, BLANKS, BUILDS, RECORDS, ANSWERS } = process.env;
  if (!DRAFT || !BLANKS) { console.error("DRAFT and BLANKS are required"); process.exit(2); }
  const readJson = (p) => (p && existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null);
  try {
    const spec = readJson(DRAFT);
    const blanksDoc = readJson(BLANKS) ?? { blanks: [] };
    const buildsDoc = readJson(BUILDS);
    const answers = readJson(ANSWERS) ?? {};
    const reply = replyText({
      spec,
      blanks: blanksDoc.blanks ?? [],
      notes: blanksDoc.notes ?? "",
      verdict: buildsDoc ? buildsDoc.verdict ?? "" : "",
      findings: buildsDoc?.problems ?? [],
      answered: Object.keys(answers),
      wentWithout: RECORDS ? paragraph(RECORDS) : "",
    });
    console.log(JSON.stringify({ ok: true, code: 0, reply, still_open: stillOpen(blanksDoc.blanks ?? []) }));
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
