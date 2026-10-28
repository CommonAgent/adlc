// The one way this agent says anything on the mesh: the agentmesh command,
// as this agent, from the host it runs on. Used twice: to ask each watched
// agent the worker interface's status (ask.mjs), and to hand each open alert
// to the incident recorder (raise.mjs).
//
// A send gets a clock. A send that never returns is stopped and said, so it
// cannot take the job with it.
//
//   needs: node >= 22, and the agentmesh command on the path (AGENTMESH_BIN
//          names another)
//   import { runAgentmesh } from "./send.mjs"
import { spawn } from "node:child_process";

const trim = (s) => String(s ?? "").trim();

/** Run `agentmesh <args>`. Resolves { status, stdout, stderr, killed, error };
 *  never throws. */
export function runAgentmesh(args, { timeoutSeconds = 60, bin = process.env.AGENTMESH_BIN || "agentmesh", spawnImpl = spawn } = {}) {
  return new Promise((resolve) => {
    const js = /\.m?js$/.test(bin);
    let child;
    try {
      child = js ? spawnImpl(process.execPath, [bin, ...args], { stdio: ["ignore", "pipe", "pipe"] })
        : spawnImpl(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      resolve({ status: null, stdout: "", stderr: "", killed: false, error: `the agentmesh command could not be started (${trim(e?.message ?? e)})` });
      return;
    }
    let stdout = ""; let stderr = ""; let done = false; let killed = false;
    const killer = setTimeout(() => { if (!done) { killed = true; try { child.kill(); } catch { /* gone */ } } }, timeoutSeconds * 1000);
    child.stdout?.on("data", (d) => { stdout += d; });
    child.stderr?.on("data", (d) => { stderr += d; });
    const finish = (status, err) => {
      if (done) return;
      done = true;
      clearTimeout(killer);
      resolve({ status, stdout, stderr, killed, error: err ? `the agentmesh command could not be started (${trim(err.message ?? err)})` : null });
    };
    child.on("error", (e) => finish(null, e));
    child.on("close", (code) => finish(code, null));
  });
}

/** The object a send printed: the whole of stdout when it is one JSON value
 *  (pretty-printed or not), else its last line that is one. */
export function jsonOf(out) {
  const t = trim(out);
  if (t.startsWith("{")) { try { return JSON.parse(t); } catch { /* a line of its own below */ } }
  for (const l of t.split("\n").reverse()) {
    if (!l.trim().startsWith("{")) continue;
    try { return JSON.parse(l); } catch { /* not this one */ }
  }
  return null;
}
