// Turn a solution into the inputs for ONE container image: the process runner
// and every member agent's package, at the versions the solution runs, with
// composite.mjs as the entrypoint. Nothing is built here and no image is
// produced; what comes out is a build context, like emit-image.mjs's.
//
// A DERIVED EDITION, NOT A FORK. Every package goes in verbatim, checked
// against its own manifest digests, exactly as its own image carries it, and
// every package's dependencies are installed from its own lockfile. The
// edition adds one file of its own, composite.json, which says which packages
// are in it, whose agents they are, and which command each one's job runs.
// When any member is updated the edition is out of date; nothing here is
// edited to keep it current, it is emitted again.
//
// WHO MAY BE COMBINED. Running several agents in one container means they
// share one machine for the length of a run: one process tree, one disk, the
// same memory. That is fine between agents one owner holds and a decision
// nobody else can make for them. So every member must belong to the owner the
// edition is for, unless the member's publisher has marked the package
// combinable (a `combinable: true` in its descriptor). Otherwise this refuses,
// in a sentence, and nothing is written.
//
//   needs: node >= 22
//   node emit-composite.mjs --plan <plan.json> --out <build context dir>
//        [--base <image>] [--bases <catalogue>] [--harness-bin <path>] [--force]
//   plan.json:
//     { "solution": "<id>", "name": "<install name of the edition>", "owner": "<account>",
//       "runner": { "dir": "<package dir>" },
//       "members": [ { "dir": "<package dir>", "name": "<its install name>", "handle": "<handle>",
//                      "agent_id": "<key>"?, "owner": "<account>" } ] }
//   prints one JSON object naming every file written and the record.
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AGENT_DIR, BASES, BINDING_DIR, DEFAULT_HARNESS_BIN, DEFAULT_HOME, Refusal, binaryRecordLines, block, chooseBase,
  dependencies, forbiddenIn, isImageRef, missingFrom, needsHarness, presenceLines, readBases, readPackage,
  requiredVariables, runSpecOf, runtimeLines, shq,
} from "./emit-image.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const dumps = (obj) => JSON.stringify(obj, null, 2) + "\n";
const refuse = (message) => { throw new Refusal(message); };
export const FORMAT = "agent-composite-v1";
const NAME_RE = /^[a-z][a-z0-9-]{0,62}$/;

/** Whether the publisher said this package may share a container with agents
 *  of another owner. Read off the descriptor, which is what the publisher
 *  signs and a buyer reads. */
export const combinable = (pkg) => pkg?.descriptor?.combinable === true;

/**
 * The trust check, as a sentence or null. Every member belongs to the owner
 * the edition is for, or its publisher has marked it combinable. Anything else
 * names the member and says what to do instead.
 */
export function trustRefusal(owner, members) {
  if (!owner) return "The edition names no owner, so nothing can say whose agents may share its container.";
  const others = members.filter((m) => String(m.owner ?? "") !== String(owner) && !m.combinable);
  if (!others.length) return null;
  const names = others.map((m) => m.name);
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `${list} ${names.length === 1 ? "belongs" : "belong"} to another owner and ${names.length === 1 ? "its publisher has" : "their publishers have"} `
    + `not marked ${names.length === 1 ? "it" : "them"} as combinable, so ${names.length === 1 ? "it" : "they"} cannot share one container `
    + `with your agents. Run the solution as it is, with each agent in its own container.`;
}

/** One install file standing for all of them, for choosing a base: every
 *  runtime and every binary any package declares. */
export function mergedNeeds(pkgs) {
  const runtimes = new Map();
  const binaries = new Map();
  for (const p of pkgs) {
    for (const r of p.install.runtimes ?? []) {
      const k = `${r.name}@${r.version ?? ""}`;
      if (!runtimes.has(k)) runtimes.set(k, r);
    }
    for (const b of p.install.binaries ?? []) if (!binaries.has(b.name)) binaries.set(b.name, b);
  }
  return { runtimes: [...runtimes.values()], binaries: [...binaries.values()] };
}

