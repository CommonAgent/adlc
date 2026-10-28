// Document a package: one command, four steps, no model.
//   needs: node >= 22
//   node document.mjs --job <job folder> --records <records folder>
//        [--work <work folder>] [--text-file <message>] [--file <path>[::<media type>]]...
//
// This is the command the runtime requirements start (run.document-a-package).
// The files attached to the message are what it documents from: the agent
// descriptor, the runtime requirements, the AgentDoc, verdicts and records,
// each told apart by what is in it (given.mjs). The message's words are not
// read for anything: what the documentation says comes from the files alone.
//
//   1. read what was given      sort and digest the files      (given.mjs)
//   2. write the documentation  a template per line, marked    (write-docs.mjs)
//   3. check every line         re-derive each line, coverage  (check-docs.mjs)
//   4. hand it over             pieces.json and the reply      (pieces.mjs)
//
// It reaches no network, changes none of the files it was given, and delivers
// nothing that failed its check.
//
// It prints one JSON object with a `reply` field. Exit codes: 0 delivered;
// 2 usage; 3 the job stops and the reply says why, which the harness sends as
// it stands; 1 failed.
import { mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { KIND_WORDS, gather, inventoryOf, sortGiven } from "./given.mjs";
import { writeDocs } from "./write-docs.mjs";
import { checkDocs } from "./check-docs.mjs";
import { fill, plan } from "./pieces.mjs";
import { note, read as wentWithout, sentence } from "./went-without.mjs";

const trim = (s) => String(s ?? "").trim();
const many = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function fromArgv(args = []) {
  const parsed = { files: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--job") parsed.job = args[++i];
    else if (a === "--records") parsed.records = args[++i];
    else if (a === "--work") parsed.work = args[++i];
    else if (a === "--text-file") parsed.textFile = args[++i];
    else if (a === "--file") {
      const v = String(args[++i] ?? "");
      const at = v.lastIndexOf("::");
      parsed.files.push(at === -1 ? v : v.slice(0, at));
    }
  }
  return parsed;
}

export const HOW_TO_ASK = "Attach the agent's agent-descriptor.json or its AgentDoc (agentdoc.json), and with it, if you have them, its agent-runtime-requirements.json, the verdicts other roles signed about it, and the records it left. Each file is told apart by what is in it.";

/** What this job went without, as notes. */
function noteAbsences(records, { sources, leftOut, unreadable }) {
  const has = (k) => sources.some((s) => s.kind === k);
  if (!has("descriptor")) note(records, { wanted: "the agent descriptor", did: "documented what the agent offers from the AgentDoc's copy of the descriptor's words" });
  if (!has("agentdoc")) note(records, { wanted: "the AgentDoc", did: "left its identity and where to send it work out, and said so under Not documented" });
  if (!has("runtime")) note(records, { wanted: "the runtime requirements", did: "left its price and how long a job may run out, and said so under Not documented" });
  if (!has("verdict")) note(records, { wanted: "a verdict", did: "said nothing about whether it passed a conformance check, and said so under Not documented" });
  if (!has("record")) note(records, { wanted: "records", did: "gave no example of any job, and said so under Not documented" });
  for (const u of unreadable) note(records, { wanted: u.file, did: "documented from the files that could be read", why: u.why });
  for (const l of leftOut) note(records, { wanted: `the use of ${l.file}`, did: "documented from the first one given", why: l.why });
}

export async function runJob(argv = [], { now } = {}) {
  const args = fromArgv(argv);
  if (!args.job || !args.records) return { ok: false, code: 2, reply: "This job needs --job <job folder> and --records <records folder>." };
  const id = basename(args.job);
  const RECORDS = join(args.records, id);
  mkdirSync(RECORDS, { recursive: true });
  for (const f of ["went-without.json", "given.json", "documentation.md", "check.json"]) rmSync(join(RECORDS, f), { force: true });

  // 1. Read what was given.
  const { files, unreadable } = gather(args.files);
  const { sources, leftOut } = sortGiven(files);
  writeFileSync(join(RECORDS, "given.json"), JSON.stringify(inventoryOf({ sources, leftOut, unreadable }), null, 2) + "\n");
  if (!sources.some((s) => s.kind === "descriptor" || s.kind === "agentdoc")) {
    const got = sources.length ? ` I was given ${many(sources.length, "file")} and none of them is either.` : " Nothing was attached.";
    return { ok: false, code: 3, reply: `To document an agent I need its agent descriptor or its AgentDoc.${got} ${HOW_TO_ASK}` };
  }
  noteAbsences(RECORDS, { sources, leftOut, unreadable });

  // 2. Write the documentation.
  const { markdown, silences } = writeDocs({ sources, leftOut, unreadable, now: now ?? new Date().toISOString() });
  const docPath = join(RECORDS, "documentation.md");
  writeFileSync(docPath, markdown);

  // 3. Check every line.
  const check = checkDocs({ markdown, sources, leftOut, unreadable });
  const tracePath = join(RECORDS, "check.json");
  writeFileSync(tracePath, JSON.stringify({ trace: "v1", ok: check.ok, findings: check.findings, lines: check.trace }, null, 2) + "\n");
  if (!check.ok) {
    const first = check.findings.slice(0, 5).map((f) => (f.line ? `line ${f.line}: ${f.why}` : f.why)).join("; ");
    return {
      ok: false, code: 3, findings: check.findings,
      reply: `The documentation did not pass its own check, so it is not delivered: ${many(check.findings.length, "finding")} (${first}). Nothing was changed to make it pass; the draft and the findings are kept in this job's records.`,
    };
  }

  // 4. Hand it over.
  const listed = fill(args.job, plan({ docPath, tracePath })).map((e) => e.name);
  const doc = sources.find((s) => s.kind === "agentdoc");
  const desc = sources.find((s) => s.kind === "descriptor");
  const who = trim(doc?.json?.subject?.handle) || "the agent";
  const version = desc?.json?.agent_version ?? (doc?.json?.sources ?? []).find((s) => s.id === "descriptor")?.agent_version;
  const kinds = sources.map((s) => KIND_WORDS[s.kind]).filter((v, i, a) => a.indexOf(v) === i);
  const went = sentence(wentWithout(RECORDS));
  const reply = [
    went,
    `I wrote the documentation for ${who}${version ? ` ${version}` : ""} from ${many(sources.length, "source")} (${kinds.join(", ")}).`,
    `Each of its ${check.trace.length} lines that says something names the place it came from, and each was checked against that place before it was delivered.`,
    silences ? `${many(silences, "thing")} the sources are silent on or did not include ${silences === 1 ? "is" : "are"} listed under Not documented.` : "The sources left nothing it covers unsaid.",
    "The trace beside it names the source and the template of every line.",
  ].filter(Boolean).join(" ");
  return { ok: true, code: 0, reply, lines: check.trace.length, silences, sources: sources.map((s) => ({ id: s.id, file: s.name, kind: s.kind })), went_without: wentWithout(RECORDS), listed };
}

const startedAsCommand = () => {
  try { return Boolean(process.argv[1]) && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; }
};

if (startedAsCommand()) {
  const out = await runJob(process.argv.slice(2)).catch((e) => ({
    ok: false, code: 1, reply: `No documentation was written, and this is what stopped it: ${trim(e?.message ?? e)}`,
  }));
  console.log(JSON.stringify(out, null, 2));
  process.exitCode = out.code ?? 0;
}

