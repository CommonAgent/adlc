// Where a package's base image comes from. Not from the package: an image
// reference is an address, and a package carries no address (12.6 rule 3). The
// package names what it needs in runtimes[] and binaries[], the operator's
// catalogue names what each base they built has, and the emitter joins the
// two. These tests are over that join and, more importantly, over what it
// refuses: the whole point of the catalogue is to turn a five minute cloud
// build that dies on a missing binary into an instant refusal that names it.
// Run: node --test "test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { BASES_NAME, fillRegistry, forbiddenIn, isImageRef, meetsVersion, missingFrom, needsHarness, readBases, readPackage, resolveBase, Refusal, emit } from "../emit-image.mjs";
import { ESCALATING_RUNNER, builtPackage, imageDir, tmp, writeJson } from "./helpers.mjs";

const installOf = (name) => readPackage(builtPackage(name)).install;
// What one base does not have that one package needs, the harness included. It
// has to be included: a harness is the one requirement that is not in the
// install file, so a helper that left it out would say node:22-bookworm-slim
// would have done for a package whose every message wakes a model.
const short = (base, install) => {
  const m = missingFrom(base, install, needsHarness(install));
  return [...m.runtimes, ...m.binaries, ...m.harness];
};
const refusal = (fn) => {
  try { fn(); } catch (err) {
    assert.ok(err instanceof Refusal, `expected a refusal, got ${err}`);
    return err.message;
  }
  assert.fail("nothing was refused");
};

/** A catalogue of the operator's own, for the cases the real one cannot show.
 *  Written by hand on purpose, and unlike a package fixture that is fine: a
 *  catalogue is an operator's file, not something a builder emits. */
const catalogue = (bases) => {
  const path = join(tmp("agentmesh-bases-"), "catalogue.json");
  writeJson(path, { format: "agent-image-bases-v1", bases });
  return path;
};
const providing = (image, binaries, node = "22") =>
  ({ image, provides: { runtimes: [{ name: "node", version: node }], binaries } });

test("the base is the plainest one in the catalogue that has everything the package declares", () => {
  const bases = readBases();
  // One package per rung of the real catalogue: no binary at all, the adapter,
  // the browser. All three wake a model, which is not a coincidence and is the
  // point: code-writer declares no binary and still cannot go on the plainest
  // base, because it names no command for its job (brief-writer was the
  // example until 0.5.2 named one), and process-runner names
  // one and can still say the turn needs judgment. The rung below is the test
  // after this one.
  for (const [name, wanted, harness] of [["code-writer", [], true], [ESCALATING_RUNNER, ["agentmesh"], true],
    ["explainer-critic", ["chromium"], true]]) {
    const install = installOf(name);
    const chosen = resolveBase(install, { packageName: name });
    assert.equal(chosen.checked, true);
    assert.equal(chosen.from, BASES_NAME, "with no --base the answer comes from the catalogue");
    const at = bases.findIndex((b) => b.image === chosen.image);
    assert.ok(at >= 0, `${chosen.image} is not in the catalogue`);
    assert.deepEqual(short(bases[at], install), [], `${name} needs something ${chosen.image} has not got`);
    for (const b of wanted) assert.ok(bases[at].provides.binaries.includes(b), `${name} should land on a base with ${b}`);
    assert.equal(needsHarness(install), harness, `${name} was read the wrong way round on whether it wakes a model`);
    // The harness is not a binary and the package never names it, so the base
    // has to carry the answer and the emitter has to take the path from there
    // rather than from a default of its own.
    if (harness) assert.ok(chosen.harness?.bin, `${chosen.image} was chosen for ${name} and names no harness`);
    // Plainest, not merely one that fits: nothing earlier in the catalogue
    // would have done, so a package needing only node is never handed an
    // image carrying a browser.
    for (const earlier of bases.slice(0, at)) {
      assert.ok(short(earlier, install).length, `${earlier.image} would also have done, so it should have been chosen`);
    }
    // And the package never named it. This is the thing the whole arrangement
    // exists for: the answer is the operator's, the requirement is the
    // package's, and neither file carries the other's half.
    assert.ok(!JSON.stringify(install).includes(chosen.image), "the install file names the base it was built on");
  }
});

