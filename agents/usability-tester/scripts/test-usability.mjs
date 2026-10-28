// Test whether a person can use an agent: one command, five steps, no model.
//   needs: node >= 22
//   node test-usability.mjs --job <job folder> --records <records folder>
//        --work <work folder> --text-file <message> [--file <path>[::<media type>]]...
//
// This is the command the runtime requirements start (run.test-usability).
// The steps, in order:
//   read-the-request      read-request.mjs: the agent, the offering, the
//                         change, a person's judgment, attached examples and
//                         files; platform.mjs: the agent's Descriptor
//   check-the-descriptor  descriptor-checks.mjs: what a page can draw from it
//   run-the-examples      form.mjs, trial.mjs, readable.mjs: each offering a
//                         person starts, filled from its example and run as
//                         the page runs it, and what came back read
//   ask-for-a-change      trial.mjs: one change, and the new version
//   write-the-report      report.mjs, pieces.mjs: the usability report
//
// It changes nothing it tests, approves nothing and pays for nothing: a
// change with a price is not asked. It prints one JSON object with a `reply`
// field. Exit codes: 0 tested; 2 usage; 3 the job stops and the reply says
// what is needed; 1 failed.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fromText, readFiles } from "./read-request.mjs";
import { descriptorChecks, personOfferings } from "./descriptor-checks.mjs";
import { fillForm } from "./form.mjs";
import { platform, fetchPublic } from "./platform.mjs";
import { askForChange, runOffering } from "./trial.mjs";
import { trialFindings, writeReport } from "./report.mjs";
import { fill, plan as piecesPlan } from "./pieces.mjs";
import { changeWords, judgmentOnly, readPrior, withJudgment } from "./revision.mjs";
import { handedSettings, settingsFor } from "./run-config.mjs";
import { note, read as wentWithout, sentence } from "./went-without.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const trim = (s) => String(s ?? "").trim();
const sha = (b) => `sha256:${createHash("sha256").update(b).digest("hex")}`;

/** This agent's own Descriptor: beside the scripts in the repository, or at the package's top. */
export function ownDescriptor() {
  for (const p of [join(HERE, "..", "agent-descriptor.json"), join(HERE, "..", "..", "..", "agent-descriptor.json")]) {
    if (existsSync(p)) return JSON.parse(readFileSync(p, "utf8"));
  }
  throw new Error("agent-descriptor.json is not beside the tester");
}

export const DEFAULT_CHANGE = "Make it a little shorter, and keep everything else as it is.";
export const HOW_TO_ASK = "Name the agent in the message: `agent: <handle>`. Add `offering: <id>` to test one offering, `change: <words>` for the change to ask for, and attach examples (a JSON object from an offering's id to `{inputs, good_result}`) for offerings whose Descriptor declares none. A person who ran the agent may add `understood: yes|no`, `could use: yes|no`, `did the job: yes|no` and `note: <words>`.";

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
      parsed.files.push(at === -1 ? { path: v, declared: "" } : { path: v.slice(0, at), declared: v.slice(at + 2) });
    }
  }
  return parsed;
}

/** Whether an offering takes changes, as the page reads it (app-next run-view.ts takesChanges). */
export const takesChanges = (o) => Boolean(o.revisions) || (Array.isArray(o.steps) && o.steps.length > 0);

/**
 * The test, given what was read. The network is reached only through `p`
 * (platform.mjs) and `fetchFile`.
 */
