// The fixtures are REAL packages, built by the real builder from the specs in
// packages/<family>/. Nothing here writes a package by hand:
// a hand-written fixture drifts from what the builder emits, and then the
// emitter passes its tests while refusing every package a person actually has.
//
// process-runner is the package that names a command for its job (12.3 `run`),
// so it is the fixture for the path where no model is woken. explainer-maker
// is the package with lockfiles, spending services and settings, so it is the
// fixture for the dependency install and for every variable the binding fills.
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { directoryVar } from "../one-message.mjs";

export const here = dirname(fileURLToPath(import.meta.url));
export const imageDir = join(here, "..");
// The packages the fixtures are built from: a folder laid out as
// <family>/<name>/spec.json, such as the AgentMesh repository's packages/,
// named by ADLC_PACKAGES. The lifecycle's own packages beside this folder
// (agents/<name>/spec.json) are found too.
export const packages = process.env.ADLC_PACKAGES || join(imageDir, "..", "..", "packages");
/** A package's folder, found by its name under its family (packages/<family>/<name>), or beside this folder. */
export function packageDir(name) {
  // A spec.json source, or the agent's folder (Common Agent 13.2: the two
  // authored files beside plugin.json), which the builder reads directly.
  const isSource = (d) => existsSync(join(d, "spec.json")) || existsSync(join(d, "agent-descriptor.json"));
  if (existsSync(packages)) {
    for (const family of readdirSync(packages)) {
      if (isSource(join(packages, family, name))) return join(packages, family, name);
    }
  }
  if (isSource(join(imageDir, "..", name))) return join(imageDir, "..", name);
  throw new Error(`no package named ${name} under packages/<family>/; set ADLC_PACKAGES to a folder of packages`);
}
export const builder = [join(imageDir, "..", "package-maker", "build.py"), join(imageDir, "..", "agentbuilder", "build.py")].find((p) => existsSync(p));
export const entrypoint = join(imageDir, "one-message.mjs");

// One listener for all of them: a listener per directory passes ten and node
// starts warning about a leak in the middle of the test output.
const temporary = [];
process.on("exit", () => {
  for (const d of temporary) { try { rmSync(d, { recursive: true, force: true }); } catch { /* the OS will */ } }
});

/** A temporary directory that goes away with the test run. */
export function tmp(prefix = "agentmesh-image-") {
  const d = mkdtempSync(join(tmpdir(), prefix));
  temporary.push(d);
  return d;
}

const python = () => ["python3", "python", "py"].find((bin) => {
  const r = spawnSync(bin, ["--version"], { encoding: "utf8" });
  return !r.error && r.status === 0;
});

const built = new Map();

/** The named example, built into a package. Cached: the builder is fast but
 *  it is not free, and half the tests in here want the same two packages. */
export function builtPackage(name) {
  if (built.has(name)) return built.get(name);
  const bin = python();
  if (!bin) throw new Error("no python on this machine, and the fixtures are built by the real builder (build.py)");
  const out = tmp("agentmesh-pkg-");
  const [example, variant] = name.split("@");
  const fromSpec = existsSync(join(packageDir(example), "spec.json"));
  let spec = fromSpec ? join(packageDir(example), "spec.json") : packageDir(example);
  if (variant === "escalating" && !fromSpec) {
    // The same change in the agent's folder: its runtime requirements are
    // where a job's command is authored.
    const src = join(tmp("agentmesh-spec-"), example);
    cpSync(packageDir(example), src, { recursive: true, filter: (p) => !p.includes("node_modules") });
    const rr = join(src, "agent-runtime-requirements.json");
    const doc = readJson(rr);
    for (const run of Object.values(doc.run ?? {})) run.escalate_when = "json:block";
    writeJson(rr, doc);
    spec = src;
  } else if (variant === "escalating") {
    // THE PACKAGE THAT RUNS A COMMAND AND CAN STILL WAKE A MODEL. That was
    // process-runner until 0.10.7, when its script began deciding every block
    // itself and `escalate_when` went (the same change 9f8161fa met in the
    // deploymgr tests). The example is copied and the one member put back as
    // 0.10.6 had it, and the real builder builds it, so the fixture is still a
    // package the builder emits and not one written by hand.
    const src = join(tmp("agentmesh-spec-"), example);
    cpSync(packageDir(example), src, { recursive: true });
    const doc = readJson(join(src, "spec.json"));
    for (const job of doc.jobs ?? []) if (job.run) job.run.escalate_when = "json:block";
    writeJson(join(src, "spec.json"), doc);
    spec = join(src, "spec.json");
  } else if (variant) {
    throw new Error(`no fixture variant ${variant}`);
  }
  const r = spawnSync(bin, [builder, spec, out], { encoding: "utf8" });
  const last = (r.stdout ?? "").trim().split("\n").pop() ?? "";
  let result;
  try { result = JSON.parse(last); } catch { throw new Error(`the builder did not print a result: ${r.stderr || r.stdout}`); }
  if (!result.ok) throw new Error(`the builder refused ${name}: ${result.error}`);
  const dir = join(out, example);
  built.set(name, dir);
  return dir;
}

