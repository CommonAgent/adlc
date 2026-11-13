// One message, from the adapter to the package and back, in the agent's
// container on the local AgentMesh (node .adlc/local.mjs).
//
// The adapter runs this for each message in pipe mode: the sender's words on
// stdin, who sent them in AGENTMESH_FROM and the message's id in
// AGENTMESH_MESSAGE_ID, and whatever this prints is the reply. The package's
// entrypoint (the image tools' one-message.mjs) answers one inbox entry from
// a job folder, so this writes the entry into a fresh job folder, runs it,
// and prints the reply it wrote. The folder is removed after; the agent's
// own records are in its declared directories, on the volume.
//
//   needs: node >= 22
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** The inbox entry one-message.mjs reads, from what the adapter handed over. */
export function entryOf(text, env) {
  const from = String(env.AGENTMESH_FROM ?? "");
  return { id: String(env.AGENTMESH_MESSAGE_ID ?? `local-${Date.now()}`), from, handle: from, text: String(text), in_reply_to: null, kind: "request", files: [] };
}

/** What the sender is told: the reply the package wrote, or why there is none. */
export function replyOf(code, job) {
  const file = join(job, "reply.txt");
  const reply = existsSync(file) ? readFileSync(file, "utf8").trim() : "";
  if (reply) return reply;
  if (code === 3) return "The work finished with nothing to say.";
  if (code === 4) return "The work ran past its time limit, so it was stopped.";
  return `The agent could not answer this message (its entrypoint exited ${code}).`;
}

function main() {
  const text = readFileSync(0, "utf8");
  const job = mkdtempSync(join(tmpdir(), "job-"));
  try {
    const message = join(job, "message.json");
    writeFileSync(message, JSON.stringify(entryOf(text, process.env)));
    const r = spawnSync("node", ["/opt/agent/entrypoint.mjs"], {
      env: { ...process.env, MESH_JOB_DIR: job, MESH_MESSAGE_FILE: message },
      // Its own output goes to the log, never into the reply.
      stdio: ["ignore", 2, 2],
    });
    process.stdout.write(`${replyOf(r.status ?? 1, job)}\n`);
  } finally {
    rmSync(job, { recursive: true, force: true });
  }
}

if (process.argv[1] && process.argv[1].endsWith("bridge.mjs")) main();
