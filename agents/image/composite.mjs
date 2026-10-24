// The entrypoint of a single-container edition of a solution: the process
// runner and every member agent of one solution, at the versions the solution
// runs, in one image. Copied in as /opt/agent/entrypoint.mjs by
// emit-composite.mjs, beside one-message.mjs, which it drives.
//
// WHY IT EXISTS. A solution's agents stay separate agents and the process
// runner still walks the process; that is the assembly, and it is what lets
// each agent be reused elsewhere. What costs time is the transport between
// them: every message to an agent starts a container of its own, and a start
// is fifteen seconds to several minutes. So this edition keeps every part and
// changes only the road. The runner runs exactly as it does in its own
// container, and when it leaves a message for one of the solution's own
// agents, this file runs that agent's job right here, the way that agent's own
// container would (one-message.mjs, the same function, the same files on the
// same mount), and hands the reply back to the runner as the next message.
// One container start per run instead of one per message.
//
// WHAT STILL GOES OUT. Anything addressed to somebody who is not in this
// container: the owner's questions, a person's step, an agent outside the
// solution. Those stay in the outbox and the host sends them under this
// agent's key, exactly as it sends any runner's. A run that reaches a person's
// approval therefore stops here: the question goes out, every record is
// already on the mount, and the container exits. The answer arrives as a new
// message and a new container picks the run up from the same records.
//
// WHAT EACH STEP LEAVES. Each member writes its own records under its own
// folders on the mount, the same folders its own container would use, and the
// runner writes and publishes the run after every turn, so the run page reads
// the same whichever edition ran. Each member step that answered also leaves a
// step-charge line for the host, because an agent's price is charged per step
// whether or not a container was started for it.
//
// ONE CLOCK. The job's own cap (AGENT_JOB_SECONDS) covers the whole run inside
// this container. A message to a member that no longer fits in what is left
// is not run here: it goes out on the mesh like any other, and the member's
// own container answers it. Slower, and still correct.
//
//   needs: node >= 22
//   environment: everything one-message.mjs reads, for the runner, plus
//     AGENT_COMPOSITE      the edition's description (default /opt/agent/composite.json)
//     COMPOSITE_MOUNT      the shared mount (default /mesh)
//     MEMBER__<NAME>__<VAR>  a member's own variables, which it alone is given
//   exit: as one-message.mjs, for the message this container was started for.
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join } from "node:path";
import { randomBytes } from "node:crypto";
import { Refusal, directoryVar, runOne as runOneMessage } from "./one-message.mjs";

export const FORMAT = "agent-composite-v1";
export const COMPOSITE_FILE = "/opt/agent/composite.json";
export const MOUNT = "/mesh";
/** Below this many seconds left, a member's message goes out on the mesh
 *  rather than being started here with too little time to finish. */
export const MIN_STEP_SECONDS = 30;

/** The prefix a member's own variables carry on the job. One member never
 *  sees another's, and none of them sees the runner's. */
export const memberPrefix = (name) => `MEMBER__${String(name).toUpperCase().replace(/[^A-Z0-9]/g, "_")}__`;

// What every program in here gets regardless of whose job it is: where things
// are in the image and how the machine is set up. Nothing that names a
// credential, a directory or a setting of any one agent.
const CARRIED = /^(PATH|HOME|LANG|LC_[A-Z]+|TZ|TMPDIR|TEMP|TMP|SYSTEMROOT|COMSPEC|PATHEXT|NODE_[A-Z_]+|AGENT_DIR|AGENT_HOME|AGENT_HARNESS_BIN|AGENT_INSTRUCTIONS_FILE|AGENTMESH_BIN|MESH_SENDS_VIA_HOST|BINARY_[A-Z0-9_]+)$/;

/** The edition's description, as emit-composite.mjs wrote it. */
export function readComposite(path) {
  if (!existsSync(path)) throw new Refusal(`there is no edition description at ${path}, so this is not an image emit-composite.mjs made`);
  const doc = JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, ""));
  if (doc?.format !== FORMAT) throw new Refusal(`${path} is not an ${FORMAT} description`);
  if (!doc.runner?.package) throw new Refusal(`${path} names no process runner`);
  if (!Array.isArray(doc.members) || !doc.members.length) throw new Refusal(`${path} names no member agents`);
  return doc;
}

