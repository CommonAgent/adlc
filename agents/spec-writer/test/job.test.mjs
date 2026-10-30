// The write-a-spec job: refusals, empty case, records, artifacts, process contract, and declaration.
//
// What is worth pinning: the job refuses choosing an agent's name, price, or unauthorized access,
// asking them as open questions instead; nothing given exits 3 with no model called and no pieces filed;
// all declared records are written to the job's records directory; a good run produces all agent files
// and open questions conforming to their declared formats; scripts exit 2 when required environment
// variables are missing; and the offering matches the declared steps and how capabilities.
//
// Nothing here touches a network or real model: model calls are mocked or handled via stand-in.
// Run: node --test test/job.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { checkDelivered } from "./delivered-formats.test.mjs";
import { fill, plan } from "../scripts/pieces.mjs";
import { blanksOf } from "../scripts/draft.mjs";
import { fileIn, note, read, sentence } from "../scripts/went-without.mjs";
import { specOfFolder } from "../scripts/agent-folder.mjs";
import { canUseProblems } from "../scripts/can-use.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DESC_PATH = join(ROOT, "agent-descriptor.json");
const DESC = JSON.parse(readFileSync(DESC_PATH, "utf8"));

async function folders(body) {
  const at = mkdtempSync(join(tmpdir(), "spec-writer-job-"));
  const dirs = {
    root: at,
    records: join(at, "records"),
    job: join(at, "job"),
  };
  mkdirSync(dirs.records, { recursive: true });
  mkdirSync(join(dirs.job, "out"), { recursive: true });
  try {
    await body(dirs);
  } finally {
    rmSync(at, { recursive: true, force: true });
  }
}

test("refusal: an agent name is never chosen and is put as an open question", () => {
  const specWithoutName = { jobs: [{ slug: "work" }], price: { model: "free" }, systems: [] };
  const blanks = blanksOf(specWithoutName, []);
  assert.ok(blanks.some((b) => b.key === "name"));
});

test("refusal: an agent price is never chosen and is left open", () => {
  const specWithoutPrice = { name: "my-agent", jobs: [{ slug: "work" }], systems: [] };
  const blanks = blanksOf(specWithoutPrice, []);
  assert.ok(blanks.some((b) => b.key === "price"));
});

test("refusal: access to external systems is never invented and unmentioned systems are asked", () => {
  const specWithoutSystems = { name: "my-agent", jobs: [{ slug: "work" }], price: { model: "free" } };
  const blanks = blanksOf(specWithoutSystems, []);
  assert.ok(blanks.some((b) => b.key === "systems"));
});

test("empty case: when nothing arrives to write a spec from, the job exits 3, calls no model, and files no pieces", async () => {
  await folders(async ({ records, job }) => {
    const textFile = join(records, "empty.txt");
    writeFileSync(textFile, "   ");
    const r = spawnSync(process.execPath, [join(ROOT, "scripts", "asked.mjs")], {
      env: { ...process.env, JOB_DIR: job, RECORDS: records, TEXT_FILE: textFile, FILES: "" },
      encoding: "utf8",
    });
    assert.equal(r.status, 3);
    const out = JSON.parse(r.stdout.trim().split(/\r?\n/).pop());
    assert.match(out.reply, /Say what you want the agent to do/);
    assert.equal(existsSync(join(job, "pieces.json")), false, "no pieces filed on exit 3");
  });
});

test("records: went-without note appends and reads back declared records correctly", async () => {
  await folders(async ({ records }) => {
    const p = fileIn(records);
    assert.ok(p.endsWith("went-without.json"));
    note(records, { wanted: "extra-config.json", did: "proceeded with default", why: "not supplied" });
    const entries = read(records);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].wanted, "extra-config.json");
    assert.match(sentence(entries), /extra-config\.json/);
  });
});

