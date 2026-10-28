// A stand-in for the agentmesh command, for the tests: it answers
// `messages send <to> <text> [--wait <s>] [--files <path>] --json` the way the
// real one prints, from a script of how each agent behaves.
//
//   FAKE_MESH       a JSON file: { "<handle>": "answer" | "silent" | "held" | "refused" | { "reply": … } }
//   FAKE_MESH_LOG   a file each send is appended to, one JSON line
import { appendFileSync, readFileSync } from "node:fs";

const args = process.argv.slice(2);
const [verb, sub, to, text] = args;
const at = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const script = JSON.parse(readFileSync(process.env.FAKE_MESH, "utf8"));
if (process.env.FAKE_MESH_LOG) appendFileSync(process.env.FAKE_MESH_LOG, JSON.stringify({ to, text, wait: at("--wait"), files: at("--files") }) + "\n");
if (verb !== "messages" || sub !== "send") { console.error("usage"); process.exit(2); }
const how = script[to] ?? "answer";
const id = `req-${Math.random().toString(36).slice(2, 10)}`;
if (at("--files")) {
  console.log(`resolved ${to}`);
  console.log(JSON.stringify(how === "refused" ? { ok: false, delivered: false, code: "REFUSED", error: "refused" } : { queued: true, request_id: id, inbox_id: null }));
} else if (how === "silent") {
  console.log(JSON.stringify({ queued: true, no_reply_within: Number(at("--wait")), inbox_id: null }));
} else if (how === "held") {
  console.log(JSON.stringify({ status: "held", delivered: false, request_id: id, note: `Held, not delivered: ${to} is holding it for its owner.` }));
} else if (how === "refused") {
  console.log(JSON.stringify({ ok: false, delivered: false, code: "BLOCKED", error: `${to} blocks this agent` }));
} else if (how === "broken") {
  console.error("could not connect");
  process.exit(1);
} else {
  const reply = typeof how === "object" ? how.reply : { interface: "interface-worker", exchange: "status", job: "job-7", state: "done", detail: "finished" };
  console.log(JSON.stringify({ reply: typeof reply === "string" ? reply : JSON.stringify(reply), from: "UFAKE", handle: to, in_reply_to: id }));
}
