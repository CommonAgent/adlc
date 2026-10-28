// A real change: Site reader 2.4.1 to 2.5.0 (AgentMesh PR #672), whose
// site-read output went from application/json to its own kind,
// application/vnd.agentmesh.site-read+json. The fixtures are the platform's
// own answers on dev on 2026-10-27, with organization, account and person
// identifiers replaced by stand-ins and each solution cut to its nodes and
// lines: the dependents list, the four solutions whose canvases the owner may
// read, and the ports of Fact writer, Fact checker, Scene writer, Ponder
// planner and Quiz maker.
//   run: node --test test/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runJob } from "../scripts/analyze.mjs";
import { job, memoryLedger } from "./helpers.mjs";

const F = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "site-reader");
const doc = (n) => JSON.parse(readFileSync(join(F, n), "utf8"));
const files = () => [
  { name: "site-reader-2.5.0.descriptor.json", doc: doc("site-reader-2.5.0.descriptor.json"), type: "application/vnd.agentmesh.agent-descriptor+json" },
  { name: "site-reader-2.4.1.descriptor.json", doc: doc("site-reader-2.4.1.descriptor.json"), type: "application/vnd.agentmesh.agent-descriptor+json" },
  { name: "dependents.json", doc: doc("dependents.json"), type: "application/vnd.agentmesh.dependents+json" },
  { name: "site-reader-2.4.1.runtime.json", doc: doc("site-reader-2.4.1.runtime.json"), type: "application/vnd.agentmesh.agent-runtime-requirements+json" },
  { name: "site-reader-2.5.0.runtime.json", doc: doc("site-reader-2.5.0.runtime.json"), type: "application/vnd.agentmesh.agent-runtime-requirements+json" },
  ...readdirSync(F).filter((n) => n.endsWith(".solution.json")).sort().map((n) => ({ name: n, doc: doc(n), type: "application/vnd.agentmesh.solution+json" })),
  { name: "receivers.ports.json", doc: doc("receivers.ports.json"), type: "application/vnd.agentmesh.agent-ports+json" },
];

test("Site reader 2.4.1 to 2.5.0: the four agents that take site-read as JSON are a change of behavior, Quiz maker is compatible, nothing breaks", async () => {
  const ledger = memoryLedger();
  const j = job({ message: "what changed: site-read has a kind of its own (AgentMesh PR #672)", files: files() });
  const out = await runJob(j.argv, ledger.env, { fetchImpl: ledger.fetchImpl });
  assert.equal(out.code, 0, out.reply);
  assert.equal(out.running, "2.4.1");
  assert.equal(out.changed, "2.5.0");
  const agents = Object.fromEntries(out.dependents.filter((d) => d.kind === "agent").map((d) => [d.name, d.verdict]));
  assert.deepEqual(agents, { "Fact writer": "behaviour", "Fact checker": "behaviour", "Scene writer": "behaviour", "Ponder planner": "behaviour", "Quiz maker": "compatible" });
  assert.equal(out.counts.breaking, 0);
  assert.equal(out.dependents.length, 25, "the platform's 20 and the 5 agents given");
  assert.equal(ledger.items.length, 24, "one for each dependent that is not compatible");
  assert.ok(!ledger.items.some((i) => /Quiz maker/.test(i.what)));
  const text = readFileSync(join(j.jobDir, "out", "impact-report.md"), "utf8");
  assert.match(text, /The output site-read of read-site was application\/json and is now application\/vnd\.agentmesh\.site-read\+json/);
  assert.match(text, /\| Quiz maker \| site read \| application\/vnd\.agentmesh\.site-read\+json \| compatible \|/);
  assert.match(text, /\| Fact writer \| site-read \| application\/json \| change of behavior \|/);
  assert.match(text, /site-read now arrives as application\/vnd\.agentmesh\.site-read\+json, which still fits Scene writer, Fact writer and Fact checker \(each takes application\/json\)/);
  assert.match(text, /Its declared price is free before and after/);
  assert.match(text, /whose canvas its owner does not show/);
  assert.match(text, /the words saying what the agent does changed/);
});

test("Site reader: the same files give the same report, byte for byte", async () => {
  const a = job({ files: files() });
  const b = job({ files: files().reverse() });
  await runJob(a.argv, {}, {});
  await runJob(b.argv, {}, {});
  const read = (j) => readFileSync(join(j.jobDir, "out", "impact-report.md"), "utf8");
  // Reversed, the solutions and the runtime requirements come in another
  // order, so the pairing sentence and the order of the given solutions are
  // the only things allowed to differ; with the same order, nothing may.
  const c = job({ files: files() });
  await runJob(c.argv, {}, {});
  assert.equal(read(a), read(c));
  assert.match(read(b), /running: "2\.4\.1"/);
});
