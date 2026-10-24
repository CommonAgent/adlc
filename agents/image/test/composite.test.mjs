// The single-container edition of a solution: the runner and its member agents
// in one image, the runner's sends to members run right there, everything else
// sent out by the host, and a person's approval step ending the container.
// Run: node --test "test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runComposite, MIN_STEP_SECONDS } from "../composite.mjs";
import { emitComposite, trustRefusal } from "../emit-composite.mjs";
import { Refusal } from "../emit-image.mjs";
import { builtPackage, copyOfPackage, copyLines, here, readJson, rewriteAuthored, tmp, writeJson } from "./helpers.mjs";

const fakeRunner = join(here, "fake-runner.mjs");
const fakeMember = join(here, "fake-member.mjs");
const WRITER = "writer.owner@example.test";
const PUBLISHER = "publisher.owner@example.test";
const OWNER = "owner@example.test";

/** An edition as the image has it: three packages under one home, the job
 *  commands beside them, and the description composite.mjs reads. */
function edition() {
  const home = tmp("agentmesh-composite-home-");
  const mount = tmp("agentmesh-composite-mount-");
  const specs = tmp("agentmesh-composite-runs-");
  for (const pkg of ["runner-pkg", "writer-pkg", "publisher-pkg"]) {
    mkdirSync(join(home, pkg), { recursive: true });
    writeJson(join(home, pkg, "install.json"), { format: "agent-install-v1", directories: [{ name: "records", purpose: "the agent's records" }] });
    writeJson(join(home, pkg, "descriptor.json"), { format: "agent-descriptor-v1", offerings: [] });
  }
  writeJson(join(specs, "runner.json"), {
    job: "run-a-process",
    command: ["node", fakeRunner, "--job", "{job_dir}", "--from", "{sender}", "--text-file", "{job_dir}/message.txt", "--runs", "{records}/runs"],
    per_file: ["--file", "{file_path}::{file_media_type}"],
    message_file: "{job_dir}/message.txt", reply: "json:reply",
  });
  writeJson(join(specs, "member.json"), {
    job: "do-the-work", command: ["node", fakeMember, "--job", "{job_dir}", "--records", "{records}", "--from", "{sender}"], reply: "json:reply",
  });
  const described = join(specs, "composite.json");
  writeJson(described, {
    format: "agent-composite-v1", solution: "sol-1", name: "sol-1-one",
    runner: { package: "runner-pkg", version: "1.0.0", run_spec: join(specs, "runner.json"), job_seconds: 60 },
    members: [
      { name: "writer", package: "writer-pkg", version: "2.0.0", run_spec: join(specs, "member.json"), job_seconds: 60, priced: true },
      { name: "publisher", package: "publisher-pkg", version: "3.0.0", run_spec: join(specs, "member.json"), job_seconds: 60, priced: false },
    ],
  });
  const env = (id, entry, extra = {}) => {
    const jobDir = join(mount, "jobs", "sol-1-one", id);
    mkdirSync(join(jobDir, "out"), { recursive: true });
    writeJson(join(jobDir, "message.json"), { id, kind: "chat", in_reply_to: null, files: [], ...entry });
    return {
      ...process.env,
      AGENT_HOME: home, AGENT_COMPOSITE: described, COMPOSITE_MOUNT: mount, AGENT_NAME: "sol-1-one",
      AGENT_HANDLE: "sol-1-one.owner@example.test", MESH_SENDS_VIA_HOST: "1",
      MESH_JOB_DIR: jobDir, MESH_MESSAGE_FILE: join(jobDir, "message.json"),
      AGENT_DIRECTORY_RECORDS: join(mount, "state", "sol-1-one", "records"),
      AGENT_BINDING_DIR: join(mount, "bindings", "sol-1-one"), AGENT_JOB_SECONDS: "600",
      MESH_API_TOKEN: "the-runner-publish-token",
      MEMBER__WRITER__MESH_SELF_HANDLE: WRITER, MEMBER__WRITER__AGENT_ID: `id-${WRITER}`, MEMBER__WRITER__WRITER_KEY: "writer-key",
      MEMBER__PUBLISHER__MESH_SELF_HANDLE: PUBLISHER,
      ...extra,
    };
  };
  const runnerState = () => readJson(join(mount, "state", "sol-1-one", "records", "runs", "state.json"));
  const outbox = (id) => {
    const p = join(mount, "jobs", "sol-1-one", id, "out", "outbox.jsonl");
    return existsSync(p) ? readFileSync(p, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : [];
  };
  return { home, mount, env, runnerState, outbox };
}

test("a send to a member runs that member here, and a send to anybody else is left for the host", () => {
  const e = edition();
  const r = runComposite(e.env("m1", { from: "platform", handle: "platform", text: "START the run" }));
  assert.equal(r.status, "answered");
  assert.equal(r.reply, "started run r-1", "the reply to the message this container was started for is the runner's first answer");
  assert.deepEqual(r.steps.map((s) => [s.member, s.status]), [["writer", "answered"]]);
  // The writer ran in this container, in the folders its own container uses.
  const seen = readJson(join(e.mount, "state", "writer", "records", "jobs.json"));
  assert.equal(seen.length, 1);
  assert.equal(seen[0].from, "sol-1-one.owner@example.test", "the member's work came from the runner");
  assert.equal(seen[0].secret_seen, "writer-key", "the member is given its own variables");
  assert.equal(seen[0].runner_token_seen, null, "and none of the runner's");
  assert.ok(existsSync(join(e.mount, "jobs", "writer")), "the member's job folder is under its own name on the mount");
  // The runner read the writer's reply and its piece, by name.
  assert.equal(e.runnerState().stage, "waiting for the owner");
  assert.deepEqual(e.runnerState().draft, ["the draft writer wrote"]);
  // What leaves: the two messages to the owner, and the writer's step charge.
  // Nothing addressed to the writer goes out on the mesh.
  const out = e.outbox("m1");
  assert.deepEqual(out.filter((l) => !l.kind).map((l) => l.handle), [OWNER, OWNER]);
  assert.equal(out.some((l) => !l.kind && l.handle === WRITER), false);
  const charges = out.filter((l) => l.kind === "step-charge");
  assert.equal(charges.length, 1);
  assert.equal(charges[0].member, `id-${WRITER}`);
  assert.equal(charges[0].package, "writer-pkg");
});

test("a person's approval step: the question goes out, the run stays on the mount, and the next container carries on", () => {
  const e = edition();
  const first = runComposite(e.env("m1", { from: "platform", handle: "platform", text: "START the run" }));
  // The container stopped at the owner's question: the publisher never ran.
  assert.deepEqual(first.steps.map((s) => s.member), ["writer"]);
  assert.equal(existsSync(join(e.mount, "state", "publisher")), false);
  const question = e.outbox("m1").find((l) => /may the draft go out/.test(l.text ?? ""));
  assert.ok(question, "the approval question is left for the host to send");
  assert.equal(question.files.length, 1, "with the draft attached");
  assert.equal(e.runnerState().stage, "waiting for the owner");

  // The owner's answer starts a new container, which reads the saved run.
  const second = runComposite(e.env("m2", { from: `id-${OWNER}`, handle: OWNER, text: "yes" }));
  assert.equal(second.reply, "publishing");
  assert.deepEqual(second.steps.map((s) => s.member), ["publisher"]);
  assert.equal(e.runnerState().stage, "done");
  // The publisher declares no price, so its step leaves no charge.
  assert.equal(e.outbox("m2").filter((l) => l.kind === "step-charge").length, 0);
  assert.ok(readJson(join(e.mount, "jobs", "sol-1-one", "m2", "composite-run.json")).steps.length === 1);
});

test("a member's work that no longer fits in the run's one time limit goes out on the mesh instead", () => {
  const e = edition();
  const r = runComposite(e.env("m1", { from: "platform", handle: "platform", text: "START the run" }, { AGENT_JOB_SECONDS: String(MIN_STEP_SECONDS - 5) }));
  assert.equal(r.steps.length, 0);
  assert.ok(e.outbox("m1").some((l) => l.handle === WRITER), "the writer is sent its work the ordinary way");
  assert.match(r.notes.join(" "), /writer was sent its work on the mesh/);
});

test("the builder refuses to combine agents of another owner, in a sentence", () => {
  const runner = builtPackage("process-runner");
  const plan = (members) => ({ solution: "sol-1", name: "sol-1-one", owner: "acct-a", runner: { dir: runner }, members });
  const theirs = { dir: builtPackage("brief-writer"), name: "brief-writer", owner: "acct-b" };
  assert.throws(() => emitComposite(plan([theirs]), join(tmp(), "ctx")), (err) => err instanceof Refusal
    && /brief-writer belongs to another owner and its publisher has not marked it as combinable/.test(err.message)
    && /Run the solution as it is, with each agent in its own container/.test(err.message));
  assert.equal(trustRefusal("acct-a", [{ name: "x", owner: "acct-a" }]), null);
  assert.equal(trustRefusal("acct-a", [{ name: "x", owner: "acct-b", combinable: true }]), null);
});

test("a package its publisher marked combinable may join, and the image carries every package verbatim with no handle baked", () => {
  const runner = builtPackage("process-runner");
  const combinable = rewriteAuthored(copyOfPackage("brief-writer"), "descriptor", (d) => { d.combinable = true; });
  const mine = { dir: builtPackage("spec-writer"), name: "spec-writer", owner: "acct-a", handle: "spec-writer.me@example.test" };
  const out = join(tmp(), "ctx");
  const { description } = emitComposite({ solution: "sol-1", name: "sol-1-one", owner: "acct-a", runner: { dir: runner },
    members: [mine, { dir: combinable, name: "brief-writer", owner: "acct-b" }] }, out);
  const docker = readFileSync(join(out, "Dockerfile"), "utf8");
  const copies = copyLines(docker).map(([from]) => from);
  for (const p of ["process-runner", "brief-writer", "spec-writer"]) assert.ok(copies.includes(`packages/${p}/`), p);
  assert.ok(existsSync(join(out, "packages", "process-runner", "plugin.json")));
  assert.match(docker, /ENTRYPOINT \["node", "\/opt\/agent\/entrypoint\.mjs"\]/);
  const baked = readFileSync(join(out, "composite.json"), "utf8");
  assert.doesNotMatch(baked, /@/, "no handle or account is baked into the image");
  assert.deepEqual(description.members.map((m) => m.name), ["spec-writer", "brief-writer"]);
  assert.equal(readFileSync(join(out, "entrypoint.mjs"), "utf8"), readFileSync(join(here, "..", "composite.mjs"), "utf8"));
});

test("a member's runtime requirements are read under the current name, the former one, and the current one first", async () => {
  const { readInstallOf } = await import("../composite.mjs");
  const home = tmp("agentmesh-composite-names-");
  mkdirSync(join(home, "old"), { recursive: true });
  mkdirSync(join(home, "new"), { recursive: true });
  mkdirSync(join(home, "both"), { recursive: true });
  writeJson(join(home, "old", "install.json"), { format: "agent-install-v1", job_seconds: 60 });
  writeJson(join(home, "new", "agent-runtime-requirements.json"), { format: "agent-runtime-requirements-v1", job_seconds: 60 });
  writeJson(join(home, "both", "agent-runtime-requirements.json"), { format: "agent-runtime-requirements-v1", job_seconds: 90 });
  writeJson(join(home, "both", "install.json"), { format: "agent-install-v1", job_seconds: 61 });
  const env = { AGENT_HOME: home };
  assert.equal(readInstallOf(env, "old").job_seconds, 60);
  assert.equal(readInstallOf(env, "new").job_seconds, 60);
  assert.equal(readInstallOf(env, "both").job_seconds, 90);
  assert.equal(readInstallOf(env, "none"), null);
});
