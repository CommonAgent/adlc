#!/usr/bin/env node
// agentevaluator's input check, run live against installed agents through the
// front door (the account's MCP connector), the way any caller reaches them.
//
// For each agent it reads the published descriptor, makes the three input
// cases for every offering that needs an input beyond free text
// (input-cases.mjs), sends each as a plain message from the account's own
// agent, and waits for the answer in that agent's inbox. A case passes when
// the answer is the standard INPUT_NOT_UNDERSTOOD reply (or, for the plain
// sentence, "I read this as ...") inside the window. Answers it reads are
// dismissed, so the inbox is left as it was.
//
// Usage (one JSON object on stdout; exit 0 only when every case passed):
//   AGENTMESH_TOKEN_FILE=<file holding an amt_ token with the mesh scope> \
//   node input-check.mjs <handle> [<handle> ...]
// The token is read from the file and never printed.
//
// Settings: AGENTMESH_API (default the environment's urls.api, env/prod.json),
// AGENTMESH_NAMING (default its urls.naming).

import { readFileSync } from "node:fs";
import { allScripted, checkableOfferings, inputCases, judgeCase, INPUT_CASE_WINDOW_MS } from "./input-cases.mjs";
import { createRequire as amCreateRequire } from "node:module";
import { existsSync as amExists } from "node:fs";
import { dirname as amDirname, join as amJoin } from "node:path";
import { fileURLToPath as amFileURLToPath } from "node:url";

// The AgentMesh environment (env/<AGENTMESH_ENV>.json, default prod) through
// env/load.cjs. This file is copied flat onto hosts, so the loader is looked
// for in AGENTMESH_ENV_DIR, in the repository, beside this file, in
// /opt/fleet/env or /opt/agentmesh/env, then in an env/ above the working
// directory; not finding it is an error that names every place looked.
let amEnvLib;
function amEnv(key) {
  if (!amEnvLib) {
    const here = amDirname(amFileURLToPath(import.meta.url));
    const dirs = [process.env.AGENTMESH_ENV_DIR, amJoin(here, "../../env"), amJoin(here, "env"), "/opt/fleet/env", "/opt/agentmesh/env"].filter(Boolean);
    for (let d = process.cwd(); ; d = amDirname(d)) { dirs.push(amJoin(d, "env")); if (amDirname(d) === d) break; }
    const dir = dirs.find((d) => amExists(amJoin(d, "load.cjs")));
    if (!dir) throw new Error(`the AgentMesh environment loader (env/load.cjs) was not found; looked in ${dirs.join(", ")}`);
    amEnvLib = amCreateRequire(import.meta.url)(amJoin(dir, "load.cjs"));
  }
  return amEnvLib.get(key);
}

const API = (process.env.AGENTMESH_API ?? amEnv("urls.api")).replace(/\/$/, "");
const NAMING = (process.env.AGENTMESH_NAMING ?? amEnv("urls.naming")).replace(/\/$/, "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function token() {
  const f = process.env.AGENTMESH_TOKEN_FILE;
  if (!f) throw new Error("set AGENTMESH_TOKEN_FILE to a file holding an amt_ token with the mesh scope");
  const t = readFileSync(f, "utf8").trim();
  if (!t.startsWith("amt_")) throw new Error("the token file does not hold an amt_ token");
  return t;
}

let rpcId = 0;
async function tool(bearer, name, args) {
  const res = await fetch(`${API}/v1/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${bearer}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method: "tools/call", params: { name, arguments: args } }),
    signal: AbortSignal.timeout(30_000),
  });
  const raw = await res.text();
  const body = raw.startsWith("{") ? JSON.parse(raw) : JSON.parse(raw.split("\n").find((l) => l.startsWith("data:"))?.slice(5) ?? "{}");
  if (body.error) throw new Error(`${name}: ${body.error.message ?? JSON.stringify(body.error)}`);
  const text = body.result?.content?.[0]?.text ?? "{}";
  try { return JSON.parse(text); } catch { return { text }; }
}

async function resolveKey(handle) {
  const r = await fetch(`${NAMING}/api/resolve?handle=${encodeURIComponent(handle)}`, { signal: AbortSignal.timeout(10_000) });
  if (!r.ok) return null;
  const card = (await r.json())?.card;
  return (card?.endpoints ?? []).find((e) => e.protocol === "agentmesh")?.agent_id ?? null;
}

async function descriptorOf(key) {
  const r = await fetch(`${API}/v1/agents/${encodeURIComponent(key)}/descriptor`, { signal: AbortSignal.timeout(10_000) });
  return r.ok ? r.json() : null;
}

/** Wait for a message from `key` that was not in the inbox before. */
async function answerFrom(bearer, key, seen, windowMs) {
  const until = Date.now() + windowMs + 3_000;
  while (Date.now() < until) {
    const inbox = await tool(bearer, "messages_inbox", {}).catch(() => ({ messages: [] }));
    for (const m of inbox.messages ?? []) {
      if (m.from === key && !seen.has(m.id) && m.reply_status !== "working") return m;
    }
    await sleep(700);
  }
  return null;
}

async function checkAgent(bearer, handle) {
  const key = await resolveKey(handle);
  if (!key) return { handle, verdict: "inconclusive", why: "the name did not resolve" };
  const descriptor = await descriptorOf(key);
  if (!descriptor) return { handle, key, verdict: "inconclusive", why: "no published descriptor" };
  const offerings = checkableOfferings(descriptor);
  if (!offerings.length) return { handle, key, verdict: "not applicable", why: "no offering needs an input beyond free text; the agent answers every message itself" };
  const results = [];
  for (const o of offerings.slice(0, 3)) {
    for (const c of inputCases(o, { mixed: !allScripted(descriptor) })) {
      const before = await tool(bearer, "messages_inbox", {}).catch(() => ({ messages: [] }));
      const seen = new Set((before.messages ?? []).map((m) => m.id));
      const t0 = Date.now();
      await tool(bearer, "messages_send", { to: handle, text: c.text });
      const got = await answerFrom(bearer, key, seen, INPUT_CASE_WINDOW_MS);
      const ms = Date.now() - t0;
      results.push({ ...judgeCase(c, got, ms), said: got ? String(got.text ?? "").slice(0, 160) : null });
      if (got?.id) await tool(bearer, "messages_dismiss", { inbox_ids: [got.id] }).catch(() => null);
    }
  }
  return { handle, key, verdict: results.every((r) => r.pass) ? "conforms" : "does not conform", cases: results };
}

const handles = process.argv.slice(2);
if (!handles.length) {
  console.error("usage: node input-check.mjs <handle> [<handle> ...]");
  process.exit(2);
}
const bearer = token();
const agents = [];
for (const h of handles) agents.push(await checkAgent(bearer, h).catch((err) => ({ handle: h, verdict: "inconclusive", why: String(err?.message ?? err) })));
const failed = agents.filter((a) => a.verdict === "does not conform" || a.verdict === "inconclusive");
console.log(JSON.stringify({ at: new Date().toISOString(), window_ms: INPUT_CASE_WINDOW_MS, agents }, null, 2));
process.exit(failed.length ? 1 : 0);