/** process-runner with its escalation put back: see builtPackage. */
export const ESCALATING_RUNNER = "process-runner@escalating";

/** A copy of a built package, so a test can spoil one file and see the
 *  emitter refuse it without spoiling the fixture for every other test. */
export function copyOfPackage(name) {
  const dir = join(tmp("agentmesh-pkg-copy-"), name);
  cpSync(builtPackage(name), dir, { recursive: true });
  return dir;
}

export const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

/** The file a package keeps one authored half in, under whichever name the
 *  builder wrote: "descriptor" is agent-descriptor.json (descriptor.json
 *  before Common Agent 0.30.0-draft), "install" is
 *  agent-runtime-requirements.json (install.json before it). */
export function authoredName(pkgDir, which) {
  const names = which === "descriptor" ? ["agent-descriptor.json", "descriptor.json"] : ["agent-runtime-requirements.json", "install.json"];
  return names.find((n) => existsSync(join(pkgDir, n))) ?? names[0];
}

/** The runtime requirements of a package directory, under either name. */
export const installOf = (pkgDir) => readJson(join(pkgDir, authoredName(pkgDir, "install")));

/** A copy of a built package under the current names (current = true) or the
 *  names before 0.30.0-draft (current = false): the two authored files, the
 *  manifest pointer and the format, with the pointer digests kept honest. */
export function renamedPackage(name, current) {
  const dir = copyOfPackage(name);
  const descFrom = authoredName(dir, "descriptor"), instFrom = authoredName(dir, "install");
  const descTo = current ? "agent-descriptor.json" : "descriptor.json";
  const instTo = current ? "agent-runtime-requirements.json" : "install.json";
  const descText = readFileSync(join(dir, descFrom));
  rmSync(join(dir, descFrom));
  writeFileSync(join(dir, descTo), descText);
  const inst = readJson(join(dir, instFrom));
  inst.format = current ? "agent-runtime-requirements-v1" : "agent-install-v1";
  rmSync(join(dir, instFrom));
  const instText = JSON.stringify(inst, null, 2) + "\n";
  writeFileSync(join(dir, instTo), instText);
  const manifest = readJson(join(dir, "plugin.json"));
  const ext = manifest.extensions["net.agentdoc.package"];
  delete ext.install;
  delete ext.runtime_requirements;
  ext.descriptor.path = descTo;
  ext[current ? "runtime_requirements" : "install"] = { path: instTo, sha256: createHash("sha256").update(instText).digest("hex") };
  writeJson(join(dir, "plugin.json"), manifest);
  return dir;
}
export const writeJson = (path, doc) => writeFileSync(path, JSON.stringify(doc, null, 2) + "\n");

/** Rewrite one of the two authored files AND the manifest pointer that names
 *  its digest, so the change reads as a package built that way rather than as
 *  a package edited after the build, which the emitter refuses first. */
