// What the emitter turns a package into: a Dockerfile that does the half of
// the install procedure a package can decide by itself, and refuses the rest
// rather than guessing at it.
// Run: node --test "test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dependencies, dockerfileText, emit, readPackage, Refusal, requiredVariables, resolveBase, runSpecOf } from "../emit-image.mjs";
import { ESCALATING_RUNNER, authoredName, builtPackage, copyOfPackage, copyLines, installOf, readJson, renamedPackage, rewriteAuthored, runLines, tmp, writeJson } from "./helpers.mjs";

const emitTo = (name, opts = {}) => emit(builtPackage(name), join(tmp("agentmesh-ctx-"), "ctx"), opts);
const dockerfileOf = (name, opts = {}) => dockerfileText(readPackage(builtPackage(name)), opts);
const refusal = (fn) => {
  try { fn(); } catch (err) {
    assert.ok(err instanceof Refusal, `expected a refusal, got ${err}`);
    return err.message;
  }
  assert.fail("nothing was refused");
};

test("the base image and the harness are build arguments, and neither is installed here", () => {
  const df = dockerfileOf("process-runner");
  // Not a literal any more. process-runner declares the agentmesh binary, so
  // the plain node base it used to be pinned to here is a base its own build
  // would stop on; the base is resolved from what the package declares, and
  // base.test.mjs is where that resolution is checked. This test is about the
  // shape: whatever the base is, it arrives as an argument and nothing here
  // installs it.
  const base = resolveBase(readPackage(builtPackage("process-runner")).install).image;
  assert.ok(df.includes(`\nARG BASE_IMAGE=${base}\n`), `the base should be a build argument, and is ${base}`);
  assert.match(df, /^FROM \$\{BASE_IMAGE\}$/m);
  assert.match(df, /^ARG HARNESS_BIN=/m);
  assert.match(df, /^ENV AGENT_HARNESS_BIN=\$\{HARNESS_BIN\}$/m);
  // A package declares what a host must have and never carries the harness
  // that runs it. An image that fetched one would be making the package's
  // choice for it, and an image that carried a provider key to drive it would
  // be carrying a credential in a layer. Asserted over what the build RUNS,
  // not over the whole file: the comments name the harnesses on purpose, so a
  // person reading the Dockerfile knows which file each one reads.
  for (const line of runLines(df)) {
    for (const forbidden of [/apt-get\s+install/, /\bcurl\b/, /\bwget\b/, /npm\s+i(nstall)?\s+-g/, /opencode/i, /codex/i, /claude/i]) {
      assert.doesNotMatch(line, forbidden, `a RUN line should not carry ${forbidden}`);
    }
  }
  assert.equal(dockerfileOf("process-runner", { harnessBin: "/opt/thing/bin/thing" }).includes("ARG HARNESS_BIN=/opt/thing/bin/thing"), true);
});

test("the package goes in verbatim under the agent's own home, and the emitted context carries it", () => {
  const { out } = emitTo("process-runner");
  const df = readFileSync(join(out, "Dockerfile"), "utf8");
  assert.ok(copyLines(df).some(([from, to]) => from === "package/" && to === "/home/agent/process-runner/"));
  // Verbatim matters because the manifest's digests and the build record are
  // over these bytes; a context that rewrote one would be a build nobody
  // could tie back to what was built.
  const source = builtPackage("process-runner");
  for (const rel of ["plugin.json", authoredName(source, "install"), authoredName(source, "descriptor"), "skills/run-a-process/scripts/turn.mjs"]) {
    assert.equal(readFileSync(join(out, "package", rel), "utf8"), readFileSync(join(source, rel), "utf8"), rel);
  }
});

