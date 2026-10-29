// Turn an Agent Package into the inputs for a container image: a Dockerfile
// and the files it copies. Nothing is built here and no image is produced.
// What comes out is a build context, and `docker build` is somebody else's
// step.
//
// WHY THIS EXISTS. The install procedure (common-agent-spec 12.7) reads as
// "put files on a host we control": create the home and the declared
// directories, install the dependencies from each lockfile, place the
// credentials, translate for the harness, start the loop. On a burstable
// sandbox there is no host to put files on and no loop to start; there is an
// image, and one container per message. The half of the procedure a package
// can decide by itself is the half that belongs in an image, and the
// dependencies are why it has to be an image at all: a lockfile with
// integrity hashes has nowhere to live once the workspace is made fresh for
// every message, and an agent that installs its own dependencies at run time
// is an agent whose dependencies nobody pinned.
//
// The split this file keeps:
//   baked     the runtime and binary checks, the agent's home, the package
//             verbatim, the dependencies from each lockfile, the job's command
//             (12.3 `run`) with the two paths that are facts about the image
//             already filled, and the entrypoint that answers ONE message and
//             exits.
//   not baked the subject, the handle, every credential, every address, every
//             ceiling number, the directories the install file declares, and
//             the harness itself. Those are the owner's instruction (12.7
//             install) or the harness's own installation, they arrive at run
//             time, and 12.6 rule 3 keeps them out of a package, so they stay
//             out of anything emitted from one. The directories are here for a
//             different reason: 12.7.1 wants storage that outlives a single
//             run, and a container's filesystem is fresh for every message.
//
//   needs: node >= 22
//   node emit-image.mjs --package <package dir> --out <build context dir>
//        [--base <image>] [--bases <catalogue>] [--harness-bin <path>]
//        [--home <path>] [--force]
//   node emit-image.mjs --check-bases [--bases <catalogue>]
//   With no --base the base image is resolved from what the package declares,
//   against the operator's catalogue in bases/catalogue.json. An operator who
//   is not us keeps their own catalogue and names it with --bases; --check-bases
//   reads one and prints what this tool sees in it, without a package.
//   prints one JSON object naming every file written and every variable the
//   container must be given at run time.
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire as amCreateRequire } from "node:module";
import { existsSync as amExists } from "node:fs";
import { dirname as amDirname, join as amJoin } from "node:path";
import { fileURLToPath as amFileURLToPath } from "node:url";

// The AgentMesh environment (env/<AGENTMESH_ENV>.json, default prod) through
// env/load.cjs. This file is copied flat onto hosts, so the loader is looked
// for in AGENTMESH_ENV_DIR, in the repository, beside this file, in
// /opt/fleet/env or /opt/agentmesh/env, then in an env/ above the working
// directory; not finding it is an error that names every place looked.
let amEnvLib;
function amEnv(key) {
  if (!amEnvLib) {
    const here = amDirname(amFileURLToPath(import.meta.url));
    const dirs = [process.env.AGENTMESH_ENV_DIR, amJoin(here, "../../env"), amJoin(here, "env"), "/opt/fleet/env", "/opt/agentmesh/env"].filter(Boolean);
    for (let d = process.cwd(); ; d = amDirname(d)) { dirs.push(amJoin(d, "env")); if (amDirname(d) === d) break; }
    const dir = dirs.find((d) => amExists(amJoin(d, "load.cjs")));
    if (!dir) throw new Error(`the AgentMesh environment loader (env/load.cjs) was not found; looked in ${dirs.join(", ")}`);
    amEnvLib = amCreateRequire(import.meta.url)(amJoin(dir, "load.cjs"));
  }
  return amEnvLib.get(key);
}

export const EXT = "net.agentdoc.package";
// The runtime requirements' format (Common Agent 0.30.0-draft, 12.2) and the
// one before it, which a reader still accepts.
export const INSTALL_FORMAT = "agent-runtime-requirements-v1";
export const LEGACY_INSTALL_FORMAT = "agent-install-v1";
// Each authored file under its name, then its name before 0.30.0-draft; and
// the manifest pointers at each, the current one first.
export const DESCRIPTOR_FILES = ["agent-descriptor.json", "descriptor.json"];
export const INSTALL_FILES = ["agent-runtime-requirements.json", "install.json"];
export const INSTALL_POINTERS = ["runtime_requirements", "install"];

/** The first of `names` present in `dir`, or null: a package written under
 *  the current names and one written under the former names both read. */
export function packageFile(dir, names) {
  for (const n of names) if (existsSync(join(dir, n))) return n;
  return null;
}

/** The manifest's pointer at the runtime requirements: `runtime_requirements`,
 *  or `install` in a package from before 0.30.0-draft. */
export function installPointer(ext) {
  for (const k of INSTALL_POINTERS) if (ext?.[k] && typeof ext[k] === "object") return ext[k];
  return null;
}
export const DESCRIPTOR_FORMAT = "agent-descriptor-v1";
export const DEFAULT_HOME = "/home/agent";
// Where the harness will be found. Not installed here: a package declares what
// a host must have and never carries the harness that runs it (12.9).
export const DEFAULT_HARNESS_BIN = "/opt/harness/bin/harness";
// The entrypoint and the job's command live OUTSIDE the agent's home, for the
// reason the fleet keeps RUN_SPEC in /opt/fleet/runs: an agent that can edit
// what its own host will run for it is not running what was installed.
export const AGENT_DIR = "/opt/agent";
// Where the platform mounts what the binding decided. Read at run time, never
// written at build time, and empty in the image on purpose.
export const BINDING_DIR = "/etc/agent";

// What a runtime or binary may be called on a host: the same table the
// installer probes with. A missing name is reported as missing; nothing is
// substituted for it.
export const ALIASES = {
  chromium: ["chromium", "chromium-browser", "google-chrome", "google-chrome-stable"],
  python: ["python3", "python"],
};

const here = dirname(fileURLToPath(import.meta.url));
// The operator's base catalogue, beside this tool because it is the operator's
// file and belongs to no package. No base image is named anywhere else in this
// tool: one pinned here as well would be a second spelling of the same fact,
// and the two would drift (12.6 rule 1).
//
// THIS DEFAULT IS A DEFAULT AND NOT AN ASSUMPTION. The catalogue that ships
// beside this tool is one operator's, and every image in it is in one private
// registry. An operator who is not us is the operator for their own agents:
// they keep a catalogue of their own, naming images in their own registry, and
// pass it as --bases. bases/catalogue.template.json is the shape to start from,
// and README.md says where the file should live on their side. Nothing else in
// here has to change for that to work, because the registry is named in the
// catalogue and nowhere else.
export const BASES_NAME = "bases/catalogue.json";
export const BASES = join(here, BASES_NAME);
export const BASES_FORMAT = "agent-image-bases-v1";
// What a build record and a refusal call the catalogue. The path this tool
// reads is absolute and belongs to whoever ran it; a record that named it
// would say where the emitting machine keeps its files and nothing useful.
const catalogueName = (path) => (path === BASES ? BASES_NAME : path);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const dumps = (obj) => JSON.stringify(obj, null, 2) + "\n";

/** A refusal is an answer. Every stop in here names the thing and what it is
 *  for, so a person reads it as an escalation and never as a crash. */
export class Refusal extends Error {}
const refuse = (message) => { throw new Refusal(message); };

