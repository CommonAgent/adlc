// The required coder check: whether these bytes came from the required code writer.
//   node --test provenance.test.mjs
//
// Every manifest here is signed for real with the adapter's own libraries, so
// what is pinned is the door and not a fake of it: a traced file is one whose
// bytes a manifest under the required key lists; a changed file, a stranger,
// a manifest signed by another key and a tampered manifest are each refused
// in their own words; and the tag is the adapter's, byte for byte, because a
// different one would verify nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { DOOR, JOB_MANIFEST_TAG, digestOf, filesUnder, libs, officialKeys, traced, verifyManifest } from "./provenance.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, "provenance.mjs");
const lib = libs();
const { nkeys, canonicalJSON } = lib;

const sign = (doc, kp) => {
  const { sig: _s, ...u } = doc;
  return { ...u, sig: Buffer.from(kp.sign(new TextEncoder().encode(JOB_MANIFEST_TAG + canonicalJSON(u)))).toString("base64url") };
};
const coder = nkeys.createUser();
const other = nkeys.createUser();
const ADD = Buffer.from("export function add(a, b) { return a + b; }\n");
const SUB = Buffer.from("export function sub(a, b) { return a - b; }\n");
const manifest = (kp = coder, pieces = [{ name: "add.mjs", digest: digestOf(ADD), path: "out/scripts/add.mjs" }]) => sign({
  format: "job-manifest-v1", job: "t1", task_id: "t1", context_id: null, revises: null, version: 1,
  agent: kp.getPublicKey(), offering: "write-the-scripts", produced_at: "2026-09-13T00:00:00.000Z",
  pieces: pieces.map((p) => ({ step: "write-the-scripts", media_type: "text/javascript", ref: "x", size: 1, reused: false, ...p })),
  reused: { pieces: 0, of: pieces.length },
}, kp);

test("the tag is the adapter's, byte for byte", () => {
  const src = readFileSync(join(here, "..", "..", "mesh-adapter", "mesh-adapter.mjs"), "utf8");
  const m = /const JOB_MANIFEST_TAG = "([^"]+)";/.exec(src);
  assert.ok(m, "the adapter names its tag");
  assert.equal(JSON.stringify(JOB_MANIFEST_TAG), `"${m[1]}"`);
});

test("a manifest signed by the key it names verifies, and a tampered or re-signed one does not", () => {
  const doc = manifest();
  assert.equal(verifyManifest(doc, lib), true);
  assert.equal(verifyManifest({ ...doc, pieces: [] }, lib), false, "a changed piece list breaks the signature");
  assert.equal(verifyManifest(sign(doc, other), lib), false, "signed by another key while naming the coder's");
  assert.equal(verifyManifest({ ...doc, format: "job-manifest-v2" }, lib), false);
  assert.equal(verifyManifest(null, lib), false);
});

test("a file is traced when the required coder's manifest lists its bytes, and refused in its own words otherwise", () => {
  const doc = manifest();
  const key = coder.getPublicKey();
  const ok = traced(doc, key, [{ path: "scripts/add.mjs", bytes: ADD }], lib);
  assert.equal(ok.ok, true);
  assert.equal(ok.said, "1 file traced to the code writer's delivery");
  assert.equal(ok.files[0].piece, "add.mjs");
  const changed = traced(doc, key, [{ path: "scripts/add.mjs", bytes: Buffer.concat([ADD, Buffer.from("// edited\n")]) }], lib);
  assert.equal(changed.ok, false);
  assert.match(changed.files[0].why, /a piece named add\.mjs was delivered with different bytes; this file has been changed since/);
  assert.equal(changed.said, "1 of 1 file cannot be traced to the code writer's delivery");
  const stranger = traced(doc, key, [{ path: "scripts/sub.mjs", bytes: SUB }], lib);
  assert.equal(stranger.ok, false);
  assert.equal(stranger.files[0].why, "no piece in the delivery has these bytes");
  const notOfficial = traced(manifest(other), key, [{ path: "scripts/add.mjs", bytes: ADD }], lib);
  assert.equal(notOfficial.ok, false);
  assert.equal(notOfficial.verified, true, "it verifies, it is just not the coder");
  assert.match(notOfficial.said, /is not the required coder$/);
  const broken = traced({ ...doc, pieces: [] }, key, [{ path: "scripts/add.mjs", bytes: ADD }], lib);
  assert.equal(broken.said, "the delivery manifest does not verify, so nothing in it can be trusted");
  assert.equal(broken.files[0].ok, false, "nothing is traced through a manifest that does not verify");
});

test("the required coder may be one key or several, so a re-keyed coder is honoured while both are live", () => {
  assert.deepEqual(officialKeys(` ${coder.getPublicKey()} , ${other.getPublicKey()} ,`), [coder.getPublicKey(), other.getPublicKey()]);
  const both = traced(manifest(other), `${coder.getPublicKey()},${other.getPublicKey()}`, [{ path: "scripts/add.mjs", bytes: ADD }], lib);
  assert.equal(both.ok, true);
});

test("files under a folder are each checked, and a missing one is said", () => {
  const dir = mkdtempSync(join(tmpdir(), "provenance-"));
  try {
    mkdirSync(join(dir, "scripts", "deep"), { recursive: true });
    writeFileSync(join(dir, "scripts", "add.mjs"), ADD);
    writeFileSync(join(dir, "scripts", "deep", "sub.mjs"), SUB);
    assert.deepEqual(filesUnder(join(dir, "scripts")).map((f) => f.path.replace(dir, "").replace(/\\/g, "/")), ["/scripts/add.mjs", "/scripts/deep/sub.mjs"]);
    assert.deepEqual(filesUnder(join(dir, "nope.mjs")), [{ path: join(dir, "nope.mjs"), missing: true }]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("as a process: exit 2 called wrong, exit 0 with every file traced, exit 1 naming the door otherwise", () => {
  const wrong = spawnSync("node", [script], { encoding: "utf8" });
  assert.equal(wrong.status, 2);
  const dir = mkdtempSync(join(tmpdir(), "provenance-"));
  try {
    const m = join(dir, "job-manifest.json");
    writeFileSync(m, JSON.stringify(manifest()));
    writeFileSync(join(dir, "add.mjs"), ADD);
    writeFileSync(join(dir, "sub.mjs"), SUB);
    const ok = spawnSync("node", [script, m, coder.getPublicKey(), join(dir, "add.mjs")], { encoding: "utf8" });
    assert.equal(ok.status, 0, ok.stderr);
    const said = JSON.parse(ok.stdout);
    assert.equal(said.ok, true);
    assert.equal(said.door, undefined);
    const no = spawnSync("node", [script, m, coder.getPublicKey(), join(dir, "add.mjs"), join(dir, "sub.mjs"), join(dir, "gone.mjs")], { encoding: "utf8" });
    assert.equal(no.status, 1);
    const v = JSON.parse(no.stdout);
    assert.equal(v.ok, false);
    assert.deepEqual(v.files.map((f) => f.ok), [true, false, false]);
    assert.equal(v.files[2].why, "the file does not exist");
    assert.equal(v.door, DOOR);
    const none = spawnSync("node", [script, join(dir, "nowhere.json"), coder.getPublicKey(), join(dir, "add.mjs")], { encoding: "utf8" });
    assert.equal(none.status, 1);
    assert.match(JSON.parse(none.stdout).said, /there is no delivery manifest at/);
    assert.equal(existsSync(m), true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
