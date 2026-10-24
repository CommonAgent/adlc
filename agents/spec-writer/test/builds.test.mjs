// The check this agent does not control.
//   node --test test/builds.test.mjs
//
// Most of these run the real builder, not a double. That is the point of the
// step: a double would be this agent checking its draft against its own idea
// of what the builder does, which is the same thing check-spec.mjs already
// does and is not evidence. Where a double appears it is for the cases the
// real builder cannot be made to produce, like exiting without answering.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BUILD_PY_DEFAULT, buildPyAt, builderSaid, checkBuilds, climbsOut, namedFiles, standIn, verdict,
} from "../scripts/builds.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BUILD_PY = join(HERE, "..", "..", "package-maker", "build.py");
const env = { BUILD_PY };
const PUBLISHER = JSON.parse(readFileSync(join(HERE, "fixtures", "publisher.spec.json"), "utf8"));
const clone = (o) => JSON.parse(JSON.stringify(o));

test("the builder is where the fleet keeps it, and a setting moves it", () => {
  // Its name on the host is agentbuilder-build.py. This said build.py, which
  // is what the repository calls it, until the package was put on the host and
  // the file was not there.
  assert.equal(BUILD_PY_DEFAULT, "/opt/fleet/agentbuilder-build.py");
  assert.equal(buildPyAt({}), BUILD_PY_DEFAULT);
  assert.equal(buildPyAt({ BUILD_PY: "/elsewhere/build.py" }), "/elsewhere/build.py");
  assert.ok(existsSync(BUILD_PY), "the real builder is not where these tests expect it");
});

test("a spec that already produced an agent is taken by the builder", () => {
  const r = checkBuilds({ spec: PUBLISHER, env });
  assert.equal(r.checked, true);
  assert.equal(r.ok, true, JSON.stringify(r.problems));
  assert.equal(r.said.name, "publisher");
});

test("the verdict never says it builds without saying what was stood in for", () => {
  const r = checkBuilds({ spec: PUBLISHER, env });
  assert.ok(r.stood_in_for.length > 0, "the publisher names files, so some were stood in for");
  const said = verdict(r);
  assert.match(said, /^The builder takes this spec\./);
  // A step that quietly created placeholders and reported "it builds" would
  // be claiming something nobody checked.
  assert.match(said, /checked the declaration and not the package/);
  assert.match(said, new RegExp(`${r.stood_in_for.length} files it names do not exist`));
});

test("the builder's refusal comes back in the builder's own words", () => {
  const bad = clone(PUBLISHER);
  bad.jobs[0].how = { control: "model", intelligence: "open", cost: "metered", contract: "full" };
  const r = checkBuilds({ spec: bad, env });
  assert.equal(r.ok, false);
  // Not paraphrased. The builder explains this one better than this agent can.
  assert.match(r.problems[0], /the shape that fails/);
  assert.match(r.problems[0], /contract: ends/);
  assert.doesNotMatch(verdict(r), /\.\./, "a doubled full stop in somebody else's sentence");
});

test("a kind that is not a kind is caught by both the builder and this agent's own check", async () => {
  const { checkSpec } = await import("../scripts/check-spec.mjs");
  const bad = clone(PUBLISHER);
  bad.jobs[0].inputs = [{ name: "the files", kind: "wingding", required: true }];
  // check-spec used to leave kinds to the builder. It names them now because
  // a container spec is never packed, so the builder's kind check never runs
  // on one, and "array of application/octet-stream" went out unnoticed (debt
  // 48). Its rule is the builder's own: four words or one media type.
  assert.match(checkSpec(bad).join(" "), /"wingding", which is not a kind/);
  const r = checkBuilds({ spec: bad, env });
  assert.equal(r.ok, false);
  assert.match(r.problems[0], /wingding/);
});

