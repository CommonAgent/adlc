// The plan job: read the request, ask the model once (twice at most), check
// the plan in code, write it.
//
// The program is in control. The one model call drafts the steps; check.mjs
// makes sure no step names an agent and every step says what it takes and
// hands back (0.3.0: the catalog agent answers each step at Source, so this
// job reads no catalog and no descriptor). Every run, whether it plans,
// refuses or fails, writes calls.json, checks.json and went-without.json into
// the records folder. A plan is written to out/plan.json and listed in
// pieces.json only when there is one; a plan the model refused is still a
// plan (refused set, no steps). It reaches only the model service, and writes
// only inside the job, records and work folders it was given. The world is
// the fetch handed to makePlan.
//
//   needs: node >= 22
//   TEXT_API_KEY=<key> [TEXT_MODEL=<model>] [NEW_AGENT_USD=1.50] \
//     node plan.mjs --job <job folder> --records <records folder> --work <work folder> \
//       --text-file <message file> [--file <path>::<media type>]...
//   exit 0 a plan was written, 2 arguments missing, 3 nothing to plan (the reply says why)
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { readRequest } from "./request.mjs";
import { DEFAULT_MODEL, askModel, buildPrompt, modelSummary } from "./ask.mjs";
import { checkPlan, NEW_AGENT_USD_DEFAULT } from "./check.mjs";
import { plan as piecesPlan, fill } from "./pieces.mjs";
import { note, sentence } from "./went-without.mjs";

export const REPLY_MAX = 3400;
const FILE_MAX_BYTES = 2 * 1024 * 1024;

const clip = (s, n) => (String(s).length > n ? `${String(s).slice(0, Math.max(0, n - 3)).trimEnd()}...` : String(s)); // cut-ok: reply and record text fitted to its room; the plan file is whole
const one = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

/** The arguments the command line names. */
export function parseArgs(argv = []) {
  const a = { files: [] };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === "--job") a.job = v;
    else if (k === "--records") a.records = v;
    else if (k === "--work") a.work = v;
    else if (k === "--text-file") a.textFile = v;
    else if (k === "--file") a.files.push(v);
    else continue;
    i++;
  }
  return a;
}

function readText(path) {
  try {
    if (!path || !existsSync(path) || statSync(path).size > FILE_MAX_BYTES) return "";
    return readFileSync(path, "utf8");
  } catch { return ""; }
}

/** Files as { name, text }, where the text is read only when it is asked for,
 *  so a stopped job never opens them. */
function filesOf(specs) {
  return specs.map((spec) => {
    const at = String(spec).lastIndexOf("::");
    const path = at > 0 ? String(spec).slice(0, at) : String(spec); // cut-ok: a split at a position, not a length
    return { name: basename(path), get text() { return readText(path); } };
  });
}

function stepLine(s, i, titleMax) {
  const names = (xs) => (xs.length ? xs.map((x) => x.name).join(", ") : "nothing");
  const needs = s.needs ? ` (takes ${names(s.needs.takes)}, hands back ${names(s.needs.gives)})` : "";
  return `${i + 1}. ${clip(one(s.title), titleMax)}${needs}`;
}

/** The reply for a written plan: the title, what the job went without, each
 *  step with what it takes and hands back, and the figures, always under
 *  3500 characters. */
export function replyFor(plan, paragraph = "") {
  if (plan.refused) return `I cannot plan this: ${one(plan.refused)}`;
  const head = [one(plan.title), paragraph ? clip(paragraph, 800) : "", plan.summary ? one(plan.summary) : ""].filter(Boolean).join("\n");
  const e = plan.estimate;
  const tail = [
    `Estimate: $${e.per_run_usd} and about ${e.run_minutes} minutes per run. The catalog answers each step next, and what has to be built is counted then, at $${e.new_agent_usd} a new agent.`,
    plan.cannot.length ? `It cannot: ${clip(plan.cannot.map(one).join(" "), 300)}` : "",
    plan.missing.length ? `Missing: ${clip(plan.missing.map(one).join(" "), 500)}` : "",
  ].filter(Boolean).join("\n");
  const room = REPLY_MAX - head.length - tail.length - 4;
  const lines = (titleMax) => plan.steps.map((s, i) => stepLine(s, i, titleMax));
  let body = lines(400).join("\n");
  if (body.length > room) body = lines(60).join("\n");
  if (body.length > room) {
    const all = lines(60);
    const shown = [];
    let used = 60;
    for (const l of all) {
      if (used + l.length + 1 > room) break;
      shown.push(l);
      used += l.length + 1;
    }
    body = `${shown.join("\n")}\n... and ${all.length - shown.length} more steps, in plan.json.`;
  }
  return [head, body, tail].filter(Boolean).join("\n");
}

/** Plan a described piece of work. { code, reply } out; code 0 a plan was
 *  written, 3 nothing was planned, 2 the arguments are missing. */
