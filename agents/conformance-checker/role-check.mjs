#!/usr/bin/env node
// agentevaluator: run a claimed role's conformance check against an installed
// container agent's own image, and sign the verdict (docs/container-agents-plan.md,
// item 9). Installed on the fleet host as /opt/fleet/agenteval-role-check.mjs.
//
// A package's conformance is derived from its own declarations (eval-gen.py,
// eval-run.py). A container agent has no package: what it declares is the role
// it claims, and a role on agentroles.ai comes with a conformance check. So this
// runs THAT check, written by the role's authors, against the very image the
// deployment manager's service runs, by digest:
//
//   1. the check's repository is read at the commit its default branch points
//      at now, and that commit is recorded;
//   2. in Cloud Build, a check image is made FROM the agent's image by digest,
//      with the check and what the check needs (node, and nats-server for a
//      mesh of its own) added beside it; nothing of the agent's image changes;
//   3. the check runs in that image, as the image's own user, in its own
//      working folder, starting the agent with its own start command;
//   4. each case is read off the check's own output, and the verdict is signed
//      as an agent-eval-record-v1 by the evaluator's own key and handed to the
//      registry, the same record and the same door eval-run.py uses.
//
// It never touches the running service, sends it nothing and changes nothing.
//
// Usage (one JSON object on stdout; exit 0 only when the agent conforms):
//   node agenteval-role-check.mjs <argfile>
// argfile: { role, image (pinned by digest), agent_key, handle, framework,
//            start, workdir, user, project }

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const TAG = "agent-eval-record-v1";
const DIGEST_REF_RE = /^[a-z0-9.-]+(?:\/[a-z0-9._-]+)+@sha256:[0-9a-f]{64}$/;
const HANDLE_RE = /^[a-z0-9][a-z0-9-]*\.[^@\s.][^@\s]*@[^@\s]+$/;
const NKEY_RE = /^U[A-Z2-7]{55}$/;
const SAFE_WORDS = /^[A-Za-z0-9 ._/=:@+-]{1,200}$/;

/** The roles this evaluator knows how to check, and where each check lives.
 *  The definitions are docs/agentroles/role-<id>.json; a role with no entry
 *  here is refused, never guessed at. */
export const ROLE_CHECKS = {
  "ring-member": {
    version: "v1",
    definition: "https://agentroles.ai/ring-member.html",
    repository: "https://github.com/AgentMesh-Community/reference-agents",
    dir: "tests",
    file: "ring-check.mjs",
    expected: "spec/fixed-mode-expected.json",
    cases: 7,
    // How the check is started inside the check image.
    argv: (a) => ["/opt/role-check/ring-check.mjs", "--cmd", a.start, "--handle", a.handle, "--framework", a.framework, "--cwd", a.workdir],
  },
  // The board demo's coding agents (docs/agentroles/role-board-worker.json).
  // `framework` carries the worker's harness, as its board.about names it.
  "board-worker": {
    version: "v1",
    definition: "https://github.com/AgentMesh-Community/reference-agents/blob/main/spec/board-v1.md",
    repository: "https://github.com/AgentMesh-Community/reference-agents",
    dir: "tests",
    file: "board-check.mjs",
    expected: "spec/board-v1.md",
    cases: 7,
    argv: (a) => ["/opt/role-check/board-check.mjs", "--cmd", a.start, "--handle", a.handle, "--harness", a.framework, "--cwd", a.workdir],
  },
  // The converter (docs/agentroles/role-input-converter.json,
  // docs/input-handling-plan.md). Its check lives with its code; `framework`
  // is read but not used, since the role is the same in any language.
  "input-converter": {
    version: "v1",
    definition: "https://github.com/AgentMesh-Community/converter/blob/main/README.md",
    repository: "https://github.com/AgentMesh-Community/converter",
    dir: "tests",
    file: "converter-check.mjs",
    expected: "tests/converter-check.mjs",
    cases: 10,
    conforms: /Conforms: all ten cases pass/,
    argv: (a) => ["/opt/role-check/converter-check.mjs", "--cmd", a.start, "--handle", a.handle, "--cwd", a.workdir],
  },
};