function baseFor(pkgs, opts, wantsHarness) {
  const merged = mergedNeeds(pkgs);
  const path = opts.bases ?? BASES;
  const bases = readBases(path);
  if (!opts.base) {
    const chosen = chooseBase(merged, bases, "this edition", wantsHarness);
    return { image: chosen.image, from: path === BASES ? "bases/catalogue.json" : path, checked: true, harness: chosen.provides?.harness ?? null };
  }
  if (!isImageRef(opts.base)) refuse(`--base ${JSON.stringify(opts.base)} is not a container image reference`);
  const known = bases.find((b) => b.image === opts.base);
  if (!known) return { image: opts.base, from: "--base", checked: false, harness: null };
  const m = missingFrom(known, merged, wantsHarness);
  const short = [...m.runtimes, ...m.binaries, ...m.harness];
  if (short.length) refuse(`--base ${opts.base} is missing ${short.join(", ")}, which this edition needs`);
  return { image: known.image, from: "--base", checked: true, harness: known.provides?.harness ?? null };
}

/** Read the plan and every package it names, and check whose they are. */
export function readPlan(plan) {
  if (!plan?.runner?.dir) refuse("the plan names no process runner package");
  if (!Array.isArray(plan.members) || !plan.members.length) refuse("the plan names no member agents");
  if (!NAME_RE.test(String(plan.name ?? ""))) refuse("the plan's name must be lowercase letters, digits and hyphens");
  const runner = readPackage(plan.runner.dir);
  const members = plan.members.map((m) => {
    if (!NAME_RE.test(String(m.name ?? ""))) refuse(`a member's name must be its install name, lowercase letters, digits and hyphens; got ${JSON.stringify(m.name)}`);
    const pkg = readPackage(m.dir);
    return { ...m, pkg, combinable: combinable(pkg) };
  });
  const seen = new Set();
  for (const m of members) {
    if (seen.has(m.name)) refuse(`${m.name} is named twice; one agent is one member`);
    seen.add(m.name);
  }
  for (const m of members) {
    if (m.pkg.name === runner.name) refuse(`${m.name} is a process runner; the edition carries one, and it walks the process`);
  }
  const why = trustRefusal(plan.owner, members);
  if (why) refuse(why);
  return { runner, members };
}

/** The Dockerfile: one base, every package under the one home, every
 *  lockfile installed, each job's command beside the entrypoint. */