export async function makePlan({ env = process.env, argv = process.argv.slice(2), fetchImpl = fetch } = {}) {
  const args = parseArgs(argv);
  if (!args.job || !args.records) {
    return { code: 2, reply: "--job and --records are required (with --work, --text-file and any --file <path>::<media type>): node plan.mjs --job <job folder> --records <records folder> --work <work folder> --text-file <message file>" };
  }
  mkdirSync(args.records, { recursive: true });

  const seen = { calls: [], changes: { unnamed: [], kinds: [], dropped: [] }, notes: [] };
  const newAgentUsd = env.NEW_AGENT_USD !== undefined && String(env.NEW_AGENT_USD).trim() !== "" && Number.isFinite(Number(env.NEW_AGENT_USD)) && Number(env.NEW_AGENT_USD) >= 0
    ? Number(env.NEW_AGENT_USD) : NEW_AGENT_USD_DEFAULT;

  const json = (name, body) => writeFileSync(join(args.records, name), `${JSON.stringify(body, null, 2)}\n`);
  const writeRecords = () => {
    json("calls.json", { model_calls: "v1", calls: seen.calls });
    json("checks.json", { checks: "v2", unnamed: seen.changes.unnamed, kinds: seen.changes.kinds, dropped: seen.changes.dropped });
    rmSync(join(args.records, "went-without.json"), { force: true });
    if (seen.notes.length) for (const n of seen.notes) note(args.records, n);
    else writeFileSync(join(args.records, "went-without.json"), `${JSON.stringify({ went_without: "v1", entries: [] }, null, 2)}\n`);
  };
  const stop = (code, reply) => { writeRecords(); return { code, reply }; };

  try {
    const request = readRequest({ text: readText(args.textFile), files: filesOf(args.files) });
    if (!request.ok) return stop(3, request.reply);

    // No TEXT_MODEL means the default, Claude Sonnet on Vertex AI.
    const model = String(env.TEXT_MODEL ?? "").trim() || DEFAULT_MODEL;
    const key = String(env.TEXT_API_KEY ?? "").trim();
    if (!key) {
      seen.notes.push({ wanted: "a model to draft the plan", did: "stopped without a plan", why: "TEXT_API_KEY is not set" });
      return stop(3, "I cannot plan this now: the model is not set up (TEXT_API_KEY is empty), so no plan was made.");
    }

    const prompt = buildPrompt({ description: request.description, earlier: request.earlier, change: request.change });
    const asked = await askModel({ prompt, model, key, fetchImpl });
    seen.calls = asked.calls;
    asked.tries.forEach((t, i) => {
      const last = asked.failed && i === asked.tries.length - 1;
      seen.notes.push({
        wanted: `a usable plan from the model on try ${t.try}`,
        did: last ? "stopped and wrote no plan" : "asked again once with the problems appended",
        why: clip(t.problems.join("; "), 240),
      });
    });
    if (asked.failed) {
      return stop(3, `I cannot make a plan: the model did not give a usable answer on either try (${clip(asked.problems.join("; "), 200)}), so there is no plan.`);
    }

    const checked = checkPlan({ draft: asked.plan, newAgentUsd });
    seen.changes = checked.changes;
    for (const u of checked.changes.unnamed) {
      seen.notes.push({
        wanted: `step ${u.step} (${u.title}) with no agent named, as the model was told`,
        did: `removed ${[u.agent, u.offering].filter(Boolean).join(" and its offering ")} from it and left the step for the catalog to answer`, why: u.why,
      });
    }
    for (const k of checked.changes.kinds) {
      seen.notes.push({ wanted: `a kind from the list for ${k.name} in step ${k.step}`, did: "read it as text", why: k.why });
    }
    for (const d of checked.changes.dropped) {
      seen.notes.push({ wanted: `the input ${d.input} of step ${d.step}, wired from ${d.from || "nowhere"}`, did: "left it unwired and listed it in missing", why: d.why });
    }

    const plan = { ...checked.plan, model: modelSummary(seen.calls) };
    fill(args.job, piecesPlan({ plan }));
    writeRecords();
    const paragraph = sentence(seen.notes.map((n) => ({ ...n })));
    return { code: 0, reply: replyFor(plan, paragraph), plan };
  } catch (e) {
    try { writeRecords(); } catch { /* the error below is the one to report */ }
    throw e;
  }
}

const thisFile = process.argv[1] ? process.argv[1].replace(/\\/g, "/").split("/").pop() : "";
if (thisFile && import.meta.url.endsWith(thisFile)) {
  try {
    const out = await makePlan({ env: process.env, argv: process.argv.slice(2) });
    if (out.code === 2) {
      console.error(`refused: ${out.reply}`);
      process.exit(2);
    }
    console.log(JSON.stringify({ reply: out.reply }));
    process.exit(out.code);
  } catch (e) {
    console.error(`failed: ${e?.message ?? e}`);
    process.exit(1);
  }
}
