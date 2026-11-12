// The plugin's hooks: what the assistant may not do in a build folder.
//
//   pre   (PreToolUse) the person's approval is theirs: no command that runs
//         approve.mjs; and no edit of a file that can no longer change (the
//         approved spec, the fixed tests), of the lock file build.lock.json,
//         or of the check itself under .adlc/
//   stop  (Stop) no stopping while such a file has changed, or while the
//         tests are fixed and the build still fails its check; asked once, so
//         the assistant can still say what blocks it
//
// A build folder is the nearest folder above the file or the working
// directory that holds .adlc/check.mjs. Outside one, every hook allows.
//
// This is a convention on the person's machine: the assistant runs with the
// person's rights and could undo it. It binds once a lifecycle or a pull
// request check holds the same folder (the plan's step 6).
//
//   needs: node >= 22
//   node hooks/guard.mjs pre|stop   reads the hook's JSON on stdin
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const LOCK = "build.lock.json";
const posix = (p) => p.split(sep).join("/");

/** The build folder at or above a path, or null. */
export function buildFolderOf(start) {
  let at = resolve(start ?? ".");
  for (;;) {
    if (existsSync(join(at, ".adlc", "check.mjs"))) return at;
    const up = dirname(at);
    if (up === at) return null;
    at = up;
  }
}

const readJson = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };
const digestOf = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

/** Why the assistant may not write a path, or null when it may. */
export function writeRefusal(file, cwd) {
  const abs = isAbsolute(file) ? file : resolve(cwd ?? ".", file);
  const dir = buildFolderOf(dirname(abs));
  if (!dir) return null;
  const rel = posix(relative(dir, abs));
  if (rel === LOCK) return `${LOCK} is the build's lock file; only the check and the person's approval write it.`;
  if (rel === ".adlc" || rel.startsWith(".adlc/")) return `${rel} is the ADLC check, and the builder does not change the check it is held to.`;
  const lock = readJson(join(dir, LOCK));
  if (lock?.digests && rel in lock.digests) {
    const back = /^(spec\.json|spec\.md|request\.md)$/.test(rel) ? "spec" : "build";
    return `${rel} can no longer change. Change it only after the person sends the build back (node .adlc/approve.mjs --send-back ${back}, which is theirs to run).`;
  }
  return null;
}

const APPROVE = /(?:^|[\s"'/\\])approve\.mjs\b/;
const WRITES = /(?:>|\btee\b|\bsed\s+-i|\bmv\b|\bcp\b|\brm\b|\bSet-Content\b|\bOut-File\b|\bRemove-Item\b|\bMove-Item\b|\bCopy-Item\b|writeFile)/;

/** Why the assistant may not run a command, or null when it may. */
export function commandRefusal(command, cwd) {
  const c = String(command ?? "");
  if (!buildFolderOf(cwd) && !/\.adlc[\\/]/.test(c)) return null;
  if (APPROVE.test(c)) return "approve.mjs is the person's approval, and the assistant never runs it. Show them what is ready and ask them to run it themselves.";
  if (c.includes(LOCK) && WRITES.test(c)) return `${LOCK} is the build's lock file; only the check and the person's approval write it.`;
  if (/\.adlc[\\/]/.test(c) && WRITES.test(c) && !/node\s+(?:\S*[\\/])?\.adlc[\\/]/.test(c)) return "the files under .adlc/ are the ADLC check, and the builder does not change the check it is held to.";
  return null;
}

/** The paths a tool call writes, from its input. */
export function writtenBy(tool, input = {}) {
  if (["Edit", "Write", "MultiEdit"].includes(tool)) return [input.file_path].filter(Boolean);
  if (tool === "NotebookEdit") return [input.notebook_path].filter(Boolean);
  return [];
}

/** The pre-tool decision: { deny: reason } or {}. */
export function pre(event) {
  const cwd = event.cwd ?? process.cwd();
  const tool = event.tool_name;
  const input = event.tool_input ?? {};
  if (tool === "Bash" || tool === "PowerShell") {
    const why = commandRefusal(input.command, cwd);
    return why ? { deny: why } : {};
  }
  for (const f of writtenBy(tool, input)) {
    const why = writeRefusal(f, cwd);
    if (why) return { deny: why };
  }
  return {};
}

/** The stop decision: { block: reason } or {}. */
export function stop(event, { run = spawnSync } = {}) {
  if (event.stop_hook_active) return {};
  const dir = buildFolderOf(event.cwd ?? process.cwd());
  if (!dir) return {};
  const r = run("node", [join(dir, ".adlc", "check.mjs"), "--json"], { cwd: dir, encoding: "utf8", timeout: 600000 });
  let doc = null;
  try { doc = JSON.parse(String(r.stdout ?? "")); } catch { return {}; }
  const listed = (doc.problems ?? []).map((p) => `- ${p}`).join("\n");
  if (doc.code === 3) return { block: `A file that can no longer change was changed, so the build cannot stop here:\n${listed}\nPut it back, or tell the person and ask them to send the build back.` };
  // The code is being judged against fixed tests and still fails: the build is not done.
  if (doc.phase === "build" && doc.code === 1 && doc.tests_fixed) return { block: `The tests are fixed and the build still fails its check, so it is not done:\n${listed}\nFix what it names, or tell the person plainly what blocks you.` };
  return {};
}

const mode = process.argv[2];
if (mode === "pre" || mode === "stop") {
  let text = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (c) => { text += c; });
  process.stdin.on("end", () => {
    let event = {};
    try { event = JSON.parse(text || "{}"); } catch { event = {}; }
    if (mode === "pre") {
      const d = pre(event);
      if (d.deny) console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: d.deny } }));
    } else {
      const d = stop(event);
      if (d.block) console.log(JSON.stringify({ decision: "block", reason: d.block }));
    }
  });
}