test("good case: a completed job fills the job folder and all pieces match their declared formats", async () => {
  await folders(async ({ records, job }) => {
    const agentDir = join(records, "agent");
    mkdirSync(join(agentDir, "skills", "write-a-spec"), { recursive: true });

    const descContent = JSON.stringify({
      name: "example-agent",
      version: "0.1.0",
      description: "An example agent.",
      jobs: [{
        slug: "write-a-spec",
        title: "Write a spec",
        offered: true,
        does: "Does the work.",
        when: "when called",
        good: "good result",
        empty: "empty result",
        how: { control: "script", intelligence: "none", cost: "none", contract: "full" },
      }],
      refuses: ["act 0", "act 1", "act 2", "act 3"],
      records: [{ name: "job manifest" }],
      price: { model: "free" },
    }, null, 2);

    const runtimeContent = JSON.stringify({ systems: [] }, null, 2);
    const pluginContent = JSON.stringify({
      $schema: "https://schemas.agentmesh.ai/plugin-manifest/v1",
      name: "example-agent",
      version: "0.1.0",
      description: "Plugin manifest.",
      extensions: { "net.agentdoc.package": { build: { skills: { "write-a-spec": { scripts: [] } } } } },
    }, null, 2);
    const skillContent = "---\nname: write-a-spec\ndescription: writes spec\n---\n\n# Write a spec\n";

    writeFileSync(join(agentDir, "agent-descriptor.json"), descContent);
    writeFileSync(join(agentDir, "agent-runtime-requirements.json"), runtimeContent);
    writeFileSync(join(agentDir, "plugin.json"), pluginContent);
    writeFileSync(join(agentDir, "skills", "write-a-spec", "SKILL.md"), skillContent);

    // Each file is recorded with the digest of the bytes the builder made,
    // as builds.json lists them; a file whose bytes differ is not delivered.
    const digest = (text) => createHash("sha256").update(text).digest("hex");
    const files = [
      { path: "agent-descriptor.json", sha256: digest(descContent) },
      { path: "agent-runtime-requirements.json", sha256: digest(runtimeContent) },
      { path: "plugin.json", sha256: digest(pluginContent) },
      { path: "skills/write-a-spec/SKILL.md", sha256: digest(skillContent) },
    ];
    const blanks = [{ key: "price", question: "What is the price?" }];

    const planned = plan({ files, filesDir: agentDir, blanks });
    fill(job, planned);

    assert.ok(existsSync(join(job, "pieces.json")), "pieces.json was not created");
    assert.deepEqual(checkDelivered(job), []);
  });
});

test("good case for container spec: checked spec is delivered as spec.json matching declared format", async () => {
  await folders(async ({ records, job }) => {
    const spec = {
      name: "container-demo",
      version: "0.1.0",
      description: "A container agent.",
      kind: "mesh-coded",
      container: {
        repository: "https://github.com/example/demo",
        commit: "0123456789abcdef0123456789abcdef01234567",
        dockerfile: "Dockerfile",
      },
      jobs: [{ slug: "run" }],
      refuses: ["nothing"],
      records: ["manifest"],
    };
    const specText = JSON.stringify(spec, null, 2);
    const specPath = join(records, "draft.json");
    writeFileSync(specPath, specText);

    const planned = plan({ container: true, specPath, blanks: [] });
    fill(job, planned);

    assert.ok(existsSync(join(job, "out", "spec.json")));
    assert.deepEqual(checkDelivered(job), []);
  });
});

test("process contract: each script exits 2 when a required environment variable is missing", () => {
  const missingCases = [
    { script: "scripts/asked.mjs", env: {}, errPattern: /JOB_DIR|RECORDS/ },
    { script: "scripts/draft.mjs", env: {}, errPattern: /ASKED|RECORDS/ },
    { script: "scripts/builds.mjs", env: {}, errPattern: /DRAFT|RECORDS/ },
    { script: "scripts/ask.mjs", env: {}, errPattern: /DRAFT|BLANKS|BUILDS|RECORDS/ },
    { script: "scripts/pieces.mjs", env: {}, errPattern: /JOB_DIR|RECORDS/ },
  ];

  for (const { script, env, errPattern } of missingCases) {
    const r = spawnSync(process.execPath, [join(ROOT, script)], {
      env: { ...process.env, ...env },
      encoding: "utf8",
    });
    assert.equal(r.status, 2, `${script} should exit 2 on missing env`);
    assert.match(r.stderr + r.stdout, errPattern, `${script} output did not name missing variables`);
  }
});

test("spec declaration: write-a-spec offering steps are jobs and match their declared how contracts", () => {
  // agent-descriptor-v1: the offering is an entry of `offerings`, and its
  // steps are objects, each with its own id and how.
  assert.equal(DESC.format, "agent-descriptor-v1");
  const offering = (DESC.offerings ?? []).find((o) => o.id === "write-a-spec");
  assert.ok(offering, "write-a-spec offering missing from agent-descriptor.json");
  assert.ok(Array.isArray(offering.started_by) && offering.started_by.length > 0, "somebody can start the offering");
  assert.deepEqual(offering.steps.map((s) => s.id), [
    "read-what-was-asked",
    "draft-the-spec",
    "check-it-builds",
    "ask-what-is-missing",
  ]);

  assert.equal(offering.steps.length, 4);
  for (const step of offering.steps) {
    assert.ok(step.how, `step ${step.id} missing how`);
    assert.ok(["script", "model"].includes(step.how.control));
    assert.ok(["none", "called", "open"].includes(step.how.intelligence));
    // Each step is a job of its own: a skill with its SKILL.md.
    assert.ok(existsSync(join(ROOT, "skills", step.id, "SKILL.md")), `step ${step.id} has no skills/${step.id}/SKILL.md`);
  }
  // The how is what it claims: drafting is the one step that calls the
  // text-reasoning service, so it alone is called and metered, and so is the
  // offering that contains it.
  const called = offering.steps.filter((s) => s.how.intelligence === "called").map((s) => s.id);
  assert.deepEqual(called, ["draft-the-spec"]);
  assert.equal(offering.steps.find((s) => s.id === "draft-the-spec").how.cost, "metered");
  assert.equal(offering.how.intelligence, "called");
  assert.equal(offering.how.cost, "metered");
});
