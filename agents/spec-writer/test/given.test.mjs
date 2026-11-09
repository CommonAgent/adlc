// What the given names, and whether the draft keeps it (scripts/given.mjs).
//   node --test test/given.test.mjs
//
// No model and no network. The given is written here: words in the shape an
// as-built record is rendered in ("Setting: x.", "Reaches: <address>: why"),
// notes, and small JSON attachments. The drafting step is handed a call that
// answers with a draft written here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { askForSpec } from "../scripts/draft.mjs";
import { checkDraft } from "../scripts/check-spec.mjs";
import { replyText } from "../scripts/ask.mjs";
import {
  exactNamed, fitToGiven, functionsNamed, givenOf, givenProblems, givenTexts, priceNamed, reachesNamed, runtimesNamed,
  settingsNamed, shapesNamed, unstatedShapes,
} from "../scripts/given.mjs";

const words = (said) => givenTexts({ said, attached: [] });
const attached = (name, text, kind = "data") => ({ said: "", attached: [{ name, kind, text, media_type: name.endsWith(".json") ? "application/json" : "text/markdown" }] });

const RECORD_WORDS = [
  "Write a spec.",
  "what it should do: Reads today's tides from the public tide service and writes them to out/tides.json.",
  "Behaviors:",
  "B1 Read the tides: Reads the table, waiting at most 5 seconds; on a timeout the reply says 'took longer than 5 seconds'.",
  "Architecture as built:",
  "Kind: plugin-on-harness.",
  "Reaches: https://tides.example.org/v2: Provides the tide table.",
  "Reaches: any page a forecast links to: Reads the forecast's own page.",
  "Format out: tides, application/vnd.agentmesh.tides+json.",
  "Setting: days, harbor.",
  "Entry point: read-tides: Executed by node from the command line.",
  "Interfaces:",
  "I1 function readTides: reads the table and returns the tides.",
].join("\n");

const how = { control: "script", intelligence: "none", cost: "none", contract: "full" };
const job = (extra = {}) => ({
  slug: "read-tides", title: "Read the tides", offered: true, how,
  when: "when somebody needs today's tides for a harbor",
  good: "A file listing every high and low tide for the harbor today, each with its time and height, read from the public tide service.",
  empty: "If the tide service cannot be read, nothing is written and the reply says why, in the service's own words.",
  does: "Reads today's tide table and writes it to a file.",
  outputs: [{ name: "tides", kind: "application/vnd.agentmesh.tides+json", about: "The tides, as `{harbor, tides}`." }],
  scripts: ["scripts/read-tides.mjs"],
  run: { command: ["node", "{home}/{package}/skills/read-tides/scripts/read-tides.mjs"], reply: "json:reply" },
  ...extra,
});
const SETTINGS = [
  { name: "days", kind: "preference", label: "How many days", about: "1 to 7. Leave blank for 1.", default: 1, min: 1, max: 7, step: 1, job_may_set: true },
  { name: "harbor", kind: "preference", label: "Harbor", about: "Such as north. Leave blank for north.", default: "north", allowed: ["north", "south"], value_labels: { north: "North", south: "South" }, job_may_set: true },
];
const SYSTEMS = [
  { name: "tide-service", access: "read", kind: "service", needs: "reads the tide table from the public tide service at tides.example.org",
    settings: [{ env: "TIDE_SERVICE_ADDRESS", purpose: "where the public tide service answers, its base address", default: "https://tides.example.org/v2" }] },
  { name: "forecast-pages", access: "read", kind: "service", needs: "fetches each page a forecast links to, at the address the forecast gives" },
];
const KEPT = {
  name: "tide-reader", version: "0.1.0",
  jobs: [job({ instructions: "Run read-tides.mjs. readTides reads the table at the address in TIDE_SERVICE_ADDRESS; on a timeout the reply says took longer than 5 seconds." })],
  refuses: Array.from({ length: 4 }, (_, i) => `refusing act ${i}, because it is not this agent's to do, and it says so instead`),
  records: [{ name: "the signed job manifest" }],
  price: { model: "free" },
  runtimes: [{ name: "node", version: ">=22" }],
  run_config: { settings: SETTINGS },
  systems: SYSTEMS,
};