test("the escalation is what puts a harness in the image, and a command that cannot escalate needs none", () => {
  // The pair that shows the question is about the WORK and not about the
  // package. process-runner names a command for its job and can also say the
  // turn needs judgment, so one message in a hundred wakes a model and the
  // image has to carry a harness for that one. Take the escalation out and
  // nothing else changes, and the same package drops to a plainer base.
  const install = installOf(ESCALATING_RUNNER);
  assert.equal(needsHarness(install), true, "process-runner can say a turn needs judgment, so it can wake a model");
  const escalating = resolveBase(install, { packageName: "process-runner" });
  assert.ok(escalating.harness?.bin, "a package that can escalate was put on a base with no harness");

  const never = JSON.parse(JSON.stringify(install));
  delete never.run["run-a-process"].escalate_when;
  assert.equal(needsHarness(never), false);
  const plain = resolveBase(never, { packageName: "process-runner" });
  assert.equal(plain.harness, null, "a package that wakes no model was handed a harness");
  const bases = readBases();
  assert.ok(bases.findIndex((b) => b.image === plain.image) < bases.findIndex((b) => b.image === escalating.image),
    "dropping the escalation should drop the image to a plainer base, not move it sideways");
});

test("a package needing a binary no base has is refused, instead of spending a build to find out", () => {
  // video-watcher was the real case: it declares ffmpeg, ffprobe and yt-dlp,
  // and for a while nobody had built a base with them. Before the catalogue
  // this emitted a context that built for four minutes and then stopped at
  // the check. The base exists now, so the refusal is put back the only
  // honest way: the operator's own catalogue as it stood the day before, with
  // the real package and the real purposes it declares.
  const before = catalogue(readBases().filter((b) => !b.provides.binaries.includes("ffmpeg")));
  const message = refusal(() => resolveBase(installOf("video-watcher"), { bases: before, packageName: "video-watcher" }));
  for (const binary of ["ffmpeg", "ffprobe", "yt-dlp"]) assert.ok(message.includes(binary), `${binary} is not named`);
  assert.match(message, /reads the video/, "the purpose, so the refusal reads as an escalation and not a crash");
  for (const base of readBases(before)) assert.ok(message.includes(base.image), `${base.image} was not said to have been considered`);
  assert.match(message, /Build a base that has what is missing/);
  assert.match(message, /Nothing is installed into a package's image to make a check pass/);
});

test("video-watcher resolves onto the base that has the three binaries AND the harness", () => {
  // The case the video harness base was built for. video-watcher resolved
  // onto the video base on 2026-09-11 and the image built; it could not have
  // answered anything, because the package names no command for its job, so
  // every message wakes a model and that base carries no harness. The emitter
  // caught it on the next emit and refused, naming the one thing missing. This
  // is that refusal answered: the video base with the harness on top.
  const install = installOf("video-watcher");
  assert.equal(needsHarness(install), true, "video-watcher names no command for its job, so every message wakes a model");
  const chosen = resolveBase(install, { packageName: "video-watcher" });
  assert.equal(chosen.checked, true);
  assert.equal(chosen.from, BASES_NAME, "with no --base the answer comes from the catalogue");
  const bases = readBases();
  const at = bases.findIndex((b) => b.image === chosen.image);
  assert.ok(at >= 0, `${chosen.image} is not in the catalogue`);
  assert.deepEqual(short(bases[at], install), [], "the base it landed on is missing something video-watcher declares");
  for (const binary of ["ffmpeg", "ffprobe", "yt-dlp"]) {
    assert.ok(bases[at].provides.binaries.includes(binary), `video-watcher should land on a base with ${binary}`);
  }
  // The half the package never declares and cannot: 12.9 keeps the harness out
  // of a package, so the base has to carry the answer and the emitter has to
  // take the path from there rather than from a default of its own.
  assert.ok(chosen.harness?.bin, `${chosen.image} was chosen for video-watcher and names no harness`);
  // Plainest, not merely one that fits. The video base is still the right
  // answer for a package that reads video with a script and wakes no model,
  // and this base must not have taken its place in front of it.
  for (const earlier of bases.slice(0, at)) {
    assert.ok(short(earlier, install).length, `${earlier.image} would also have done, so it should have been chosen`);
  }
  assert.ok(!JSON.stringify(install).includes(chosen.image), "the install file names the base it was built on");
});

test("the catalogue moved the failure earlier and did not replace the check", () => {
  // A base entry that turns out to be wrong must still stop the build naming
  // the binary, which is what makes the entry a claim somebody can test. This
  // runs against the operator's real catalogue, because video-watcher resolves
  // onto a base again: the choice and the check are two different things, and
  // the check is what is under test here.
  const { record, out } = emit(builtPackage("video-watcher"), join(tmp("agentmesh-ctx-"), "ctx"));
  const df = readFileSync(join(out, "Dockerfile"), "utf8");
  for (const b of ["ffmpeg", "ffprobe", "yt-dlp"]) {
    assert.ok(df.includes(`command -v '${b}'`), `the build does not check ${b}`);
    assert.ok(df.includes(`BINARY_${b.toUpperCase().replace(/-/g, "_")}=`), `nothing records where ${b} is`);
  }
  // And the harness, which no package declares and every model-driven one
  // needs. An image that built clean onto a base without one was the whole
  // failure: it refused its first message and the build had said nothing.
  assert.match(df, /test -x "\$\{HARNESS_BIN\}"/, "the build does not check that the base has a harness");
  assert.doesNotMatch(df, /apt-get/, "an image that installed a declared binary would be the substitution 12.4 rule 1 forbids");
  assert.ok(!JSON.stringify(installOf("video-watcher")).includes(record.base.image), "the install file names the base it was built on");
});

test("a base the catalogue claims a binary for has a Dockerfile that proves it", () => {
  // The cost the catalogue buys its speed with: two files kept in step by
  // hand. An entry saying a base provides a binary that its Dockerfile never
  // checks is a claim nothing makes true, and the first anyone hears of it is
  // a package built on that base dying at the check. This is the join.
  const all = readBases();
  const built = all.filter((b) => b.dockerfile);
  assert.ok(built.length >= 3, "the operator has built more than two bases and they should all be in here");
  // Every file in the base's own directory, because one context can publish
  // more than one tag and then the FROM image is a build argument: the
  // harness base makes both the plain one and the one with the browser under
  // it, and which is which lives in the build config beside the Dockerfile.
  // A tag built from an argument typed at a prompt is a tag nothing records.
  const sources = (base) => {
    const dir = dirname(join(imageDir, base.dockerfile));
    return fillRegistry(readdirSync(dir).map((f) => readFileSync(join(dir, f), "utf8")).join("\n"));
  };
  // A claim is proved by this base's own Dockerfile or by that of a base it
  // was built from, following the catalogue down. Layering is the point of a
  // base: the chromium harness base carries chromium because the chromium
  // base put it there and proved it, and asking it to prove chromium again
  // would mean either a second copy of that apt block or a context that
  // cannot serve both its tags.
  const provenIn = (base, binary, seen = new Set()) => {
    if (!base || seen.has(base.image)) return false;
    seen.add(base.image);
    if (base.dockerfile && new RegExp(`command -v ${binary}\\b`).test(readFileSync(join(imageDir, base.dockerfile), "utf8"))) return true;
    return provenIn(all.find((b) => b.image === base.built_from), binary, seen);
  };
  for (const base of built) {
    const path = join(imageDir, base.dockerfile);
    const text = fillRegistry(readFileSync(path, "utf8"));
    assert.ok(sources(base).includes(base.built_from), `nothing beside ${base.dockerfile} says ${base.image} is built from ${base.built_from}`);
    for (const binary of base.provides.binaries) {
      assert.ok(provenIn(base, binary), `${base.image} claims ${binary} and nothing in its chain proves it`);
    }
    // The harness is claimed the same way and proved the same way: by running
    // it, not by looking for the file. A base that lost opencode would
    // otherwise publish, and every package built on it would refuse its first
    // message with words about a harness that is sitting right there.
    if (base.provides.harness) {
      assert.match(text, /opencode --version/, `${base.image} claims a harness and never starts it`);
      assert.ok(text.includes(base.provides.harness.bin), `${base.image} says its harness is at ${base.provides.harness.bin} and the build never puts one there`);
    }
    // No agent is in a base. The same image runs for every agent that ever
    // uses it, so a key or a handle in one would be bound for all of them.
    //
    // Two kinds of long string belong here and are checked against their own
    // shape before being masked out of the prose scan, the way the emitter
    // treats a base image: an ARG default, which is always a pin, and an
    // address, which an operator's file may carry and a package may not. An
    // ARG default reaching a build layer is the same hazard the catalogue
    // test names, so it is checked and never waved through.
    const pins = [...text.matchAll(/^ARG\s+\w+=(\S+)/gm)].map((m) => m[1]);
    for (const pin of pins) {
      // The four shapes an ARG default is allowed to be here, each of which a
      // reader can tell from a key at a glance: an image reference, a digest,
      // an absolute path to something the build puts in the image, and the
      // NAME of an environment variable. Anything else is refused rather than
      // waved through, because an ARG default does reach a build layer and
      // "it is probably fine" is how a key gets into one.
      const allowed = isImageRef(pin) || /^[0-9a-f]{64}$/.test(pin)
        || /^\/[A-Za-z0-9_./-]+$/.test(pin) || /^[A-Z][A-Z0-9_]*$/.test(pin);
      assert.ok(allowed, `${base.dockerfile} pins ${pin}, which is not an image reference, a digest, a path or a `
        + `variable name, so nothing here can say it is not a key`);
    }
    const addresses = text.match(/[a-z][a-z0-9+.-]*:\/\/\S+/gi) ?? [];
    for (const a of addresses) assert.match(a, /^https:\/\//, `${base.dockerfile} fetches over a plain connection`);
    assert.deepEqual(forbiddenIn(text, base.dockerfile, [...pins, ...addresses]), [],
      `${base.dockerfile} carries something that is bound per install`);
  }
});

test("one context publishes three tags, and each asks the image under it for what the catalogue claims", () => {
  // The harness base, the one with the browser under it and the one with the
  // video tools under it are ONE Dockerfile and three FROM images, because a
  // package that wakes a model must not be handed a browser or a video toolkit
  // it has no use for. That is what makes the built_from line load bearing: a
  // step pointed at the wrong image would publish a tag the catalogue says
  // carries ffmpeg, the build would pass every check in it, and the first
  // anyone would hear of it is a package dying four minutes into its own
  // build. So the context asks the image underneath for the binaries that
  // tag's catalogue entry claims, and this is the join between the two files.
  const dir = join(imageDir, "bases", "agentmesh-harness");
  const dockerfile = readFileSync(join(dir, "Dockerfile"), "utf8");
  assert.match(dockerfile, /for b in \$\{REQUIRE_BINARIES\}/, "the context never asks the image underneath for anything");
  const config = fillRegistry(readFileSync(join(dir, "cloudbuild.yaml"), "utf8"));
  const values = Object.fromEntries([...config.matchAll(/^\s{2}(_[A-Z0-9_]+):\s*(.+)$/gm)].map((m) => [m[1], m[2].trim()]));
  const steps = [...config.matchAll(/args:\s*\[(.+)\]/g)]
    .map((m) => m[1].replace(/\$\{(_[A-Z0-9_]+)\}/g, (_, k) => values[k] ?? "")
      .split(",").map((a) => a.trim().replace(/^"|"$/g, "")));
  const shared = readBases().filter((b) => b.dockerfile === "bases/agentmesh-harness/Dockerfile");
  assert.equal(shared.length, 3, "three tags come out of that one context, and each needs a step of its own");
  for (const base of shared) {
    const step = steps.find((a) => a.includes(base.image));
    assert.ok(step, `nothing beside the Dockerfile builds ${base.image}, so that tag is built from an argument typed at a prompt`);
    const argument = (name) => step.find((a) => a.startsWith(`${name}=`))?.slice(name.length + 1);
    assert.equal(argument("FROM_IMAGE"), base.built_from,
      `${base.image} is built on something other than the image the catalogue records it was built from`);
    const asked = (argument("REQUIRE_BINARIES") ?? "").split(/\s+/).filter(Boolean);
    for (const binary of base.provides.binaries) {
      assert.ok(asked.includes(binary), `${base.image} claims ${binary} and its build never asks the image underneath for it`);
    }
  }
});

test("a base the operator names is checked against what the package declares", () => {
  const plainest = readBases()[0].image;
  const message = refusal(() => resolveBase(installOf("explainer-critic"), { base: plainest, packageName: "explainer-critic" }));
  assert.match(message, /is missing chromium/);
  assert.match(message, /The build would stop at the check for it/);
  assert.match(message, /leave --base off and let the catalogue answer/);
});

test("a base the catalogue does not know is the operator's word, and the record says it was not checked", () => {
  // Refusing would mean a base an operator built ten minutes ago cannot be
  // used until the file is edited. The build step still checks every binary,
  // so the cost of trusting them is a build failure they can read.
  const unknown = "gcr.io/langbench-1528148150979/some-base-nobody-listed:1";
  const { record, out } = emit(builtPackage("explainer-critic"), join(tmp("agentmesh-ctx-"), "ctx"), { base: unknown });
  assert.deepEqual(record.base, { image: unknown, from: "--base", checked: false });
  const df = readFileSync(join(out, "Dockerfile"), "utf8");
  assert.ok(df.includes(`ARG BASE_IMAGE=${unknown}`), "the operator's base is what the context builds on");
  assert.match(df, /command -v 'chromium'/, "and the check for what the package declares is still in the build");
});

test("the emitted record and the FROM line cannot disagree about what the image is built on", () => {
  const { record, out } = emit(builtPackage("process-runner"), join(tmp("agentmesh-ctx-"), "ctx"));
  const df = readFileSync(join(out, "Dockerfile"), "utf8");
  assert.ok(df.includes(`ARG BASE_IMAGE=${record.base.image}`));
  assert.equal(record.base.checked, true);
  assert.equal(record.base.from, BASES_NAME);
});

test("a base that does not reach the runtime version the package asks for is missing, not close enough", () => {
  assert.equal(meetsVersion("22.20.0", ">=22"), true);
  assert.equal(meetsVersion("22", ">=22.11"), false, "22.0 is not 22.11");
  assert.equal(meetsVersion("20.19.0", ">=22"), false);
  assert.equal(meetsVersion("18", null), true, "a package that asks for no version takes what is there");
  assert.equal(meetsVersion(null, ">=22"), false, "a base that says nothing has not said 22");
  // The catalogue is coarse on purpose: major and minor, and the exact check
  // is the node one-liner in the image. Coarse still has to refuse this.
  const old = catalogue([providing("registry.example/old-node:1", ["agentmesh"], "20.19.0")]);
  const message = refusal(() => resolveBase(installOf("process-runner"), { bases: old, packageName: "process-runner" }));
  assert.match(message, /node >=22/);
  assert.match(message, /is missing node >=22/);
});

test("the catalogue has to be a catalogue: images only, no credential, and no file is not an answer", () => {
  const bases = readBases();
  assert.ok(bases.length >= 2, "the operator really has built more than one base");
  for (const b of bases) {
    assert.ok(Array.isArray(b.provides?.binaries), `${b.image} does not say which binaries it provides`);
    assert.ok(b.why, `${b.image} does not say why it exists`);
  }
  assert.match(refusal(() => readBases(catalogue([{ image: "gcr.io/proj/img; rm -rf /", provides: { binaries: [] } }]))),
    /not a container image reference/);
  // A catalogue may carry image references, because it is the operator's file
  // and not a package. It may not carry a key: this file's values reach a
  // build argument, and a key in a build layer is revoked, never unpublished.
  const withKey = catalogue([{ ...providing("registry.example/img:1", []), token: "ghp_" + "a1b2c3d4e5".repeat(3) }]);
  assert.match(refusal(() => readBases(withKey)), /reads as a credential value/);
  assert.match(refusal(() => readBases(join(tmp("agentmesh-bases-"), "nothing.json"))), /there is no base catalogue at/);
  const wrongFormat = join(tmp("agentmesh-bases-"), "catalogue.json");
  writeJson(wrongFormat, { format: "something-else", bases: [] });
  assert.match(refusal(() => readBases(wrongFormat)), /format is "something-else"/);
});

test("the harness is granted the directories the deployment bound, and not the mount they sit on", async () => {
  // The critic's first real run on Cloud Run ended with "Read /mesh/jobs/
  // explainer-critic/critic-run-1/script.json failed: the user rejected
  // permission" and no review. opencode asks before it touches a directory
  // outside its project, nobody is there to answer in a container, so it
  // refuses itself. On a host the question never arises, because the fleet's
  // job folders are under the agent's own home; on a mount they cannot be.
  const { boundDirectories, configFor } = await import("../bases/agentmesh-harness/opencode-config.mjs");
  const env = {
    MESH_JOB_DIR: "/mesh/jobs/explainer-critic/m1/",
    AGENT_DIRECTORY_RECORDS: "/mesh/state/explainer-critic/records",
    AGENT_NAME: "explainer-critic",
    GOOGLE_GENERATIVE_AI_API_KEY: "not-a-key",
  };
  // The agent's own state folder comes with its directories: the package
  // lives there beside them, and a model reading its own skill file from it
  // was refused whole (code-writer, 2026-09-22). Derived from the directory
  // and the agent's name, so another agent's folder is never granted.
  assert.deepEqual(boundDirectories(env),
    ["/mesh/jobs/explainer-critic/m1", "/mesh/state/explainer-critic", "/mesh/state/explainer-critic/records"]);
  assert.deepEqual(boundDirectories({ ...env, AGENT_NAME: "somebody-else" }),
    ["/mesh/jobs/explainer-critic/m1", "/mesh/state/explainer-critic/records"]);
  const external = configFor(env).permission.external_directory;
  // Three spellings per directory: opencode asks about the PARENT of the file
  // it is opening with a star after it, so a grant on the directory alone does
  // not cover a file in it, and a grant on its children does not cover the
  // per-job folder the critic makes under its records directory.
  for (const dir of boundDirectories(env)) {
    for (const p of [dir, `${dir}/*`, `${dir}/**`]) assert.equal(external[p], "allow", `${p} is not granted`);
  }
  // And nothing wider. One bucket serves the whole fleet, so a blanket grant
  // would hand every other agent's records to whoever happened to be reading,
  // which is a worse failure than the one this fixes and a silent one.
  for (const wider of ["/mesh", "/mesh/*", "/mesh/**", "/mesh/state", "/mesh/state/*"]) {
    assert.equal(external[wider], undefined, `${wider} is granted, and it is not this agent's to read`);
  }
  // Everything else is DENIED, and the deny is the first key. A question
  // nobody answers is a rejection in `opencode run`, and a rejection ends the
  // run: converted agents globbed /mesh on 2026-09-24 and exited 3 with
  // nothing delivered. A deny is a tool error the model reads and gets past.
  // opencode takes the last rule that matches, so the deny must come before
  // every allow or it would refuse the job folder too.
  assert.equal(external["*"], "deny", "a directory nobody bound is asked about, and in a container the question ends the run");
  assert.equal(Object.keys(external)[0], "*", "the catch-all is not first, so it wins over the allows after it");
  // The container's own /tmp is always granted: a task's scratch space is
  // nobody else's, and a model staging its work there was refused whole
  // (code-writer, 2026-09-22).
  for (const p of ["/tmp", "/tmp/*", "/tmp/**"]) assert.equal(external[p], "allow", `${p} is not granted`);
  // A container given nothing grants only its own scratch space, rather than
  // falling back to a guess about where a job folder usually is.
  assert.deepEqual(Object.entries(configFor({}).permission.external_directory),
    [["*", "deny"], ["/tmp", "allow"], ["/tmp/*", "allow"], ["/tmp/**", "allow"]]);
});
