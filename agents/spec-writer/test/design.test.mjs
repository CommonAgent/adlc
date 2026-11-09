// The Design: the agent's own files, made from the spec in the same job.
//   node --test test/design.test.mjs
//
// No model and no network. What is worth pinning: the Design is handed the
// spec and not the raw as-built record; the descriptor never carries an
// address (on 2026-11-09 the round trip stopped at Package on one); the name,
// the version and the price are the spec's; the spec's address settings and
// the hosts it only writes down are where the security reviewer reads them;
// and a whole job delivers out/spec.json, out/spec.md, the agent's files under
// out/agent/ and what is still open, each as its declared kind, with a reply
// that opens with the spec.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordOf, seedSpec } from "../scripts/seed.mjs";
import { keepSpec, mergeFill, specCounts, writeTheSpec } from "../scripts/spec.mjs";
import { THE_SPEC, addressProblems, designView, fitNoAddress, fitToSpec } from "../scripts/design.mjs";
import { givenOfSpec, givenProblems } from "../scripts/given.mjs";
import { askForSpec, requestParts } from "../scripts/draft.mjs";
import { checkBuilds } from "../scripts/builds.mjs";
import { fill, plan, SPEC_MD_PATH, SPEC_PATH } from "../scripts/pieces.mjs";
import { replyText } from "../scripts/ask.mjs";
import { validateSpec } from "../scripts/spec-v1.mjs";
import { checkDelivered } from "./delivered-formats.test.mjs";
import { askedWith, fillFor } from "./as-built-fixture.mjs";

const SAID = "Write a spec.\nwhat it should do: Rebuild the tide reader\nname: tide-reader\nprice: free\n";
const theSpec = () => { const seed = seedSpec(recordOf(askedWith(SAID)), { said: SAID }); return mergeFill(seed, fillFor(seed)); };

/** The agent's own files as a model might draft them from the spec: an
 *  address written out in an about and in the instructions, the address
 *  setting under a name of its own, and no word of the host it writes down. */
const draftFrom = () => ({
  name: "tide-reader", version: "0.1.0", description: "Reads the next tides for a harbor from the tide service and hands them back as JSON.",
  jobs: [{
    slug: "read-the-tides", title: "Read the tides", offered: true,
    when: "when somebody wants the next tides for a harbor, by its four-letter code",
    does: "Reads the tide table for a harbor and writes the next twelve tides as JSON.",
    good: "A tides file that holds the harbor, the chart link and the next tides in order, each with its time and height, with nothing invented where the table was empty.",
    empty: "When the tide service does not answer, nothing is written and the reply says the tides could not be read for that harbor.",
    inputs: [{ name: "harbor", kind: "text", required: true, given_by: "person", about: "Which harbor? Its four-letter code, such as BRST." }],
    outputs: [{ name: "tides", kind: "application/vnd.example.tides+json", when: "per_task", about: "`{format, harbor, chart, tides}`: format tides-v1, chart https://charts.example.net/, the next tides." }],
    how: { control: "script", intelligence: "none", cost: "none", contract: "full" },
    run: { command: ["node", "scripts/tides.mjs", "--job", "{job_dir}"], reply: "json:reply" },
    instructions: "Run scripts/tides.mjs. It reads the tide service at https://tides.example.org/api from TIDES_ADDRESS.",
  }],
  refuses: ["Reading a harbor that is not four capital letters, because the tide service answers nothing useful for it and a guess would mislead a sailor.", "Writing tides the service did not give, because an invented tide could put a boat on the rocks.", "Keeping any harbor a person asked about after the job, because nobody asked for a history.", "Calling any service other than the tide service, because nothing else was granted."],
  records: [{ name: "job manifest", when: "per_task" }],
  systems: [{ name: "tide-service", kind: "service", access: "read", needs: "reads the tide table at tides.example.org", settings: [{ env: "TIDES_ADDRESS", purpose: "where the tide service answers", default: "https://tides.example.org/api" }] }],
  runtimes: [{ name: "node", version: ">=22" }],
  price: { model: "flat", amount_micro: 990000, currency: "USD" },
});

