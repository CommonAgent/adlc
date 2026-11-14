// The link from the local AgentMesh to a public one (kit/local/link.mjs and
// local.mjs link, Agent Messaging §21.8 to §21.13). The rules the link holds
// to are tested here without a network; local.mjs link is run with Docker
// and AgentMesh standing in.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HOP_HEADER, MAX_HOPS, credsOf, goesUp, inboxAgentOf, meshUrlOf, meshUrlsOf, nextHops } from "../kit/local/link.mjs";
import { LINK_CONTAINER, identityPathOf, link, linkRunArgs, localAgents, tryFromPublic } from "../kit/local.mjs";

const A = `U${"A".repeat(55)}`;
const B = `U${"B".repeat(55)}`;
const H = `U${"H".repeat(55)}`;
const OWN = `U${"O".repeat(55)}`;
const dirs = [];
process.on("exit", () => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const tmp = (p) => { const d = mkdtempSync(join(tmpdir(), p)); dirs.push(d); return d; };

test("the hop count rides in its header, starts at 0, and a message past three crossings is dropped", () => {
  assert.equal(HOP_HEADER, "Mesh-Hops");
  assert.equal(nextHops(undefined), 1);
  assert.equal(nextHops("junk"), 1);
  assert.equal(nextHops("2"), 3);
  assert.equal(nextHops(String(MAX_HOPS)), null);
});

test("a message goes up only when the local mesh says it does not hold the recipient, and a linked agent sent it", () => {
  const linked = new Set([A, B]);
  assert.equal(goesUp({ to: H, from: A, linked, held: false }), true);
  assert.equal(goesUp({ to: H, from: A, linked, held: true }), false, "held here: it stays");
  assert.equal(goesUp({ to: H, from: A, linked, held: null }), false, "the registry could not say: never sent out on a guess");
  assert.equal(goesUp({ to: H, from: H, linked, held: false }), false, "an answer could not come back to an agent the public mesh does not know");
  assert.equal(goesUp({ to: B, from: A, linked, held: false }), false, "a linked agent is held here");
});

test("the inbox subject names the agent; the credential file gives the JWT and seed; the public mesh's WebSocket endpoint is used", () => {
  assert.equal(inboxAgentOf(`mesh.agent.${A}.inbox`), A);
  assert.equal(inboxAgentOf(`mesh.agent.${A}.inbox.guarded`), null);
  const creds = "-----BEGIN NATS USER JWT-----\neyJ0eXAi-OiJKV1Q_.x.y\n------END NATS USER JWT------\n\n-----BEGIN USER NKEY SEED-----\nSUAKEY\n------END USER NKEY SEED------\n";
  assert.deepEqual(credsOf(creds), { jwt: "eyJ0eXAi-OiJKV1Q_.x.y", seed: "SUAKEY" });
  assert.equal(meshUrlOf({ endpoints: ["nats://mesh.dev.agentmesh.ai:4222", "wss://mesh.dev.agentmesh.ai"] }), "wss://mesh.dev.agentmesh.ai");
  assert.equal(meshUrlOf({ endpoints: { nats: ["wss://x"] } }), "wss://x");
  assert.equal(meshUrlOf({}), null);
  // What dev's bootstrap answers: a plain WebSocket on 4443, while its web
  // front serves the same broker over TLS on the standard port.
  assert.deepEqual(meshUrlsOf({ endpoints: ["nats://mesh.dev.agentmesh.ai:4222", "ws://mesh.dev.agentmesh.ai:4443"] }), ["wss://mesh.dev.agentmesh.ai", "ws://mesh.dev.agentmesh.ai:4443"]);
});

test("the link's container reads each linked agent's volume read-only and the local mesh's credential read-only", () => {
  const args = linkRunArgs({ image: "img", api: "https://api.dev.agentmesh.ai", mesh: "wss://mesh.dev.agentmesh.ai", agents: [{ name: "tz", id: A, volume: "agentmesh-local-tz" }] });
  assert.ok(args.includes("agentmesh-local-tz:/agents/tz:ro"));
  assert.ok(args.includes("agentmesh-local_config:/config:ro"));
  const config = JSON.parse(args[args.indexOf("-e") + 1].replace(/^LINK_CONFIG=/, ""));
  assert.deepEqual(config.agents, [{ name: "tz", id: A, identity: identityPathOf("tz") }]);
  assert.equal(config.api, "https://api.dev.agentmesh.ai");
});

function localHomeWith() {
  const home = tmp("adlc-link-home-");
  writeFileSync(join(home, "mesh.json"), "{}");
  mkdirSync(join(home, "agents", "tz"), { recursive: true });
  writeFileSync(join(home, "agents", "tz", "agent.json"), JSON.stringify({ name: "tz", id: A, container: "agentmesh-local-tz" }));
  writeFileSync(join(home, "caller.json"), JSON.stringify({ id: B }));
  return home;
}

function agentmesh({ press = true } = {}) {
  const calls = [];
  let pressed = false;
  const fetcher = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? "GET", body: init.body ? JSON.parse(init.body) : null, auth: init.headers?.authorization });
    const reply = (status, body) => ({ status, json: async () => body });
    if (url.endsWith("/v1/link/by-email")) return reply(202, { ticket: "T.secret", says: "We emailed you." });
    if (/\/v1\/link\/by-email\/T\.secret$/.test(url)) {
      if (!pressed && press) { pressed = true; return reply(200, { state: "waiting" }); }
      if (!press) return reply(200, { state: "waiting" });
      return reply(200, { state: "linked", mesh: { endpoints: ["wss://mesh.dev.agentmesh.ai"] }, own_agent_key: OWN, agents: [{ name: "tz", key: A, handle: "tz.dana@example.com" }, { name: "caller", key: B, handle: "caller.dana@example.com" }] });
    }
    if (url.endsWith("/test")) return reply(200, { ok: true, to: "tz.dana@example.com", sent_at: "2026-11-13T17:00:00.000Z" });
    if (url.includes("/replies")) return reply(200, { replies: [{ text: "17:30 in Paris", received_at: "2026-11-13T17:00:03.000Z" }] });
    return reply(404, {});
  };
  return { calls, fetcher };
}

