// No retired adapter command or tool name in what the lifecycle runs or reads.
//
// The AgentMesh adapter renamed its commands and MCP tools by service, and on
// 2026-11-04 the old names stopped: `agentmesh contacts allow` now refuses
// with "was renamed to agentmesh contacts admit and stopped working". The
// deployment manager still ran `contacts allow` to admit the process runner
// at install, so every new agent's install failed at that step (repo-converter
// on dev, 2026-11-21). The lists below are the adapter's RENAMED_COMMANDS and
// RENAMED_TOOLS (mesh-adapter services.generated.mjs) as they stood when the
// old names stopped.
//
// The files read: every file of code, every template and every Markdown file
// under agents/, host/ and plugin/, leaving out tests (a test/ or fixtures/
// folder, *.test.*, test_*.py), records/ (history) and node_modules/.
//
//   needs: node >= 22
//   node --test checks/test/adapter-commands.test.mjs
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, extname, join, relative, sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const READ = ["agents", "host", "plugin"];
const SKIP_DIRS = new Set(["node_modules", ".git", "out", "__pycache__", "test", "tests", "__tests__", "fixtures", "records"]);
const TEXT = new Set([".mjs", ".js", ".cjs", ".ts", ".mts", ".cts", ".py", ".sh", ".bash", ".tmpl", ".md", ".txt"]);

/** Old command words, each with the command that replaced it. */
export const RETIRED_COMMANDS = {
  "interview": "agents interview", "reputation report": "agents reputation",
  "rfp list": "calls list", "rfp show": "calls show", "rfp post": "calls post", "rfp withdraw": "calls withdraw",
  "knock": "contacts knock", "contacts review": "contacts waiting", "contacts allow": "contacts admit",
  "contacts approve": "contacts admit", "who": "contacts presence", "status": "identity me",
  "send": "messages send", "inbox": "messages inbox", "reply": "messages reply", "ack": "messages dismiss",
  "pair": "names confirm", "ask-owner": "owner ask", "portfolio": "portfolio read",
  "review": "reviews file", "value": "reviews rate",
  ...Object.fromEntries(["open", "join", "invite", "post", "history", "phase", "list", "attach", "fetch", "link",
    "files", "close", "leave", "expel", "dossier"].map((w) => [`room ${w}`, `rooms ${w}`])),
  "room agent-presence": "rooms presence",
};

/** Old MCP tool names that cannot be mistaken for an English word. The ones
 *  that can (knock, reply, discover, remember, recall, reflect) are caught
 *  as commands above or not at all. */
export const RETIRED_TOOLS = [
  "connect_account", "redeem_agent_key", "mesh_capabilities", "mint_agent_token", "mint_gateway_key",
  "revoke_gateway_key", "interview_agent", "interview_diff", "reputation_report", "preview_agent",
  "attach_agent", "list_attachments", "approve_card_change", "set_rate", "detach_agent", "work_board",
  "post_work", "claim_work", "complete_work", "abandon_work", "withdraw_work", "find_agent",
  "check_presence", "declare_feed", "publish_feed", "follow_feed", "unfollow_feed", "read_feed",
  "list_feeds", "retire_feed", "my_identity", "send_message", "check_inbox", "mark_seen",
  "resolve_handle", "begin_naming", "complete_naming", "ask_owner", "portfolio_draft_line",
  "portfolio_declare_dependency", "file_review", "rate_value", "open_room", "join_room",
  "invite_to_room", "post_to_room", "room_history", "room_phase", "list_rooms", "attach_to_room",
  "fetch_from_room", "link_into_room", "list_room_files",
];