export function compositeDockerfile({ runner, members }, { home, base, harnessBin, wantsHarness }) {
  const pkgs = [runner, ...members.map((m) => m.pkg)];
  const unique = [...new Map(pkgs.map((p) => [p.name, p])).values()];
  const merged = mergedNeeds(unique);
  const L = [];
  const say = (...lines) => L.push(...lines);
  say(`# Emitted by fleet-manager/image/emit-composite.mjs. Do not edit this file:`,
    `# change a package, or the solution, and emit again.`,
    `#`,
    `# A single-container edition: the process runner and every member agent's`,
    `# package, verbatim, at the versions the solution runs. Nothing of any`,
    `# binding is in here: no credential, no address, no ceiling number.`,
    ...unique.map((p) => `#   ${p.name} ${p.version}`),
    ``,
    `ARG BASE_IMAGE=${base}`,
    `FROM \${BASE_IMAGE}`,
    `ARG HARNESS_BIN=${harnessBin}`,
    `ARG HARNESS_INSTRUCTIONS=AGENTS.md`,
    `ARG AGENT_UID=10001`,
    ``,
    `ENV AGENT_PACKAGE=${runner.name}`,
    `ENV AGENT_PACKAGE_VERSION=${runner.version}`,
    `ENV AGENT_HOME=${home}`,
    `ENV HOME=${home}`,
    `ENV npm_config_cache=${home}/.npm`,
    `ENV AGENT_HARNESS_BIN=\${HARNESS_BIN}`,
    `ENV AGENT_INSTRUCTIONS_FILE=\${HARNESS_INSTRUCTIONS}`,
    `ENV AGENT_DIR=${AGENT_DIR}`,
    `ENV AGENT_BINDING_DIR=${BINDING_DIR}`,
    `ENV AGENT_COMPOSITE=${AGENT_DIR}/composite.json`,
    ...(runner.install.wants_replies === true ? [`ENV AGENT_WANTS_REPLIES=1`] : []),
    ``,
    `# Every runtime and binary any of the packages names, checked; nothing substituted.`,
    `RUN set -eu ; \\`,
    block([...runtimeLines(merged), ...(merged.binaries ?? []).flatMap((b) => presenceLines(b.name, b.purpose)), "true"]),
    ``);
  if (wantsHarness) {
    say(`RUN set -eu ; \\`,
      block([`test -x "\${HARNESS_BIN}" || { echo "this base has no harness at \${HARNESS_BIN}, and a package in this edition wakes a model" >&2 ; exit 1 ; }`]),
      ``);
  }
  say(`RUN set -eu ; \\`,
    block([`groupadd -g \${AGENT_UID} agent`,
      `useradd -u \${AGENT_UID} -g agent -d ${home} -m -s /usr/sbin/nologin agent`,
      `mkdir -p ${[...unique.map((p) => `${home}/${p.name}`), `${home}/.npm`, AGENT_DIR, `${AGENT_DIR}/runs`, BINDING_DIR].join(" ")}`,
      ...binaryRecordLines(merged),
      `chown -R agent:agent ${home}`]),
    ``);
  for (const p of unique) say(`COPY --chown=agent:agent packages/${p.name}/ ${home}/${p.name}/`);
  say(`COPY entrypoint.mjs ${AGENT_DIR}/entrypoint.mjs`,
    `COPY one-message.mjs ${AGENT_DIR}/one-message.mjs`,
    `COPY check-lockfile.mjs ${AGENT_DIR}/check-lockfile.mjs`,
    `COPY composite.json ${AGENT_DIR}/composite.json`,
    `COPY runs/ ${AGENT_DIR}/runs/`,
    ``,
    `USER agent`);
  for (const p of unique) {
    for (const d of dependencies(p, { home })) {
      say(`RUN set -eu ; cd ${shq(d.dir)} ; \\`,
        block([`node ${AGENT_DIR}/check-lockfile.mjs ${shq(d.name)} ${d.sha256}`,
          `npm ci --ignore-scripts --omit=dev --no-audit --no-fund --loglevel=error`]));
    }
  }
  say(`WORKDIR ${home}`,
    `# One message in; the runner walks as far as it can inside this container,`,
    `# running each member's job here, and exits at the end or at a person's step.`,
    `ENTRYPOINT ["node", "${AGENT_DIR}/entrypoint.mjs"]`,
    ``);
  return L.join("\n");
}

