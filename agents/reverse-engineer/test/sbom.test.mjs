// The dependencies part: a CycloneDX bill of materials made by rule from the
// lockfiles and manifests, the same bytes every time, never by the model.
//   node --test test/sbom.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { componentChanges, fromCargoLock, fromGoMod, fromNpmLock, fromRequirements, makeSbom, npmPurl } from "../scripts/sbom.mjs";
import { FIXTURES } from "./helpers.mjs";

const fixtureReader = (name) => (f) => { try { return readFileSync(join(FIXTURES, name, f), "utf8"); } catch { return null; } };
const NODE_FILES = ["bin/greet.js", "package-lock.json", "package.json", "src/index.js", "test/greet.test.js"];

test("a package-lock gives every installed package, its version, hash, scope and edges", () => {
  const { bom, gaps } = makeSbom({ files: NODE_FILES, read: fixtureReader("node-app"), repository: "r", commit: "c", tool: { name: "reverse-engineer", version: "0.1.0" } });
  assert.equal(bom.bomFormat, "CycloneDX");
  assert.equal(bom.specVersion, "1.5");
  assert.match(bom.serialNumber, /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.deepEqual(bom.metadata.component, { type: "application", "bom-ref": "codebase", name: "greeter", version: "1.2.0" });
  assert.deepEqual(bom.components.map((c) => `${c.name}@${c.version}`), ["debug@4.3.4", "is-number@7.0.0", "left-pad@1.3.0", "ms@2.1.2"]);
  const isNumber = bom.components.find((c) => c.name === "is-number");
  assert.deepEqual(isNumber.properties, [{ name: "cdx:npm:package:development", value: "true" }]);
  assert.equal(isNumber.purl, "pkg:npm/is-number@7.0.0");
  assert.equal(isNumber.hashes[0].alg, "SHA-512");
  assert.match(isNumber.hashes[0].content, /^[0-9a-f]{128}$/);
  assert.deepEqual(isNumber.evidence, { occurrences: [{ location: "package-lock.json" }] });
  const dep = (ref) => bom.dependencies.find((d) => d.ref === ref).dependsOn;
  assert.deepEqual(dep("codebase"), ["pkg:npm/debug@4.3.4", "pkg:npm/is-number@7.0.0", "pkg:npm/left-pad@1.3.0"]);
  assert.deepEqual(dep("pkg:npm/debug@4.3.4"), ["pkg:npm/ms@2.1.2"]);
  assert.deepEqual(gaps, []);
});

test("the same files give the same bytes, and another commit another serial number", () => {
  const one = JSON.stringify(makeSbom({ files: NODE_FILES, read: fixtureReader("node-app"), repository: "r", commit: "c" }).bom);
  const two = JSON.stringify(makeSbom({ files: NODE_FILES, read: fixtureReader("node-app"), repository: "r", commit: "c" }).bom);
  const other = makeSbom({ files: NODE_FILES, read: fixtureReader("node-app"), repository: "r", commit: "d" }).bom;
  assert.equal(one, two);
  assert.notEqual(JSON.parse(one).serialNumber, other.serialNumber);
});

test("a package.json with no lockfile gives its ranges, each marked, and a gap", () => {
  const { bom, gaps } = makeSbom({ files: ["package.json", "src/app.js"], read: fixtureReader("no-tests"), repository: "r", commit: "c" });
  assert.deepEqual(bom.components.map((c) => [c.name, c.version, c.purl]), [["express", "^4.18.0", "pkg:npm/express"]]);
  assert.deepEqual(bom.components[0].properties, [{ name: "as-built:version-is-a-range", value: "true" }]);
  assert.equal(gaps.length, 1);
  assert.match(gaps[0].why, /no lockfile sits beside it/);
});

test("a scoped package's purl writes its @ as %40, and a version 1 lockfile is read", () => {
  assert.equal(npmPurl("@acme/tool", "1.0.0"), "pkg:npm/%40acme/tool@1.0.0");
  const v1 = JSON.stringify({ lockfileVersion: 1, dependencies: { a: { version: "1.0.0", requires: { b: "^2.0.0" } }, b: { version: "2.1.0", dev: true } } });
  const got = fromNpmLock(v1, "package-lock.json");
  assert.deepEqual(got.components.map((c) => c.purl), ["pkg:npm/a@1.0.0", "pkg:npm/b@2.1.0"]);
  assert.deepEqual(got.edges.get("pkg:npm/a@1.0.0"), ["pkg:npm/b@2.1.0"]);
});

test("requirements.txt, go.mod and Cargo.lock are read; a range is marked", () => {
  const req = fromRequirements("requests==2.31.0\nflask>=2.0  # web\n-r more.txt\n", "requirements.txt");
  assert.deepEqual(req.components.map((c) => [c.purl, c.version ?? null]), [["pkg:pypi/requests@2.31.0", "2.31.0"], ["pkg:pypi/flask", ">=2.0"]]);
  assert.equal(req.gaps.length, 1);
  const go = fromGoMod("module x\n\nrequire (\n\tgithub.com/pkg/errors v0.9.1\n)\nrequire golang.org/x/text v0.14.0\n", "go.mod");
  assert.deepEqual(go.components.map((c) => c.purl), ["pkg:golang/github.com/pkg/errors@v0.9.1", "pkg:golang/golang.org/x/text@v0.14.0"]);
  const cargo = fromCargoLock('[[package]]\nname = "serde"\nversion = "1.0.190"\nchecksum = "' + "a".repeat(64) + '"\n', "Cargo.lock");
  assert.deepEqual(cargo.components.map((c) => [c.purl, c.hashes[0].alg]), [["pkg:cargo/serde@1.0.190", "SHA-256"]]);
});

test("a lockfile this agent does not read is a gap, not a guess", () => {
  const { bom, gaps } = makeSbom({ files: ["yarn.lock"], read: () => "", repository: "r", commit: "c" });
  assert.equal(bom.components.length, 0);
  assert.match(gaps[0].why, /reads no yarn\.lock/);
});

test("what changed between two bills of materials, by name", () => {
  const before = { components: [{ name: "a", version: "1.0.0", purl: "pkg:npm/a@1.0.0" }, { name: "b", version: "1.0.0", purl: "pkg:npm/b@1.0.0" }] };
  const after = { components: [{ name: "a", version: "1.1.0", purl: "pkg:npm/a@1.1.0" }, { name: "c", version: "3.0.0", purl: "pkg:npm/c@3.0.0" }] };
  assert.deepEqual(componentChanges(before, after), {
    added: [{ name: "c", version: "3.0.0" }],
    removed: [{ name: "b", version: "1.0.0" }],
    changed: [{ name: "a", from: "1.0.0", to: "1.1.0" }],
  });
});
