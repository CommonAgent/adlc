// The three things that must be true of every image this tool describes, for
// every package, whatever else changes. They are asserted here rather than
// read off the Dockerfile in review, because all three fail silently: an image
// with a credential in a layer looks exactly like one without, a baked job
// folder answers the first message correctly, and a build step that runs a
// package's own script produces a working image the first time.
// Run: node --test "test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { GATEWAY_FILE, carriesGateway, gatewaySource, hasModelSystem, needsHarness } from "../emit-image.mjs";
import { emit, forbiddenIn, isImageRef, readPackage, Refusal, requiredVariables } from "../emit-image.mjs";
import { readEnvironment, fillArgv } from "../one-message.mjs";
import { builtPackage, copyLines, copyOfPackage, messageAndJob, rewriteAuthored, runLines, tmp } from "./helpers.mjs";

const FIXTURES = ["process-runner", "explainer-maker", "explainer-critic"];
const emitTo = (name) => emit(builtPackage(name), join(tmp("agentmesh-ctx-"), "ctx"));
// Everything this tool authors. The package's own bytes are not in this list:
// they go in verbatim, they were scanned at the depot's door, and rewriting
// them would break the digests that tie the image to a build record.
const AUTHORED = ["Dockerfile", ".dockerignore", "entrypoint.mjs", "check-lockfile.mjs", "run.json", "build-inputs.json"];

test("no credential value, address, endpoint or account identifier is written into anything emitted", () => {
  for (const name of FIXTURES) {
    const { out, record } = emitTo(name);
    for (const rel of readdirSync(out)) {
      // The model gateway is the host's own program, copied as it is for a
      // package that declares a model system (12.4.1) or wakes a harness
      // (technical debt 619), and for no other.
      if (rel === GATEWAY_FILE) {
        const install = readPackage(builtPackage(name)).install;
        assert.ok(hasModelSystem(install) || needsHarness(install), `${name} carries the model gateway and neither declares a model system nor wakes a harness`);
        assert.equal(readFileSync(join(out, rel), "utf8"), gatewaySource(), "the gateway is copied as it is");
        continue;
      }
      if (!AUTHORED.includes(rel)) {
        assert.equal(rel, "package", `${rel} is neither the package nor a file this tool authors`);
        continue;
      }
      // Scanned with the one string this tool checked against a grammar of its
      // own, exactly as emit does. The base is a real registry reference now
      // that it is resolved from what the package declares rather than left at
      // a plain node default, and a registry path reads to the prose scan as a
      // credential; the test below is what proves masking one does not switch
      // the scan off around it.
      const problems = forbiddenIn(readFileSync(join(out, rel), "utf8"), `${name}/${rel}`, [record.base.image]);
      assert.deepEqual(problems, [], problems.join("; "));
    }
  }
});

test("the variables that hold credentials are named in the image and never assigned in it", () => {
  const { out } = emitTo("explainer-maker");
  const df = readFileSync(join(out, "Dockerfile"), "utf8");
  const vars = requiredVariables(readPackage(builtPackage("explainer-maker")).install);
  const named = [...vars.credentials, ...vars.settings, ...vars.ceilings].map((v) => v.env);
  // draft-host is brokered since explainer-maker 0.12.0, so the fixture has
  // two credentials and two ceilings and no settings of its own.
  assert.ok(named.length >= 4, "the fixture really does need credentials and a ceiling");
  for (const env of named) {
    assert.ok(df.includes(env), `${env} should be named, so a person knows what the container must be given`);
    // Named, never set. ENV TTS_API_KEY= with any value on the right, even an
    // empty one, is a value in a layer and a variable the platform's own
    // binding would then have to fight.
    for (const verb of ["ENV", "ARG"]) {
      assert.doesNotMatch(df, new RegExp(`^${verb}\\s+${env}=`, "m"), `${verb} ${env}= is a value in the image`);
    }
    assert.doesNotMatch(df, new RegExp(`export\\s+${env}=`), `${env} must not be exported by a build step`);
  }
  // A ceiling number is the owner's instruction, not the package's suggestion.
  // Found by name: the fixture has grown a second spending system since this
  // was written, and which one sorts first is not what the check is about.
  const install = readPackage(builtPackage("explainer-maker")).install;
  const speech = install.ceilings.find((c) => c.system === "text-to-speech" || c.name === "text-to-speech");
  assert.equal(speech?.suggested, 20000, "the fixture carries a suggested number");
  assert.doesNotMatch(df, /20000/, "a suggested number binds nothing until an instruction adopts it");
});

