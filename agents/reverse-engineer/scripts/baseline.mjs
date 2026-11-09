// One baseline run of the project's own tests, when the job may run things.
//
// The command is the test script the project's package.json names, run the
// way npm runs a script: through the shell, in the codebase's folder, with its
// node_modules/.bin first on the PATH. It runs in a child process with a time
// limit, and the whole process tree is stopped when the limit passes.
//
// What the child is handed is chosen by exact name, never by a prefix: the
// PATH, the few variables a shell needs to start on each system, and a home
// and a temporary folder of its own under the job's work folder. Nothing else
// from this agent's environment reaches it, so the model's credential and any
// key the host placed never reach the code being described.
//
// No network: where the host can start the run in a network namespace of its
// own with no interface (unshare -rn, on Linux), it does, and the record says
// the network was cut off. Where it cannot, the run still goes ahead with npm
// set offline, and the record says plainly that the network was not cut off,
// so nobody reads the run as sealed when it was not.
//
// The results are read from what the run printed, by rule: node's test
// runner, TAP, Jest, Mocha and pytest summaries. A run whose counts cannot be
// read says so, and its exit code still stands.
//
//   needs: node >= 22; a shell; unshare, on Linux, to cut the network off
//   import { runBaseline } from "./baseline.mjs"
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { delimiter, join } from "node:path";

const trim = (s) => String(s ?? "").trim();

/** The time limit when the job names none, and the range it may name. */
export const BASELINE_SECONDS = 300;
export const MIN_SECONDS = 30;
export const MAX_SECONDS = 600;
/** How much of what the run printed is kept: the log keeps its last this
 *  many bytes, the record its last TAIL characters. */
export const OUTPUT_BYTES = 2 * 1024 * 1024;
export const TAIL = 4000;

/** The variables the child is handed from this process, by exact name. */
export const PASSED = ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "ComSpec", "COMSPEC", "PATHEXT", "WINDIR", "LANG", "LC_ALL", "TZ"];

/** Whether this host can start a command with no network: unshare -rn. */
export function canCutNetwork() {
  if (process.platform !== "linux") return false;
  try { return spawnSync("unshare", ["-rn", "true"], { stdio: "ignore", timeout: 5000 }).status === 0; } catch { return false; }
}

/** The child's environment: the passed names, a home and temp of its own,
 *  npm offline, and the project's node_modules/.bin first on the PATH. */
export function childEnv(cwd, scratch, from = process.env) {
  const env = {};
  for (const k of PASSED) if (typeof from[k] === "string") env[k] = from[k];
  const pathKey = "PATH" in env ? "PATH" : "Path" in env ? "Path" : "PATH";
  env[pathKey] = [join(cwd, "node_modules", ".bin"), env[pathKey] ?? ""].filter(Boolean).join(delimiter);
  mkdirSync(join(scratch, "home"), { recursive: true });
  mkdirSync(join(scratch, "tmp"), { recursive: true });
  Object.assign(env, {
    HOME: join(scratch, "home"), USERPROFILE: join(scratch, "home"),
    TMPDIR: join(scratch, "tmp"), TEMP: join(scratch, "tmp"), TMP: join(scratch, "tmp"),
    CI: "true", NO_COLOR: "1", FORCE_COLOR: "0",
    npm_config_offline: "true", npm_config_update_notifier: "false",
  });
  return env;
}

