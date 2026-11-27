#!/usr/bin/env node
// The harness contract check (docs/harness-contract.md in the AgentMesh
// repository, "The contract check"). It runs inside a built harness image, as
// the last step of the image's build, and the image is not listed until it
// passes. A customer's harness image passes the same check.
//
// It starts a stand-in model door on 127.0.0.1:8790, which records each call
// and answers with a scripted turn in the Messages shape (streamed when the
// call asks), and a stand-in egress door on 127.0.0.1:8899, which refuses
// every host. Then it runs the harness once, through harness-serve's
// answerOne, on the fixture plugin beside this file, and checks the four parts:
//
//   1. the package: the harness read the fixture's skill (the scripted model
//      asks it to, with the harness's own read tool, and the word in the
//      skill comes back in the delivery);
//   2. one message in, one delivery out: answer.md in the job folder;
//   3. the model only through the door: every model call reached the stand-in
//      door, as POST /v1/messages or count_tokens (run it with no network,
//      `docker run --network none`, and nothing else could have answered);
//   4. inside what it was given: a write outside its grant was refused, no
//      host went through the egress door unasked, and the fixture's hook never
//      ran.
//
//   node harness-check.mjs        exit 0 when every part holds, 1 otherwise
import { createServer } from "node:http";
import { existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const FIXTURE = join(here, "fixture");
export const WORD = "CHECK-WORD-7f3a9c";
export const FORBIDDEN = "/opt/harness-check-forbidden.txt";
export const HOOK_MARK = "/tmp/harness-check-hook-ran";

const pathProp = (tool) => Object.keys(tool?.input_schema?.properties ?? {}).find((k) => /path/i.test(k)) ?? null;
const contentProp = (tool) => Object.keys(tool?.input_schema?.properties ?? {}).find((k) => /^(content|contents|text)$/i.test(k)) ?? null;
const toolNamed = (tools, re) => (tools ?? []).find((t) => re.test(String(t.name ?? "")));
const textOf = (c) => (typeof c === "string" ? c : Array.isArray(c) ? c.map((b) => (typeof b === "string" ? b : b?.text ?? (Array.isArray(b?.content) ? textOf(b.content) : typeof b?.content === "string" ? b.content : ""))).join("\n") : "");

/** The scripted turn for one call: read the skill, write the answer, try a
 *  write outside the grant, then stop. Decided from what the conversation
 *  already holds, so a harness that makes extra calls of its own (titles,
 *  summaries) gets plain words back and the script is not disturbed. */
export function scriptedTurn(body) {
  const tools = body.tools ?? [];
  const read = toolNamed(tools, /^read$/i);
  const write = toolNamed(tools, /^write$/i);
  if (!read || !write) return { text: "ok" };
  const all = (body.messages ?? []).map((m) => textOf(m.content)).join("\n");
  const answerFile = /(\/\S+\/answer\.md)/.exec(all)?.[1]?.replace(/[:.,]+$/, "") ?? null;
  const results = (body.messages ?? []).flatMap((m) => (Array.isArray(m.content) ? m.content.filter((b) => b?.type === "tool_result") : []));
  if (!answerFile) return { text: "There is no answer file named in the request." };
  if (results.length === 0) return { tool: read.name, input: { [pathProp(read)]: join(FIXTURE, "skills", "check-skill", "SKILL.md") } };
  if (results.length === 1) {
    const word = all.includes(WORD) ? WORD : "the skill was not read";
    return { tool: write.name, input: { [pathProp(write)]: answerFile, [contentProp(write)]: `The answer is ${word}.\n` } };
  }
  if (results.length === 2) return { tool: write.name, input: { [pathProp(write)]: FORBIDDEN, [contentProp(write)]: "this must not be written\n" } };
  return { text: "Done." };
}

let n = 0;
function messageOf(turn) {
  n += 1;
  const content = turn.tool ? [{ type: "tool_use", id: `toolu_check_${n}`, name: turn.tool, input: turn.input }] : [{ type: "text", text: turn.text }];
  return { id: `msg_check_${n}`, type: "message", role: "assistant", model: "house-stack", content, stop_reason: turn.tool ? "tool_use" : "end_turn", stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 } };
}
function sse(msg) {
  const ev = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
  let out = ev("message_start", { message: { ...msg, content: [], stop_reason: null, usage: { input_tokens: 10, output_tokens: 1 } } });
  msg.content.forEach((b, i) => {
    if (b.type === "text") {
      out += ev("content_block_start", { index: i, content_block: { type: "text", text: "" } });
      out += ev("content_block_delta", { index: i, delta: { type: "text_delta", text: b.text } });
    } else {
      out += ev("content_block_start", { index: i, content_block: { type: "tool_use", id: b.id, name: b.name, input: {} } });
      out += ev("content_block_delta", { index: i, delta: { type: "input_json_delta", partial_json: JSON.stringify(b.input) } });
    }
    out += ev("content_block_stop", { index: i });
  });
  out += ev("message_delta", { delta: { stop_reason: msg.stop_reason, stop_sequence: null }, usage: { output_tokens: 10 } });
  out += ev("message_stop", {});
  return out;
}