export function readArgs(raw) {
  const a = raw && typeof raw === "object" ? raw : {};
  const refuse = (why) => { throw new Error(why); };
  const role = ROLE_CHECKS[a.role] ? a.role : refuse(`no conformance check is known for the role ${JSON.stringify(a.role ?? null)}; one is added here from its definition, never guessed`);
  if (!DIGEST_REF_RE.test(String(a.image ?? ""))) refuse("image must be the agent's image pinned by digest, <registry>/<name>@sha256:...");
  if (!HANDLE_RE.test(String(a.handle ?? ""))) refuse("handle must be the agent's full name");
  if (!NKEY_RE.test(String(a.agent_key ?? ""))) refuse("agent_key must be the installed agent's key, which the verdict is about");
  for (const k of ["start", "framework", "workdir"]) if (!SAFE_WORDS.test(String(a[k] ?? ""))) refuse(`${k} must be given in plain words (letters, digits and . _ / = : @ + -)`);
  if (a.user !== undefined && a.user !== null && !/^[a-z_][a-z0-9_-]{0,31}$/.test(String(a.user))) refuse("user must be a unix user name");
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(String(a.project ?? ""))) refuse("project must name the Google Cloud project the check builds in");
  return { role, image: a.image, agent_key: a.agent_key, handle: a.handle, framework: a.framework, start: a.start, workdir: a.workdir, user: a.user ?? null, project: a.project };
}

/** The check image: the agent's own image by digest, with the check beside it. */
export function checkDockerfile(a, check) {
  const argv = check.argv(a).map((s) => JSON.stringify(s)).join(", ");
  return [
    "FROM node:22-slim AS check",
    "RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/*",
    "WORKDIR /check",
    `COPY check/${check.dir}/ ./`,
    "RUN npm ci --no-audit --no-fund",
    "RUN curl -fsSL https://github.com/nats-io/nats-server/releases/download/v2.10.24/nats-server-v2.10.24-linux-amd64.tar.gz | tar xz && mv nats-server-v2.10.24-linux-amd64/nats-server /usr/local/bin/nats-server",
    `FROM ${a.image}`,
    "USER root",
    // Only what the check itself needs; the agent's own files are untouched.
    "RUN if command -v apt-get >/dev/null; then apt-get update && apt-get install -y --no-install-recommends libstdc++6 && rm -rf /var/lib/apt/lists/*; fi",
    "COPY --from=check /usr/local/bin/node /usr/local/bin/node-role-check",
    "COPY --from=check /check /opt/role-check",
    "COPY --from=check /usr/local/bin/nats-server /usr/local/bin/nats-server",
    "ENV NATS_SERVER_BIN=/usr/local/bin/nats-server",
    ...(a.user ? [`USER ${a.user}`] : []),
    `WORKDIR ${a.workdir}`,
    `ENTRYPOINT ["/usr/local/bin/node-role-check", ${argv}]`,
    "",
  ].join("\n");
}

export function buildConfig(check, commit) {
  return {
    steps: [
      { name: "gcr.io/cloud-builders/git", args: ["clone", "--quiet", check.repository, "check"] },
      { name: "gcr.io/cloud-builders/git", args: ["-C", "check", "checkout", "--quiet", commit] },
      { name: "gcr.io/cloud-builders/docker", args: ["build", "-t", "role-check", "-f", "check.Dockerfile", "."] },
      { name: "gcr.io/cloud-builders/docker", args: ["run", "--rm", "role-check"] },
    ],
    timeout: "1500s",
    options: { logging: "CLOUD_LOGGING_ONLY" },
    tags: ["agentevaluator", "role-check"],
  };
}

/** The build account the check runs as, when the host names one in the
 *  check's own project (EVAL_BUILD_SA, else DM_ROLE_CHECK_BUILDER in
 *  deploymgr-platform.json). The check runs the agent's own code, so its
 *  build should hold as little as a build can: an account that may write logs
 *  and read images and nothing else, never the project's default build
 *  account (usually an Editor) and never the account that writes images.
 *  One in another project, or none, leaves the call as it was. */
