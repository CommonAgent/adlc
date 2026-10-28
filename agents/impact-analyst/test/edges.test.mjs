// The edges: a canvas that does not send an input now required, a ceiling
// changed in a way that is not plainly higher, runtime members no rule names,
// a dependents list that names no agent, two dependents the list cannot tell
// apart, and a ledger with more than one page of items.
//   run: node --test test/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { answerOne, useFromCanvas } from "../scripts/answer.mjs";
import { compareDeclarations, compareRuntimes } from "../scripts/compare.mjs";
import { fileOwed, owedItems } from "../scripts/ledger.mjs";
import { runJob } from "../scripts/analyze.mjs";
import { canvas, changeFiles, descriptor, dependents, job, KEY, memoryLedger } from "./helpers.mjs";

test("an optional input made required breaks a dependent whose canvas does not send it", () => {
  const before = descriptor("1", (d) => { d.offerings[0].inputs.push({ name: "audience", kind: "text", required: false }); return d; });
  const after = descriptor("2", (d) => { d.offerings[0].inputs.push({ name: "audience", kind: "text", required: true }); return d; });
  const use = useFromCanvas(canvas({ id: "s", org: "o", output: "notes", reader: "Writer", readerPort: "notes", readerKind: "text/markdown" }), KEY);
  const a = answerOne(compareDeclarations(before, after), use);
  assert.equal(a.verdict, "breaking");
  assert.match(a.reasons.join(" "), /canvas does not send it/);
  const group = descriptor("2", (d) => { d.offerings[0].inputs.push({ name: "audience", kind: "text", required: false, one_of: "who" }); return d; });
  assert.equal(answerOne(compareDeclarations(before, group), use).verdict, "breaking");
});

test("a ceiling, a member no rule names, the systems it is bound to, or where it keeps things: any change that is not plainly wider breaks", () => {
  const rt = (over = {}) => ({ format: "agent-runtime-requirements-v1", job_seconds: 300, systems: [], directories: [{ name: "records" }], ceilings: [{ system: "text-reasoning", per: "task", suggested: 10, max: 10 }], ...over });
  const ch = (b) => compareRuntimes(rt(), rt(b)).map((x) => [x.change, x.effect]);
  assert.deepEqual(ch({ ceilings: [{ system: "text-reasoning", per: "task", suggested: 10, max: 1 }] }), [["ceiling-lower", "breaking"]]);
  assert.deepEqual(ch({ ceilings: [{ system: "text-reasoning", per: "task", suggested: 20, max: 20 }] }), [["ceiling-wider", "compatible"]]);
  assert.deepEqual(ch({ ceilings: [{ system: "text-reasoning", per: "task", suggested: 10, max: 10, unit: "calls" }] }), [["ceiling-changed", "breaking"]]);
  const sys = (scopes) => ({ systems: [{ name: "mail", kind: "service", credential: "mail-key", env: "MAIL_KEY", scopes }] });
  assert.deepEqual(compareRuntimes(rt(sys(["read"])), rt(sys(["read", "write"]))).map((x) => x.change), ["bound-systems-changed"]);
  assert.deepEqual(ch({ ceilings: [{ system: "text-reasoning", per: "task", suggested: 20, max: 10 }] }), [["ceiling-wider", "compatible"]]);
  assert.deepEqual(ch({ ceilings: [{ system: "text-reasoning", per: "task", suggested: 5, max: 10 }] }), [["ceiling-lower", "breaking"]]);
  assert.deepEqual(ch({ egress: { allow: ["example.com"] } }), [["runtime-other-changed", "breaking"]]);
  assert.deepEqual(ch({ systems: [{ name: "mail", kind: "service", credential: "mail-key", env: "MAIL_KEY" }] }), [["bound-systems-changed", "breaking"]]);
  assert.deepEqual(ch({ directories: [] }), [["directories-changed", "breaking"]]);
});

test("a how that is not an object, changed, breaks; an output that may be larger, or is now working, breaks", () => {
  const base = descriptor();
  const how = compareDeclarations(base, descriptor("2", (d) => { d.offerings[0].how = "cheap"; return d; }));
  assert.deepEqual(how.map((x) => [x.change, x.effect]), [["how-unreadable", "breaking"]]);
  const lim = (n) => descriptor("1", (d) => { d.offerings[0].outputs[1].max_bytes = n; return d; });
  assert.equal(compareDeclarations(lim(100), lim(1000)).find((x) => x.change === "output-limit-wider").effect, "breaking");
  assert.equal(compareDeclarations(base, descriptor("2", (d) => { d.offerings[0].outputs[1].working = true; return d; })).find((x) => x.change === "output-working-changed").effect, "breaking");
});

test("a dependents list that names no agent stops the job, rather than reading every box as the agent", async () => {
  const list = dependents();
  list.subject = { kind: "agent", name: "tone-check" };
  const files = changeFiles(descriptor(), descriptor("2")).map((f) => (f.name === "dependents.json" ? { ...f, doc: list } : f));
  const out = await runJob(job({ files }).argv, {}, {});
  assert.equal(out.code, 3);
  assert.match(out.reply, /its subject has no id/);
  assert.equal(useFromCanvas(canvas({ id: "s", org: "o", output: "notes", reader: "W", readerPort: "notes", readerKind: "text/markdown" }), ""), null);
});