test("the settings the given names are read from words, a Settings section and JSON", () => {
  assert.deepEqual(settingsNamed(words(RECORD_WORDS)).map((s) => s.name), ["days", "harbor"]);
  assert.deepEqual(settingsNamed(words("## Settings\n\n- `days-ahead` (\"Days\"), a preference with the default 1.\n\n## Decisions\n")).map((s) => s.name), ["days-ahead"]);
  assert.deepEqual(settingsNamed(words("Declare the run-config setting count, ten by default. Also the setting `limit`.")).map((s) => s.name), ["limit", "count"]);
  assert.deepEqual(settingsNamed(words("Settings that it does not declare are refused.")), [], "a word after settings is not a setting's name");
  assert.deepEqual(settingsNamed(words("Setting: MODEL_NAME.")), [], "the model's four settings are the install's, not the draft's");
  const arch = JSON.stringify({ record: "architecture-record-v1", as_built: true, settings: [{ name: "count", credential: false }, { name: "API_KEY", credential: true }] });
  assert.deepEqual(settingsNamed(givenTexts(attached("architecture.json", arch))).map((s) => s.name), ["count"]);
  const rt = JSON.stringify({ format: "agent-runtime-requirements-v1", systems: [{ name: "x", kind: "service", settings: [{ env: "X_REGION" }] }] });
  assert.deepEqual(settingsNamed(givenTexts(attached("agent-runtime-requirements.json", rt, "an agent's own file"))).map((s) => s.name), ["X_REGION"]);
});

test("the runtime, the price and the reaches the given names", () => {
  assert.deepEqual(runtimesNamed(words(RECORD_WORDS)).map(({ name, version }) => ({ name, version })), [{ name: "node", version: null }]);
  assert.deepEqual(runtimesNamed(words("It needs node 22 or later.")).map(({ name, version }) => ({ name, version })), [{ name: "node", version: ">=22" }]);
  assert.deepEqual(runtimesNamed(words("a mesh node answers")), [], "a mesh node is no runtime");
  assert.equal(priceNamed(words("changes: Price: free.")).model, "free");
  assert.deepEqual((({ model, amount_micro }) => ({ model, amount_micro }))(priceNamed(words("The price is a flat 250,000 micro USD."))), { model: "flat", amount_micro: 250000 });
  assert.equal(priceNamed(words("The price is $0.10 per job.")).amount_micro, 100000);
  assert.equal(priceNamed(words("no word about money")), null);
  const r = reachesNamed(words(RECORD_WORDS));
  assert.deepEqual(r.addresses.map((a) => a.address), ["https://tides.example.org/v2"]);
  assert.deepEqual(r.handed.map((h) => h.what), ["any page a forecast links to"]);
  const arch = JSON.stringify({ record: "architecture-record-v1", as_built: true, egress: [{ destination: "https://tides.example.org/v2/", why: "x" }, { destination: "any linked page", why: "y" }] });
  const j = reachesNamed(givenTexts(attached("architecture.json", arch)));
  assert.deepEqual([j.addresses.map((a) => a.address), j.handed.map((h) => h.what)], [["https://tides.example.org/v2"], ["any linked page"]]);
});

test("the shapes, the quoted words and the functions the given names", () => {
  const schema = JSON.stringify({ $schema: "https://json-schema.org/draft/2020-12/schema", title: "tides", type: "object", required: ["format", "harbor", "tides"],
    properties: { format: { const: "tides-v1" }, harbor: { type: "string" }, tides: { type: "array", items: { type: "object", properties: { at: {}, height_m: {} } } } } });
  const s = shapesNamed(givenTexts(attached("tides.schema.json", schema)));
  assert.equal(s.schemas.length, 1);
  assert.deepEqual(s.schemas[0].top, ["format", "harbor", "tides"]);
  assert.deepEqual([...s.schemas[0].consts], ["tides-v1"]);
  assert.ok(["at", "height_m"].every((m) => s.members.has(m)));
  assert.deepEqual([...shapesNamed(words("It writes `{harbor, tides}` to out/tides.json.")).members], ["harbor", "tides"]);
  const asBuilt = JSON.stringify({ format: "as-built-behaviors-v1", behaviors: [{ id: "B1", name: "n", does: "d", inputs: [], outputs: [], refusals: ["prints `^stop run (r-[a-z0-9]+)` and stops"] }] });
  assert.equal(shapesNamed(givenTexts(attached("behaviors.json", asBuilt))).members.size, 0, "an as-built part's own members are no output's shape");
  assert.deepEqual(exactNamed(words(RECORD_WORDS)).map((e) => e.text), ["took longer than 5 seconds"]);
  assert.deepEqual(exactNamed(words('It says "Nothing to read today." and uses `^tide (\\d+)`; the {"key": "x"} part is JSON.')).map((e) => e.text), ["^tide (\\d+)", "Nothing to read today."]);
  assert.deepEqual(exactNamed(words("the page's title and the reader's own words")), [], "an apostrophe opens no quotation");
  assert.deepEqual(exactNamed(givenTexts(attached("behaviors.json", asBuilt))).map((e) => e.text), ["^stop run (r-[a-z0-9]+)"]);
  assert.deepEqual(functionsNamed(words(RECORD_WORDS)).map((f) => f.name), ["readTides"]);
  const ifaces = JSON.stringify({ format: "as-built-interfaces-v1", interfaces: [{ id: "I2", kind: "function", name: "parseTable" }, { id: "I3", kind: "command", name: "read-tides" }] });
  assert.deepEqual(functionsNamed(givenTexts(attached("interfaces.json", ifaces))).map((f) => f.name), ["parseTable"]);
});

