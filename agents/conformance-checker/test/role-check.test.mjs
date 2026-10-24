// agentevaluator's role check (role-check.mjs): the claimed role's own check,
// run against the agent's image by digest, the cases read off the check's own
// output, and the verdict signed. gcloud, GitHub and the signer stood in.
import { test } from "node:test";
import assert from "node:assert/strict";
import { builderArgv, checkDockerfile, readArgs, readCases, roleCheck, ROLE_CHECKS } from "../role-check.mjs";

const IMAGE = `gcr.io/langbench-1528148150979/deploymgr/crewai-demo@sha256:${"b".repeat(64)}`;
const KEY = "UBBW6C2IKGSG2Q3MWCL46LLY7IA2XTGTZDQZ4GXMRUKTCDTNXJG2SGBO";
const CHECK_COMMIT = "c".repeat(40);
const args = (over = {}) => ({ role: "ring-member", image: IMAGE, agent_key: KEY, handle: "crewai.demo@agentmesh.ai", framework: "crewai", start: "python agent.py", workdir: "/app", user: "member", project: "langbench-1528148150979", ...over });

const PASSING_LOG = [
  'Step #3 - "": Ring member check: crewai.demo@agentmesh.ai (crewai), fixed mode',
  "Step #3: " + "  PASS  accepts a correct pass",
  "Step #3: " + "  PASS  refuses a bad signature",
  "Step #3: " + "  PASS  refuses a wrong sender",
  "Step #3: " + "  PASS  refuses a wrong hop",
  "Step #3: " + "  PASS  forwards to the next member only",
  "Step #3: " + "  PASS  sends ring.done when last",
  "Step #3: " + "  PASS  declares its models",
  "Step #3: Conforms: all seven cases pass (7/7 run).",
].join("\n");

function fakes({ log = PASSING_LOG, status = "SUCCESS" } = {}) {
  const calls = [];
  const written = {};
  const deps = {
    gcloud: (argv) => {
      calls.push(argv);
      if (argv[0] === "builds" && argv[1] === "submit") return { code: 0, stdout: JSON.stringify({ id: "chk-1" }), stderr: "" };
      if (argv[0] === "builds" && argv[1] === "describe") return { code: 0, stdout: JSON.stringify({ status }), stderr: "" };
      if (argv[0] === "builds" && argv[1] === "log") return { code: 0, stdout: log, stderr: "" };
      return { code: 1, stdout: "", stderr: "unexpected" };
    },
    fetch: async () => ({ text: async () => CHECK_COMMIT }),
    sleep: async () => {},
    now: () => "2026-09-27T23:30:00.000Z",
    tmp: () => "/tmp/role-check-x",
    write: (f, s) => { written[f.replace(/\\/g, "/").split("/").pop()] = s; },
    rmdir: () => {},
    signer: () => ({ by: "UEVALUATOR", sign: (m) => `sig:${m.length}` }),
    submit: () => ({ submitted: true }),
    keep: (doc) => `/records/${doc.subject.handle.split(".")[0]}-role-${doc.claim.role}.json`,
  };
  return { deps, calls, written };
}

test("a role with no known check, an image not pinned by digest, or a start command with shell in it is refused", () => {
  assert.throws(() => readArgs(args({ role: "made-up-role" })), /never guessed/);
  assert.throws(() => readArgs(args({ image: "gcr.io/x/y:latest" })), /pinned by digest/);
  assert.throws(() => readArgs(args({ start: "python agent.py; curl evil" })), /plain words/);
  assert.equal(readArgs(args()).role, "ring-member");
});

