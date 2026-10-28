// What is owed, and filing it once.
//   run: node --test test/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { apiRoot, causeOf, digestOf, fileOwed, owedItems } from "../scripts/ledger.mjs";
import { descriptor, memoryLedger } from "./helpers.mjs";

const answered = [
  { kind: "solution", id: "sol_a", name: "Review desk", display: "Review desk", owner: { org: "org_a", name: "Org A" }, owner_words: "Org A (org_a)", verdict: "breaking", reasons: ["The output verdict is gone."] },
  { kind: "solution", id: "sol_b", name: "Writing room", display: "Writing room", owner: { org: "org_b", name: "Org B" }, owner_words: "Org B (org_b)", verdict: "compatible", reasons: ["Nothing it uses changed."] },
  { kind: "account", id: null, name: null, display: "an unnamed account of Org C", owner: { org: "org_c", name: "Org C" }, owner_words: "Org C (org_c)", verdict: "behaviour", reasons: ["It may act differently."] },
];
const items = () => owedItems({ answered, subject: "tone-check.example", before: descriptor("1.0.0"), after: descriptor("2.0.0") });

test("one item per dependent that is not compatible, owed to its owner, holding back promote and decommission", () => {
  const it = items();
  assert.deepEqual(it.map((i) => i.owed_to), ["org_a", "org_c"]);
  assert.ok(it.every((i) => i.kind === "dependency" && i.against === "tone-check.example"));
  assert.deepEqual(it[0].blocks, ["promote", "decommission"]);
  assert.match(it[0].what, /Review desk \(solution\) is answered breaking/);
  assert.match(it[0].what, /dependent: solution sol_a of org_a$/);
  assert.match(it[1].what, /dependent: account an unnamed account of Org C of org_c$/);
});

test("the cause names both versions and the digest of the changed declaration, whatever its key order", () => {
  const d = descriptor("2.0.0");
  const r = Object.fromEntries(Object.entries(d).reverse());
  assert.equal(digestOf(d), digestOf(r));
  assert.equal(causeOf({ subject: "x", before: descriptor("1.0.0"), after: d }), `x 1.0.0 -> 2.0.0 (declaration sha256:${digestOf(d)})`);
});

test("filed once: a second filing of the same change finds the first", async () => {
  const ledger = memoryLedger();
  const first = await fileOwed(items(), { base: "https://app.mesh.example.com", token: ledger.key, fetchImpl: ledger.fetchImpl });
  assert.deepEqual(first.map((f) => f.state), ["filed", "filed"]);
  assert.deepEqual(first.map((f) => f.number), [501, 502]);
  const again = await fileOwed(items(), { base: "https://app.mesh.example.com/", token: ledger.key, fetchImpl: ledger.fetchImpl });
  assert.deepEqual(again.map((f) => [f.state, f.number]), [["already filed", 501], ["already filed", 502]]);
  assert.equal(ledger.items.length, 2);
  assert.ok(ledger.calls.every((c) => c.path.startsWith("/v1/operator/debt")));
  assert.equal(ledger.items[0].who, "impact-analyst");
});

test("without a key or an address nothing is filed, and it says why; a refusal or a failure is said in words", async () => {
  const none = await fileOwed(items(), { base: "https://app.mesh.example.com", token: "" });
  assert.deepEqual(none.map((f) => f.state), ["not filed", "not filed"]);
  assert.match(none[0].why, /no ledger key/);
  assert.match((await fileOwed(items(), { base: "", token: "k" }))[0].why, /no address for the platform/);
  const wrong = memoryLedger({ key: "right" });
  const r = await fileOwed(items(), { base: "https://x", token: "wrong", fetchImpl: wrong.fetchImpl });
  assert.match(r[0].why, /would not list what is already filed \(401/);
  assert.equal(wrong.items.length, 0);
  const refusing = memoryLedger({ refuse: "owed_to is required for dependency debt" });
  const r2 = await fileOwed(items(), { base: "https://x", token: refusing.key, fetchImpl: refusing.fetchImpl });
  assert.match(r2[0].why, /refused it \(400: owed_to is required/);
  const r3 = await fileOwed(items(), { base: "https://x", token: "k", fetchImpl: async () => { throw new Error("connection reset"); } });
  assert.match(r3[0].why, /did not answer \(connection reset\)/);
  assert.deepEqual(await fileOwed([], {}), []);
});

test("the API root: the origin with /v1, or a value that already ends in it", () => {
  assert.equal(apiRoot("https://app.dev.agentmesh.ai"), "https://app.dev.agentmesh.ai/v1");
  assert.equal(apiRoot("https://app.dev.agentmesh.ai/v1/"), "https://app.dev.agentmesh.ai/v1");
  assert.equal(apiRoot(""), "");
});