// ── what must never be written into an image ──────────────────────────────

// Strings that look like a credential VALUE rather than a name: the prefixes
// vendors stamp on their keys, a signed token, or a long run of token
// characters mixing letters and digits. The same shapes the installer refuses
// an instruction for. A hex digest is not one: digests are how packages are
// named, and every lockfile check in the emitted Dockerfile carries one.
const VALUE_RE = /AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20,}|gh[ous]_[A-Za-z0-9]{20,}|xox[abp]-[A-Za-z0-9-]{20,}|ya29\.[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{30,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}|(?<![A-Za-z0-9])(?:sk|rk|pk)[-_](?:live|test|proj|ant|or|api)?[-_]?[A-Za-z0-9]{16,}/;
const TOKENISH_RE = /(?<![A-Za-z0-9+/=_.-])[A-Za-z0-9+/=_.-]{32,}(?![A-Za-z0-9+/=_.-])/g;
const HEX_RE = /^[0-9a-f]{32,}$/;
const ADDRESS_RE = /[a-z][a-z0-9+.-]*:\/\/\S+/i;
// A CONTAINER IMAGE REFERENCE, which is the one long slash-separated string
// that legitimately belongs in a Dockerfile. It has to be recognised by shape
// rather than scanned as prose: `gcr.io/langbench-1528148150979/agentmesh-base`
// is forty four characters of letters, digits, dots, slashes and dashes, which
// is exactly what TOKENISH_RE is looking for, so the first real base image we
// passed was refused as a credential. The answer is not to loosen the scan. It
// is to CHECK the reference against its own grammar and then exclude the
// checked string from the prose scan, so anything else long in that file still
// fails. Registry, optional port, path, optional tag, optional digest.
const IMAGE_REF_RE = /^(?:[a-z0-9]+(?:[._-][a-z0-9]+)*(?::[0-9]{1,5})?\/)?[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*(?::[A-Za-z0-9][A-Za-z0-9._-]{0,127})?(?:@sha256:[0-9a-f]{64})?$/;

/** Whether a string is a container image reference and nothing else. It is
 *  anchored on purpose: a reference with anything appended is not one. */
export function isImageRef(s) {
  if (typeof s !== "string" || !s.length || s.length > 255) return false;
  // A credential value can BE a syntactically valid image name: ghp_ followed
  // by thirty lowercase alphanumerics parses as a reference perfectly well.
  // Since a checked reference is masked out of the prose scan, accepting one
  // would be a way to smuggle a key past the scan by passing it as the base.
  // So the vendor-prefix check runs first, and a reference that reads as a
  // credential is refused rather than guessed at.
  if (VALUE_RE.test(s)) return false;
  return IMAGE_REF_RE.test(s);
}
const HANDLE_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

export function looksLikeValue(s) {
  if (typeof s !== "string") return false;
  if (VALUE_RE.test(s)) return true;
  for (const run of s.match(TOKENISH_RE) ?? []) {
    if (HEX_RE.test(run)) continue;
    if (/[A-Za-z]/.test(run) && /[0-9]/.test(run)) return true;
  }
  return false;
}

/** Every reason this text must not be written into an image or a Dockerfile
 *  (12.6 rule 3): a credential value, an address, an endpoint, or an account
 *  identifier. Empty means it may be written. */
export function forbiddenIn(text, what = "the file", checked = []) {
  const problems = [];
  // Strings this tool has already validated against a stricter grammar of
  // their own are masked before the prose scan, never exempted from it in
  // place: masking keeps the surrounding text scanned, so a credential next to
  // a base image is still caught.
  for (const c of checked) {
    if (typeof c === "string" && c) text = text.split(c).join("(checked)");
  }
  const address = text.match(ADDRESS_RE);
  if (address) {
    problems.push(`${what} carries an address (${address[0].slice(0, 60)}); an image is built once and copied `
      + `everywhere, and an address is bound per install`);
  }
  const handle = text.match(HANDLE_RE);
  if (handle) {
    problems.push(`${what} carries what reads as an account identifier (${handle[0].slice(0, 60)}); the subject `
      + `is minted at install and never baked`);
  }
  if (looksLikeValue(text)) {
    problems.push(`${what} carries what reads as a credential value; a package names credentials and the host `
      + `resolves the names`);
  }
  return problems;
}

// ── the package ───────────────────────────────────────────────────────────

/** Read a package and check it holds together well enough to build from.
 *  Nothing here executes anything from the package: the depot executes
 *  nothing, the installer executes nothing, and this is the installer's side
 *  of that fence (12.6 rule 7). */
export function readPackage(dir) {
  const root = resolve(dir);
  const manifestPath = join(root, "plugin.json");
  if (!existsSync(manifestPath)) refuse(`${dir} has no plugin.json; that is a directory, not an Agent Package`);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const ext = manifest?.extensions?.[EXT];
  if (!ext || typeof ext !== "object") {
    refuse(`the manifest declares no ${EXT} extension, so nothing points at a descriptor or an install file. `
      + `A package from before the package format cannot be turned into an image: build it again.`);
  }
  // The manifest points and never copies (12.2), so the pointer's digest is
  // the only thing saying these are the bytes that were built. A package whose
  // install file was edited after the build would otherwise become an image
  // that no build record could be tied to.
  const pointed = (keys, fallbacks) => {
    const key = keys.find((k) => typeof ext[k]?.path === "string") ?? keys[0];
    const ptr = ext[key];
    const rel = typeof ptr?.path === "string" ? ptr.path : (packageFile(root, fallbacks) ?? fallbacks[0]);
    const path = resolve(root, rel);
    if (!path.startsWith(root)) refuse(`the manifest's ${key} pointer leaves the package: ${rel}`);
    if (!existsSync(path)) refuse(`the manifest points at ${rel} for its ${key} and the file is not there`);
    const bytes = readFileSync(path);
    if (typeof ptr?.sha256 === "string" && sha256(bytes) !== ptr.sha256) {
      refuse(`${rel} does not hash to the digest the manifest names for it; this is not the package that was built`);
    }
    paths[key === "descriptor" ? "descriptor" : "install"] = rel;
    return JSON.parse(bytes.toString("utf8"));
  };
  const paths = {};
  const descriptor = pointed(["descriptor"], DESCRIPTOR_FILES);
  const install = pointed(INSTALL_POINTERS, INSTALL_FILES);
  if (descriptor.subject) {
    refuse("this package carries a bound descriptor, not a draft; a package's descriptor has no subject (12.2)");
  }
  if (descriptor.format !== DESCRIPTOR_FORMAT) {
    refuse(`the descriptor's format is ${JSON.stringify(descriptor.format)}, not ${DESCRIPTOR_FORMAT}`);
  }
  if (install.format !== INSTALL_FORMAT && install.format !== LEGACY_INSTALL_FORMAT) {
    refuse(`the install file's format is ${JSON.stringify(install.format)}, not ${INSTALL_FORMAT} (or ${LEGACY_INSTALL_FORMAT}, its name before 0.30.0-draft)`);
  }
  // An installer refuses a request carrying a credential value before the
  // value is used (12.7). The install file is the one file in a package that
  // names credentials at all, so it is where a value ends up when one does.
  const bad = forbiddenIn(JSON.stringify(install), "the install file");
  if (bad.length) refuse(bad.join("; ") + ". Nothing was written.");
  // A package shipping its own node_modules is a package whose dependencies
  // nobody verified: the lockfile is the authority, and a directory copied in
  // beside it would be installed by nothing and checked by nothing.
  for (const slug of skillSlugs(root)) {
    if (existsSync(join(root, "skills", slug, "scripts", "node_modules"))) {
      refuse(`skills/${slug}/scripts carries a node_modules directory. The image installs from the lockfile; `
        + `take it out of the package and let the lockfile be the authority.`);
    }
  }
  // `paths` names the file each was read from, so a reader placed beside the
  // package (the tenant host, one-message) opens the same one.
  return { root, manifest, descriptor, install, paths, name: manifest.name, version: String(manifest.version ?? "") };
}

function skillSlugs(root) {
  try {
    return readdirSync(join(root, "skills"), { withFileTypes: true })
      .filter((e) => e.isDirectory()).map((e) => e.name);
  } catch { return []; }
}

// ── the job's command (12.3 `run`) ────────────────────────────────────────

// The placeholders the host substitutes, and no others. An unknown one is an
// error at install, not at run: a command that silently ran with the literal
// text {job_dir} in it would be worse than one that refused.
//
// TWO OF THE FOUR PATHS ARE NOT FILLED HERE, and the split is the difference
// between a fact about the image and a fact about the deployment. {home} and
// {package} are inside the image and are the same bytes in every container of
// it. {records} and {work} are the directories the install file declares, and
// 12.7.1 binds each directory system to storage that OUTLIVES A SINGLE RUN. A
// container's own filesystem outlives nothing: it is made fresh for every
// message. The process runner keeps each run under records/runs/<run id>/ and
// rebuilds the run from it on the next message, so a records path baked into
// the image pointed at an empty directory every time, and the second message
// of a conversation found no run and answered as though the first had never
// happened. So they stay as placeholders in run.json, and the entrypoint fills
// them from what the deployment bound, per agent, on the mount.
export const FIXED_AT_BUILD = ["home", "package"];
export const BOUND_AT_START = ["records", "work"];
export const PER_MESSAGE = ["job_dir", "message_id", "sender", "handle", "in_reply_to"];
export const PER_FILE = ["file_path", "file_media_type"];
const PLACEHOLDER_RE = /\{([a-z_]+)\}/g;

/** The variable the deployment names a directory system in. The same shape as
 *  the ceiling and binary variables, and spelled out rather than shortened,
 *  because AGENT_DIR is already the directory the build put the entrypoint in
 *  and two names a grep cannot tell apart is how the wrong one gets read. */
export const directoryVar = (name) => "AGENT_DIRECTORY_" + name.toUpperCase().replace(/[^A-Z0-9]/g, "_");

/** The command the host runs for this package's job, with the two paths that
 *  are facts about the image already filled in. The directories belong to the
 *  deployment and the rest belong to one message, and both are filled by the
 *  entrypoint.
 *
 *  One command per package, for the reason the fleet's installer gives: a
 *  message does not say which offering it is for, so a package naming a
 *  command on two jobs is refused rather than guessed at. */
export function runSpecOf(install, { home = DEFAULT_HOME, packageName } = {}) {
  const runs = install?.run;
  if (!runs || typeof runs !== "object" || !Object.keys(runs).length) return null;
  const slugs = Object.keys(runs).sort();
  if (slugs.length > 1) {
    refuse(`the package names a command on more than one job (${slugs.join(", ")}); a message does not say which `
      + `offering it is for, so the host cannot tell which to run`);
  }
  const [slug] = slugs;
  const spec = runs[slug];
  const fixed = { home, package: packageName };
  const fill = (s, allowed) => {
    for (const [, found] of s.matchAll(PLACEHOLDER_RE)) {
      if (!allowed.includes(found)) {
        refuse(`job ${slug}: the command carries {${found}}, which the host does not substitute. `
          + `It knows ${allowed.map((p) => `{${p}}`).join(", ")}.`);
      }
    }
    return s.replace(PLACEHOLDER_RE, (whole, key) => (key in fixed ? fixed[key] : whole));
  };
  const known = [...FIXED_AT_BUILD, ...BOUND_AT_START, ...PER_MESSAGE];
  const out = { job: slug, command: spec.command.map((x) => fill(x, known)), reply: spec.reply ?? "stdout" };
  if (spec.per_file) out.per_file = spec.per_file.map((x) => fill(x, [...known, ...PER_FILE]));
  if (spec.message_file) out.message_file = fill(spec.message_file, known);
  if (spec.escalate_when) out.escalate_when = spec.escalate_when;
  return out;
}

/** Whether a container of this package will ever wake a model, which is the
 *  same question as whether it needs a harness.
 *
 *  Two ways it will. A package that names no command for its job has nothing
 *  else to run: its work is a model reading and writing, and explainer-critic
 *  is that package. And a package that names one AND can say the turn needs
 *  judgment runs the command first and wakes the model when it says so, so the
 *  harness has to be there for the message that says it and not only for the
 *  ones that do not.
 *
 *  Asked of the install file rather than of the descriptor's `how`, because
 *  the install file is what the host acts on: the entrypoint reads the run
 *  declaration and nothing else when it decides which of the two to do. A
 *  descriptor saying `control: model` and an install file naming a command
 *  would be one package with two answers, and the one that runs is this one. */
export function needsHarness(install, opts = {}) {
  const spec = runSpecOf(install, opts);
  return !spec || Boolean(spec.escalate_when);
}

// ── the dependencies (12.4 rule 2) ────────────────────────────────────────

/** One entry per lockfile: where it sits under the agent's home, and the
 *  digest the install file names for it. Refuses a lockfile with no
 *  package.json beside it, the way the fleet's installer does, because
 *  `npm ci` in a directory with no manifest installs nothing and says so in a
 *  line a build log swallows. */
export function dependencies(pkg, { home = DEFAULT_HOME } = {}) {
  const out = [];
  for (const dep of pkg.install.dependencies ?? []) {
    const rel = dep.lockfile;
    if (typeof rel !== "string" || rel.includes("..")) {
      refuse(`a dependency names ${JSON.stringify(rel)}, which is not a path inside the package`);
    }
    const onDisk = resolve(pkg.root, rel);
    if (!existsSync(onDisk)) refuse(`the install file names ${rel} and the package does not carry it`);
    if (typeof dep.sha256 === "string" && sha256(readFileSync(onDisk)) !== dep.sha256) {
      refuse(`${rel} does not hash to the digest the install file names for it; this is not the package that was built`);
    }
    const dir = rel.split("/").slice(0, -1).join("/");
    if (!existsSync(join(pkg.root, dir, "package.json"))) {
      refuse(`${rel} has no package.json beside it; npm would install nothing from it and the build would pass anyway`);
    }
    out.push({
      skill: dep.skill, lockfile: rel, name: rel.split("/").pop(),
      dir: `${home}/${pkg.name}/${dir}`, sha256: dep.sha256,
    });
  }
  return out;
}

// ── what the container must be given at run time ──────────────────────────

export const ceilingVar = (name) => "CEILING_" + name.toUpperCase().replace(/[^A-Z0-9]/g, "_");
export const binaryVar = (name) => "BINARY_" + name.toUpperCase().replace(/[^A-Z0-9]/g, "_");

/** The name a systems[] entry gives the system it is bound to. Common Agent
 *  0.16.0-draft renamed this member from `role` to `name`, because `role`
 *  already means the standard job an agent holds; `role` is read as an alias
 *  for one revision and `name` wins where a package carries both. */
export const systemName = (s) =>
  (typeof s?.name === "string" && s.name) || (typeof s?.role === "string" && s.role) || "";

/** Every variable name the binding fills, by name. Names only: this list is
 *  written into the emitted record and read by the entrypoint, and a value in
 *  it would be a credential sitting in a build artifact.
 *
 *  The directories are here for the same reason the ceilings are: the package
 *  declares that it needs one and the owner's instruction says where it is.
 *  12.7.1 requires storage that outlives a single run, which nothing inside an
 *  image can be, so an unbound directory is a thing this image does not have
 *  rather than a default it can fall back on. */
export function requiredVariables(install) {
  const credentials = [];
  const settings = [];
  const ceilings = [];
  const mcp = [];
  const directories = [];
  for (const d of install.directories ?? []) {
    if (d?.name) directories.push({ name: d.name, env: directoryVar(d.name), purpose: d.purpose ?? null });
  }
  for (const s of install.systems ?? []) {
    const n = systemName(s);
    if (s.kind === "mcp") mcp.push({ name: n });
    if (s.env) credentials.push({ name: n, env: s.env, credential: s.credential ?? null });
    for (const st of s.settings ?? []) settings.push({ name: n, env: st.env, purpose: st.purpose ?? null });
  }
  for (const c of install.ceilings ?? []) {
    const spends = (install.systems ?? []).find((s) => systemName(s) === c.system)?.spends;
    ceilings.push({ name: c.system, per: c.per, env: ceilingVar(c.system), ...(spends?.unit ? { unit: spends.unit } : {}) });
  }
  return { credentials, settings, ceilings, mcp, directories };
}

// ── which base image (12.4 rule 1 against 12.6 rule 3) ────────────────────
//
// WHERE A PACKAGE'S BASE REQUIREMENT LIVES. It is already in the package, and
// it is not the base. The install file's runtimes[] and binaries[] name what
// must be present before an install proceeds, each with a purpose a person can
// read, and 12.4 rule 1 says an installer checks each one and stops when it is
// missing, never substitutes. That is the requirement. The base image is an
// ANSWER to it, and an answer is not the package's to give: an image reference
// is an address, a package carries no address (12.6 rule 3), and the same
// package has to be buildable by an operator on their own registry.
//
// So the base is not declared anywhere. It is RESOLVED. The package names
// requirements; the operator keeps a catalogue of the bases they have built
// and what each one provides; this tool picks the first base in the catalogue
// that has everything the package declares. Nobody writes a base into a
// package, and nobody writes a package's needs into a base.
//
// WHAT IT COSTS, plainly. The catalogue is a claim and not a proof: it says
// the chromium base has chromium, and nothing here opens the image to look. An
// entry that is wrong buys a build failure rather than preventing one. That is
// why the emitted Dockerfile still checks every declared binary at build time
// and fails naming it: the catalogue moves the common failure from a five
// minute cloud build to an instant refusal, and the build step is what makes
// the claim true. The second cost is that two files must be kept in step by
// hand: build a base, and the operator has to say what it provides. The
// alternative was for the emitter to install whatever a package declared,
// which is the substitution 12.4 rule 1 forbids.

/** Our catalogues name their registry as a placeholder at the front of an image
 *  reference, "{gcp.registry}/agentmesh-base:0.88.6", so one file serves prod
 *  and dev: the placeholder is a dotted path into the AgentMesh environment
 *  file (env/<AGENTMESH_ENV>.json). A catalogue with no placeholder, which is
 *  every other operator's, is read as written and needs no environment. The
 *  harness cloud build config uses the same placeholders. */
export function fillRegistry(text) {
  return String(text).replace(/(["\s:=])\{([a-z_]+(?:\.[a-z_]+)+)\}\//g, (_, lead, key) => `${lead}${amEnv(key)}/`);
}

/** Read the operator's catalogue of bases. Refuses a file that is not one,
 *  the way the package reader refuses a directory that is not a package. */
export function readBases(path = BASES) {
  if (!existsSync(path)) {
    refuse(`there is no base catalogue at ${catalogueName(path)}. It is the operator's list of the images they `
      + `have built and what each one provides, and without it nothing here knows which base a package can be `
      + `built on.`);
  }
  const doc = JSON.parse(fillRegistry(readFileSync(path, "utf8")));
  if (doc.format !== BASES_FORMAT) {
    refuse(`the base catalogue's format is ${JSON.stringify(doc.format)}, not ${BASES_FORMAT}`);
  }
  const bases = Array.isArray(doc.bases) ? doc.bases : [];
  if (!bases.length) refuse(`the base catalogue at ${catalogueName(path)} names no bases`);
  for (const b of bases) {
    // Checked against the grammar before it can reach a FROM line, for the
    // same reason --base is: a base that is not a reference is either a typo
    // or an attempt to put something else in the build.
    if (!isImageRef(b.image)) {
      refuse(`the base catalogue names ${JSON.stringify(b.image)}, which is not a container image reference`);
    }
  }
  // The catalogue legitimately carries image references, which are addresses,
  // because it is the operator's file and not a package. It carries nothing
  // else: a credential put here would end up in a build argument.
  const bad = forbiddenIn(JSON.stringify(doc), "the base catalogue", bases.map((b) => b.image));
  if (bad.length) refuse(bad.join("; ") + ". Nothing was written.");
  return bases;
}

/** What this tool reads out of a catalogue, one line per base. It answers the
 *  question an operator has after writing the file and before having a package
 *  to try it with: is this a catalogue this tool accepts, and does it agree
 *  with me about what I built.
 *
 *  Every refusal in readBases is the real answer to the first half, so nothing
 *  is re-checked here. The second half is why the members are spelled out
 *  rather than the file printed back: a runtime whose version member was
 *  misspelled reads as a base providing node with no version, which quietly
 *  fails to meet any package asking for one, and a harness written without its
 *  `bin` is a base that builds every image cleanly and refuses every message. */
export function describeBases(path = BASES) {
  return readBases(path).map((b) => ({
    image: b.image,
    runtimes: (b.provides?.runtimes ?? []).map((r) => (r.version ? `${r.name} ${r.version}` : r.name)),
    binaries: b.provides?.binaries ?? [],
    harness: b.provides?.harness?.bin ?? null,
    why: b.why ?? null,
  }));
}

/** Whether a version the catalogue names covers the version a package asks
 *  for. A floor, the way runtimeLines reads it: ">=22" and "22" both mean 22
 *  or later. Major and minor only; the exact check is the one in the image. */
export function meetsVersion(provided, required) {
  if (!required) return true;
  const want = String(required).match(/(\d+)(?:\.(\d+))?/);
  if (!want) return true;
  const have = String(provided ?? "").match(/(\d+)(?:\.(\d+))?/);
  if (!have) return false;
  const [wantMajor, wantMinor] = [Number(want[1]), Number(want[2] ?? 0)];
  const [haveMajor, haveMinor] = [Number(have[1]), Number(have[2] ?? 0)];
  return haveMajor > wantMajor || (haveMajor === wantMajor && haveMinor >= wantMinor);
}

/** What this base does not have that the install file says it needs. Empty
 *  means the package can be built on it.
 *
 *  The catalogue spells a binary the way the package does. It is deliberately
 *  not run through ALIASES: that table is for probing a host that may call a
 *  thing by another name, and a catalogue is written by the person who built
 *  the image, who can spell it the way the packages do. */
export function missingFrom(base, install, wantsHarness = false) {
  const provides = base?.provides ?? {};
  const has = new Set(provides.binaries ?? []);
  const runtimes = [];
  for (const r of install.runtimes ?? []) {
    const found = (provides.runtimes ?? []).find((p) => p.name === r.name);
    if (!found || !meetsVersion(found.version, r.version)) runtimes.push(r.version ? `${r.name} ${r.version}` : r.name);
  }
  return {
    runtimes,
    binaries: (install.binaries ?? []).filter((b) => !has.has(b.name)).map((b) => b.name),
    // The harness is the one requirement that is not in the install file, and
    // it cannot be: 12.9 keeps the harness out of a package entirely. So the
    // caller asks needsHarness of the work the package declares and passes the
    // answer in, and the catalogue's own harness entry is what a base offers
    // against it. A base with no entry has none, and an image built on it
    // would refuse every message rather than fail a build.
    harness: wantsHarness && !provides.harness?.bin ? ["a harness"] : [],
  };
}

const items = (m) => [...m.runtimes, ...m.binaries, ...(m.harness ?? [])];
const shortfall = (m) => items(m).join(", ");
// A thing the package declared, with the purpose it declared it for. The
// purpose is the whole reason a refusal reads as an escalation rather than a
// crash: "needs chromium" is a puzzle, "needs chromium: plays every step of
// the draft" is a decision somebody can make.
const withPurpose = (install, names) => names.map((n) => {
  const binary = (install.binaries ?? []).find((b) => b.name === n);
  return binary?.purpose ? `${n} (${binary.purpose})` : n;
}).join(", ");
const needsList = (install, wantsHarness = false) => withPurpose(install, [
  ...(install.runtimes ?? []).map((r) => (r.version ? `${r.name} ${r.version}` : r.name)),
  ...(install.binaries ?? []).map((b) => b.name),
  // Named alongside the declared things even though the package declares no
  // harness, because a refusal a person acts on has to list everything the
  // base they build next must carry, and half a list is a second refusal.
  ...(wantsHarness ? ["a harness"] : []),
]);

/** The first base in the catalogue that has everything the package declares.
 *  First, not best: the catalogue is in the operator's preference order,
 *  plainest first, so a package that needs only node is not handed an image
 *  carrying a browser. */
export function chooseBase(install, bases, what = "this package", wantsHarness = false) {
  const missing = bases.map((base) => ({ base, missing: missingFrom(base, install, wantsHarness) }));
  const fits = missing.find((m) => !items(m.missing).length);
  if (fits) return fits.base;
  // What NOTHING has, rather than everything the package declared. A refusal
  // that listed the runtime every base carries alongside the binary none of
  // them do reads as though node were the problem too.
  const nowhere = items(missing[0].missing).filter((x) => missing.every((m) => items(m.missing).includes(x)));
  const opening = nowhere.length
    ? `${what} needs ${withPurpose(install, nowhere)}, and no base in the catalogue has ${nowhere.length > 1 ? "them" : "it"}.`
    : `${what} needs ${needsList(install, wantsHarness)}, and no one base in the catalogue has all of it.`;
  // "is missing", not "has no": the list can now carry "a harness" beside a
  // binary name, and "has no chromium, a harness" reads as a typo.
  refuse(`${opening} ${missing.map((m) => `${m.base.image} is missing ${shortfall(m.missing)}`).join("; ")}. `
    + `Build a base that has what is missing, add it to the catalogue with what it provides, and emit again. Nothing is `
    + `installed into a package's image to make a check pass: the install file says check and never substitute `
    + `(12.4 rule 1).`);
}

/** The base this package will be built on, and where that answer came from.
 *
 *  `harness` is the catalogue's word on where that base keeps a harness, and
 *  it is here so the emitter writes the operator's path into the image rather
 *  than its own default. Null where the catalogue says nothing, which is a
 *  base with none and also a base nobody wrote down. */
export function resolveBase(install, opts = {}) {
  const path = opts.bases ?? BASES;
  const what = opts.packageName ?? "this package";
  const wantsHarness = needsHarness(install, opts);
  const bases = readBases(path);
  if (!opts.base) {
    const chosen = chooseBase(install, bases, what, wantsHarness);
    return { image: chosen.image, from: catalogueName(path), checked: true, harness: chosen.provides?.harness ?? null };
  }
  if (!isImageRef(opts.base)) refuse(`--base ${JSON.stringify(opts.base)} is not a container image reference`);
  const known = bases.find((b) => b.image === opts.base);
  if (!known) {
    // Not in the catalogue, so nothing here knows what it holds. Accepted
    // rather than refused, because a base an operator built ten minutes ago is
    // not in the file yet and the build step is still the thing that checks
    // it. The emitted record says it was not checked, so a build that fails on
    // a missing binary is not a surprise.
    return { image: opts.base, from: "--base", checked: false, harness: null };
  }
  const missing = missingFrom(known, install, wantsHarness);
  if (shortfall(missing)) {
    refuse(`--base ${opts.base} is missing ${shortfall(missing)}, and ${what} needs it: ${needsList(install, wantsHarness)}. `
      + `The build would stop at the check for it. Name a base that has it, or leave --base off and let the `
      + `catalogue answer.`);
  }
  return { image: known.image, from: "--base", checked: true, harness: known.provides?.harness ?? null };
}

// ── the Dockerfile ────────────────────────────────────────────────────────

export const shq = (s) => `'${String(s).replace(/'/g, `'"'"'`)}'`;
export const block = (lines, indent = "    ") =>
  lines.map((l, i) => `${indent}${l}${i === lines.length - 1 ? "" : " ; \\"}`).join("\n");

/** The version check for a declared runtime. Only node can be checked from
 *  inside a node one-liner, and node is the runtime the base image is chosen
 *  to carry; any other runtime is checked the way a binary is, by looking for
 *  it and stopping when it is not there. */
export function runtimeLines(install) {
  const lines = [];
  for (const r of install.runtimes ?? []) {
    if (r.name !== "node") {
      lines.push(...presenceLines(r.name, `the package names it as a runtime${r.version ? ` (${r.version})` : ""}`));
      continue;
    }
    const want = String(r.version ?? ">=0").match(/(\d+)(?:\.(\d+))?/);
    const major = Number(want?.[1] ?? 0);
    const minor = Number(want?.[2] ?? 0);
    lines.push(`node -e 'const v = process.versions.node.split(".").map(Number); `
      + `if (v[0] < ${major} || (v[0] === ${major} && v[1] < ${minor})) { `
      + `console.error("this package needs the node runtime ${r.version ?? ""} and this base image has " + process.versions.node); `
      + `process.exit(1); }'`);
  }
  return lines;
}

/** A binary the package names must be in the image, and the build stops when
 *  it is not. On a host the deployment manager probes and escalates to a
 *  person; in an image the honest equivalent is a build that fails naming the
 *  binary and what it is for. NOTHING is installed to make the check pass:
 *  the install file says check and never substitute (12.4 rule 1), and an
 *  image that quietly apt-got a lookalike would be that substitution. */
export function presenceLines(name, purpose) {
  const found = (ALIASES[name] ?? [name]).map((c) => `command -v ${shq(c)}`).join(" || ");
  const why = purpose ? `: ${purpose}` : "";
  return [`{ ${found} ; } >/dev/null 2>&1 || { echo "this package needs ${name}${why}. `
    + `Nothing was substituted for it: put it in the base image." >&2 ; exit 1 ; }`];
}

/** Where each declared binary is in this image, recorded so a skill's script
 *  asks for the binary the package declared and never guesses a path. The
 *  same thing the host's env file does with BINARY_<NAME>; a path inside an
 *  image is not an address and not a credential.
 *
 *  IT GOES IN AGENT_DIR AND NOT IN THE BINDING DIRECTORY. Where a binary is
 *  inside this image is a fact the BUILD established, and the binding
 *  directory is the one place a deployment mounts something of its own: a
 *  deploy that mounts its ceilings and addresses there, or points
 *  AGENT_BINDING_DIR at a folder on a bucket, would hide this file, every
 *  BINARY_<NAME> would silently disappear, and a script would go back to
 *  guessing a path, which is the failure the variable exists to prevent. The
 *  entrypoint reads this one first and lets the binding's file override it, so
 *  the two are a default and an override rather than one shadowing the
 *  other. */
export function binaryRecordLines(install) {
  return (install.binaries ?? []).map((b) => {
    const cands = (ALIASES[b.name] ?? [b.name]).map((c) => `command -v ${shq(c)}`).join(" || ");
    return `echo "${binaryVar(b.name)}=$( ${cands} )" >> ${AGENT_DIR}/binaries.env`;
  });
}

export function dockerfileText(pkg, opts = {}) {
  const home = opts.home ?? DEFAULT_HOME;
  const { name, version, install } = pkg;
  const resolved = resolveBase(install, { ...opts, home, packageName: name });
  const base = resolved.image;
  // The operator's answer before this tool's own. A path invented here is a
  // path no base has, which is the whole of the failure being fixed: every
  // image emitted before the catalogue carried a harness entry pointed at
  // /opt/harness/bin/harness and nothing was ever there. --harness-bin still
  // wins, because an operator naming one by hand is naming one they built.
  const harnessBin = opts.harnessBin ?? resolved.harness?.bin ?? DEFAULT_HARNESS_BIN;
  const wakesAModel = needsHarness(install, { home, packageName: name });
  const pkgHome = `${home}/${name}`;
  const deps = dependencies(pkg, { home });
  const vars = requiredVariables(install);
  const runSpec = runSpecOf(install, { home, packageName: name });
  const L = [];
  const say = (...lines) => L.push(...lines);

  say(`# Emitted by fleet-manager/image/emit-image.mjs from the Agent Package`,
    `# ${name} ${version}. Do not edit this file: change the package and emit again.`,
    `#`,
    `# This is the install procedure of the Common Agent Specification 12.7 up to`,
    `# the point where the owner's instruction is needed, and no further. What the`,
    `# package decides is baked; what the binding decides arrives at run time.`,
    `# There is no credential, no address, no account identifier and no ceiling`,
    `# number anywhere in here, and there must never be: an image is built once`,
    `# and copied everywhere, so anything baked into it is bound for every agent`,
    `# that ever runs it (12.6 rule 3).`,
    ``,
    `# The base the runtimes and binaries this package declares resolve to. A`,
    `# package names what it needs and never which image to build on: an image`,
    `# reference is an address and a package carries none (12.6 rule 3), so the`,
    `# answer comes from the operator's base catalogue and arrives here.`,
    `ARG BASE_IMAGE=${base}`,
    `FROM \${BASE_IMAGE}`,
    ``,
    `# Where the harness will be found at run time. It is NOT installed here: a`,
    `# package declares what a host must have and never carries the harness that`,
    `# runs it (12.9), and a key for one would be a credential in a build layer.`,
    `# The path is the base's own, out of the operator's catalogue, so this file`,
    `# never invents one. A path ending .mjs is run with node, which is how a`,
    `# test stands in for a harness without installing one.`,
    `ARG HARNESS_BIN=${harnessBin}`,
    `# The file the harness reads its instructions from, at the agent's home.`,
    `# Codex and OpenCode read AGENTS.md; Claude Code reads .claude/CLAUDE.md.`,
    `# The entrypoint writes it per message, because half of what belongs in it`,
    `# is the binding and the binding is not known here.`,
    `ARG HARNESS_INSTRUCTIONS=AGENTS.md`,
    `# Not 1000: the node base images already have a user there.`,
    `ARG AGENT_UID=10001`,
    ``,
    `ENV AGENT_PACKAGE=${name}`,
    `ENV AGENT_PACKAGE_VERSION=${version}`,
    `ENV AGENT_HOME=${home}`,
    `# npm and the harness both read HOME, and docker does not set it from the`,
    `# passwd entry. Without this the dependency install writes its cache into`,
    `# root's home, which is the "never system-wide" half of 12.4 rule 2 lost to`,
    `# a default nobody looked at.`,
    `ENV HOME=${home}`,
    `ENV npm_config_cache=${home}/.npm`,
    `ENV AGENT_HARNESS_BIN=\${HARNESS_BIN}`,
    `ENV AGENT_INSTRUCTIONS_FILE=\${HARNESS_INSTRUCTIONS}`,
    // What the build decided and what the binding decides, under two names, so
    // a deployment that mounts its own binding cannot hide the build's answers.
    `ENV AGENT_DIR=${AGENT_DIR}`,
    `ENV AGENT_BINDING_DIR=${BINDING_DIR}`);
  if (Number.isInteger(install.job_seconds)) {
    say(`# The package's own word on how long one job may take. The entrypoint`,
      `# stops the work at it, the way the attendant's WORK_TIMEOUT does.`,
      `ENV AGENT_JOB_SECONDS=${install.job_seconds}`);
  }
  if (install.wants_replies === true) {
    say(`# This agent reads replies to work it sent, so a reply is a message to`,
      `# answer and not something to acknowledge and drop.`,
      `ENV AGENT_WANTS_REPLIES=1`);
  }
  if (runSpec) {
    say(`# The command this package names for its job (12.3). A host that has one`,
      `# runs it and does not wake a model to decide whether to.`,
      `ENV AGENT_RUN_SPEC=${AGENT_DIR}/run.json`);
  }
  // A package that names no runtime and no binary has nothing to check, and
  // an empty check is not a RUN line: `RUN set -eu ; \` with nothing after it
  // runs on into the next instruction and the image build fails there.
  const checks = [...runtimeLines(install), ...(install.binaries ?? []).flatMap((b) => presenceLines(b.name, b.purpose))];
  say(``,
    `# 12.4 rule 1: check every runtime and binary the install file names, stop`,
    `# when one is missing, and never substitute.`,
    ...(checks.length
      ? [`RUN set -eu ; \\`, block(checks)]
      : [`# This package names no runtime and no binary, so there is nothing to check.`]),
    ``);
  if (wakesAModel) {
    say(`# And the harness, checked the same way and for the same reason, even`,
      `# though no package declares one. ${runSpec
        ? `${name} names a command for its job and can say the turn needs`
        : `${name} names no command for its job, so every message wakes a`}`,
      `${runSpec
        ? `# judgment, so the message that says it wakes a model`
        : `# model`} and something has to wake it. Nothing is installed here to make`,
      `# this pass: 12.9 keeps the harness out of a package, so the base carries`,
      `# it and this is the line where a base that does not says so. Before it,`,
      `# an image built clean on a base with no harness and then refused its`,
      `# first message with "the harness is not in this container", which is a`,
      `# build that proved nothing.`,
      `RUN set -eu ; \\`,
      block([`test -x "\${HARNESS_BIN}" || { echo "this base has no harness at \${HARNESS_BIN}, and ${name} wakes a `
        + `model for its work. Build on a base that carries one." >&2 ; exit 1 ; }`]),
      ``);
  }
  say(
    `# The agent's own home, plus the two places that are deliberately not the`,
    `# home: ${AGENT_DIR} for what the host runs, ${BINDING_DIR} for what the binding`,
    `# mounts.`,
    `#`,
    `# THE DIRECTORIES THE INSTALL FILE DECLARES ARE NOT MADE HERE. 12.7.1 binds`,
    `# each directory role to storage that outlives a single run, and nothing in`,
    `# an image can be that: a container is made fresh for every message. One of`,
    `# the same name in here would be worse than nothing, because it is a decoy`,
    `# that swallows every record written to it while the container is alive and`,
    `# takes them with it when the container exits. They are bound at start, by`,
    `# the deployment, and named in the variables at the end of this file.`,
    `RUN set -eu ; \\`,
    block([`groupadd -g \${AGENT_UID} agent`,
      `useradd -u \${AGENT_UID} -g agent -d ${home} -m -s /usr/sbin/nologin agent`,
      `mkdir -p ${[pkgHome, `${home}/.npm`, AGENT_DIR, BINDING_DIR].join(" ")}`,
      ...binaryRecordLines(install),
      `chown -R agent:agent ${home}`]),
    ``,
    `# The package, verbatim, under the agent's own home. Nothing in it runs at`,
    `# build time: the depot executes nothing, the installer executes nothing,`,
    `# and only the agent's harness runs a package's scripts (12.6 rule 7).`,
    ...(deps.length ? [`# The dependency install below runs npm, never the package.`] : []),
    `COPY --chown=agent:agent package/ ${pkgHome}/`,
    ``,
    `# Outside the home on purpose: an agent that can edit what its own host`,
    `# runs for it is not running what was installed.`,
    `COPY entrypoint.mjs ${AGENT_DIR}/entrypoint.mjs`,
    `COPY check-lockfile.mjs ${AGENT_DIR}/check-lockfile.mjs`);
  if (runSpec) say(`COPY run.json ${AGENT_DIR}/run.json`);
  if (hasModelSystem(install)) {
    say(`# The model gateway the entrypoint starts on loopback for a package whose`,
      `# model system's MODEL_ENDPOINT points there (Common Agent 12.4.1): the host's`,
      `# own facility, holding the job's sign-in, never the package's.`,
      `COPY ${GATEWAY_FILE} ${AGENT_DIR}/${GATEWAY_FILE}`);
  }
  say(``);
  if (deps.length) {
    say(`# 12.4 rule 2: install from the lockfile, into the agent's own home,`,
      `# never system-wide, and never an install-time script or lifecycle hook.`,
      `# --ignore-scripts is what makes the last part true. The digest check`,
      `# first is what makes it "from the lockfile that was built" rather than`,
      `# "from a lockfile". Run as the agent, so nothing installed is owned by`,
      `# root and nothing written lands outside the home.`,
      `USER agent`);
    for (const d of deps) {
      say(`RUN set -eu ; cd ${shq(d.dir)} ; \\`,
        block([`node ${AGENT_DIR}/check-lockfile.mjs ${shq(d.name)} ${d.sha256}`,
          `npm ci --ignore-scripts --omit=dev --no-audit --no-fund --loglevel=error`]));
    }
    say(``);
  }
  say(...(deps.length ? [] : [`USER agent`]),
    `WORKDIR ${home}`,
    `# One message, then the container is done. There is no loop in here: the`,
    `# loop belongs to whatever wakes the container, and a container that polled`,
    `# an inbox would be an always-on VM wearing a container's clothes.`,
    `ENTRYPOINT ["node", "${AGENT_DIR}/entrypoint.mjs"]`,
    ``);
  const names = [...vars.credentials.map((c) => c.env), ...vars.settings.map((s) => s.env),
    ...vars.ceilings.map((c) => c.env)];
  if (names.length || vars.mcp.length || vars.directories.length || wakesAModel) {
    say(`# What this image does NOT have and the container must be given, by name:`,
      ...names.map((n) => `#   ${n}`),
      // The model and the key that pays for it. They are not in the install
      // file and never will be: which model an agent thinks with is the
      // owner's instruction, the same one a host deploy answers, and the key
      // is the owner's. The harness reads both out of the environment and
      // refuses the message naming the model when either is absent.
      ...(wakesAModel ? [`#   AGENT_MODEL  which model this agent thinks with, and the variable`,
        `#     its provider reads, holding the owner's key`] : []),
      // An address is the one binding that cannot be a variable in a layer or
      // a line in a package, so it arrives mounted, per container.
      ...vars.mcp.map((m) => `#   the address of the ${m.name} server, in ${BINDING_DIR}/mcp.json`),
      // A path on storage that outlives one run. Per agent, because one bucket
      // serves the whole fleet and two agents' records are not the same
      // records, and the same path on every execution, because a run is
      // rebuilt from what the last message left there.
      ...vars.directories.map((d) => `#   ${d.env}  the ${d.name} directory, on storage that outlives one `
        + `run${d.purpose ? `: ${d.purpose}` : ""}`),
      `# The entrypoint refuses the message when one is missing, and says which.`,
      ``);
  }
  return L.join("\n");
}

// ── the model gateway ─────────────────────────────────────────────────────

/** The file the entrypoint starts as the job's model gateway (one-message.mjs
 *  startGateway), and where its source is: beside this file on a fleet host,
 *  where the host install puts responses-bridge.mjs in /opt/fleet, or in the
 *  repository's host/ folder. */
export const GATEWAY_FILE = "model-gateway.mjs";
export function gatewaySource(dirs = [here, join(here, "..", "..", "host")]) {
  for (const d of dirs) {
    const p = join(d, "responses-bridge.mjs");
    if (existsSync(p)) return readFileSync(p, "utf8");
  }
  return null;
}

/** Whether the package declares a system of kind model (12.4.1). */
export function hasModelSystem(install) {
  return (install?.systems ?? []).some((s) => s && s.kind === "model");
}

// ── emit ──────────────────────────────────────────────────────────────────

/** Write the build context: the Dockerfile, the files it copies, the package
 *  itself, and a record of what the deployment record will have to say. */
export function emit(packageDir, outDir, opts = {}) {
  const pkg = readPackage(packageDir);
  const home = opts.home ?? DEFAULT_HOME;
  // Resolved before the output directory is made, and handed to the Dockerfile
  // from here, so a package nothing can be built for is refused with an empty
  // hand, and the record and the FROM line cannot disagree about the base.
  const base = resolveBase(pkg.install, { ...opts, home, packageName: pkg.name });
  const harnessBin = opts.harnessBin ?? base.harness?.bin ?? DEFAULT_HARNESS_BIN;
  const wakesAModel = needsHarness(pkg.install, { home, packageName: pkg.name });
  const out = resolve(outDir);
  if (existsSync(out) && readdirSync(out).length) {
    if (!opts.force) refuse(`${outDir} is not empty; emit into a new directory, or pass --force to replace what is there`);
    rmSync(out, { recursive: true, force: true });
  }
  mkdirSync(out, { recursive: true });

  const runSpec = runSpecOf(pkg.install, { home, packageName: pkg.name });
  const deps = dependencies(pkg, { home });
  const files = {
    "Dockerfile": dockerfileText(pkg, { ...opts, home, base: base.image }),
    ".dockerignore": "**/node_modules\n**/.git\n",
    "entrypoint.mjs": readFileSync(join(here, "one-message.mjs"), "utf8"),
    "check-lockfile.mjs": readFileSync(join(here, "check-lockfile.mjs"), "utf8"),
    ...(runSpec ? { "run.json": dumps(runSpec) } : {}),
  };
  // Every file this tool authors is scanned before it is written. The check
  // costs nothing and the failure it prevents cannot be undone: an image with
  // a credential in a layer is not unpublished, only revoked.
  for (const [rel, text] of Object.entries(files)) {
    const bad = forbiddenIn(text, rel, [base.image, harnessBin].filter(Boolean));
    if (bad.length) refuse(bad.join("; ") + ". Nothing was written.");
    writeFileSync(join(out, rel), text);
  }
  // THE MODEL GATEWAY, copied as it is. It is the host's program, not the
  // package's and not authored here, and it carries the addresses it calls
  // (Vertex AI, the metadata server's token path) by design, so it is scanned
  // for what reads as an account and not for addresses or path segments that
  // the loose credential sweep mistakes for a value. It holds no credential:
  // it asks for a token at run time.
  if (hasModelSystem(pkg.install)) {
    const gateway = gatewaySource();
    if (!gateway) refuse(`${pkg.name} declares a model system and the model gateway (responses-bridge.mjs) is not beside this tool; nothing was written`);
    const bad = forbiddenIn(gateway, GATEWAY_FILE).filter((b) => !/carries an address|reads as a credential value/.test(b));
    if (bad.length) refuse(bad.join("; ") + ". Nothing was written.");
    writeFileSync(join(out, GATEWAY_FILE), gateway);
  }
  // The package goes in verbatim, because the digests in the manifest and in
  // the build record are over these bytes; a build that rewrote any of them
  // would be a build nobody could verify.
  cpSync(pkg.root, join(out, "package"), { recursive: true });

  const record = {
    format: "agent-image-inputs-v1",
    package: {
      name: pkg.name, version: pkg.version,
      descriptor_sha256: pkg.manifest.extensions[EXT].descriptor?.sha256 ?? null,
      install_sha256: installPointer(pkg.manifest.extensions[EXT])?.sha256 ?? null,
      runtime_requirements_sha256: installPointer(pkg.manifest.extensions[EXT])?.sha256 ?? null,
    },
    // Which base, and on whose word. `checked` is false only when the operator
    // named a base the catalogue does not list, so a build that then stops at a
    // missing binary can be read back to this line rather than guessed at.
    base: { image: base.image, from: base.from, checked: base.checked },
    // `needed` is the fact the deployment acts on: a container that wakes a
    // model is a container that has to be given one and a key to pay for it,
    // and one that runs only the package's command must be given neither. The
    // path and the harness's name come from the base, never from here, because
    // this tool installs none (12.9) and a path it invented is the path
    // nothing was ever at.
    harness: {
      arg: "HARNESS_BIN", bin: harnessBin, baked: false, needed: wakesAModel,
      in_base: base.harness?.name ?? null,
    },
    home,
    runtimes: pkg.install.runtimes ?? [],
    binaries: (pkg.install.binaries ?? []).map((b) => ({ name: b.name, checked_at_build: true, installed_here: false })),
    // Declared and NOT made here, which is a statement and not an omission: a
    // directory inside an image is fresh for every message, and 12.7.1 wants
    // one that outlives a run. A reader asking what is inside a layer is owed
    // the fact that these are not.
    directories: (pkg.install.directories ?? []).filter((d) => d?.name)
      .map((d) => ({ name: d.name, purpose: d.purpose ?? null, made_here: false, bound: "at start" })),
    dependencies: deps.map((d) => ({ skill: d.skill, lockfile: d.lockfile, sha256: d.sha256, into: d.dir })),
    job_seconds: pkg.install.job_seconds ?? null,
    run: runSpec ? { job: runSpec.job, can_wake_a_model: Boolean(runSpec.escalate_when) } : null,
    // Names, never values. This list is what an owner's instruction has to
    // answer before a container of this image can do any work at all.
    needed_at_run_time: requiredVariables(pkg.install),
    files: Object.keys(files).map((rel) => ({ path: rel, sha256: sha256(files[rel]) })),
    emitted_at: opts.now ?? new Date().toISOString(),
  };
  writeFileSync(join(out, "build-inputs.json"), dumps(record));
  return { out, files: [...Object.keys(files), "build-inputs.json", "package/"], record };
}

// ── cli ───────────────────────────────────────────────────────────────────

export function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--package") o.package = next();
    else if (a === "--out") o.out = next();
    else if (a === "--base") o.base = next();
    else if (a === "--bases") o.bases = next();
    else if (a === "--harness-bin") o.harnessBin = next();
    else if (a === "--home") o.home = next();
    else if (a === "--force") o.force = true;
    else if (a === "--check-bases") o.checkBases = true;
    else if (a === "--help" || a === "-h") o.help = true;
    else throw new Refusal(`unknown argument ${a}`);
  }
  return o;
}

const thisFile = process.argv[1] ? process.argv[1].replace(/\\/g, "/").split("/").pop() : "";
if (thisFile && import.meta.url.endsWith(thisFile)) {
  try {
    const o = parseArgs(process.argv.slice(2));
    if (o.help || (!o.checkBases && (!o.package || !o.out))) {
      console.error("usage: node emit-image.mjs --package <package dir> --out <build context dir> "
        + "[--base <image>] [--bases <catalogue>] [--harness-bin <path>] [--home <path>] [--force]\n"
        + "       node emit-image.mjs --check-bases [--bases <catalogue>]\n"
        + "with no --base, the base is resolved from what the package declares against bases/catalogue.json");
      process.exit(o.help ? 0 : 2);
    }
    // A catalogue read and reported on, with no package in hand. It is the
    // first thing an operator who is not us has to get right, and before this
    // the only way to find out whether their file was one this tool accepts
    // was to emit a package against it and read the refusal.
    if (o.checkBases) {
      const path = o.bases ?? BASES;
      console.log(JSON.stringify({ ok: true, catalogue: catalogueName(path), bases: describeBases(path) }, null, 2));
      process.exit(0);
    }
    const { out, files, record } = emit(o.package, o.out, o);
    // The harness is printed as well as written, because the deployment
    // manager reads this line and not the file beside the context, and whether
    // this image wakes a model is what decides if the container act has to
    // name a model and place a key for it.
    console.log(JSON.stringify({ ok: true, out, files, package: record.package, base: record.base,
      harness: record.harness, needed_at_run_time: record.needed_at_run_time }, null, 2));
  } catch (err) {
    if (err instanceof Refusal) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }
}