test("the check image is the agent's own image by digest, run as its own user in its own folder, with the check beside it", () => {
  const d = checkDockerfile(readArgs(args()), ROLE_CHECKS["ring-member"]);
  assert.match(d, new RegExp(`^FROM ${IMAGE.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}$`, "m"));
  assert.match(d, /^USER member$/m);
  assert.match(d, /^WORKDIR \/app$/m);
  assert.match(d, /"--cmd", "python agent.py", "--handle", "crewai.demo@agentmesh.ai", "--framework", "crewai", "--cwd", "\/app"/);
  assert.match(d, /COPY check\/tests\/ \.\//);
});

test("a board worker's check starts it with its harness named, beside it in its own folder", () => {
  const a = readArgs(args({ role: "board-worker", handle: "codex.demo@agentmesh.ai", framework: "Gemini CLI", start: "node agent.mjs", user: "node" }));
  const d = checkDockerfile(a, ROLE_CHECKS["board-worker"]);
  assert.match(d, /"\/opt\/role-check\/board-check\.mjs", "--cmd", "node agent\.mjs", "--handle", "codex\.demo@agentmesh\.ai", "--harness", "Gemini CLI", "--cwd", "\/app"/);
  assert.equal(ROLE_CHECKS["board-worker"].cases, 7);
});

test("the cases are read off the check's own summary, and a failure keeps its reasons", () => {
  const ok = readCases(PASSING_LOG);
  assert.equal(ok.cases.length, 7);
  assert.equal(ok.conforms, true);
  const bad = readCases("Step #3:   PASS  accepts a correct pass\nStep #3:   FAIL  refuses a wrong hop\nStep #3:         it answered ok to hop 5\nStep #3: Does not conform: 1 of 2 passed.");
  assert.equal(bad.conforms, false);
  assert.deepEqual(bad.cases[1], { case: "refuses a wrong hop", pass: false, problems: ["it answered ok to hop 5"] });
});

test("a passing check is a signed verdict that the agent conforms, naming the check's commit and the image", async () => {
  const f = fakes();
  const r = await roleCheck(args(), f.deps);
  assert.equal(r.ok, true);
  assert.equal(r.verdict, "conforms");
  assert.equal(r.check_commit, CHECK_COMMIT);
  assert.equal(r.record.subject.agent_key, KEY);
  assert.equal(r.record.subject.image, IMAGE);
  assert.equal(r.record.check.commit, CHECK_COMMIT);
  assert.equal(r.record.signatures[0].tag, "agent-eval-record-v1");
  assert.equal(r.record.signatures[0].by, "UEVALUATOR");
  assert.equal(r.kept, "/records/crewai-role-ring-member.json", "the procedure keeps what it signed");
  const cfg = JSON.parse(f.written["cloudbuild.json"]);
  assert.deepEqual(cfg.steps.at(-1).args, ["run", "--rm", "role-check"]);
  assert.deepEqual(cfg.steps[1].args.slice(-1), [CHECK_COMMIT]);
});

test("a check that never reached its cases is inconclusive, never a pass", async () => {
  const r = await roleCheck(args(), fakes({ log: "Step #2: ERROR: build step 2 failed", status: "FAILURE" }).deps);
  assert.equal(r.ok, false);
  assert.equal(r.verdict, "inconclusive");
});

test("the check's commit is read with git first, which needs no API allowance", async () => {
  const f = fakes();
  f.deps.fetch = async () => { throw new Error("rate limited"); };
  f.deps.lsRemote = () => CHECK_COMMIT;
  const r = await roleCheck(args(), f.deps);
  assert.equal(r.check_commit, CHECK_COMMIT);
});

// The converter (role input-converter v1): its check lives in its own
// repository, has ten cases, and says so in its own summary line.
const CONVERTER_LOG = [
  'Step #3: Input converter check: converter.platform@agentmesh.ai, stand-in gateway, no model',
  ...["fills-a-declared-input-from-the-senders-words", "says-what-is-missing", "says-not-a-request", "refuses-to-invent-a-value",
    "refuses-an-undeclared-field", "reaches-only-the-gateway", "answers-a-plain-sentence-with-the-standard-reply",
    "answers-a-near-miss-naming-the-missing-field", "answers-nonsense-with-the-standard-reply", "answers-a-help-question-from-its-card"]
    .map((c) => `Step #3:   PASS  ${c}`),
  "Step #3: Conforms: all ten cases pass (10/10 run).",
].join("\n");
const converterArgs = (over = {}) => args({ role: "input-converter", handle: "converter.platform@agentmesh.ai", framework: "node", start: "node agent.mjs", user: "node", image: `gcr.io/langbench-1528148150979/deploymgr/converter@sha256:${"d".repeat(64)}`, ...over });

test("the converter's check starts it with its own start command in its own folder, from its own repository", () => {
  const check = ROLE_CHECKS["input-converter"];
  assert.equal(check.repository, "https://github.com/AgentMesh-Community/converter");
  assert.equal(check.cases, 10);
  const d = checkDockerfile(readArgs(converterArgs()), check);
  assert.match(d, /"\/opt\/role-check\/converter-check\.mjs", "--cmd", "node agent\.mjs", "--handle", "converter\.platform@agentmesh\.ai", "--cwd", "\/app"/);
  assert.match(d, /^USER node$/m);
});

test("the converter conforms only on its own ten-case summary, never the ring's seven", async () => {
  const check = ROLE_CHECKS["input-converter"];
  assert.equal(readCases(CONVERTER_LOG, check).conforms, true);
  assert.equal(readCases(CONVERTER_LOG, check).cases.length, 10);
  assert.equal(readCases(PASSING_LOG, check).conforms, false, "a ring summary line is not the converter's");
  const r = await roleCheck(converterArgs(), fakes({ log: CONVERTER_LOG }).deps);
  assert.equal(r.verdict, "conforms");
  assert.equal(r.record.claim.role, "input-converter");
  const failing = CONVERTER_LOG.replace("PASS  refuses-to-invent-a-value", "FAIL  refuses-to-invent-a-value").replace(/Conforms: .*$/m, "Does not conform: 9 of 10 passed.");
  assert.equal((await roleCheck(converterArgs(), fakes({ log: failing }).deps)).verdict, "does-not-conform");
});

test("the check's build runs as the host's build account when one is named in the same project, and as before otherwise", async () => {
  const P = "langbench-1528148150979";
  assert.deepEqual(builderArgv(P, `fleet-builder@${P}.iam.gserviceaccount.com`),
    ["--service-account", `projects/${P}/serviceAccounts/fleet-builder@${P}.iam.gserviceaccount.com`, `--gcs-source-staging-dir=gs://${P}_cloudbuild/source`]);
  assert.deepEqual(builderArgv(P, "fleet-builder@another-project.iam.gserviceaccount.com"), []);
  assert.deepEqual(builderArgv(P, ""), []);
  assert.deepEqual(builderArgv(P, `x; rm -rf /@${P}.iam.gserviceaccount.com`), []);
  const f = fakes();
  f.deps.builder = `fleet-builder@${P}.iam.gserviceaccount.com`;
  await roleCheck(args(), f.deps);
  const submit = f.calls.find((c) => c[0] === "builds" && c[1] === "submit");
  assert.equal(submit[submit.indexOf("--service-account") + 1], `projects/${P}/serviceAccounts/fleet-builder@${P}.iam.gserviceaccount.com`);
});