/** The members as this container knows them: the image says which packages
 *  and install names, and the job says each one's handle and key (never
 *  baked, 12.6 rule 3), under that member's own prefix. */
export function membersOf(composite, env) {
  return composite.members.map((m) => {
    const p = memberPrefix(m.name);
    return { ...m, handle: env[`${p}MESH_SELF_HANDLE`] || m.handle || null, agent_id: env[`${p}AGENT_ID`] || m.agent_id || null };
  });
}

const lower = (s) => String(s ?? "").trim().toLowerCase();

/** The member a line of the runner's outbox is for, or null when it is for
 *  somebody outside this container. Matched on the agent id the runner
 *  resolved, and on the handle it wrote beside it. */
export function memberFor(line, composite) {
  if (!line || line.kind) return null;
  return composite.members.find((m) =>
    (m.agent_id && line.to === m.agent_id)
    || (m.handle && (lower(line.handle) === lower(m.handle) || lower(line.to) === lower(m.handle)))) ?? null;
}

function carried(env) {
  return Object.fromEntries(Object.entries(env).filter(([k, v]) => v !== undefined && CARRIED.test(k)));
}

/** The environment the runner's own turn is given: the job's variables as the
 *  runner's own container would have them, less every member's. */
export function runnerEnv(env, composite, { jobDir, messageFile, seconds }) {
  const own = Object.fromEntries(Object.entries(env).filter(([k]) => !k.startsWith("MEMBER__")));
  delete own.MESH_JOB_ANSWER;
  return {
    ...own,
    AGENT_PACKAGE: composite.runner.package,
    AGENT_RUN_SPEC: composite.runner.run_spec ?? "",
    AGENT_JOB_SECONDS: String(seconds),
    MESH_JOB_DIR: jobDir,
    MESH_MESSAGE_FILE: messageFile,
    MESH_REPLY_FILE: join(jobDir, "reply.txt"),
  };
}

/** The environment one member's job is given: what the image says, that
 *  member's own variables, and where its folders are on the mount. The folders
 *  default to the ones its own deploy binds (state/<name>/<dir> and
 *  bindings/<name>), so a member reads and writes the same files here as in
 *  its own container. */
export function memberEnv(env, member, { jobDir, messageFile, seconds, mount, install }) {
  const prefix = memberPrefix(member.name);
  const own = {};
  for (const [k, v] of Object.entries(env)) if (k.startsWith(prefix) && v !== undefined) own[k.slice(prefix.length)] = v;
  const dirs = {};
  for (const d of install?.directories ?? []) {
    if (d?.name) dirs[directoryVar(d.name)] = `${mount}/state/${member.name}/${d.name}`;
  }
  return {
    ...carried(env),
    AGENT_BINDING_DIR: `${mount}/bindings/${member.name}`,
    ...dirs,
    ...own,
    AGENT_NAME: member.name,
    AGENT_PACKAGE: member.package,
    AGENT_RUN_SPEC: member.run_spec ?? "",
    AGENT_JOB_SECONDS: String(seconds),
    MESH_SENDS_VIA_HOST: "1",
    ...(member.handle ? { MESH_SELF_HANDLE: member.handle } : {}),
    MESH_JOB_DIR: jobDir,
    MESH_MESSAGE_FILE: messageFile,
    MESH_REPLY_FILE: join(jobDir, "reply.txt"),
  };
}

/** Take the lines a turn left for the host, and leave nothing behind: what
 *  goes out is decided once, at the end, from the whole run. */
export function takeOutbox(jobDir) {
  const path = join(jobDir, "out", "outbox.jsonl");
  if (!existsSync(path)) return [];
  const text = readFileSync(path, "utf8");
  rmSync(path, { force: true });
  const out = [];
  for (const line of text.split("\n").map((l) => l.trim()).filter(Boolean)) {
    try { out.push(JSON.parse(line)); } catch { /* a line that is not JSON would not have been sent either */ }
  }
  return out;
}

