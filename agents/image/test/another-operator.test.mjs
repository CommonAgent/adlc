// Everything an operator who is not us needs, and nothing of ours in the way.
//
// The catalogue beside the emitter is one operator's file: every image in it
// is in one private registry, and a person with their own packages, their own
// registry and a Docker daemon cannot pull a single one of them. That is not a
// gap in the design, because a package names no image and the operator answers
// with their own; it was a gap in what shipped, because the only catalogue in
// here was ours and there was no path from a package to an image that did not
// run through our project. These tests are over that path: the template an
// operator starts their own catalogue from, the reading of a catalogue that is
// not ours, and the commands that build the bases a catalogue names.
// Run: node --test "test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BASES, describeBases, fillRegistry, emit, readBases, Refusal } from "../emit-image.mjs";
import { buildOrder, buildPlan, commandFor, dockerfileFacts, missingFromContext } from "../build-bases.mjs";
import { ESCALATING_RUNNER, builtPackage, imageDir, tmp, writeJson } from "./helpers.mjs";

const TEMPLATE = join(imageDir, "bases", "catalogue.template.json");
const emitter = join(imageDir, "emit-image.mjs");
const refusal = (fn) => {
  try { fn(); } catch (err) {
    assert.ok(err instanceof Refusal, `expected a refusal, got ${err}`);
    return err.message;
  }
  assert.fail("nothing was refused");
};
const catalogue = (bases) => {
  const path = join(tmp("agentmesh-bases-"), "catalogue.json");
  writeJson(path, { format: "agent-image-bases-v1", bases });
  return path;
};

test("the template is a catalogue this tool accepts, and carries no image only we can pull", () => {
  const template = readBases(TEMPLATE);
  assert.ok(template.length >= 2, "a template with one base teaches nothing about the order");
  // Every image we built and put in our own registry, which is exactly what a
  // template must not carry: a person who copies it and edits the entries they
  // recognise would be left pointing at a tag they cannot fetch, and the first
  // they would hear of it is a build stopping at a pull.
  const ours = new Set(readBases().filter((b) => b.dockerfile).map((b) => b.image));
  for (const b of template) {
    assert.ok(!ours.has(b.image), `${b.image} is one of ours, and a template is the shape without the answers`);
    // The members the emitter reads, and the one a person reads. A template
    // whose entries were missing one of them would teach the shape wrong.
    assert.ok(Array.isArray(b.provides?.binaries), `${b.image} does not say which binaries it provides`);
    assert.ok(b.provides?.runtimes?.length, `${b.image} does not say which runtime it carries`);
    assert.ok(b.why, `${b.image} does not say why it exists`);
    if (b.dockerfile) {
      assert.ok(existsSync(join(imageDir, b.dockerfile)), `${b.image} points at ${b.dockerfile}, which is not here`);
      assert.ok(b.built_from, `${b.image} is built by ${b.dockerfile} and does not say what it is built on`);
    }
  }
  // The harness is the member nobody guesses right the first time, because no
  // package declares one and the shape is not in any package. A template with
  // no harness entry in it leaves an operator to invent the spelling.
  const harness = template.find((b) => b.provides?.harness);
  assert.ok(harness?.provides.harness.bin, "no entry in the template shows what a base with a harness looks like");
});

test("a package resolves onto the operator's own image with nothing of ours named", () => {
  // The whole point, end to end: our emitter, our base contexts, our package
  // fixture, and an answer that is the operator's image and not ours.
  const { record, out } = emit(builtPackage(ESCALATING_RUNNER), join(tmp("agentmesh-ctx-"), "ctx"), { bases: TEMPLATE });
  const chosen = readBases(TEMPLATE).find((b) => b.image === record.base.image);
  assert.ok(chosen, `${record.base.image} is not in the catalogue that was named`);
  assert.equal(record.base.checked, true);
  assert.ok(chosen.provides.harness?.bin, "process-runner can say a turn needs judgment, so it needs a harness");
  assert.equal(record.harness.bin, chosen.provides.harness.bin, "the harness path came from somewhere other than the catalogue");
  const df = readFileSync(join(out, "Dockerfile"), "utf8");
  assert.ok(df.includes(`ARG BASE_IMAGE=${record.base.image}`));
  for (const mine of readBases(BASES).map((b) => b.image)) {
    if (readBases(TEMPLATE).some((b) => b.image === mine)) continue;
    assert.ok(!df.includes(mine), `${mine} is in the emitted Dockerfile and the operator never named it`);
  }
});