/** Write the build context for an edition. */
export function emitComposite(plan, outDir, opts = {}) {
  const home = opts.home ?? DEFAULT_HOME;
  const { runner, members } = readPlan(plan);
  const all = [runner, ...members.map((m) => m.pkg)];
  const wantsHarness = all.some((p) => needsHarness(p.install, { home, packageName: p.name }));
  const base = baseFor(all, opts, wantsHarness);
  const harnessBin = opts.harnessBin ?? base.harness?.bin ?? DEFAULT_HARNESS_BIN;

  const runs = {};
  const runPath = (p) => {
    const spec = runSpecOf(p.install, { home, packageName: p.name });
    if (!spec) return null;
    runs[`${p.name}.json`] = dumps(spec);
    return `${AGENT_DIR}/runs/${p.name}.json`;
  };
  const description = {
    format: FORMAT,
    solution: plan.solution ?? null,
    name: plan.name,
    runner: { package: runner.name, version: runner.version, run_spec: runPath(runner), job_seconds: runner.install.job_seconds ?? null },
    members: members.map((m) => ({
      // The install name only. Whose agent it is and its handle are the
      // deployment's to bind and never baked (12.6 rule 3): the job gives each
      // member its handle as MEMBER__<NAME>__MESH_SELF_HANDLE and its key as
      // MEMBER__<NAME>__AGENT_ID.
      name: m.name,
      package: m.pkg.name, version: m.pkg.version, run_spec: runPath(m.pkg), job_seconds: m.pkg.install.job_seconds ?? null,
      priced: Boolean(m.pkg.install.price), combinable: m.combinable,
    })),
  };

  const out = resolve(outDir);
  if (existsSync(out) && readdirSync(out).length) {
    if (!opts.force) refuse(`${outDir} is not empty; emit into a new directory, or pass --force to replace what is there`);
    rmSync(out, { recursive: true, force: true });
  }
  mkdirSync(join(out, "runs"), { recursive: true });
  const files = {
    "Dockerfile": compositeDockerfile({ runner, members }, { home, base: base.image, harnessBin, wantsHarness }),
    ".dockerignore": "**/node_modules\n**/.git\n",
    "entrypoint.mjs": readFileSync(join(here, "composite.mjs"), "utf8"),
    "one-message.mjs": readFileSync(join(here, "one-message.mjs"), "utf8"),
    "check-lockfile.mjs": readFileSync(join(here, "check-lockfile.mjs"), "utf8"),
    "composite.json": dumps(description),
    ...Object.fromEntries(Object.entries(runs).map(([k, v]) => [`runs/${k}`, v])),
  };
  for (const [rel, text] of Object.entries(files)) {
    const bad = forbiddenIn(text, rel, [base.image, harnessBin].filter(Boolean));
    if (bad.length) refuse(bad.join("; ") + ". Nothing was written.");
    writeFileSync(join(out, rel), text);
  }
  for (const p of new Map(all.map((x) => [x.name, x])).values()) cpSync(p.root, join(out, "packages", p.name), { recursive: true });

  const record = {
    format: "agent-composite-image-inputs-v1",
    solution: plan.solution ?? null,
    name: plan.name,
    packages: all.map((p) => ({ name: p.name, version: p.version,
      descriptor_sha256: p.manifest.extensions["net.agentdoc.package"].descriptor?.sha256 ?? null,
      install_sha256: p.manifest.extensions["net.agentdoc.package"].install?.sha256 ?? null })),
    members: description.members.map(({ name, package: pkg, version }) => ({ name, package: pkg, version })),
    trust: { owner_checked: true, combinable: members.filter((m) => m.combinable).map((m) => m.name) },
    base: { image: base.image, from: base.from, checked: base.checked },
    harness: { arg: "HARNESS_BIN", bin: harnessBin, baked: false, needed: wantsHarness },
    home,
    // What the job has to carry: the runner's own variables as they are, and
    // each member's under MEMBER__<NAME>__, which composite.mjs hands to that
    // member alone.
    needed_at_run_time: { runner: requiredVariables(runner.install),
      members: Object.fromEntries(members.map((m) => [m.name, requiredVariables(m.pkg.install)])) },
    files: Object.keys(files).map((rel) => ({ path: rel, sha256: sha256(files[rel]) })),
    emitted_at: opts.now ?? new Date().toISOString(),
  };
  writeFileSync(join(out, "build-inputs.json"), dumps(record));
  return { out, files: [...Object.keys(files), "build-inputs.json", "packages/"], record, description };
}

const thisFile = process.argv[1] ? process.argv[1].replace(/\\/g, "/").split("/").pop() : "";
if (thisFile && import.meta.url.endsWith(thisFile)) {
  try {
    const o = {};
    const argv = process.argv.slice(2);
    for (let i = 0; i < argv.length; i++) {
      const a = argv[i];
      if (a === "--plan") o.plan = argv[++i];
      else if (a === "--out") o.out = argv[++i];
      else if (a === "--base") o.base = argv[++i];
      else if (a === "--bases") o.bases = argv[++i];
      else if (a === "--harness-bin") o.harnessBin = argv[++i];
      else if (a === "--force") o.force = true;
      else throw new Refusal(`unknown argument ${a}`);
    }
    if (!o.plan || !o.out) {
      console.error("usage: node emit-composite.mjs --plan <plan.json> --out <build context dir> [--base <image>] [--bases <catalogue>] [--harness-bin <path>] [--force]");
      process.exit(2);
    }
    const plan = JSON.parse(readFileSync(o.plan, "utf8").replace(/^﻿/, ""));
    const { out, files, record } = emitComposite(plan, o.out, o);
    console.log(JSON.stringify({ ok: true, out, files, packages: record.packages, members: record.members, base: record.base,
      harness: record.harness, needed_at_run_time: record.needed_at_run_time }, null, 2));
  } catch (err) {
    if (err instanceof Refusal) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }
}