test("the Design is handed the spec in place of the as-built record, and the spec part says what the files owe it", () => {
  const asked = askedWith(SAID, [{ name: "notes.md", kind: "a document", media_type: "text/markdown", text: "the harbor is BRST" }]);
  const text = JSON.stringify(theSpec(), null, 2);
  const view = designView(asked, text);
  assert.deepEqual(view.attached.map((a) => a.kind), [THE_SPEC, "a document"]);
  const parts = requestParts({ asked: view }).join("\n");
  assert.match(parts, /THE SPEC \(spec-v1\), APPROVED AT REQUIREMENTS/);
  assert.match(parts, /An address goes only in an address setting's default/);
  assert.doesNotMatch(parts, /as-built-behaviors-v1/, "the raw record does not reach the Design");
  assert.equal(designView({ ...asked, revision: { how: "answer" } }, text).revision, undefined, "with no files sent back the files are made fresh");
});

test("the Design's given is the spec: its settings, runtime, price, reaches, schemas and modules", () => {
  const g = givenOfSpec(theSpec());
  assert.deepEqual(g.settings.map((s) => s.name), ["harbor", "TIDE_SERVICE_ADDRESS"]);
  assert.deepEqual(g.runtimes.map((r) => r.name), ["node"]);
  assert.deepEqual(g.price, { model: "free", from: "the spec" });
  assert.deepEqual(g.reaches.addresses.map((a) => a.address), ["https://tides.example.org/api"]);
  assert.deepEqual(g.reaches.handed, []);
  const tides = g.shapes.schemas.find((s) => s.name === "out/tides.json");
  assert.deepEqual(tides.top, ["format", "harbor", "chart", "tides"]);
  assert.deepEqual([...tides.consts], ["tides-v1"], "an address const is the spec's to keep, never the files'");
  assert.deepEqual(g.modules.map((m) => m.file), ["scripts/tides.mjs", "scripts/stop.mjs", "scripts/banner.mjs"].filter((f) => f !== "scripts/banner.mjs"));
  assert.deepEqual(g.exact, [], "the exact words are the spec's; the files are not held to them");
});

test("the files carry no address outside a setting's default, and code writes each as its host", () => {
  const d = draftFrom();
  assert.deepEqual(addressProblems(d).map((p) => p.split(" ")[0]), ["jobs[0].outputs[0].about", "jobs[0].instructions"]);
  const f = fitNoAddress(d);
  assert.deepEqual(addressProblems(f.spec), []);
  assert.match(f.spec.jobs[0].outputs[0].about, /chart charts\.example\.net,/);
  assert.equal(f.spec.systems[0].settings[0].default, "https://tides.example.org/api", "a setting's default keeps its address");
  assert.match(f.note, /2 addresses were written/);
});

test("the name, version and price are the spec's, its address setting is named as the spec names it, and a host it only writes down is in a service's needs", () => {
  const spec = theSpec();
  spec.price = "Free";
  const fit = fitToSpec(draftFrom(), spec);
  const d = fit.spec;
  assert.deepEqual(d.price, { model: "free" });
  assert.equal(d.systems[0].settings[0].env, "TIDE_SERVICE_ADDRESS");
  assert.match(d.jobs[0].instructions, /from TIDE_SERVICE_ADDRESS/);
  assert.match(d.systems[0].needs, /writes down links to charts\.example\.net, which it never calls/);
  assert.deepEqual(addressProblems(d), []);
  assert.deepEqual(givenProblems(d, givenOfSpec(spec)).filter((p) => /harbor/.test(p)), ["the spec names the setting harbor, and the draft does not declare it; keep it, in the spec's run_config with its default and range, or as a system setting's variable"]);
  // A spec that still asks the name gets files with no name.
  const open = { ...spec, product: { ...spec.product, name: "agent-not-named-yet" }, open: [...spec.open, { key: "name", question: "?" }] };
  assert.equal(fitToSpec(draftFrom(), open).spec.name, undefined);
  const noPrice = { ...spec }; delete noPrice.price;
  assert.equal(fitToSpec(draftFrom(), noPrice).spec.price, undefined);
});

test("a whole job: the spec first, then the files from it, each piece filed as its declared kind, and the reply opens with the spec", async () => {
  const dir = mkdtempSync(join(tmpdir(), "spec-writer-design-"));
  try {
    const records = join(dir, "records"); const job = join(dir, "job");
    mkdirSync(records, { recursive: true }); mkdirSync(job, { recursive: true });
    const asked = askedWith(SAID);
    const seed = seedSpec(recordOf(asked), { said: SAID });
    const prompts = [];
    // The stand-in model: a fill for the spec, then a draft of the files.
    const call = async (req) => {
      const p = req.body.contents[0].parts.map((x) => x.text).join("\n\n");
      prompts.push(p);
      return { text: JSON.stringify(/THE SPEC SO FAR/.test(p) ? fillFor(seed) : { spec: draftFrom(), blanks: [], notes: "drafted from the spec" }) };
    };
    const written = await writeTheSpec({ asked, call });
    assert.deepEqual(written.findings, []);
    const kept = keepSpec(records, written.spec);
    const view = designView(asked, readFileSync(kept.json, "utf8"));
    const out = await askForSpec({ call, asked: view, given: givenOfSpec(written.spec, view), specV1: written.spec, table: null });
    assert.equal(prompts.length >= 2, true);
    assert.match(prompts[1], /THE SPEC \(spec-v1\), APPROVED AT REQUIREMENTS/);
    assert.equal(out.spec.name, "tide-reader");
    assert.deepEqual(out.spec.price, { model: "free" });
    assert.deepEqual(addressProblems(out.spec), []);
    const built = checkBuilds({ spec: out.spec, env: { BUILD_PY: join(dir, "no-builder.py") }, keep: join(records, "agent") });
    for (const f of built.files.list) assert.doesNotMatch(readFileSync(join(records, "agent", f.path), "utf8").replace(/"\$schema": "[^"]*"/, ""), /:\/\//, `${f.path} carries an address`);
    const blanks = (written.spec.open ?? []).map((o) => ({ key: o.key, question: o.question }));
    fill(job, plan({ files: built.files.list, filesDir: join(records, "agent"), blanks, theSpec: { json: kept.json, md: kept.md, sha256: kept.sha256, md_sha256: kept.md_sha256 } }));
    const listed = JSON.parse(readFileSync(join(job, "pieces.json"), "utf8"));
    assert.deepEqual(listed.slice(0, 2).map((e) => [e.name, e.path, e.media_type]), [["the spec", SPEC_PATH, "application/vnd.agentmesh.spec+json"], ["the spec, readable", SPEC_MD_PATH, "text/markdown"]]);
    assert.ok(listed.some((e) => e.path === "out/agent/agent-descriptor.json"));
    assert.ok(listed.some((e) => e.path === "out/still-open.md"));
    assert.deepEqual(checkDelivered(job), []);
    const delivered = JSON.parse(readFileSync(join(job, "out", "spec.json"), "utf8"));
    assert.deepEqual(validateSpec(delivered), []);
    const reply = replyText({ spec: out.spec, blanks, theSpec: written.spec, specInfo: { counts: specCounts(written.spec) }, files: built.files.list.map((f) => f.path) });
    assert.match(reply, /^The spec is tide-reader 0\.1\.0: three features with \d+ requirements and three acceptance scenarios, and four interfaces \(all kept exactly\), drawn from the as-built record\. It is in out\/spec\.json, and readable in out\/spec\.md\./);
    assert.match(reply, /The agent's own files are made from the spec \(the Design\): the draft is tide-reader/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a spec changed after the drafting step wrote it is not delivered", () => {
  const dir = mkdtempSync(join(tmpdir(), "spec-writer-design-edit-"));
  try {
    const kept = keepSpec(join(dir, "records"), theSpec());
    writeFileSync(kept.json, readFileSync(kept.json, "utf8").replace("tide-reader", "tide-reader2"));
    mkdirSync(join(dir, "job"));
    assert.throws(() => fill(join(dir, "job"), plan({ theSpec: { json: kept.json, md: kept.md, sha256: kept.sha256, md_sha256: kept.md_sha256 } })), /the spec was changed after the drafting step wrote it/);
    assert.equal(existsSync(join(dir, "job", "pieces.json")), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
