// Print the commands that build the base images a catalogue names, in the order
// they have to run. Nothing is built here and no image is produced. What comes
// out is a list of `docker build` lines, and running them is somebody else's
// step, the same bargain emit-image.mjs makes with the build context it writes.
//
// WHY THIS EXISTS. The bases are the half of the arrangement an operator owns.
// A package declares what it needs and the catalogue answers with an image that
// has it, so before anybody can emit a single package, somebody has to have
// built those images and put them in a registry they can pull from. For us that
// happens on Cloud Build, through the config beside bases/agentmesh-harness,
// and that file is one vendor's shape and nobody else's: an operator with a
// Docker daemon and a registry has no use for it. This is the same work with
// nothing of a particular cloud in it.
//
// EVERY ARGUMENT COMES OUT OF THE CATALOGUE, and that is the point rather than
// a convenience. The catalogue already records, per base, the image it was
// built from and the context that built it, because a reader has to be able to
// ask what is underneath a tag. So the build order is a fact the file already
// holds, and so is what to pass each build: which image goes under this one,
// and what that image is expected to carry. Nothing is written down twice.
// Before this, the three tags out of the harness context carried their FROM
// images and their binary lists in the build config as well as in the
// catalogue, and a test had to exist to keep the two in step.
//
// WHAT IT WILL NOT DO. It does not know your registry, because the catalogue
// does: an entry's `image` is the full reference a build tags and a pull
// fetches, so the registry is named in the one file that is yours to edit. It
// does not invent an argument the catalogue cannot answer. Where a Dockerfile
// declares one and the catalogue has no answer, the build keeps that
// Dockerfile's own default and the printed output says so above the command,
// because a silently wrong argument is how a tag comes to claim a binary
// nothing in the build ever looked for.
//
//   needs: node >= 22
//   node build-bases.mjs [--bases <catalogue>] [--root <dir>]
//   --bases defaults to the catalogue beside this tool, --root to the directory
//   this tool is in, which is what a catalogue's `dockerfile` paths are
//   relative to. Prints shell lines, so the output can be read first and piped
//   to a shell second.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BASES, readBases, Refusal } from "./emit-image.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const refuse = (message) => { throw new Refusal(message); };