/** The subcommands `agentmesh portfolio` takes now; bare `portfolio` was the read. */
const PORTFOLIO_NOW = ["read", "draft", "depend", "review", "transition", "derivations"];

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const words = Object.keys(RETIRED_COMMANDS).sort((a, b) => b.length - a.length);
const oldWords = words.map((w) => w === "portfolio" ? `portfolio(?!\\s+(?:${PORTFOLIO_NOW.join("|")})\\b)` : w.split(" ").map(esc).join("\\s+"));
// The adapter as a word on a command line, a shell variable or a Python
// f-string field that holds it.
const BINARY = String.raw`(?:\bagentmesh|\bmesh-adapter|\$\{?ADAPTER\}?|\{state_cmd\})`;
const AS_TEXT = new RegExp(`${BINARY}\\s+(?:${oldWords.join("|")})(?=\\s|$|["'\`)\\],;:.])`);
// An argument list: the binary then the old word, or a two-word old command
// on its own, in either language's list syntax.
const Q = `["']`;
const firstArg = words.filter((w) => !w.includes(" ") && w !== "portfolio").map(esc).join("|");
const AS_ARGS_AFTER_BINARY = new RegExp(`(?:${Q}[^"'\\s]*(?:agentmesh|mesh-adapter)${Q}|\\bADAPTER\\b|\\badapter\\b)\\s*,\\s*\\[?\\s*${Q}(?:${firstArg})${Q}`);
const pairs = words.filter((w) => w.includes(" ")).map((w) => w.split(" ").map(esc).join(`${Q}\\s*,\\s*${Q}`));
const AS_ARGS_PAIR = new RegExp(`${Q}(?:${pairs.join("|")})${Q}`);
const AS_TOOL = new RegExp(`\\b(?:${RETIRED_TOOLS.join("|")})\\b`);

/** What a line names that stopped on 2026-11-04, or null. */
export function retiredIn(line) {
  for (const re of [AS_TEXT, AS_ARGS_AFTER_BINARY, AS_ARGS_PAIR]) {
    const m = line.match(re);
    if (m) return m[0];
  }
  // The allowance's on_exhausted value "ask_owner" is that document's own
  // word for what happens when a ceiling runs out, not the tool.
  const t = line.match(AS_TOOL);
  if (t && !(t[0] === "ask_owner" && line.includes("on_exhausted"))) return t[0];
  return null;
}

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (!SKIP_DIRS.has(name)) yield* files(p); continue; }
    if (!TEXT.has(extname(name)) || /\.test\./.test(name) || /^test_.*\.py$/.test(name)) continue;
    yield p;
  }
}

test("the patterns catch the forms an old name was written in, and pass the new names", () => {
  for (const line of [
    'as_user(state_user, f"{state_cmd} contacts allow {h}", "admit", 60)',
    '.map((h) => ["contacts", "allow", h])',
    'spawnSync("agentmesh", ["send", handle, text])',
    'run(["/usr/bin/mesh-adapter", "inbox", "--json"])',
    "run `agentmesh status` to see who you are",
    "agentmesh room post r_1 hello",
    "agentmesh portfolio --json",
    "the adapter's send_message tool",
  ]) assert.ok(retiredIn(line), `caught: ${line}`);
  for (const line of [
    'as_user(state_user, f"{state_cmd} contacts admit {h}", "admit", 60)',
    'as_user(state_user, f"{state_cmd} contacts default a2a allow", "expose", 60)',
    '["contacts", "default", "a2a", "block"]',
    'subprocess.run(["sudo", "agentmesh", "messages", "send", runner, text])',
    'spawn("agentmesh", ["start", "--inbox", "--name", name])',
    "agentmesh portfolio draft --json",
    "=== agentmesh message from ${who} ===",
    'doc.get("on_exhausted") in ("refuse", "ask_owner")',
    "the adapter's messages_send tool",
  ]) assert.equal(retiredIn(line), null, `passed: ${line}`);
});

test("nothing the lifecycle runs or reads names an adapter command or tool that stopped on 2026-11-04", () => {
  const found = [];
  for (const top of READ) {
    for (const p of files(join(ROOT, top))) {
      readFileSync(p, "utf8").split(/\r?\n/).forEach((line, i) => {
        const hit = retiredIn(line);
        if (hit) found.push(`${relative(ROOT, p).split(sep).join("/")}:${i + 1}: ${hit}`);
      });
    }
  }
  assert.deepEqual(found, [], "use the adapter's current names (agentmesh help lists them)");
});