export function builderArgv(project, builder) {
  const b = String(builder || "");
  if (!project || !b.endsWith(`@${project}.iam.gserviceaccount.com`) || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]@[a-z0-9-]+\.iam\.gserviceaccount\.com$/.test(b)) return [];
  return ["--service-account", `projects/${project}/serviceAccounts/${b}`, `--gcs-source-staging-dir=gs://${project}_cloudbuild/source`];
}

/** The cases, read off the check's own summary lines. */
export function readCases(log, check = null) {
  const text = String(log ?? "").replace(/^(?:Step #\d+(?: - "[^"]*")?: )/gm, "");
  const cases = [];
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s{2}(PASS|FAIL)\s{2}(\S.*)$/.exec(line);
    if (m) { current = { case: m[2].trim(), pass: m[1] === "PASS", problems: [] }; cases.push(current); continue; }
    const p = /^\s{8}(\S.*)$/.exec(line);
    if (p && current && !current.pass) current.problems.push(p[1].trim());
  }
  const conforms = (check?.conforms ?? /Conforms: all seven cases pass/).test(text);
  const said = /(Conforms: .*|Does not conform: .*)$/m.exec(text)?.[1] ?? null;
  return { cases, conforms, said };
}

export function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;
  return JSON.stringify(v);
}

/** The verdict with the trial cases (Common Agent 7.7) folded in: a failed
 *  trial case fails the agent, and an inconclusive one leaves an otherwise
 *  conforming agent inconclusive, never rounded up. */
export function withTrials(verdict, trial = []) {
  if (verdict === "does-not-conform" || !trial.length) return verdict;
  if (trial.some((c) => c.verdict === "fail")) return "does-not-conform";
  if (trial.some((c) => c.verdict !== "pass")) return "inconclusive";
  return verdict;
}

export function evalRecord(a, check, commit, build, read, by, now, trial = []) {
  const role = read.cases.length === 0 ? "inconclusive" : read.conforms && read.cases.every((c) => c.pass) ? "conforms" : "does-not-conform";
  const verdict = withTrials(role, trial);
  return {
    record: "v1", role: "agent-evaluator", act: "evaluate", tag: TAG,
    subject: { agent_key: a.agent_key, handle: a.handle, image: a.image },
    claim: { role: a.role, version: check.version, definition: check.definition },
    check: { repository: check.repository, commit, file: `${check.dir}/${check.file}`, expected: check.expected, cases_required: check.cases,
      ran: "in Cloud Build, inside an image made FROM the agent's own image by digest with the check added beside it, as the image's own user in its own working folder, against a mesh of its own; no model was called" },
    cloud_build: { id: build.id, status: build.status },
    // The role check's own cases, then the trial cases of every offering the
    // agent's descriptor declares a trial on, each of kind trial.
    cases: [...read.cases, ...trial],
    verdict,
    conforms: verdict === "conforms",
    said: read.said,
    produced_at: now, by, signatures: [],
  };
}

export function signed(doc, signer) {
  const body = { ...doc };
  delete body.signatures;
  const sig = signer?.sign ? signer.sign(`${TAG}\n${canonical(body)}`) : null;
  return sig ? { ...body, signatures: [{ tag: TAG, by: doc.by, sig, alg: "ed25519" }] } : { ...body, signatures: [], _unsigned: "the evaluator's identity could not sign" };
}

// ── the run ───────────────────────────────────────────────────────────────

const parse = (s) => { try { return JSON.parse(s || "{}"); } catch { return {}; } };

