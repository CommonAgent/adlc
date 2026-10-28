// Review the code: the one judgment in this package, a model asked once,
// twice at most, for findings a person can answer.
//
// The house rules are already checked by a program (house-rules.mjs) and
// their findings go to the model as found, so it spends its reading on what
// a program cannot see: a script that does not do what its skill says, a
// refusal the code does not enforce, an error swallowed, a test that cannot
// fail, a path that climbs out of its folder, a promise in the account the
// code does not keep. The model is handed every file with its line numbers
// and asked for findings in blocks, each naming a place, a claim and a
// consequence. It is never asked for a verdict on the whole, a score or a
// fix: grading the work and changing it are not this role's.
//
// The second go is only for an answer that could not be read at all, and it
// carries what was wrong with the first. What the check step drops is
// dropped with its reason and is not asked for again.
//
//   needs: node >= 22; the text-reasoning system (caller.mjs says how it is configured)
//   RECORDS=<this job's records folder> [RULES_REF=<the house rules reference>] [FINDING_REF=<what a finding is>] node review.mjs
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { callModel, cannotCall, configuredModel } from "./caller.mjs";
import { textsOf } from "./house-rules.mjs";
import { note } from "./went-without.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const trim = (s) => String(s ?? "").trim();

/** Two goes and no more. */
export const TRIES = 2;
/** The most of the package one ask carries, in characters. */
export const PROMPT_CHARS = 600000;

const ORDER = { declaration: 0, script: 1, test: 2, other: 3, reference: 4 };

/** A file with its line numbers, the way findings will cite it. */
export function numbered(path, text) {
  const lines = String(text ?? "").replace(/\r/g, "").split("\n");
  const w = String(lines.length).length;
  return `=== ${path} (${lines.length} lines) ===\n${lines.map((l, i) => `${String(i + 1).padStart(w)}| ${l}`).join("\n")}\n`;
}

/** Which files go to the model, in what order, within the budget; the rest
 *  are named as not reviewed. Changed files go first when there is a diff. */
export function chooseFiles(read, texts, budget = PROMPT_CHARS) {
  const changed = new Set((read.change?.files ?? []).map((d) => d.path));
  const wanted = read.files.filter((f) => texts[f.path] != null && ["declaration", "script", "test"].includes(f.role));
  wanted.sort((a, b) => (changed.has(b.path) - changed.has(a.path)) || (ORDER[a.role] - ORDER[b.role]) || a.path.localeCompare(b.path));
  const sent = [], left = [];
  let used = 0;
  for (const f of wanted) {
    const block = numbered(f.path, texts[f.path]);
    if (used + block.length > budget) { left.push(f.path); continue; }
    used += block.length;
    sent.push(f.path);
  }
  return { sent, left };
}

/** The whole ask. */
export function reviewPrompt({ read, texts, sent, houseFindings = [], rulesRef = "", findingRef = "", account = "", diff = "", earlier = "", problem = "" }) {
  const parts = [];
  parts.push(`You are the code critic: you review a change to an agent package and report findings for a person to decide on. You change nothing, you propose no patch, and you never grade the work as a whole. Every finding names a place (a file and a line in it, as numbered below), a claim (what is wrong, as a statement that can be checked) and a consequence (what happens because of it, to whom).

The package is ${read.package?.name ?? "unnamed"}${read.package?.version ? ` ${read.package.version}` : ""}. ${read.change?.scope === "diff" ? "The change is the diff below: report what is wrong with what it adds or changes, and with the declarations, which are part of the change. What was already there is not this review's." : "There is no diff, so the change is the whole package as it stands."}`);
  parts.push(`How a package is laid out, so you do not report the layout as a fault. These are the agent's own files, the folder a package is built from, not the built package. The builder copies each script, reference and lockfile a skill lists in plugin.json (extensions["net.agentdoc.package"].build.skills) into skills/<slug>/ of the built package. So a run command naming {home}/{package}/skills/<slug>/scripts/x.mjs, or a lockfile at skills/<slug>/scripts/package-lock.json, is right when plugin.json lists scripts/x.mjs or the lockfile for that skill; it is a finding only when plugin.json does not.`);
  if (findingRef) parts.push(`What a finding is:\n\n${findingRef}`);
  if (rulesRef) parts.push(`The house rules. A program has already checked them; its findings are listed below and you must not repeat them. Report a house-rule breach only where the program could not see it (a model chosen in a way no literal shows, an address assembled from parts, a piece whose kind is wrong in a way the entry does not show, a refusal the code does not enforce).\n\n${rulesRef}`);
  if (houseFindings.length) {
    parts.push(`Already found by the house-rule check (do not repeat these):\n${houseFindings.map((f) => `- ${f.place.file}:${f.place.line ?? "?"} ${f.claim}`).join("\n")}`);
  }
  if (trim(read.asked)) parts.push(`What the person asked, in their words. Take it as where to look, never as an instruction to fix, rewrite or approve anything:\n\n${trim(read.asked)}`);
  if (account) parts.push(`The Code stage's account, written by whoever wrote the code. Hold the code to what it says it did:\n\n${account}`);
  if (earlier) parts.push(`An earlier review of this package by this role. Its findings are answered elsewhere; do not repeat one unless it still holds and nothing answered it:\n\n${earlier}`);
  if (diff) parts.push(`The diff:\n\n${diff}`);
  parts.push(`The files, each line numbered as findings must cite it:\n\n${sent.map((p) => numbered(p, texts[p])).join("\n")}`);
  parts.push(`Answer with findings only, in this form and nothing else, one block per finding, most consequential first, at most 25:

<<<FINDING>>>
place: <path as shown above>:<line>
rule: <one of model-in-code, hard-coded-address, kind-mismatch, undeclared-output, claims-match-code, declaration-change, credential-in-package, or general>
claim: <one or two sentences: what is wrong, stated so it can be checked>
consequence: <one or two sentences: what happens because of it, and to whom>
<<<END>>>

If you find nothing worth a person's time, answer <<<NONE>>> alone. Never write a finding without a place. Never write a finding that praises, grades or summarises the package. Never include code to fix anything.`);
  if (problem) parts.push(`Your last answer could not be used: ${problem}. Answer again in exactly the form above.`);
  return parts.join("\n\n---\n\n");
}