function docker() {
  const calls = [];
  const run = (cmd, args) => {
    calls.push([cmd, ...args]);
    if (args[0] === "logs") return { status: 0, stdout: "[link] linked: tz, caller\n", stderr: "" };
    return { status: 0, stdout: "", stderr: "" };
  };
  return { calls, run };
}

test("link files the local agents with the email, waits for the button, starts the link and lets the person's own agent in", async () => {
  const home = localHomeWith();
  assert.deepEqual(localAgents(home).map((a) => a.name), ["tz", "caller"]);
  const am = agentmesh();
  const d = docker();
  const r = await link({ email: "dana@example.com", name: "Dana Developer", instance: "https://api.dev.agentmesh.ai", env: { ADLC_LOCAL_HOME: home }, run: d.run, fetcher: am.fetcher, sleep: async () => {} });
  assert.equal(r.code, 0, r.said);
  assert.match(r.said, /tz\.dana@example\.com/);
  const filed = am.calls[0];
  assert.equal(filed.url, "https://api.dev.agentmesh.ai/v1/link/by-email");
  assert.deepEqual(filed.body.agents, [{ name: "tz", key: A }, { name: "caller", key: B }]);
  assert.equal(filed.auth, undefined, "no deploy key in the shell: the owner approves by email");
  const started = d.calls.find((c) => c[1] === "run" && c.includes(LINK_CONTAINER));
  assert.ok(started, "the link's container started");
  assert.ok(d.calls.some((c) => c[1] === "exec" && c[2] === "agentmesh-local-tz" && c.at(-1).includes(`contacts admit ${OWN}`)), "the person's own agent is let in");
  assert.equal(JSON.parse(readFileSync(join(home, "link.json"), "utf8")).state, "linked");
});

test("link with the deploy key sends it as the bearer; without the button pressed it says to run it again, and keeps the ticket", async () => {
  const home = localHomeWith();
  const am = agentmesh({ press: false });
  const r = await link({ email: "platform+link@agentmesh.ai", name: "AgentMesh", env: { ADLC_LOCAL_HOME: home, AGENTMESH_DEPLOY_KEY: "k" }, run: docker().run, fetcher: am.fetcher, sleep: async () => {}, waitMs: 0 });
  assert.equal(r.code, 3);
  assert.equal(am.calls[0].auth, "Bearer k");
  const again = await link({ env: { ADLC_LOCAL_HOME: home }, run: docker().run, fetcher: am.fetcher, sleep: async () => {}, waitMs: 0 });
  assert.equal(again.code, 3);
  assert.equal(am.calls.filter((c) => c.method === "POST").length, 1, "the same agents are not filed twice");
});

test("try --via-agentmesh sends from the person's own agent on AgentMesh and shows the reply carried back", async () => {
  const home = localHomeWith();
  writeFileSync(join(home, "link.json"), JSON.stringify({ api: "https://api.dev.agentmesh.ai", ticket: "T.secret", state: "linked" }));
  const dir = tmp("adlc-link-dir-");
  writeFileSync(join(dir, "plugin.json"), JSON.stringify({ name: "tz" }));
  const am = agentmesh();
  const r = await tryFromPublic(dir, { text: "09:30 Denver in Paris?", env: { ADLC_LOCAL_HOME: home }, fetcher: am.fetcher, sleep: async () => {} });
  assert.equal(r.code, 0, r.said);
  assert.match(r.said, /17:30 in Paris/);
  assert.deepEqual(am.calls[0].body, { to: "tz", text: "09:30 Denver in Paris?" });
});

test("try --via-agentmesh shows the answer the test brought back itself, and says why when AgentMesh would not send", async () => {
  const home = localHomeWith();
  writeFileSync(join(home, "link.json"), JSON.stringify({ api: "https://api.dev.agentmesh.ai", ticket: "T.secret", state: "linked" }));
  const dir = tmp("adlc-link-dir-");
  writeFileSync(join(dir, "plugin.json"), JSON.stringify({ name: "tz" }));
  const answered = async () => ({ status: 200, json: async () => ({ ok: true, state: "answered", reply: { text: "17:30 in Paris" }, to: "tz.dana@example.com" }) });
  const r = await tryFromPublic(dir, { env: { ADLC_LOCAL_HOME: home }, fetcher: answered, sleep: async () => {} });
  assert.equal(r.code, 0);
  assert.match(r.said, /tz\.dana@example\.com answered, through AgentMesh:\n17:30 in Paris/);
  const unnamed = async () => ({ status: 200, json: async () => ({ ok: false, state: "failed", error: "This agent does not have one yet, so nothing was sent." }) });
  const n = await tryFromPublic(dir, { env: { ADLC_LOCAL_HOME: home }, fetcher: unnamed, sleep: async () => {} });
  assert.equal(n.code, 1);
  assert.match(n.said, /nothing was sent/);
});