/** The stand-in model door: records every call, answers the script. */
export function standInDoor(port = 8790) {
  const calls = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => { raw += d; });
    req.on("end", () => {
      calls.push({ method: req.method, path: req.url });
      if (req.method === "POST" && /^\/v1\/messages\/count_tokens/.test(req.url)) {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ input_tokens: Math.ceil(raw.length / 4) }));
      }
      if (req.method !== "POST" || !/^\/v1\/messages(\?|$)/.test(req.url)) {
        res.writeHead(404, { "content-type": "application/json" });
        return res.end(JSON.stringify({ type: "error", error: { type: "not_found_error", message: "the model door takes POST /v1/messages only" } }));
      }
      let body = {};
      try { body = JSON.parse(raw); } catch { /* answered as an empty call */ }
      const msg = messageOf(scriptedTurn(body));
      if (body.stream) {
        res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8" });
        return res.end(sse(msg));
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(msg));
    });
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve({ server, calls })));
}

/** The stand-in egress door: refuses every host, and remembers each. */
export function standInEgress(port = 8899) {
  const asked = [];
  const server = createServer((req, res) => { asked.push(req.url); res.writeHead(403); res.end(); });
  server.on("connect", (req, sock) => { asked.push(req.url); sock.end("HTTP/1.1 403 Forbidden\r\n\r\n"); });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve({ server, asked })));
}

export async function check(env = process.env, { answer } = {}) {
  for (const f of [FORBIDDEN, HOOK_MARK]) { try { rmSync(f, { force: true }); } catch { /* not there */ } }
  const door = await standInDoor();
  const egress = await standInEgress();
  const serveFile = join(env.HARNESS_SERVE_DIR || "/opt/harness/bin", "harness-serve.mjs");
  const answerOne = answer ?? (await import(pathToFileURL(serveFile).href)).answerOne;
  const runEnv = {
    ...env,
    AGENT_PACKAGE: FIXTURE, HARNESS_LABEL: "Harness check", AGENT_JOB_SECONDS: "300", HARNESS_JOBS: "/tmp/harness-check",
    ANTHROPIC_BASE_URL: "http://127.0.0.1:8790", ANTHROPIC_API_KEY: "the-model-door-takes-no-key",
    HTTPS_PROXY: "http://127.0.0.1:8899", HTTP_PROXY: "http://127.0.0.1:8899", NO_PROXY: "127.0.0.1,localhost,::1",
  };
  let a;
  try {
    a = await answerOne("Run the harness check. Use the check skill.", runEnv);
  } finally {
    door.server.close();
    egress.server.close();
  }
  const reply = String(a?.body?.reply ?? a?.body?.error ?? "");
  const parts = [
    ["1. it read the package's skill", reply.includes(WORD)],
    ["2. one message in gave one delivery out (answer.md, status 200)", a?.status === 200 && reply.includes("The answer is")],
    ["3. every model call reached the model door, in the Messages shape", door.calls.length > 0 && door.calls.every((c) => c.method === "POST" && /^\/v1\/messages/.test(c.path))],
    ["4a. a write outside its grant was refused", !existsSync(FORBIDDEN)],
    ["4b. no host went through the egress door unasked", egress.asked.length === 0],
    ["4c. the fixture's hook never ran", !existsSync(HOOK_MARK)],
  ];
  for (const [what, ok] of parts) process.stdout.write(`${ok ? "pass" : "FAIL"}  ${what}\n`);
  process.stdout.write(`model door calls: ${door.calls.length}; egress asked: ${egress.asked.length}\n`);
  if (!parts.every(([, ok]) => ok)) process.stdout.write(`reply: ${reply.slice(0, 600)}\n`);
  return parts.every(([, ok]) => ok);
}

const thisFile = process.argv[1] ? process.argv[1].replace(/\\/g, "/").split("/").pop() : "";
if (thisFile && import.meta.url.endsWith(thisFile)) process.exit((await check()) ? 0 : 1);