export function realDeps() {
  const identity = process.env.EVAL_IDENTITY || "/home/agentevaluator/.agentmesh/adapter/identity.json";
  const require = createRequire(process.env.DM_ADAPTER_MODULES || "/usr/lib/node_modules/mesh-adapter/node_modules/");
  // Its own account, never the platform's image builder: the check runs the
  // agent's code, which must not be able to write images.
  let builder = process.env.EVAL_BUILD_SA || "";
  if (!builder) try { builder = JSON.parse(readFileSync(`${process.env.DM_FLEET || "/opt/fleet"}/deploymgr-platform.json`, "utf8")).DM_ROLE_CHECK_BUILDER || ""; } catch { builder = ""; }
  return {
    builder,
    gcloud: (argv, timeout = 600_000) => {
      const p = spawnSync(process.env.EVAL_GCLOUD || "gcloud", argv, { encoding: "utf8", timeout, maxBuffer: 64 * 1024 * 1024 });
      return { code: p.status ?? 1, stdout: p.stdout ?? "", stderr: p.stderr ?? "" };
    },
    fetch: globalThis.fetch,
    lsRemote: (repo) => {
      const p = spawnSync("git", ["ls-remote", repo, "HEAD"], { encoding: "utf8", timeout: 30_000 });
      const sha = (p.stdout ?? "").trim().split(/s+/)[0];
      return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
    },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    // The trial check beside this file (flat on the host as
    // agenteval-trial-check.mjs). An agent whose descriptor declares no trial
    // gets no trial cases; one whose descriptor cannot be read gets none
    // either, since a container agent has no package to say it declares one.
    trialCases: async (handle) => {
      const here = dirname(fileURLToPath(import.meta.url));
      const file = [join(here, "agenteval-trial-check.mjs"), join(here, "trial-check.mjs")].find((p) => existsSync(p));
      if (!file) return [];
      const { checkAgent, liveSettings } = await import(pathToFileURL(file).href);
      return (await checkAgent(handle, liveSettings())).cases ?? [];
    },
    now: () => new Date().toISOString(),
    tmp: () => mkdtempSync(join(tmpdir(), "role-check-")),
    write: (f, s) => writeFileSync(f, s),
    rmdir: (d) => rmSync(d, { recursive: true, force: true }),
    signer: () => {
      if (!existsSync(identity)) return { by: "agentevaluator", sign: null };
      const id = JSON.parse(readFileSync(identity, "utf8"));
      const nk = require("nkeys.js");
      const kp = (nk.default ?? nk).fromSeed(new TextEncoder().encode(String(id.seed).trim()));
      return { by: id.public_key ?? kp.getPublicKey(), sign: (m) => Buffer.from(kp.sign(new TextEncoder().encode(m))).toString("base64") };
    },
    keep: (doc) => {
      const dir = process.env.EVAL_RECORDS || "/home/agentevaluator/records";
      try {
        mkdirSync(dir, { recursive: true });
        const f = join(dir, `${String(doc.subject.handle).split(".")[0]}-role-${doc.claim.role}-${String(doc.cloud_build.id).slice(0, 8)}.json`);
        writeFileSync(f, JSON.stringify(doc, null, 2));
        return f;
      } catch { return null; }
    },
    submit: (doc) => {
      // The same door eval-run.py uses: the registry keeps the latest verdict
      // per agent, and the AgentDoc renders it. Best effort; the signed record
      // on stdout is the artifact.
      const submitter = ["/opt/fleet/agenteval-submit-record.mjs", join(process.cwd(), "submit-record.mjs")].find((p) => existsSync(p));
      const creds = process.env.EVAL_CREDS || join(identity, "..", "..", "..", ".config", "fleet", "mesh.creds");
      if (!submitter || !existsSync(creds) || !doc.signatures?.length) return { submitted: false, why: "no submitter, no connection credential, or no signature" };
      const dir = mkdtempSync(join(tmpdir(), "role-check-rec-"));
      try {
        const f = join(dir, "record.json");
        writeFileSync(f, JSON.stringify(doc));
        const p = spawnSync("node", [submitter, f, identity], { encoding: "utf8", timeout: 60_000, env: { ...process.env, MESH_CREDS_FILE: creds } });
        return p.status === 0 ? { submitted: true } : { submitted: false, why: (p.stderr || p.stdout || "").trim().slice(-200) };
      } finally { rmSync(dir, { recursive: true, force: true }); }
    },
  };
}