/** The counts a run printed: {passed, failed, skipped, read_from} or {}. */
export function countsIn(output) {
  const t = String(output ?? "");
  const num = (re) => { const m = re.exec(t); return m ? Number(m[1]) : null; };
  // node's test runner (spec and TAP reporters) and TAP in general.
  const nodePass = num(/^\s*(?:#|ℹ)\s*pass\s+(\d+)\s*$/m);
  const nodeFail = num(/^\s*(?:#|ℹ)\s*fail\s+(\d+)\s*$/m);
  if (nodePass !== null || nodeFail !== null) {
    return { passed: nodePass ?? 0, failed: nodeFail ?? 0, skipped: (num(/^\s*(?:#|ℹ)\s*skipped\s+(\d+)\s*$/m) ?? 0) + (num(/^\s*(?:#|ℹ)\s*todo\s+(\d+)\s*$/m) ?? 0), read_from: "the node test runner's summary" };
  }
  // Jest: "Tests:       1 failed, 2 passed, 3 total"
  const jest = /^Tests:\s+(.+total)\s*$/m.exec(t);
  if (jest) {
    const part = (w) => Number(new RegExp(`(\\d+) ${w}`).exec(jest[1])?.[1] ?? 0);
    return { passed: part("passed"), failed: part("failed"), skipped: part("skipped") + part("todo"), read_from: "Jest's summary" };
  }
  // Mocha: "  3 passing (12ms)" / "  1 failing" / "  2 pending"
  const passing = num(/^\s*(\d+) passing\b/m);
  if (passing !== null) return { passed: passing, failed: num(/^\s*(\d+) failing\b/m) ?? 0, skipped: num(/^\s*(\d+) pending\b/m) ?? 0, read_from: "Mocha's summary" };
  // pytest: "==== 2 failed, 3 passed in 0.12s ===="
  const py = /^=+ (.*\b(?:passed|failed|error)\b.*) in [\d.]+s/m.exec(t);
  if (py) {
    const part = (w) => Number(new RegExp(`(\\d+) ${w}`).exec(py[1])?.[1] ?? 0);
    return { passed: part("passed"), failed: part("failed") + part("errors?"), skipped: part("skipped"), read_from: "pytest's summary" };
  }
  // TAP plan with ok / not ok lines.
  const oks = (t.match(/^ok \d+/gm) ?? []).length;
  const notOks = (t.match(/^not ok \d+/gm) ?? []).length;
  if (oks || notOks) return { passed: oks, failed: notOks, skipped: 0, read_from: "the TAP lines it printed" };
  return {};
}

/** Stop the child and everything it started. */
function stopTree(child) {
  if (!child.pid) return;
  try {
    if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    else process.kill(-child.pid, "SIGKILL");
  } catch { try { child.kill("SIGKILL"); } catch { /* already gone */ } }
}

/** Run the command once: {command, exit_code, signal, timed_out, seconds,
 *  network, passed?, failed?, skipped?, read_from?, output}. `scratch` is a
 *  folder of the job's own for the child's home and temp. `floor` is the
 *  shortest limit allowed (a test sets it lower, to see a run stopped). */
export function runBaseline({ command, cwd, scratch, seconds = BASELINE_SECONDS, env = process.env, cutNetwork = canCutNetwork(), floor = MIN_SECONDS }) {
  const limit = Math.min(MAX_SECONDS, Math.max(floor, Number(seconds) || BASELINE_SECONDS));
  const childEnvironment = childEnv(cwd, scratch, env);
  const started = Date.now();
  return new Promise((resolve) => {
    const child = cutNetwork
      ? spawn("unshare", ["-rn", "sh", "-c", command], { cwd, env: childEnvironment, detached: true, stdio: ["ignore", "pipe", "pipe"] })
      : spawn(command, { cwd, env: childEnvironment, shell: true, detached: process.platform !== "win32", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let out = Buffer.alloc(0);
    let dropped = 0;
    // cut-ok: the log keeps the last OUTPUT_BYTES of what the run printed, where every runner writes its summary, and says how much came before it.
    const take = (b) => {
      out = Buffer.concat([out, b]);
      if (out.length > OUTPUT_BYTES) { dropped += out.length - OUTPUT_BYTES; out = out.subarray(out.length - OUTPUT_BYTES); }
    };
    child.stdout.on("data", take);
    child.stderr.on("data", take);
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; stopTree(child); }, limit * 1000);
    const finish = (code, signal, failedToStart = "") => {
      clearTimeout(timer);
      const output = (dropped ? `(the first ${dropped} bytes the run printed are not kept)\n` : "") + out.toString("utf8") + (failedToStart ? `\n${failedToStart}\n` : "");
      resolve({
        command,
        exit_code: typeof code === "number" ? code : null,
        ...(signal ? { signal } : {}),
        timed_out: timedOut,
        time_limit_seconds: limit,
        seconds: Math.round((Date.now() - started) / 100) / 10,
        network: cutNetwork ? "cut off: the run had a network namespace of its own with no interface" : "not cut off: this host could not start the run without a network, so npm was set offline and nothing else held it back",
        ...countsIn(output),
        output,
      });
    };
    child.on("error", (e) => finish(null, null, `the command could not be started: ${trim(e.message)}`));
    child.on("close", (code, signal) => finish(code, signal));
  });
}

/** The last TAIL characters of a run's output, with the codebase's own
 *  folder and the scratch folder written as `.` and `<scratch>`, so no path
 *  of the machine it ran on travels in the record. */
export function tailOf(output, { cwd = "", scratch = "" } = {}) {
  let t = String(output ?? "");
  const swap = (from, to) => {
    if (!from) return;
    for (const v of new Set([from, from.replace(/\\/g, "/"), from.replace(/\//g, "\\")])) t = t.split(v).join(to);
  };
  swap(scratch, "<scratch>");
  swap(cwd, ".");
  // cut-ok: the record keeps the last TAIL characters of the output, where the summary is; the whole of it is in the job's baseline.log.
  return t.length > TAIL ? t.slice(-TAIL) : t;
}