test("the builder takes any version at all, so this agent checks that itself", async () => {
  // Found by running the real builder rather than a double: "one point oh"
  // builds. Release pointers are bare semver, so a version the builder takes
  // can still be one nothing downstream can order. check-spec covers it, and
  // this test is here so that the day the builder starts checking, somebody
  // sees that the two now overlap.
  const { checkSpec } = await import("../scripts/check-spec.mjs");
  const bad = clone(PUBLISHER);
  bad.version = "one point oh";
  assert.equal(checkBuilds({ spec: bad, env }).ok, true, "the builder began refusing a bad version");
  assert.match(checkSpec(bad).join(" "), /is not three numbers/);
  assert.deepEqual(checkSpec(PUBLISHER), []);
});

test("no builder is a check that did not happen, not a pass and not a fail", () => {
  const r = checkBuilds({ spec: PUBLISHER, env: { BUILD_PY: "/nowhere/build.py" } });
  assert.equal(r.checked, false);
  assert.equal(r.ok, null, "a missing builder was reported as a verdict");
  assert.match(verdict(r), /nothing checked whether this spec builds/);
  assert.match(verdict(r), /unknown rather than passed/);
});

test("every member the spec names is found, once, across all its jobs", () => {
  const named = namedFiles({
    jobs: [
      { scripts: ["scripts/a.mjs", "scripts/b.mjs"], references: ["rules.md"] },
      { scripts: ["scripts/a.mjs"], assets: ["t.html"], instructions: { file: "how.md" } },
      { scripts: [] },
    ],
  });
  assert.deepEqual(named, ["scripts/a.mjs", "scripts/b.mjs", "rules.md", "t.html", "how.md"]);
  assert.deepEqual(namedFiles({}), []);
});

test("a member that climbs out of the folder is refused before anything is written", () => {
  for (const rel of ["../../etc/passwd", "/etc/passwd", "scripts/../../x.mjs", "C:/windows/x"]) {
    assert.equal(climbsOut(rel), true, rel);
  }
  for (const rel of ["scripts/a.mjs", "references/rules.md", "./a.mjs"]) {
    assert.equal(climbsOut(rel), false, rel);
  }
  const bad = clone(PUBLISHER);
  bad.jobs[0].scripts = ["../../../tmp/escaped.mjs"];
  const wrote = [];
  const r = checkBuilds({
    spec: bad, env,
    io: { write: (p) => wrote.push(p), run: () => { throw new Error("the builder was run anyway"); } },
  });
  assert.equal(r.ok, false);
  assert.match(r.problems[0], /climbs out of the package folder/);
  assert.ok(!wrote.some((p) => p.includes("escaped.mjs")), "a climbing member was written to disk");
});

test("stand-ins are empty on purpose", () => {
  const wrote = new Map();
  standIn("/tmp/x", { jobs: [{ scripts: ["scripts/a.mjs"] }] }, { write: (p, body) => wrote.set(p, body) });
  const script = [...wrote.keys()].find((p) => p.includes("a.mjs"));
  // A stand-in with plausible content in it would make a package that looks
  // built and runs nothing.
  assert.equal(wrote.get(script), "");
  assert.match(wrote.get([...wrote.keys()].find((p) => p.endsWith("spec.json"))), /"jobs"/);
});

test("a builder that answers with something other than a result is itself the finding", () => {
  assert.equal(builderSaid('{"ok":true,"name":"x"}', "", 0).ok, true);
  assert.deepEqual(builderSaid('{"ok":false,"error":"no"}', "", 1).problems, ["no"]);
  assert.deepEqual(builderSaid('{"ok":false}', "", 1).problems, ["the builder refused and gave no reason"]);
  assert.match(builderSaid("Traceback...", "SyntaxError: bad", 1).problems[0], /did not answer with a result: SyntaxError/);
  assert.match(builderSaid("", "", 137).problems[0], /exited 137 and said nothing/);
});

test("the temp folder goes, even when the builder throws", () => {
  const dropped = [];
  assert.throws(() => checkBuilds({
    spec: PUBLISHER, env,
    io: { mkdtemp: () => "/tmp/made", write: () => {}, rm: (d) => dropped.push(d),
          run: () => { throw new Error("boom"); } },
  }), /boom/);
  assert.deepEqual(dropped, ["/tmp/made"]);
});