export async function test({ asked, attached, p, signIn, settings, fetchFile, now = () => new Date(), sleep, pollMs, budgetSeconds = 3600, log, self, clock = Date.now }) {
  const started = clock();
  const deadlineAll = started + Math.max(60, budgetSeconds - 90) * 1000;
  const notChecked = [];
  const sf = await p.storefront(asked.handle);
  const key = trim(sf.data?.agent_id);
  if (!sf.ok || !key) return { stop: `No agent answers to ${asked.handle} on ${p.root}${sf.error ? ` (${sf.error})` : ""}, so there is nothing to test.` };
  const dr = await p.descriptor(key);
  let doc = null;
  try { doc = dr.ok ? JSON.parse(dr.bytes.toString("utf8")) : null; } catch { doc = null; }
  if (!doc) return { stop: `${asked.handle} serves no Descriptor a page could be drawn from (${dr.error ?? "its bytes are not JSON"}), so there is nothing to test.` };
  const door = trim(dr.header?.("x-descriptor-digest"));
  const descriptorDigest = door ? (door.startsWith("sha256:") ? door : `sha256:${door}`) : sha(dr.bytes);
  const checks = descriptorChecks(doc);
  const persons = personOfferings(doc);
  for (const o of (doc.offerings ?? []).filter((x) => !persons.includes(x))) notChecked.push(`${o.name || o.id} (\`${o.id}\`): it is started by other agents only (started_by), so it was not run as a person runs it.`);
  const chosen = asked.offering ? persons.filter((o) => o.id === asked.offering) : persons;
  if (asked.offering && !chosen.length) return { stop: `${asked.handle} has no offering "${asked.offering}" that a person starts; it has ${persons.map((o) => o.id).join(", ") || "none"}.` };
  if (asked.offering) for (const o of persons.filter((x) => !chosen.includes(x))) notChecked.push(`${o.name || o.id} (\`${o.id}\`): the request named another offering.`);

  const needRuns = chosen.some((o) => o.example || attached.examples[o.id]);
  let account = null;
  if (needRuns) {
    account = await signIn();
    if (!account.ok) return { stop: `I cannot run ${asked.handle} as a person: ${account.error}.` };
  }
  const trials = [];
  let packageDigest = null;
  let ranVersion = null;
  for (const o of chosen) {
    const t = { id: o.id, name: trim(o.name) || o.id, example: null, example_from: null, form: null, run: null, change: null };
    if (o.example) { t.example = o.example; t.example_from = "the Descriptor's"; }
    else if (attached.examples[o.id]) { t.example = attached.examples[o.id]; t.example_from = "given with the request (the Descriptor declares none)"; }
    if (t.example) {
      t.form = await fillForm(o, t.example, { nameJob: persons.length > 1, fetchFile, attached: attached.attached });
      if (t.form.ok) {
        const deadline = Math.min(deadlineAll, clock() + settings.wait_minutes * 60_000);
        log?.(`running ${o.id}`);
        t.run = await runOffering(p, { key, o, message: t.form.message, deadline, sleep, pollMs, log, clock });
        if (t.run.agent_version && !ranVersion) ranVersion = t.run.agent_version;
        // The package that made the run binds the report only when it is the version the Descriptor read says.
        if (t.run.package_digest && !packageDigest && (!t.run.agent_version || t.run.agent_version === trim(doc.agent_version))) packageDigest = t.run.package_digest;
        if (t.run.delivers) {
          if (settings.ask_for_a_change !== "yes") t.change = { not: "the run config's ask_for_a_change setting is no" };
          else if (!takesChanges(o)) t.change = { not: "the offering does not say a change can be asked for", declared: false };
          else {
            const deadline2 = Math.min(deadlineAll, clock() + settings.wait_minutes * 60_000);
            log?.(`asking ${o.id} for a change`);
            t.change = await askForChange(p, { key, o, job: t.run.job, change: asked.change || DEFAULT_CHANGE, before: { versions: t.run.version ?? 1, pieces: t.run.pieces }, deadline: deadline2, sleep, pollMs, log, clock });
          }
        }
      }
    }
    const tf = trialFindings(t);
    t.answers = tf.answers;
    t.findings = tf.findings;
    if (t.change?.not && !t.change.declared) notChecked.push(`${t.name} (\`${t.id}\`): no change was asked, because ${t.change.not}.`);
    if (t.change?.price) notChecked.push(`${t.name} (\`${t.id}\`): no change was asked, because a change has a price and the tester never pays (${t.change.price}).`);
    trials.push(t);
  }
  if (!asked.judgment) notChecked.push("A person's judgment: whether they understood it, could use the result and it did the job. A person adds it by asking for a change to this report with `understood:`, `could use:`, `did the job:` and `note:` lines.");
  notChecked.push("Whether the words are clear to a person: the tester reads each piece's form by rules and calls no model, so how well it reads is a person's judgment.");
  if (ranVersion && trim(doc.agent_version) && ranVersion !== trim(doc.agent_version)) notChecked.push(`The run was made by version ${ranVersion}, and the Descriptor read says ${doc.agent_version}; the report names the Descriptor's version.`);
  if (!packageDigest) notChecked.push("The package digest: no run came back with a delivery manifest naming it, so the report is bound to the Descriptor's version and digest only.");
  const report = writeReport({
    handle: asked.handle, name: trim(doc.name), key, version: trim(doc.agent_version) || null,
    package_digest: packageDigest, descriptor_digest: descriptorDigest,
    tested_at: now().toISOString().replace(/\.\d{3}Z$/, "Z"), tested_by: `usability-tester ${self?.agent_version ?? ""}`.trim(),
    checks, trials, judgment: asked.judgment, not_checked: notChecked,
  });
  return { report, trials, checks, key, account, descriptorDigest, packageDigest, doc };
}