test("a catalogue with no base for what a package declares refuses, whoever the operator is", () => {
  // The template carries no browser, and explainer-critic declares one. The
  // refusal has to read the same for an operator with three bases as it does
  // for us with seven: what is missing, what it is for, and build a base.
  const message = refusal(() => emit(builtPackage("explainer-critic"), join(tmp("agentmesh-ctx-"), "ctx"), { bases: TEMPLATE }));
  assert.match(message, /chromium/);
  assert.match(message, /Build a base that has what is missing/);
  for (const b of readBases(TEMPLATE)) assert.ok(message.includes(b.image), `${b.image} was not said to have been considered`);
});

test("a catalogue can be read and reported on before there is a package to try it with", () => {
  const seen = describeBases(TEMPLATE);
  const harness = seen.find((b) => b.harness);
  assert.ok(harness, "nothing in the template was reported as carrying a harness");
  assert.deepEqual(seen.map((b) => b.image), readBases(TEMPLATE).map((b) => b.image), "in the operator's own order");
  // Through the command line, because that is where an operator meets it, and
  // because --check-bases is the one call that takes no package at all.
  const ran = spawnSync(process.execPath, [emitter, "--check-bases", "--bases", TEMPLATE], { encoding: "utf8" });
  assert.equal(ran.status, 0, ran.stderr);
  assert.deepEqual(JSON.parse(ran.stdout).bases, seen);
  // And a file that is not a catalogue is the refusal readBases already gives,
  // rather than a crash or an empty answer.
  const wrong = spawnSync(process.execPath, [emitter, "--check-bases", "--bases", catalogue([])], { encoding: "utf8" });
  assert.equal(wrong.status, 1);
  assert.match(wrong.stderr, /names no bases/);
});

test("the commands that build a catalogue's bases come out of the catalogue, in an order that works", () => {
  const bases = readBases();
  const plan = buildPlan(bases);
  const byImage = new Map(bases.map((b) => [b.image, b]));
  assert.equal(plan.length, bases.filter((b) => b.dockerfile).length, "one build per base with a context, and no others");
  const built = new Set();
  for (const step of plan) {
    const base = byImage.get(step.image);
    // Nothing is built before the image it is built on. A plan in the wrong
    // order fails on the second build with a pull error naming a tag that is
    // about to exist, which reads as a registry problem.
    if (base.built_from && byImage.get(base.built_from)?.dockerfile) {
      assert.ok(built.has(base.built_from), `${step.image} is built before ${base.built_from}, which it is built on`);
    }
    built.add(step.image);
    // The image underneath, passed to whichever argument the Dockerfile names
    // for it, so the default in that file never decides anything.
    const facts = dockerfileFacts(readFileSync(step.dockerfile, "utf8"));
    assert.equal(step.args[facts.fromArg], base.built_from, `${step.image} is not built on what the catalogue says`);
    const command = commandFor(step);
    assert.ok(command.startsWith("docker build "), command);
    assert.ok(command.includes(`-t ${step.image}`), "the tag is the one the catalogue names");
  }
});

test("what a build asks the image under it for is what the catalogue says that image provides", () => {
  // The check that keeps one context from publishing a tag whose catalogue
  // entry claims a binary nobody put there. Three tags come out of the harness
  // context and the only binary all three have in common is the adapter, so a
  // build pointed at the wrong image underneath would otherwise pass every
  // check in it.
  const bases = readBases();
  const byImage = new Map(bases.map((b) => [b.image, b]));
  const asked = buildPlan(bases).filter((s) => "REQUIRE_BINARIES" in s.args);
  assert.ok(asked.length >= 3, "the harness context publishes three tags and each has to ask for its own list");
  for (const step of asked) {
    const under = byImage.get(byImage.get(step.image).built_from);
    assert.deepEqual(step.args.REQUIRE_BINARIES.split(" ").filter(Boolean), under.provides.binaries,
      `${step.image} asks the image under it for something other than what the catalogue says it provides`);
  }
});