const MEDIA = { txt: "text/plain", md: "text/markdown", json: "application/json", html: "text/html", csv: "text/csv", pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", svg: "image/svg+xml", zip: "application/zip", mp4: "video/mp4", vtt: "text/vtt" };
const mediaOf = (path) => MEDIA[basename(String(path)).split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";

/** What a member delivered, as the files its reply would have carried: each
 *  piece in its pieces.json, copied under its own name so the runner reads it
 *  by that name, the way the adapter hands a downloaded piece over. */
export function handedPieces(jobDir) {
  let list = [];
  try { list = JSON.parse(readFileSync(join(jobDir, "pieces.json"), "utf8")); } catch { return []; }
  if (!Array.isArray(list)) return [];
  const out = [];
  const into = join(jobDir, "handed");
  list.forEach((p, i) => {
    if (typeof p?.path !== "string") return;
    const from = isAbsolute(p.path) ? p.path : join(jobDir, p.path);
    if (!existsSync(from)) return;
    const name = String(p.name ?? basename(from)).replace(/[\\/]/g, "_");
    const ext = basename(from).includes(".") && !name.includes(".") ? `.${basename(from).split(".").pop()}` : "";
    mkdirSync(join(into, String(i)), { recursive: true });
    const to = join(into, String(i), `${name}${ext}`);
    writeFileSync(to, readFileSync(from));
    out.push({ path: to, media_type: p.media_type ?? mediaOf(from), name: `${name}${ext}` });
  });
  return out;
}

const writeJson = (path, doc) => writeFileSync(path, JSON.stringify(doc, null, 2) + "\n");
const newId = () => `c-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;

function readInstallOf(env, pkg) {
  try { return JSON.parse(readFileSync(join(env.AGENT_HOME || process.cwd(), pkg, "install.json"), "utf8")); } catch { return null; }
}

/**
 * The run inside one container. Returns what the first turn answered (the
 * reply to the message this container was started for), every member step
 * run here, and every line that goes out.
 *
 * `runOne` is one-message.mjs's, the same function every agent's own
 * container runs; a test may hand in another.
 */
export function runComposite(env = process.env, { runOne = runOneMessage, now = () => Date.now(), id = newId } = {}) {
  const described = readComposite(env.AGENT_COMPOSITE || COMPOSITE_FILE);
  const composite = { ...described, members: membersOf(described, env) };
  const mount = (env.COMPOSITE_MOUNT || MOUNT).replace(/[\\/]+$/, "");
  const rootJob = env.MESH_JOB_DIR;
  if (!rootJob) throw new Refusal("MESH_JOB_DIR is not set, so there is nowhere to file what this message produces.");
  if (!env.MESH_MESSAGE_FILE) throw new Refusal("MESH_MESSAGE_FILE is not set, so there is no message to answer.");
  const cap = Number(env.AGENT_JOB_SECONDS) > 0 ? Number(env.AGENT_JOB_SECONDS) : 900;
  const deadline = now() + cap * 1000;
  const left = () => Math.floor((deadline - now()) / 1000);
  const within = (own) => Math.max(1, Math.min(Number(own) > 0 ? Number(own) : cap, left()));
  const self = { handle: env.AGENT_HANDLE || env.MESH_SELF_HANDLE || composite.name || composite.runner.package, id: env.MESH_SELF_ID || null };

  // The message this container was started for, answered by the runner exactly
  // as its own container would answer it. Its reply is this container's reply.
  const first = runOne(runnerEnv(env, composite, { jobDir: rootJob, messageFile: env.MESH_MESSAGE_FILE, seconds: within(composite.runner.job_seconds) }));
  const queue = takeOutbox(rootJob);
  const outward = [];
  const steps = [];
  const notes = [];
  let turn = 0;

  while (queue.length) {
    const line = queue.shift();
    const member = memberFor(line, composite);
    if (!member) { outward.push(line); continue; }
    if (left() < MIN_STEP_SECONDS) {
      outward.push(line);
      notes.push(`${member.name} was sent its work on the mesh: ${left()} seconds were left in this container`);
      continue;
    }
    const messageId = id();
    const memberJob = join(mount, "jobs", member.name, messageId);
    mkdirSync(join(memberJob, "out"), { recursive: true });
    const entry = {
      id: messageId, kind: "chat", from: self.id ?? self.handle, handle: self.handle, in_reply_to: null,
      text: String(line.text ?? ""),
      files: (line.files ?? []).map((f) => (typeof f === "string" ? { path: f, media_type: mediaOf(f) } : f)),
    };
    writeJson(join(memberJob, "message.json"), entry);
    const started = now();
    let answered;
    try {
      answered = runOne(memberEnv(env, member, {
        jobDir: memberJob, messageFile: join(memberJob, "message.json"), seconds: within(member.job_seconds),
        mount, install: readInstallOf(env, member.package),
      }));
    } catch (err) {
      if (!(err instanceof Refusal)) throw err;
      answered = { status: "refused", reply: err.message };
    }
    const step = { member: member.name, handle: member.handle ?? null, message: messageId, status: answered.status,
      seconds: Math.round((now() - started) / 1000), job: memberJob };
    steps.push(step);
    // Priced per step, as it would have been on the mesh: only a step that
    // did its work. The host files the line and the platform prices it off the
    // agent's own rate, so nothing in here decides an amount.
    if (member.priced && answered.status === "answered") {
      outward.push({ kind: "step-charge", member: member.agent_id ?? member.handle ?? member.name, handle: member.handle ?? null,
        package: member.package, version: member.version ?? null, message: messageId, composite: composite.solution ?? null,
        at: new Date(now()).toISOString() });
    }
    // What the member itself wanted sent goes out as it would from its own
    // container. The host sends it under this agent's key and says on whose
    // behalf.
    for (const own of takeOutbox(memberJob)) outward.push({ ...own, on_behalf_of: member.handle ?? member.name });

    // The reply goes back to the runner as the next message, from the member.
    turn += 1;
    const turnJob = join(rootJob, "turns", `${turn}-${member.name}`);
    mkdirSync(join(turnJob, "out"), { recursive: true });
    const back = {
      id: id(), kind: "chat", from: member.agent_id ?? member.handle ?? member.name, handle: member.handle ?? member.name,
      in_reply_to: null, text: String(answered.reply ?? ""), files: handedPieces(memberJob),
    };
    writeJson(join(turnJob, "message.json"), back);
    try {
      runOne(runnerEnv(env, composite, { jobDir: turnJob, messageFile: join(turnJob, "message.json"), seconds: within(composite.runner.job_seconds) }));
    } catch (err) {
      if (!(err instanceof Refusal)) throw err;
      notes.push(`the runner refused ${member.name}'s reply: ${err.message}`);
    }
    queue.push(...takeOutbox(turnJob));
  }

  // One outbox, for the host, holding everything that leaves this container.
  if (outward.length) {
    mkdirSync(join(rootJob, "out"), { recursive: true });
    writeFileSync(join(rootJob, "out", "outbox.jsonl.tmp"), outward.map((l) => JSON.stringify(l)).join("\n") + "\n");
    renameSync(join(rootJob, "out", "outbox.jsonl.tmp"), join(rootJob, "out", "outbox.jsonl"));
  }
  const record = { format: "agent-composite-run-v1", solution: composite.solution ?? null, message: first.message ?? null,
    steps, turns: turn, sent_out: outward.filter((l) => !l.kind).length, charges: outward.filter((l) => l.kind === "step-charge").length,
    seconds_left: left(), notes };
  writeJson(join(rootJob, "composite-run.json"), record);
  return { ...first, steps, outward, notes };
}

const thisFile = process.argv[1] ? process.argv[1].replace(/\\/g, "/").split("/").pop() : "";
if (thisFile && import.meta.url.endsWith(thisFile)) {
  try {
    const r = runComposite(process.env);
    process.stdout.write(String(r.reply ?? "").endsWith("\n") ? r.reply : `${r.reply ?? ""}\n`);
    process.exit(r.status === "answered" ? 0 : r.status === "stopped" ? 4 : 3);
  } catch (err) {
    if (err instanceof Refusal) {
      console.error(err.message);
      process.exit(2);
    }
    throw err;
  }
}