export async function roleCheck(raw, deps) {
  let a;
  try { a = readArgs(raw); } catch (e) { return { ok: false, step: "validate", error: e.message }; }
  const check = ROLE_CHECKS[a.role];
  // 1. The check, at the commit its default branch points at now.
  const slug = check.repository.replace("https://github.com/", "");
  // git first: it needs no API allowance, and GitHub's anonymous API
  // allowance is shared by everything on this host (the scanner spends it).
  let commit = deps.lsRemote ? deps.lsRemote(check.repository) : null;
  if (!commit) try {
    const r = await deps.fetch(`https://api.github.com/repos/${slug}/commits/HEAD`, { headers: { Accept: "application/vnd.github.sha", "User-Agent": "agentmesh-agentevaluator" }, signal: AbortSignal.timeout(15_000) });
    const t = (await r.text()).trim();
    commit = /^[0-9a-f]{40}$/.test(t) ? t : null;
  } catch { commit = null; }
  if (!commit) return { ok: false, step: "check", error: `the check's repository ${check.repository} could not be read, so no commit of the check can be named` };
  // 2 and 3. Build the check image from the agent's image and run it.
  const dir = deps.tmp();
  let submitted;
  try {
    deps.write(join(dir, "check.Dockerfile"), checkDockerfile(a, check));
    deps.write(join(dir, "cloudbuild.json"), JSON.stringify(buildConfig(check, commit)));
    const r = deps.gcloud(["builds", "submit", dir, "--config", join(dir, "cloudbuild.json"), "--project", a.project, ...builderArgv(a.project, deps.builder ?? ""), "--async", "--format", "json", "--quiet"], 300_000);
    if (r.code !== 0) return { ok: false, step: "build", error: `the check could not be started: ${(r.stderr || "").trim().slice(-300)}` };
    submitted = parse(r.stdout);
  } finally { deps.rmdir(dir); }
  const id = submitted.id ?? submitted.metadata?.build?.id;
  if (!id) return { ok: false, step: "build", error: "the check was submitted and gcloud named no build id" };
  const done = new Set(["SUCCESS", "FAILURE", "TIMEOUT", "CANCELLED", "EXPIRED", "INTERNAL_ERROR"]);
  const deadline = Date.now() + 30 * 60_000;
  let b = {};
  for (;;) {
    b = parse(deps.gcloud(["builds", "describe", id, "--project", a.project, "--format", "json"]).stdout);
    if (done.has(b.status)) break;
    if (Date.now() > deadline) return { ok: false, step: "check", error: `the check build ${id} is still ${b.status} after 30 minutes` };
    await deps.sleep(15_000);
  }
  // 4. The cases, off the check's own output. A build that failed before the
  // check ran has none, and that is inconclusive, never a pass or a fail.
  const log = deps.gcloud(["builds", "log", id, "--project", a.project], 300_000).stdout;
  const read = readCases(log, check);
  // The trial cases, through the front door, when the agent declares a trial.
  // A check that cannot run them says so as one inconclusive case.
  let trial = [];
  if (deps.trialCases) {
    try { trial = await deps.trialCases(a.handle); } catch (e) {
      trial = [{ id: "trial", kind: "trial", source: "Common Agent 7.7, Conformance", verdict: "inconclusive", observed: `the trial check did not run: ${String(e?.message ?? e).slice(0, 160)}` }]; // cut-ok: an error note
    }
  }
  const signer = deps.signer();
  const doc = signed(evalRecord(a, check, commit, { id, status: b.status }, read, signer.by, deps.now(), trial), signer);
  const registry = deps.submit(doc);
  // The signed record is kept by this procedure itself, under one name per
  // agent, role and check build, so what is on disk is exactly what was
  // signed and never a copy a model chose to write.
  const kept = deps.keep ? deps.keep(doc) : null;
  return { ok: doc.verdict === "conforms", act: "evaluate", verdict: doc.verdict, role: a.role, handle: a.handle, image: a.image, check_commit: commit, build_id: id, cases: read.cases, ...(trial.length ? { trial_cases: trial } : {}), said: read.said, registry, ...(kept ? { kept } : {}), record: doc };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const f = process.argv[2];
  let raw = null;
  try { raw = JSON.parse(readFileSync(f, "utf8")); } catch (e) { raw = null; }
  roleCheck(raw ?? {}, realDeps()).then((r) => {
    process.stdout.write(`${JSON.stringify(r)}\n`);
    process.exit(r.ok ? 0 : 1);
  }, (e) => {
    process.stdout.write(`${JSON.stringify({ ok: false, step: "unexpected", error: String(e?.message ?? e).slice(0, 400) })}\n`);
    process.exit(1);
  });
}