test("an install file carrying a value, an address or an identifier is refused before anything is written", () => {
  const cases = [
    ["a credential value", (i) => { i.systems[0].credential = "sk_live_51H8xQ2eZvKYlo2Cabcdef"; }],
    ["an address", (i) => { i.systems[0].endpoint = "https://tts.example.com/v1/speak"; }],
    ["an account identifier", (i) => { i.systems[0].account = "explainer.maker@agentmesh.example"; }],
  ];
  for (const [what, spoil] of cases) {
    const dir = rewriteAuthored(copyOfPackage("explainer-maker"), "install", spoil);
    let message = null;
    try { readPackage(dir); } catch (err) {
      assert.ok(err instanceof Refusal, `${what}: expected a refusal, got ${err}`);
      message = err.message;
    }
    assert.ok(message, `${what} was not refused`);
    assert.match(message, /the install file carries/);
    assert.match(message, /Nothing was written\./);
  }
});

test("the job folder comes from MESH_JOB_DIR, and is never baked into the image", () => {
  const { out } = emitTo("process-runner");
  const df = readFileSync(join(out, "Dockerfile"), "utf8");
  // Baking one would answer the first message correctly and file every later
  // one into the first message's folder, which is the shape of a delivery
  // nobody collects.
  assert.doesNotMatch(df, /MESH_JOB_DIR/, "the job folder belongs to one message, and an image outlives them all");
  assert.doesNotMatch(df, /MESH_JOB_OUT/);

  let refused = null;
  try { readEnvironment({ AGENT_PACKAGE: "process-runner" }); } catch (err) { refused = err.message; }
  assert.match(refused ?? "", /MESH_JOB_DIR is not set/);
  assert.match(refused ?? "", /this container does not guess one/);

  const { jobDir } = messageAndJob({ id: "m1" });
  const spec = JSON.parse(readFileSync(join(out, "run.json"), "utf8"));
  const argv = fillArgv(spec, { id: "m1", handle: "someone" }, jobDir);
  assert.ok(argv.includes(jobDir), "the command is given the folder the environment named");
  assert.ok(!argv.some((a) => a.includes("{job_dir}")), "and no placeholder is left in it");
});