test("a draft that keeps all of it has no findings", () => {
  const given = givenOf({ said: `${RECORD_WORDS}\nIt writes \`{harbor, tides}\`.`, attached: [] });
  assert.deepEqual(givenProblems(KEPT, given), []);
  assert.deepEqual(checkDraft(KEPT, { given }).filter((f) => !/went-without/.test(f)), []);
});

test("a draft that drops what the given names is told each thing, by rule", () => {
  const given = givenOf({ said: `${RECORD_WORDS}\nPrice: free.`, attached: [] });
  const dropped = { ...KEPT, price: undefined, runtimes: undefined, run_config: undefined, systems: [SYSTEMS[0]],
    jobs: [job({ instructions: "Run it.", run_config: { settings: [SETTINGS[0]] } })] };
  const found = givenProblems(dropped, given).join("\n");
  assert.match(found, /the setting days \(named in the request\) sits in job read-tides's run_config/);
  assert.match(found, /the request names the setting harbor, and the draft does not declare it/);
  assert.match(found, /names the runtime node, and the draft declares no runtimes/);
  assert.match(found, /states the price \(free\), and the draft has none/);
  assert.match(found, /"any page a forecast links to", and no service in the draft says it fetches what it is handed/);
  assert.match(found, /output tides sketches `\{harbor, tides\}`, and nothing given states harbor, tides/);
  assert.match(found, /quotes these exactly[^\n]*"took longer than 5 seconds"/);
  assert.match(found, /exported function readTides/);
  const wrongAddress = { ...KEPT, systems: [{ ...SYSTEMS[0], settings: [{ ...SYSTEMS[0].settings[0], default: "https://tides.example.org/v1" }] }, SYSTEMS[1]] };
  assert.match(givenProblems(wrongAddress, given).join("\n"), /says the code reaches https:\/\/tides\.example\.org\/v2, and no address setting in the draft has it as its default/);
});

test("a job that runs node needs a node runtime even when the given never says node", () => {
  const given = givenOf({ said: "count the words", attached: [] });
  assert.match(givenProblems({ ...KEPT, runtimes: [] }, given).join("\n"), /a job's command names the runtime node/);
});

test("a JSON Schema the given carries is carried word for word", () => {
  const schema = JSON.stringify({ title: "tides", type: "object", required: ["format", "harbor"], properties: { format: { const: "tides-v1" }, harbor: { type: "string" } } });
  const given = givenOf(attached("tides.schema.json", schema));
  assert.match(givenProblems(KEPT, given).join("\n"), /gives the JSON Schema tides, and the draft does not carry "format", "tides-v1"/);
  const carried = { ...KEPT, jobs: [job({ outputs: [{ name: "tides", kind: "application/vnd.agentmesh.tides+json", about: "The tides, as `{format, harbor}`, format tides-v1." }] })] };
  assert.ok(!givenProblems(carried, given).some((f) => /JSON Schema/.test(f)));
  assert.deepEqual(unstatedShapes(carried, given), [], "a schema for the output states its shape");
});

test("an output whose shape was not given is asked, never sketched, and an earlier one keeps its own", () => {
  const given = givenOf({ said: "Reads the tides and writes them.", attached: [] });
  const u = unstatedShapes(KEPT, given);
  assert.deepEqual(u.map((x) => [x.output, x.invented]), [["tides", ["harbor", "tides"]]]);
  const bare = { ...KEPT, jobs: [job({ outputs: [{ name: "tides", kind: "application/vnd.agentmesh.tides+json", about: "The tides." }] })] };
  assert.deepEqual(unstatedShapes(bare, given).map((x) => x.key), ["shape of tides"], "no sketch and no shape given is still asked");
  const md = { ...KEPT, jobs: [job({ outputs: [{ name: "notes", kind: "text/markdown", about: "Markdown: `## Tides`." }] })] };
  assert.deepEqual(unstatedShapes(md, given), [], "a Markdown piece's convention is drafted, as before");
  const earlier = givenOf({ said: "changes: shorter", attached: [{ name: "agent-descriptor.json", kind: "an agent's own file", text: JSON.stringify({ format: "agent-descriptor-v1", offerings: [{ id: "read-tides", outputs: [{ name: "tides", kind: "application/vnd.agentmesh.tides+json", about: "`{harbor, tides}`" }] }] }) }] });
  assert.deepEqual(unstatedShapes(KEPT, earlier), [], "a revision keeps the shape the agent already declares");
});

test("the fit moves a job's run_config to the spec, adds the runtime and price the given names, and asks each unstated shape", () => {
  const given = givenOf({ said: `${RECORD_WORDS}\nIt needs node 22 or later. Price: free.`, attached: [] });
  const draft = { ...KEPT, price: undefined, runtimes: undefined, run_config: undefined, jobs: [job({ run_config: { settings: SETTINGS } })] };
  const fit = fitToGiven(draft, given);
  assert.deepEqual(fit.spec.run_config.settings.map((s) => s.name), ["days", "harbor"]);
  assert.ok(!("run_config" in fit.spec.jobs[0]));
  assert.deepEqual(fit.spec.runtimes, [{ name: "node", version: ">=22" }]);
  assert.deepEqual(fit.spec.price, { model: "free" });
  assert.deepEqual(fit.blanks.map((b) => b.key), ["shape of tides"]);
  assert.match(fit.blanks[0].question, /the draft's sketch `\{harbor, tides\}` is a guess/);
  assert.match(fit.note, /moved to the spec's own run_config/);
  assert.match(fit.note, /The runtime node >=22 was added/);
  assert.match(fit.note, /The price was set to free/);
  assert.deepEqual(fitToGiven(KEPT, null), { spec: KEPT, blanks: [], note: "" });
});

test("the drafting step holds a draft to the given, asks again with the findings, then fits and asks what code cannot settle", async () => {
  const asked = { asked: "v1", said: `${RECORD_WORDS}\nPrice: free.`, attached: [], missing_files: [] };
  const sloppy = { ...KEPT, price: undefined, runtimes: undefined, run_config: undefined, systems: [{ ...SYSTEMS[0], settings: undefined, needs: "reads the tides" }],
    jobs: [job({ run_config: { settings: SETTINGS } })] };
  const prompts = [];
  const out = await askForSpec({ asked, call: async (req) => { prompts.push(req.body.contents[0].parts.map((p) => p.text).join("\n")); return JSON.stringify({ spec: sloppy, blanks: [] }); } });
  assert.equal(prompts.length, 2, "asked once more with what the given names");
  assert.match(prompts[1], /WHAT WAS WRONG WITH YOUR LAST DRAFT[\s\S]*the setting days \(named in the request\) sits in job read-tides's run_config/);
  assert.match(prompts[1], /system tide-service is reached over the network and declares no address setting/);
  assert.deepEqual(out.spec.run_config.settings.map((s) => s.name), ["days", "harbor"]);
  assert.deepEqual(out.spec.runtimes, [{ name: "node" }]);
  assert.deepEqual(out.spec.price, { model: "free" });
  assert.ok(out.blanks.some((b) => b.key === "shape of tides"));
  assert.ok(!out.blanks.some((b) => b.key === "price"), "a price the person stated is not asked again");
  const left = out.findings.join("\n");
  assert.doesNotMatch(left, /sits in job|declares no runtimes|has none/, "what the fit settled is not said as still standing");
  assert.doesNotMatch(left, /put "shape of tides" in blanks/, "a shape now asked is not said twice");
  assert.match(left, /declares no address setting/);
  assert.match(left, /no address setting in the draft has it as its default/);
  assert.match(left, /exported function readTides/);
});

test("what still stands after the second go reaches the reply", () => {
  const reply = replyText({ spec: KEPT, blanks: [], findings: ["system tide-service declares no address setting"] });
  assert.match(reply, /The draft was written twice and this still stands: system tide-service declares no address setting/);
  assert.match(reply, /TIDE_SERVICE_ADDRESS \(tide-service\), https:\/\/tides\.example\.org\/v2 by default/);
});