test("the portable commands and the cloud build config say the same thing", () => {
  // The config beside the harness Dockerfile is one vendor's shape, and an
  // operator with a Docker daemon has no use for it. It is also the file that
  // has built every harness tag we run, so the portable path is only worth
  // anything if it produces the same builds. Where the two disagree, one of
  // them is publishing a tag that is not what the catalogue describes.
  const config = fillRegistry(readFileSync(join(imageDir, "bases", "agentmesh-harness", "cloudbuild.yaml"), "utf8"));
  const values = Object.fromEntries([...config.matchAll(/^\s{2}(_[A-Z0-9_]+):\s*(.+)$/gm)].map((m) => [m[1], m[2].trim()]));
  const steps = [...config.matchAll(/args:\s*\[(.+)\]/g)]
    .map((m) => m[1].replace(/\$\{(_[A-Z0-9_]+)\}/g, (_, k) => values[k] ?? "")
      .split(",").map((a) => a.trim().replace(/^"|"$/g, "")));
  const plan = buildPlan(readBases());
  for (const step of steps) {
    const image = step[step.indexOf("-t") + 1];
    const mine = plan.find((s) => s.image === image);
    assert.ok(mine, `the cloud build config builds ${image} and the plan does not`);
    for (const name of ["FROM_IMAGE", "REQUIRE_BINARIES"]) {
      const theirs = step.find((a) => a.startsWith(`${name}=`))?.slice(name.length + 1);
      assert.equal(mine.args[name], theirs, `${image} is built with a different ${name} on the two paths`);
    }
  }
});

test("a file a build context has to hold and does not is named before anything is run", () => {
  // The first thing an operator building the plainest base runs into. That
  // context copies the adapter in as a tarball, `npm pack` makes it and no
  // repository carries it, and docker's own message for a missing COPY source
  // names a path inside a temporary context that the person never made.
  const bases = readBases();
  const plan = buildPlan(bases);
  const forContext = (dockerfile) => {
    const base = bases.find((b) => b.dockerfile === dockerfile);
    assert.ok(base, `nothing in the catalogue is built from ${dockerfile}`);
    return plan.find((s) => s.image === base.image);
  };
  const step = forContext("bases/agentmesh/Dockerfile");
  assert.ok(step.warnings.some((w) => /\.tgz/.test(w) && /docker reads the context/.test(w)),
    `nothing said the adapter tarball has to be put in the context: ${step.warnings.join("; ")}`);
  // And a context that holds everything it copies says nothing, so the warning
  // means something when it appears.
  const harness = forContext("bases/agentmesh-harness/Dockerfile");
  assert.deepEqual(harness.warnings, [], "the harness context copies only files that are in it");
  const text = "FROM node:22\nCOPY --chown=a:b there.txt /x\nCOPY /already/absolute /y\nCOPY sub/*.mjs /z\n";
  assert.deepEqual(missingFromContext(text, imageDir), ["there.txt"], "only a plain name in the context is looked for");
});

test("a catalogue whose bases are built on each other in a circle is refused, not half planned", () => {
  const circle = catalogue([
    { image: "registry.example/a:1", provides: { binaries: [] }, why: "a", built_from: "registry.example/b:1", dockerfile: "bases/agentmesh/Dockerfile" },
    { image: "registry.example/b:1", provides: { binaries: [] }, why: "b", built_from: "registry.example/a:1", dockerfile: "bases/agentmesh/Dockerfile" },
  ]);
  const message = refusal(() => buildOrder(readBases(circle)));
  assert.match(message, /cannot be put in a build order/);
  assert.match(message, /there is no image to start from/);
  // And a context the catalogue names that is not on this machine is a refusal
  // naming what the paths are relative to, because the answer is --root and
  // not a missing file.
  const elsewhere = catalogue([{ image: "registry.example/c:1", provides: { binaries: [] }, why: "c", built_from: null, dockerfile: "bases/nothing-here/Dockerfile" }]);
  assert.match(refusal(() => buildPlan(readBases(elsewhere))), /pass --root to say where yours are/);
});