test("nothing from the package is executed at build time except the install from its lockfiles", () => {
  for (const name of FIXTURES) {
    const { out } = emitTo(name);
    const df = readFileSync(join(out, "Dockerfile"), "utf8");
    const home = `/home/agent/${name}`;
    for (const line of runLines(df)) {
      if (!line.includes(home)) continue;
      // A build step that names the package's own path may only make the
      // directory it will be copied into, or change into it to hand it to
      // npm. Running one of its scripts would be the installer executing what
      // it was given, which 12.6 rule 7 keeps to the agent's own harness, and
      // a build layer is nobody's harness.
      for (const part of line.split(";").map((p) => p.trim()).filter((p) => p.includes(home))) {
        assert.match(part, /^(cd '|mkdir -p )/, `a build step does more to the package than make it or cd into it: ${part}`);
      }
      if (line.includes(`cd '${home}`)) {
        assert.match(line, /npm ci --ignore-scripts/, `${line} enters the package and is not the lockfile install`);
      }
      assert.doesNotMatch(line, new RegExp(`node\\s+${home}`), "a build step runs one of the package's own scripts");
    }
    // And what is copied in is the package, the entrypoint, the lockfile
    // check and the command spec, and nothing else at all.
    // ... and the host's model gateway, for a package that declares a model
    // system or wakes a harness.
    const install = readPackage(builtPackage(name)).install;
    const gateway = carriesGateway(install, needsHarness(install)) ? [GATEWAY_FILE] : [];
    for (const [from] of copyLines(df)) {
      assert.ok(["package/", "entrypoint.mjs", "check-lockfile.mjs", "run.json", ...gateway].includes(from), `unexpected copy of ${from}`);
    }
  }
});

test("the image holds no identity: no key, no handle, no creds file", () => {
  const { out } = emitTo("process-runner");
  const df = readFileSync(join(out, "Dockerfile"), "utf8");
  for (const word of [/\.creds\b/, /\bseed\b/i, /public_key/, /nkey/i, /PRIVATE KEY/]) {
    assert.doesNotMatch(df, word, `the Dockerfile should not mention ${word}`);
  }
  // The subject is minted at install and the handle is the owner's decision;
  // an image is built once and copied everywhere, so an image that carried
  // either would be that one agent, forever, wherever it ran.
  assert.doesNotMatch(df, /^ENV AGENT_NAME=/m);
  assert.ok(statSync(join(out, "package")).isDirectory());
});

// ── an image reference is a shape, not prose ────────────────────────────────
//
// The prose scan looks for long runs of token characters mixing letters and
// digits, which is what a credential value looks like. It is also exactly what
// a real registry path looks like: the first base image we passed,
// gcr.io/langbench-1528148150979/agentmesh-base, is forty four such characters
// and was refused as a credential. The scan was not loosened. The reference is
// checked against its own grammar and then masked before the prose scan, so
// everything around it is still read.

test("a real registry reference is accepted, and anything that is not a reference is refused", () => {
  assert.ok(isImageRef("gcr.io/langbench-1528148150979/agentmesh-base:0.88.6"));
  assert.ok(isImageRef("node:22-bookworm-slim"));
  assert.ok(isImageRef("us-docker.pkg.dev/proj/repo/img@sha256:" + "a".repeat(64)));
  assert.ok(!isImageRef("gcr.io/proj/img; rm -rf /"));
  assert.ok(!isImageRef("https://gcr.io/proj/img"));
  assert.ok(!isImageRef("ghp_" + "a1b2c3d4e5".repeat(3)));
  assert.ok(!isImageRef(""));
});

test("masking a checked reference does not blind the scan around it", () => {
  const ref = "gcr.io/langbench-1528148150979/agentmesh-base:0.88.6";
  // On its own, the reference passes once it is checked.
  assert.deepEqual(forbiddenIn(`FROM ${ref}
`, "Dockerfile", [ref]), []);
  // A credential sitting beside it is still caught: the mask replaces the
  // reference, it does not switch the scan off.
  const withKey = `FROM ${ref}
ENV K=ghp_${"a1b2c3d4e5".repeat(3)}
`;
  assert.ok(forbiddenIn(withKey, "Dockerfile", [ref]).length > 0);
  // And an unchecked reference is still read as prose, so nothing is exempt
  // merely by looking like an image.
  assert.ok(forbiddenIn(`FROM ${ref}
`, "Dockerfile", []).length > 0);
});

test("a package that wakes a harness carries the model gateway, so the host's model can reach it (technical debt 619)", () => {
  // The deployment gives a harness with no model in the instruction the host's
  // model through the gateway, as model-gateway/<model> with MODEL_ENDPOINT on
  // loopback. Which model is decided after the image is built, so an image whose
  // package wakes a harness carries the gateway whether or not it declares a
  // model system; without it the harness would call a loopback port nothing
  // listens on. The entrypoint starts it only when the job has its settings.
  const { out } = emitTo("explainer-critic");
  const install = readPackage(builtPackage("explainer-critic")).install;
  assert.ok(needsHarness(install), "the fixture no longer wakes a harness, so this proves nothing");
  assert.ok(!hasModelSystem(install), "the fixture declares a model system, so this proves nothing new");
  assert.equal(readFileSync(join(out, GATEWAY_FILE), "utf8"), gatewaySource(), "the gateway is copied as it is");
  const df = readFileSync(join(out, "Dockerfile"), "utf8");
  assert.ok(copyLines(df).some(([from]) => from === GATEWAY_FILE), "the Dockerfile does not copy the gateway in");
});