test("the home is the agent's own, and what the host runs sits outside it", () => {
  const df = dockerfileOf("process-runner");
  assert.match(df, /useradd -u \$\{AGENT_UID\} -g agent -d \/home\/agent/);
  // The directories the install file declares are NOT here. 12.7.1 binds each
  // to storage that outlives a single run, and one of the same name inside the
  // image is a decoy: the records written to it look filed and go with the
  // container. The process runner lost a whole run that way between the first
  // message of a conversation and the second.
  const mkdir = runLines(df).find((l) => l.includes("mkdir -p"));
  assert.ok(mkdir, "the image makes the home and the two places outside it");
  assert.doesNotMatch(mkdir, /\/home\/agent\/records|\/home\/agent\/work/);
  assert.match(df, /^#   AGENT_DIRECTORY_RECORDS  the records directory, on storage that outlives one run/m);
  assert.match(df, /^#   AGENT_DIRECTORY_WORK  the work directory, on storage that outlives one run/m);
  assert.match(df, /^ENV HOME=\/home\/agent$/m, "npm and the harness both read HOME, and docker does not set it");
  assert.match(df, /^USER agent$/m);
  assert.match(df, /^ENTRYPOINT \["node", "\/opt\/agent\/entrypoint.mjs"\]$/m);
  for (const [, to] of copyLines(df)) {
    assert.ok(to.startsWith("/opt/agent/") || to === "/home/agent/process-runner/", `unexpected copy into ${to}`);
  }
});

test("every lockfile is installed from, into the home, with install-time scripts refused", () => {
  const df = dockerfileOf("explainer-maker");
  const deps = dependencies(readPackage(builtPackage("explainer-maker")));
  assert.equal(deps.length, 3, "the fixture carries three lockfiles: make-an-explainer, check-the-fit and stage-a-draft");
  const installs = runLines(df).filter((l) => l.includes("npm ci"));
  assert.equal(installs.length, deps.length, "one install per lockfile the install file names, and no others");
  for (const d of deps) {
    const line = installs.find((l) => l.includes(d.dir));
    assert.ok(line, `nothing installs ${d.lockfile}`);
    assert.match(line, /npm ci --ignore-scripts --omit=dev --no-audit --no-fund --loglevel=error/);
    // The digest first: "from the lockfile that was built", not "from a lockfile".
    assert.ok(line.indexOf(d.sha256) < line.indexOf("npm ci"), "the digest is checked before anything is installed");
    assert.ok(d.dir.startsWith("/home/agent/"), "never system-wide");
  }
  assert.doesNotMatch(df, /npm (install|i)\b/, "npm install resolves fresh; only the lockfile decides");
  assert.doesNotMatch(df, /npm rebuild/, "rebuild runs the lifecycle hooks --ignore-scripts just refused");
});

test("a lockfile that is not the one the install file names stops the emit", () => {
  const dir = copyOfPackage("explainer-maker");
  const lock = join(dir, "skills", "check-the-fit", "scripts", "package-lock.json");
  writeFileSync(lock, readFileSync(lock, "utf8").replace(/"lockfileVersion": \d/, '"lockfileVersion": 9'));
  const message = refusal(() => dependencies(readPackage(dir)));
  assert.match(message, /does not hash to the digest/);
  assert.match(message, /not the package that was built/);
});

test("a lockfile with no package.json beside it is refused, because npm would install nothing and pass", () => {
  const dir = copyOfPackage("explainer-maker");
  rmSync(join(dir, "skills", "check-the-fit", "scripts", "package.json"));
  assert.match(refusal(() => dependencies(readPackage(dir))), /has no package.json beside it/);
});

test("the job's command is emitted with the image's own paths filled and every other one left alone", () => {
  const pkg = readPackage(builtPackage(ESCALATING_RUNNER));
  const spec = runSpecOf(pkg.install, { home: "/home/agent", packageName: "process-runner" });
  assert.equal(spec.job, "run-a-process");
  assert.ok(spec.command.includes("/home/agent/process-runner/skills/run-a-process/scripts/turn.mjs"));
  // {records} is NOT filled here. It is a directory role, and 12.7.1 binds one
  // to storage that outlives a single run: a path under the home is made fresh
  // with every container, so the run this message starts would not be there
  // for the next message to find. The deployment names it and the entrypoint
  // fills it.
  assert.ok(spec.command.includes("{records}/runs"));
  assert.ok(!spec.command.some((x) => x.includes("/home/agent/records")), "no records path is baked into the image");
  // These belong to one message. Filling them here would bake the first
  // message into the image and answer every later one with its id.
  assert.ok(spec.command.includes("{job_dir}"));
  assert.ok(spec.command.includes("{message_id}"));
  assert.deepEqual(spec.per_file, ["--file", "{file_path}::{file_media_type}"]);
  assert.equal(spec.reply, "json:reply");
  assert.equal(spec.escalate_when, "json:block");
  const { out } = emitTo(ESCALATING_RUNNER);
  assert.deepEqual(readJson(join(out, "run.json")), spec);
  assert.match(readFileSync(join(out, "Dockerfile"), "utf8"), /^ENV AGENT_RUN_SPEC=\/opt\/agent\/run.json$/m);
});

test("a package naming a command on two jobs is refused rather than guessed at", () => {
  const install = installOf(builtPackage("process-runner"));
  install.run["write-the-account"] = { command: ["node", "x.mjs"], reply: "stdout" };
  const message = refusal(() => runSpecOf(install, { home: "/home/agent", packageName: "process-runner" }));
  assert.match(message, /run-a-process, write-the-account/);
  assert.match(message, /a message does not say which offering it is for/);
});

test("a placeholder the host does not substitute is an error at emit, not text in a command at run", () => {
  const install = installOf(builtPackage("process-runner"));
  install.run["run-a-process"].command = ["node", "turn.mjs", "--who", "{operator}"];
  const message = refusal(() => runSpecOf(install, { home: "/home/agent", packageName: "process-runner" }));
  assert.match(message, /\{operator\}/);
  assert.match(message, /which the host does not substitute/);
});

test("a job with no command leaves the image with none, and the harness is what answers", () => {
  const pkg = readPackage(builtPackage("explainer-critic"));
  assert.equal(runSpecOf(pkg.install, { home: "/home/agent", packageName: "explainer-critic" }), null);
  const { out } = emitTo("explainer-critic");
  assert.equal(existsSync(join(out, "run.json")), false);
  assert.doesNotMatch(readFileSync(join(out, "Dockerfile"), "utf8"), /AGENT_RUN_SPEC/);
});

test("every runtime and binary becomes a build that fails naming the thing and what it is for", () => {
  const df = dockerfileOf("explainer-maker");
  const checks = runLines(df).find((l) => l.includes("process.versions.node"));
  assert.match(checks, /v\[0\] < 22/, "the version the install file names, not a version this tool prefers");
  assert.match(checks, /command -v 'chromium' \|\| command -v 'chromium-browser'/, "the same aliases the installer probes");
  assert.match(checks, /renders every step to check it fits the window/, "the purpose, so the failure reads as an escalation");
  assert.match(checks, /Nothing was substituted for it/);
  // The check must never turn into an install: substituting a lookalike is
  // exactly what 12.4 rule 1 forbids.
  assert.doesNotMatch(df, /apt-get/);
  assert.match(df, /BINARY_CHROMIUM=/, "where it is in this image, so a script never guesses a path");
});

test("what the build recorded about this image is not in the directory a deployment mounts over", () => {
  // Where a binary IS inside this image is a fact the build established, and
  // the binding directory is the one place a deployment mounts something of
  // its own or points AGENT_BINDING_DIR somewhere else. A build-time file
  // written there disappears the moment a deploy binds its ceilings and
  // addresses, every BINARY_<NAME> goes with it, and a script goes back to
  // guessing a path, which is the failure the variable exists to prevent.
  const df = dockerfileOf("explainer-maker");
  assert.match(df, /BINARY_CHROMIUM=\$\(.*\)" >> \/opt\/agent\/binaries\.env/, "the build's answer lives with the build's files");
  assert.doesNotMatch(df, /\/etc\/agent\/binaries\.env/, "and never in the directory the binding mounts");
  assert.match(df, /ENV AGENT_DIR=\/opt\/agent/, "named, so the entrypoint reads it without deriving a path");
});

test("the emitted record names the package, its digests, and every variable the binding must fill", () => {
  const { record } = emitTo("explainer-maker", { now: "2026-09-10T00:00:00Z" });
  const manifest = readJson(join(builtPackage("explainer-maker"), "plugin.json"));
  assert.equal(record.package.name, "explainer-maker");
  assert.equal(record.package.install_sha256, manifest.extensions["net.agentdoc.package"].install.sha256);
  assert.equal(record.harness.baked, false);
  assert.equal(record.job_seconds, 1500);
  assert.deepEqual(record.binaries, ["chromium", "ffmpeg", "ffprobe"].map((name) => ({ name, checked_at_build: true, installed_here: false })));
  const vars = requiredVariables(readPackage(builtPackage("explainer-maker")).install);
  // draft-host is brokered since explainer-maker 0.12.0: no key of its own;
  // since 0.14.1 text-reasoning carries one setting, the story model.
  assert.deepEqual(vars.credentials.map((c) => c.env), ["TEXT_API_KEY", "TTS_API_KEY"]);
  assert.deepEqual(vars.settings.map((s) => s.env), ["STORY_MODEL"]);
  assert.deepEqual(vars.ceilings, [
    { name: "text-reasoning", per: "task", env: "CEILING_TEXT_REASONING", unit: "calls" },
    { name: "text-to-speech", per: "task", env: "CEILING_TEXT_TO_SPEECH", unit: "characters" },
  ]);
  assert.deepEqual(record.needed_at_run_time, vars);
});

test("a package that is not what was built, or is not a draft, is refused before anything is written", () => {
  const edited = copyOfPackage("process-runner");
  const path = join(edited, authoredName(edited, "install"));
  writeJson(path, { ...readJson(path), job_seconds: 60 });
  assert.match(refusal(() => readPackage(edited)), /does not hash to the digest the manifest names/);

  const bound = copyOfPackage("process-runner");
  rewriteAuthored(bound, "descriptor", (d) => { d.subject = "an agent that already exists"; });
  assert.match(refusal(() => readPackage(bound)), /bound descriptor, not a draft/);

  const legacy = copyOfPackage("process-runner");
  const manifest = readJson(join(legacy, "plugin.json"));
  delete manifest.extensions["net.agentdoc.package"];
  writeJson(join(legacy, "plugin.json"), manifest);
  assert.match(refusal(() => readPackage(legacy)), /no net.agentdoc.package extension/);
});

test("emitting over a directory that already holds something is refused unless it is asked for", () => {
  const dir = join(tmp("agentmesh-ctx-"), "ctx");
  emit(builtPackage("explainer-critic"), dir);
  assert.match(refusal(() => emit(builtPackage("explainer-critic"), dir)), /is not empty/);
  const again = emit(builtPackage("explainer-critic"), dir, { force: true });
  assert.ok(again.files.includes("Dockerfile"));
});

// Common Agent 0.30.0-draft renamed descriptor.json, install.json, the pointer
// install and the format agent-install-v1. A reader takes the current names
// and still takes the former ones, so a package already in a depot builds.
test("a package under the current names and one under the former names read the same", () => {
  const current = readPackage(renamedPackage("process-runner", true));
  const former = readPackage(renamedPackage("process-runner", false));
  assert.equal(current.install.format, "agent-runtime-requirements-v1");
  assert.equal(former.install.format, "agent-install-v1");
  assert.equal(current.paths.install, "agent-runtime-requirements.json");
  assert.equal(former.paths.install, "install.json");
  assert.equal(current.paths.descriptor, "agent-descriptor.json");
  assert.equal(former.paths.descriptor, "descriptor.json");
  assert.deepEqual(current.descriptor, former.descriptor);
  const { format: _a, ...a } = current.install;
  const { format: _b, ...b } = former.install;
  assert.deepEqual(a, b);
  const opts = {};
  assert.equal(dockerfileText(current, opts), dockerfileText(former, opts));
});

test("where both names are present the current one is read, and a format that is neither is refused", () => {
  const dir = renamedPackage("process-runner", true);
  writeJson(join(dir, "install.json"), { format: "agent-install-v1", job_seconds: 61 });
  assert.notEqual(readPackage(dir).install.job_seconds, 61);
  const odd = renamedPackage("process-runner", true);
  rewriteAuthored(odd, "install", (d) => { d.format = "agent-install-v2"; });
  assert.match(refusal(() => readPackage(odd)), /format is "agent-install-v2"/);
});