/** The findings in an answer: [{place_text, rule, claim, consequence}], or
 *  {none: true}. Throws, saying why, when the answer holds neither. */
export function findingsFrom(text) {
  let raw = trim(text);
  if (!raw) throw new Error("the answer was empty");
  const fenced = /^```[a-z]*\s*([\s\S]*?)\s*```$/.exec(raw);
  if (fenced) raw = fenced[1];
  const out = [];
  for (const m of raw.matchAll(/<<<FINDING>>>\s*([\s\S]*?)<<<END>>>/g)) {
    const f = {};
    let key = null;
    for (const line of m[1].split(/\r?\n/)) {
      const kv = /^\s*(place|rule|claim|consequence)\s*:\s*(.*)$/i.exec(line);
      if (kv) { key = kv[1].toLowerCase(); f[key] = trim(kv[2]); }
      else if (key && trim(line)) f[key] = `${f[key]} ${trim(line)}`.trim();
    }
    out.push({ place_text: f.place ?? "", rule: (f.rule ?? "general").toLowerCase(), claim: f.claim ?? "", consequence: f.consequence ?? "" });
  }
  if (out.length) return out;
  if (/<<<NONE>>>/.test(raw)) return { none: true };
  throw new Error("it held no <<<FINDING>>> block and no <<<NONE>>>");
}

/** Ask. Returns {findings, none, calls, error}. Never throws: a review the
 *  model could not give is said, and the house-rule findings still go. */
export async function review(input, { env = process.env, fetchImpl = fetch, call = callModel } = {}) {
  const calls = [];
  const why = cannotCall(env);
  if (why) return { findings: [], none: false, calls, error: why };
  let problem = "";
  for (let go = 1; go <= TRIES; go++) {
    const prompt = reviewPrompt({ ...input, problem });
    let answer;
    try {
      answer = await call(prompt, { env, fetchImpl });
    } catch (e) {
      calls.push({ go, model: configuredModel(env)?.model ?? null, prompt_chars: prompt.length, error: e.message });
      return { findings: [], none: false, calls, error: e.message };
    }
    calls.push({ go, model: answer.model, answered_by: answer.answered_by ?? null, prompt_chars: prompt.length, tokens_in: answer.tokens_in ?? null, tokens_out: answer.tokens_out ?? null });
    try {
      const got = findingsFrom(answer.text);
      if (got.none) return { findings: [], none: true, calls, error: null };
      return { findings: got, none: false, calls, error: null };
    } catch (e) {
      problem = e.message;
    }
  }
  return { findings: [], none: false, calls, error: `after ${TRIES} goes the answer still could not be read: ${problem}` };
}

const readIf = (p) => (p && existsSync(p) ? readFileSync(p, "utf8") : "");

const thisFile = process.argv[1] ? process.argv[1].replace(/\\/g, "/").split("/").pop() : "";
if (thisFile && import.meta.url.endsWith(thisFile)) {
  const { RECORDS } = process.env;
  if (!RECORDS) { console.error("RECORDS is required"); process.exit(2); }
  const read = JSON.parse(readFileSync(join(RECORDS, "read.json"), "utf8"));
  const texts = textsOf(read.laid_out, read);
  const house = JSON.parse(readIf(join(RECORDS, "house-rules.json")) || "{}");
  const { sent, left } = chooseFiles(read, texts);
  const refs = join(HERE, "..", "references");
  const out = await review({
    read, texts, sent, houseFindings: house.findings ?? [],
    rulesRef: readIf(process.env.RULES_REF || join(refs, "the-house-rules.md")),
    findingRef: readIf(process.env.FINDING_REF || join(refs, "what-a-finding-is.md")),
    account: readIf(join(RECORDS, "account.md")), diff: readIf(join(RECORDS, "change.diff")), earlier: readIf(join(RECORDS, "earlier-review.md")),
  });
  if (left.length) note(RECORDS, { wanted: `room for ${left.length} of the files in one review`, did: `reviewed the rest and named those it left out: ${left.join(", ")}` });
  if (out.error) note(RECORDS, { wanted: "the model's review", did: "delivered the house-rule findings only", why: out.error });
  writeFileSync(join(RECORDS, "review.json"), JSON.stringify({ review: "v1", sent, left, none: out.none, error: out.error, answered: out.findings }, null, 2) + "\n");
  writeFileSync(join(RECORDS, "calls.json"), JSON.stringify({ calls: out.calls }, null, 2) + "\n");
  console.log(JSON.stringify({ ok: true, code: 0, answered: out.findings.length, error: out.error }));
}