test("two dependents the list cannot tell apart are two debts, filed once each", async () => {
  const twin = { kind: "solution", id: null, name: "Ponder", display: "Ponder", owner: { org: "org_x", name: "X" }, owner_words: "X (org_x)", verdict: "behaviour", reasons: ["It may act differently."] };
  const items = owedItems({ answered: [twin, { ...twin }], subject: "a", before: descriptor("1"), after: descriptor("2") });
  assert.deepEqual(items.map((i) => i.what.split("\n").pop()), ["dependent: solution Ponder of org_x (1 of 2)", "dependent: solution Ponder of org_x (2 of 2)"]);
  const ledger = memoryLedger();
  const first = await fileOwed(items, { base: "https://x", token: ledger.key, fetchImpl: ledger.fetchImpl });
  assert.deepEqual(first.map((f) => f.state), ["filed", "filed"]);
  const again = await fileOwed(items, { base: "https://x", token: ledger.key, fetchImpl: ledger.fetchImpl });
  assert.deepEqual(again.map((f) => f.state), ["already filed", "already filed"]);
  assert.equal(ledger.items.length, 2);
});

test("what is already filed is read past the first page", async () => {
  const items = owedItems({ answered: [{ kind: "solution", id: "sol_z", name: "Z", display: "Z", owner: { org: "org_z" }, owner_words: "org_z", verdict: "breaking", reasons: ["r"] }], subject: "a", before: descriptor("1"), after: descriptor("2") });
  const filler = Array.from({ length: 600 }, (_, i) => ({ number: i + 1, against: "a", caused_by: "something else", owed_to: "org_q", what: "x\n\ndependent: solution other of org_q", state: "open" }));
  const mine = { number: 999, against: "a", caused_by: items[0].caused_by, owed_to: "org_z", what: items[0].what, state: "open" };
  const all = [...filler, mine];
  const pages = [];
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    if ((init.method ?? "GET") === "GET") {
      const limit = Number(u.searchParams.get("limit"));
      const offset = Number(u.searchParams.get("offset") ?? 0);
      pages.push(offset);
      return { ok: true, status: 200, text: async () => JSON.stringify({ total: all.length, items: all.slice(offset, offset + Math.min(limit, 500)) }) };
    }
    return { ok: true, status: 201, text: async () => JSON.stringify({ item: { number: 1000, state: "open" } }) };
  };
  const r = await fileOwed(items, { base: "https://x", token: "k", fetchImpl });
  assert.deepEqual(pages, [0, 500]);
  assert.deepEqual(r, [{ state: "already filed", number: 999, ledger_state: "open" }]);
});

test("a ledger that answers smaller pages is still read whole, and one that repeats a page files nothing", async () => {
  const items = owedItems({ answered: [{ kind: "solution", id: "sol_z", name: "Z", display: "Z", owner: { org: "org_z" }, owner_words: "org_z", verdict: "breaking", reasons: ["r"] }], subject: "a", before: descriptor("1"), after: descriptor("2") });
  const all = [...Array.from({ length: 250 }, (_, i) => ({ number: i + 1, caused_by: "x", owed_to: "q", what: "w" })), { number: 999, caused_by: items[0].caused_by, owed_to: "org_z", what: `${items[0].what}\n\nadded by the ledger`, state: "open" }];
  const small = async (url) => { const u = new URL(url); const o = Number(u.searchParams.get("offset")); return { ok: true, status: 200, text: async () => JSON.stringify({ total: all.length, items: all.slice(o, o + 100) }) }; };
  assert.deepEqual(await fileOwed(items, { base: "https://x", token: "k", fetchImpl: small }), [{ state: "already filed", number: 999, ledger_state: "open" }]);
  const stuck = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ total: 1000, items: all.slice(0, 100) }) });
  const r = await fileOwed(items, { base: "https://x", token: "k", fetchImpl: stuck });
  assert.equal(r[0].state, "not filed");
  assert.match(r[0].why, /same page twice/);
});

test("an input moved into a group is not short for a dependent that already sends another of the group", () => {
  const before = descriptor("1", (d) => { d.offerings[0].inputs[0].required = false; d.offerings[0].inputs[0].one_of = "source"; d.offerings[0].inputs.push({ name: "page", kind: "url", required: false }); return d; });
  const after = descriptor("2", (d) => { d.offerings[0].inputs[0].required = false; d.offerings[0].inputs[0].one_of = "source"; d.offerings[0].inputs.push({ name: "page", kind: "url", required: false, one_of: "source" }); return d; });
  const use = useFromCanvas(canvas({ id: "s", org: "o", output: "notes", reader: "W", readerPort: "notes", readerKind: "text/markdown" }), KEY);
  assert.deepEqual([...use.sends], ["check.in.text"]);
  assert.equal(answerOne(compareDeclarations(before, after), use).verdict, "compatible");
});