export function rewriteAuthored(pkgDir, which, change) {
  const path = join(pkgDir, authoredName(pkgDir, which));
  const doc = readJson(path);
  change(doc);
  const text = JSON.stringify(doc, null, 2) + "\n";
  writeFileSync(path, text);
  const manifest = readJson(join(pkgDir, "plugin.json"));
  const ext = manifest.extensions["net.agentdoc.package"];
  const key = which === "descriptor" ? "descriptor" : (["runtime_requirements", "install"].find((k) => ext[k]) ?? "install");
  ext[key].sha256 = createHash("sha256").update(text).digest("hex");
  writeJson(join(pkgDir, "plugin.json"), manifest);
  return pkgDir;
}

/** The shell command each RUN line in a Dockerfile carries, joined across
 *  line continuations. What the build actually executes, which is the only
 *  thing an assertion about executing nothing can be made against. */
export function runLines(dockerfile) {
  const out = [];
  const lines = dockerfile.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!/^RUN /.test(lines[i])) continue;
    let cmd = lines[i].slice(4);
    while (cmd.trimEnd().endsWith("\\") && i + 1 < lines.length) {
      cmd = cmd.trimEnd().slice(0, -1) + " " + lines[++i].trim();
    }
    out.push(cmd.replace(/\s+/g, " ").trim());
  }
  return out;
}

/** Every COPY in a Dockerfile, as [from, to]. */
export function copyLines(dockerfile) {
  return dockerfile.split("\n").filter((l) => l.startsWith("COPY "))
    .map((l) => l.replace(/^COPY\s+(--\S+\s+)*/, "").split(/\s+/));
}

/** An agent's home with the package installed in it, the way the image has
 *  it: the package under the home, and NOTHING else.
 *
 *  The declared directories are bound outside the home, the way a deployment
 *  binds them to a mount, and handed back as the variables that name them.
 *  12.7.1 wants storage that outlives a single run, and the home is inside the
 *  container: a fixture that made them under the home would be testing the
 *  arrangement that lost a run between two messages. */
/** A stand-in value for one setting: an address where the name asks for one. */
const settingStandIn = (env) => (/(_BASE|_URL|_HOST|_ENDPOINT)$/.test(env) ? "https://example.test" : `test-${env.toLowerCase()}`);

/**
 * What the install file says this package must be given: a value for each
 * system credential and each setting beside it.
 *
 * Read off the package rather than listed here. A fixture that lists them by
 * hand goes stale the moment a package declares one more, which is exactly
 * what happened: the process runner gained the run-record system and its
 * three variables on 2026-09-17, and every test that ran it was refused by
 * the entrypoint for six weeks without anybody seeing it, because the gate
 * that runs them was failing earlier for another reason.
 */
export function bindingsFor(install) {
  const out = {};
  for (const s of install.systems ?? []) {
    const name = s.name ?? s.role ?? "system";
    if (s.env) out[s.env] = `test-${s.credential ?? name}`;
    for (const st of s.settings ?? []) if (st?.env) out[st.env] = settingStandIn(st.env);
  }
  return out;
}

export function installedHome(name) {
  const home = tmp("agentmesh-home-");
  cpSync(builtPackage(name), join(home, name), { recursive: true });
  const install = installOf(join(home, name));
  const mount = tmp("agentmesh-mount-");
  const directories = {};
  for (const d of install.directories ?? []) {
    directories[directoryVar(d.name)] = join(mount, "state", name, d.name);
  }
  return { home, packageName: name, install, mount, directories, bindings: bindingsFor(install) };
}

/** One inbox entry written where the entrypoint reads it, and the job folder
 *  it will file into. The job folder is a mount in the real thing, so the
 *  test makes it somewhere the entrypoint could never have guessed. */
export function messageAndJob(entry) {
  const dir = tmp("agentmesh-run-");
  const jobDir = join(dir, "jobs", "not-where-anything-would-guess", entry.id ?? "m1");
  mkdirSync(jobDir, { recursive: true });
  const messageFile = join(dir, "message.json");
  writeJson(messageFile, entry);
  return { jobDir, messageFile };
}

/** Run the entrypoint the way a container does: one message, then it exits. */
export function runEntrypoint(env) {
  return spawnSync(process.execPath, [entrypoint], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}