// Quoted only where a shell would read it as more than one word. Every path and
// every argument value goes through it, because a list of binaries is one
// argument with spaces in it and an unquoted one silently becomes three.
const SAFE = /^[A-Za-z0-9_@%+=:,.\/-]+$/;
export const shq = (s) => (SAFE.test(String(s)) ? String(s) : `'${String(s).replace(/'/g, `'"'"'`)}'`);

/** What a Dockerfile says about its own base and its own arguments: which build
 *  argument the FROM line names, or the literal image it names instead, and
 *  every argument it declares with the default it declares it at.
 *
 *  Read off the file rather than kept in a table here, because the file is the
 *  authority on what it accepts. bases/agentmesh calls its base NODE_BASE and
 *  the three later ones call theirs FROM_IMAGE, and a table would be a second
 *  spelling of a fact the Dockerfile already carries (12.6 rule 1). */
export function dockerfileFacts(text) {
  const defaults = {};
  for (const m of text.matchAll(/^ARG\s+([A-Za-z_][A-Za-z0-9_]*)(?:=(\S*))?/gm)) defaults[m[1]] = m[2] ?? "";
  const from = text.match(/^FROM\s+(\S+)/m)?.[1] ?? "";
  const named = from.match(/^\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?$/);
  return { args: Object.keys(defaults), defaults, fromArg: named?.[1] ?? null, fromLiteral: named ? null : from };
}

/** Every file a build context has to hold that this one does not. A Dockerfile
 *  copies files in by name, and the name can come from an argument, so the
 *  defaults are filled in before the file is looked for.
 *
 *  It is here because of the first thing an operator building bases/agentmesh
 *  runs into: that context copies in the adapter as a tarball, the tarball is
 *  made by `npm pack` and is in no repository, and docker's own message for a
 *  missing COPY source names a path inside a temporary build context that the
 *  person never made. */
export function missingFromContext(text, contextDir, args = {}) {
  const { defaults } = dockerfileFacts(text);
  const fill = (s) => s.replace(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g, (whole, k) =>
    (k in args ? args[k] : k in defaults ? defaults[k] : whole));
  const out = [];
  for (const m of text.matchAll(/^COPY\s+(?:--\S+\s+)*(.+)$/gm)) {
    const parts = m[1].trim().split(/\s+/);
    for (const src of parts.slice(0, -1).map(fill)) {
      // An absolute path is a destination in another stage rather than a file
      // in the context, a wildcard is a pattern nothing here should expand, and
      // a name still carrying a dollar sign is one no argument answered.
      if (src.startsWith("/") || src.includes("*") || src.includes("$")) continue;
      if (!existsSync(join(contextDir, src))) out.push(src);
    }
  }
  return out;
}

/** The bases that have a build context, ordered so that a base is built after
 *  the image it is built on. The catalogue's own order is usually already this
 *  order, plainest first, and where it is not this is what fixes it rather than
 *  a person reading the file top to bottom and hoping. */
export function buildOrder(bases) {
  const built = bases.filter((b) => b.dockerfile);
  const byImage = new Map(built.map((b) => [b.image, b]));
  const out = [];
  const done = new Set();
  for (let pass = 0; out.length < built.length && pass <= built.length; pass++) {
    for (const b of built) {
      if (done.has(b.image)) continue;
      // A base built on something this catalogue does not build is ready now:
      // that image is pulled rather than made here, which is what the plainest
      // entry in every catalogue is.
      if (b.built_from && byImage.has(b.built_from) && !done.has(b.built_from)) continue;
      out.push(b);
      done.add(b.image);
    }
  }
  if (out.length < built.length) {
    const stuck = built.filter((b) => !done.has(b.image)).map((b) => `${b.image} on ${b.built_from}`);
    refuse(`the catalogue's bases cannot be put in a build order: ${stuck.join("; ")}. One of them is built on `
      + `another that is built on it, so there is no image to start from.`);
  }
  return out;
}

/** One build per base that has a context: where the Dockerfile is, what the
 *  build context directory is, and every argument the catalogue can answer for
 *  it. Warnings are things a person has to act on before the command will work,
 *  and they are carried rather than thrown, because a plan with one unbuildable
 *  base in it is still the plan for the others. */
export function buildPlan(bases, { root = here } = {}) {
  const byImage = new Map(bases.map((b) => [b.image, b]));
  return buildOrder(bases).map((base) => {
    const dockerfile = resolve(root, base.dockerfile);
    if (!existsSync(dockerfile)) {
      refuse(`the catalogue says ${base.image} is built from ${base.dockerfile} and there is no file there. `
        + `Paths in the catalogue are relative to ${root}; pass --root to say where yours are.`);
    }
    const context = dirname(dockerfile);
    const text = readFileSync(dockerfile, "utf8");
    const facts = dockerfileFacts(text);
    const args = {};
    const warnings = [];
    if (base.built_from && facts.fromArg) args[facts.fromArg] = base.built_from;
    if (base.built_from && facts.fromLiteral && facts.fromLiteral !== base.built_from) {
      // The two files disagree about what is underneath this tag, and the
      // Dockerfile wins at build time whatever the catalogue says. Refused
      // rather than warned: a tag built on an image the catalogue does not
      // record is a tag nothing in the repository describes.
      refuse(`the catalogue says ${base.image} is built from ${base.built_from}, and ${base.dockerfile} builds on `
        + `${facts.fromLiteral} and takes no argument for it. One of the two is wrong, and the build would use `
        + `the Dockerfile's.`);
    }
    // What the image underneath is expected to carry, which is the check that
    // keeps one context from publishing a tag whose catalogue entry claims a
    // binary nobody put there. The catalogue is the only thing that knows: it
    // is the file that says what each base provides.
    if (facts.args.includes("REQUIRE_BINARIES")) {
      const under = byImage.get(base.built_from);
      if (under) args.REQUIRE_BINARIES = (under.provides?.binaries ?? []).join(" ");
      else {
        warnings.push(`this build asks the image under it for ${facts.defaults.REQUIRE_BINARIES ?? "nothing"}, which `
          + `is the Dockerfile's own default: ${base.built_from ?? "nothing"} is not in the catalogue, so nothing `
          + `here knows what that image carries`);
      }
    }
    for (const file of missingFromContext(text, context, args)) {
      warnings.push(`${base.dockerfile} copies ${file} and it is not in ${context}. Put it there before you build: `
        + `docker reads the context and not this repository.`);
    }
    return { image: base.image, dockerfile, context, args, warnings };
  });
}

/** The command, as a shell line. `-f` with a context directory rather than a
 *  cd, so the line can be run from anywhere and read anywhere. */
export function commandFor(step) {
  const args = Object.entries(step.args).flatMap(([k, v]) => ["--build-arg", shq(`${k}=${v}`)]);
  return ["docker", "build", "-f", shq(step.dockerfile), ...args, "-t", shq(step.image), shq(step.context)].join(" ");
}

export function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--bases") o.bases = next();
    else if (a === "--root") o.root = next();
    else if (a === "--help" || a === "-h") o.help = true;
    else throw new Refusal(`unknown argument ${a}`);
  }
  return o;
}

const thisFile = process.argv[1] ? process.argv[1].replace(/\\/g, "/").split("/").pop() : "";
if (thisFile && import.meta.url.endsWith(thisFile)) {
  try {
    const o = parseArgs(process.argv.slice(2));
    if (o.help) {
      console.error("usage: node build-bases.mjs [--bases <catalogue>] [--root <dir>]\n"
        + "prints the docker build commands for every base in the catalogue that has a build context, in the "
        + "order they have to run. Nothing is built here.");
      process.exit(0);
    }
    const path = o.bases ?? BASES;
    const plan = buildPlan(readBases(path), { root: o.root ?? here });
    console.log(`# The bases in ${path}, in the order they have to be built.`);
    console.log(`# Each is tagged as the catalogue names it, so push each tag when its build succeeds.`);
    for (const step of plan) {
      console.log("");
      for (const w of step.warnings) console.log(`# ${w}`);
      console.log(commandFor(step));
    }
  } catch (err) {
    if (err instanceof Refusal) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }
}
