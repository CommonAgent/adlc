// Each dependent answered from what it uses, and an output whose kind changed
// answered for each reader.
//   run: node --test test/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { answerKind, answerOne, joined, parsePort, sameName, specific, useFromCanvas, useFromPorts, outputsOf } from "../scripts/answer.mjs";
import { compareDeclarations } from "../scripts/compare.mjs";
import { canvas, descriptor, KEY } from "./helpers.mjs";

const kindDiff = (before, after, refines) => ({ scope: "output", change: "output-kind-changed", effect: "kind", offering: "check", port: "verdict", before, after, refines });
const reader = (kind) => ({ label: "Reader", agent: "UREADER", end: false, port: "in", kind, known: true });

test("a changed kind, for each reader: still fits, now fits, no longer fits, fits neither", () => {
  assert.equal(answerKind(kindDiff("application/json", "application/vnd.x+json", true), reader("application/json")).effect, "behaviour");
  assert.equal(answerKind(kindDiff("application/json", "application/vnd.x+json", true), reader("application/vnd.x+json")).effect, "compatible");
  assert.equal(answerKind(kindDiff("application/vnd.x+json", "text/markdown", false), reader("application/json")).effect, "breaking");
  assert.equal(answerKind(kindDiff("text/html", "text/markdown", false), reader("application/pdf")).cat, "neither");
});

test("a changed kind, for a reader that is not known: a narrower spelling is a change of behavior, anything else breaks", () => {
  assert.equal(answerKind(kindDiff("application/json", "application/vnd.x+json", true), null).effect, "behaviour");
  assert.equal(answerKind(kindDiff("application/json", "text/markdown", false), null).effect, "breaking");
  assert.equal(answerKind(kindDiff("application/json", "application/vnd.x+json", true), { ...reader(null), known: false }).cat, "unknown-refines");
});

test("a canvas says which outputs a solution reads, into what, and which inputs it sends", () => {
  const use = useFromCanvas(canvas({ id: "s", org: "o", output: "verdict", reader: "Reviewer", readerPort: "verdict", readerKind: "application/vnd.example.verdict+json" }), KEY);
  assert.deepEqual([...use.offerings], ["check"]);
  assert.deepEqual([...use.sends], ["check.in.text"]);
  assert.deepEqual(use.reads.get("check.out.verdict").map((r) => [r.label, r.port, r.kind]), [["Reviewer", "verdict", "application/vnd.example.verdict+json"]]);
  assert.equal(useFromCanvas({ nodes: [], connections: [] }, KEY), null);
});

test("an agent's ports are matched to an output by name, else by a specific kind, never by plain JSON", () => {
  const outputs = [{ offering: "read-site", name: "site-read", before: "application/json", after: "application/vnd.agentmesh.site-read+json" }, { offering: "read-site", name: "subject", before: "application/json", after: "application/json" }];
  const ports = (inputs) => ({ agent: "UQ", label: "Quiz maker", offerings: [{ id: "make", inputs }] });
  assert.deepEqual([...useFromPorts(ports([{ name: "site read", media_type: "application/vnd.agentmesh.site-read+json" }]), outputs).reads.keys()], ["read-site.out.site-read"]);
  assert.deepEqual([...useFromPorts(ports([{ name: "page", media_type: "application/vnd.agentmesh.site-read+json" }]), outputs).reads.keys()], ["read-site.out.site-read"]);
  assert.deepEqual([...useFromPorts(ports([{ name: "facts", media_type: "application/json" }]), outputs).reads.keys()], []);
  assert.ok(sameName("site read", "Site-Read"));
  assert.ok(!specific("application/json") && !specific("text/*") && specific("application/vnd.x+json"));
});

test("a dependent is reached only by what it uses; the worst answer is its answer", () => {
  const before = descriptor();
  const after = descriptor("2", (d) => { d.offerings[0].outputs = d.offerings[0].outputs.filter((o) => o.name !== "verdict"); d.offerings[0].inputs.push({ name: "x", kind: "text" }); return d; });
  const diffs = compareDeclarations(before, after);
  const readsNotes = useFromCanvas(canvas({ id: "s", org: "o", output: "notes", reader: "Writer", readerPort: "notes", readerKind: "text/markdown" }), KEY);
  const a = answerOne(diffs, readsNotes);
  assert.equal(a.verdict, "compatible");
  assert.match(a.reasons.join(" "), /new optional input, x/);
  const unknown = answerOne(diffs, { offerings: null, reads: null, sends: null, canvas: false });
  assert.equal(unknown.verdict, "breaking");
  assert.match(unknown.reasons.join(" "), /not known, so it is answered as if it reads it/);
});

test("the helpers: a port id, a list in words, the outputs before and after", () => {
  assert.deepEqual(parsePort("write-facts.in.site-read"), { offering: "write-facts", side: "in", name: "site-read" });
  assert.equal(parsePort("nonsense"), null);
  assert.equal(joined(["a", "b", "c"]), "a, b and c");
  const o = outputsOf(descriptor("1", (d) => { d.offerings[0].outputs[0].kind = "application/json"; return d; }), descriptor());
  assert.deepEqual(o.find((x) => x.name === "verdict"), { offering: "check", name: "verdict", before: "application/json", after: "application/vnd.example.verdict+json" });
});