export function replyText({ handle, report, trials, account, settings, went, unread = [] }) {
  const L = [];
  L.push(`I tested ${handle} as a person would: ${report.verdict.replace(/_/g, " ")}.`);
  if (trials.length) L.push(`Offerings a person starts: ${trials.map((t) => `${t.id} (form ${t.answers.form}, delivers ${t.answers.delivers}, readable ${t.answers.readable}, change ${t.answers.change})`).join("; ")}.`);
  const d = report.findings.filter((f) => f.label === "descriptor").length;
  const a = report.findings.filter((f) => f.label === "agent").length;
  if (report.findings.length) L.push(`${report.findings.length} finding${report.findings.length === 1 ? "" : "s"}: ${d} in the Descriptor (fixed by design), ${a} in the agent (fixed by code).`);
  if (account?.how) L.push(`It ran as ${account.how}, with ${settings.wait_minutes} minutes for each result${settings.ask_for_a_change === "yes" ? " and one change asked" : " and no change asked"}.`);
  if (unread.length) L.push(`Not read: ${unread.map((u) => `${u.name} (${u.why})`).join("; ")}.`);
  if (went) L.push(went);
  L.push("The usability report is filed with the job.");
  return L.join(" ");
}

/** The job, as the runtime requirements start it. */
export async function runJob(argv = [], env = process.env, { fetchImpl, now = () => new Date(), sleep, pollMs, clock = Date.now } = {}) {
  const args = fromArgv(argv);
  if (!args.job || !args.records) return { ok: false, code: 2, reply: "This job needs --job <job folder> and --records <records folder>." };
  const text = args.textFile && existsSync(args.textFile) ? readFileSync(args.textFile, "utf8") : "";
  const id = basename(args.job);
  const RECORDS = join(args.records, id);
  mkdirSync(RECORDS, { recursive: true });
  rmSync(join(RECORDS, "went-without.json"), { force: true });
  const self = ownDescriptor();
  const decl = Array.isArray(self.run_config?.settings) ? self.run_config.settings : [];
  const s = settingsFor(decl, handedSettings(args.files.map((f) => f.path)));
  if (s.refused) return { ok: false, code: 3, error: { code: "RUN_CONFIG_REFUSED" }, reply: `RUN_CONFIG_REFUSED: ${s.refused}. Nothing was run.` };
  const settings = s.values;

  let asked = fromText(text);
  const prior = readPrior(args.job);
  if (prior?.missing) return { ok: false, code: 3, reply: `I cannot make this change: ${prior.missing}.` };
  let changeNote = "";
  if (prior) {
    if (judgmentOnly(text) && asked.judgment) {
      const out = withJudgment(prior.text, asked.judgment);
      const listed = fill(args.job, piecesPlan({ report: out })).map((e) => e.name);
      writeFileSync(join(RECORDS, "test.json"), `${JSON.stringify({ test: "v1", change_of: prior.header, judgment: asked.judgment }, null, 2)}\n`);
      return { ok: true, code: 0, reply: `I wrote the person's judgment into the usability report for ${prior.header.agent}; every run is as it was, and nothing was run again.`, agent: prior.header.agent, verdict: prior.header.verdict, listed };
    }
    const handle = asked.handle || trim(prior.header.agent).toLowerCase();
    asked = { ...asked, handle };
    const words = changeWords(text);
    if (words && !/\b(again|re-?test|re-?run|retry|once more)\b/i.test(words)) changeNote = `I read the change as a request to test ${handle} again; these words I could not act on otherwise: "${words.slice(0, 200)}".`;
  }
  if (!asked.handle) return { ok: false, code: 3, reply: `I cannot test yet: no agent was named. ${HOW_TO_ASK}` };
  if (!trim(env.MESH_API_BASE)) return { ok: false, code: 3, reply: "I cannot test: this host names no address for the platform (MESH_API_BASE), and the agent is run there." };

  const attached = readFiles(args.files.filter((f) => !/run-context/i.test(basename(f.path))));
  for (const u of attached.unread) note(RECORDS, { wanted: u.name, did: "tested without it", why: u.why });
  const p = platform({ base: env.MESH_API_BASE, fetchImpl, sleep });
  const signIn = () => p.signIn({ session: env.TESTER_SESSION, account: env.TESTER_ACCOUNT, testKey: env.TEST_ACCOUNT_KEY, domain: env.TEST_ACCOUNT_DOMAIN });
  const fetchFile = (url) => fetchPublic(url, { fetchImpl: fetchImpl ?? globalThis.fetch });
  const budgetSeconds = Number(env.WORK_TIMEOUT) > 0 ? Number(env.WORK_TIMEOUT) : 3600;
  const result = await test({ asked, attached, p, signIn, settings, fetchFile, now, sleep, pollMs, budgetSeconds, self, clock, log: (m) => process.stderr.write(`${m}\n`) });
  if (result.stop) return { ok: false, code: 3, reply: result.stop };
  for (const t of result.trials) if (t.example_from?.startsWith("given with the request")) note(RECORDS, { wanted: `an example in ${asked.handle}'s Descriptor for ${t.id}`, did: "ran the example given with the request, and reported the missing one as a finding" });
  const listed = fill(args.job, piecesPlan({ report: result.report.text })).map((e) => e.name);
  writeFileSync(join(RECORDS, "test.json"), `${JSON.stringify({
    test: "v1", agent: asked.handle, key: result.key, descriptor_digest: result.descriptorDigest, package_digest: result.packageDigest,
    verdict: result.report.verdict, settings, account: result.account?.how ?? null,
    trials: result.trials.map((t) => ({ id: t.id, example_from: t.example_from, answers: t.answers, form: t.form && { ok: t.form.ok, problems: t.form.problems, shown: t.form.shown }, run: t.run, change: t.change, findings: t.findings })),
    descriptor_checks: result.checks,
  }, null, 2)}\n`);
  const went = sentence(wentWithout(RECORDS));
  return {
    ok: true, code: 0,
    reply: [replyText({ handle: asked.handle, report: result.report, trials: result.trials, account: result.account, settings, went, unread: attached.unread }), changeNote].filter(Boolean).join(" "),
    agent: asked.handle,
    version: result.report.header.version,
    package_digest: result.packageDigest,
    verdict: result.report.verdict,
    offerings: result.trials.map((t) => ({ id: t.id, ...t.answers })),
    findings: result.report.findings.map((f) => ({ label: f.label, check: f.check, place: f.place, what: f.what, fixed_by: f.fixed_by })),
    settings,
    went_without: wentWithout(RECORDS),
    listed,
  };
}

const startedAsCommand = () => {
  try { return Boolean(process.argv[1]) && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; }
};

if (startedAsCommand()) {
  const out = await runJob(process.argv.slice(2)).catch((e) => ({
    ok: false, code: 1, reply: `No usability report was written, and this is what stopped it: ${trim(e?.message ?? e)}`,
  }));
  console.log(JSON.stringify(out, null, 2));
  process.exitCode = out.code ?? 0;
}
