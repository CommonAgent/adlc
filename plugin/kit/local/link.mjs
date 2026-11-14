// The link: the local AgentMesh's one connection to a public AgentMesh, kept
// open (Agent Messaging §21.8 to §21.13). It runs in a container of its own
// beside the local mesh (node .adlc/local.mjs link starts it).
//
// A mesh on a person's computer has no address anyone outside can reach, so
// it dials out, the way an agent behind a firewall keeps its connection to
// its mesh open. On the public AgentMesh the link is a node: it carries the
// local agents the person linked by email, registered there under their own
// keys, so agents on the public mesh reach them by name. The link holds those
// agents' keys (they are the person's, on the person's computer), which is
// what lets it sign their registrations and its node credential, as the
// public mesh's doors require of any node.
//
// What it carries, and nothing else:
//   down  a message for a linked agent that reaches the public mesh is
//         published on the local mesh at that agent's inbox subject; while
//         the link was down such messages waited in the agent's mailbox
//         there, and are carried when it returns
//   up    a message a linked agent sends to an agent the local mesh does not
//         hold is published on the public mesh at that agent's inbox subject
// Answers on a transport reply subject come back the same way. Each crossing
// adds one to the hop count in the Mesh-Hops header, and a message over three
// is dropped. Envelopes are carried unchanged and verified by whoever reads
// them, on their own signatures.
//
// Its settings come in LINK_CONFIG (JSON: api, mesh, agents [{ name, id,
// identity }]); the local mesh's server credential is /config/creds/core.creds;
// the node's own key is kept in /data/node.json. Nothing here is secret in
// the configuration: the keys are read from the agents' own volumes.
//
//   needs: node >= 22, and in its image the agent-messaging SDK
import { existsSync, readFileSync, writeFileSync } from "node:fs";

/** The header that carries the hop count (Agent Messaging §18.8). */
export const HOP_HEADER = "Mesh-Hops";
export const MAX_HOPS = 3;

/** The hop count a carried message leaves with, or null when it is over the
 *  bound and must be dropped. Absent or unreadable counts as 0. */
export function nextHops(value) {
  const n = /^\d+$/.test(String(value ?? "").trim()) ? Number(value) : 0;
  const next = n + 1;
  return next > MAX_HOPS ? null : next;
}

/** The JWT and seed in a NATS credentials file. */
export function credsOf(text) {
  const block = (label) => {
    const m = new RegExp(`-----BEGIN ${label}-----\\s*(\\S+?)\\s*------END ${label}------`).exec(String(text));
    return m ? m[1].trim() : null;
  };
  const jwt = block("NATS USER JWT");
  const seed = block("USER NKEY SEED");
  return jwt && seed ? { jwt, seed } : null;
}

const INBOX = /^mesh\.agent\.(U[A-Z2-7]{55})\.inbox$/;
/** The agent an inbox subject is for, or null. */
export const inboxAgentOf = (subject) => INBOX.exec(String(subject))?.[1] ?? null;

/**
 * Whether a message seen on the local mesh goes up the link: it is addressed
 * to an agent the local mesh does not hold, and sent by a linked agent (an
 * answer can come back only to an agent the public mesh knows through this
 * link). `held` is null when the local registry could not say, and then the
 * message stays here: a message is never sent out on a guess.
 */
export function goesUp({ to, from, linked, held }) {
  if (!to || linked.has(to)) return false;
  if (held !== false) return false;
  return linked.has(from);
}

/** Where the link may connect on the public mesh, in the order to try, from
 *  what its bootstrap answered: each TLS WebSocket endpoint; then, for a
 *  plain WebSocket endpoint, the same host over TLS on the standard port
 *  (where a public mesh's web front serves it); then the plain one. */
export function meshUrlsOf(mesh) {
  const all = (Array.isArray(mesh?.endpoints) ? mesh.endpoints : Array.isArray(mesh?.endpoints?.nats) ? mesh.endpoints.nats : []).map(String);
  const tls = all.filter((u) => /^wss:\/\//.test(u));
  const plain = all.filter((u) => /^ws:\/\//.test(u));
  const fronted = plain.map((u) => { try { return `wss://${new URL(u).hostname}`; } catch { return null; } }).filter(Boolean);
  return [...new Set([...tls, ...fronted, ...plain])];
}
/** The first place to try, or null. */
export const meshUrlOf = (mesh) => meshUrlsOf(mesh)[0] ?? null;

const log = (line) => console.log(`[link] ${line}`);

async function main() {
  const sdk = await import("agent-messaging");
  const { connect, jwtAuthenticator, headers, createInbox } = await import("nats.ws");
  const cfg = JSON.parse(process.env.LINK_CONFIG ?? "{}");
  const local = credsOf(readFileSync("/config/creds/core.creds", "utf8"));
  if (!local) throw new Error("the local mesh's server credential could not be read");

  // The node's own key, made once and kept.
  const nodeFile = "/data/node.json";
  let nodeSeed;
  if (existsSync(nodeFile)) nodeSeed = JSON.parse(readFileSync(nodeFile, "utf8")).seed;
  else {
    const kp = sdk.nkeys.createUser();
    nodeSeed = new TextDecoder().decode(kp.getSeed());
    writeFileSync(nodeFile, JSON.stringify({ seed: nodeSeed, created_at: new Date().toISOString() }) + "\n", { mode: 0o600 });
  }
  const nodeKp = sdk.keyPairFromSeed(nodeSeed);

  // The linked agents, with their keys from their own volumes.
  const agents = [];
  for (const a of cfg.agents ?? []) {
    try {
      const id = JSON.parse(readFileSync(a.identity, "utf8"));
      if (id.public_key !== a.id) { log(`${a.name}: its volume holds another agent's key; not linked`); continue; }
      agents.push({ name: a.name, id: a.id, seed: id.seed, kp: sdk.keyPairFromSeed(id.seed) });
    } catch (e) { log(`${a.name}: its key could not be read (${e.message}); not linked`); }
  }
  if (!agents.length) throw new Error("no linked agent's key could be read");
  const linked = new Set(agents.map((a) => a.id));

  // The node credential on the public mesh, signed by the node and by each
  // agent, as its node-credential door requires.
  const cred = await sdk.renewNodeCredential(cfg.api, nodeSeed, agents.map((a) => ({ id: a.id, seed: a.seed })));
  let pub = null;
  let meshUrl = null;
  for (const url of [].concat(cfg.mesh)) {
    try {
      pub = await sdk.MeshNode.connect(url, {
        jwt: cred.jwt,
        nodeSeed,
        profile: { availability_class: "intermittent", reachability: "leaf" },
        credentialRenewal: { apiBase: cfg.api, onRenewed: () => log("the node credential was renewed") },
      });
      meshUrl = url;
      break;
    } catch (e) { log(`${url} did not take the connection (${e.message})`); }
  }
  if (!pub) throw new Error("the public mesh took the connection at none of its addresses");
  cfg.mesh = meshUrl;
  for (const a of agents) pub.addAgent({ nkeySeed: a.seed });
  const pubNc = pub.conn.raw;
  const localNc = await connect({ servers: cfg.local ?? "ws://host.docker.internal:4443", authenticator: jwtAuthenticator(local.jwt, new TextEncoder().encode(local.seed)), name: "link" });
  log(`connected: ${cfg.mesh} as node ${nodeKp.getPublicKey()}, and the local mesh`);

  /** Carry one message to the other mesh at the same subject, with its reply subject proxied back. */
  const carry = (msg, from, to, subject, way) => {
    const hops = nextHops(msg.headers?.get(HOP_HEADER));
    if (hops === null) { log(`${way}: dropped a message to ${subject}: its hop count is over ${MAX_HOPS}`); return; }
    const h = headers();
    h.set(HOP_HEADER, String(hops));
    log(`${way}: a message for ${(inboxAgentOf(subject) ?? subject).slice(0, 12)}…${msg.reply ? ", its answers to come back" : ""}`);
    if (msg.reply) {
      const back = createInbox();
      const sub = to.subscribe(back, { max: 8, timeout: 180_000 });
      (async () => { try { for await (const r of sub) from.publish(msg.reply, r.data); } catch { /* the window closed */ } })();
      to.publish(subject, msg.data, { headers: h, reply: back });
    } else {
      to.publish(subject, msg.data, { headers: h });
    }
  };

  // Each linked agent registered on the public mesh: its own signed manifest
  // from the local registry, with this node's vouch.
  const lookup = async (asAgent, target) => {
    const env = sdk.signEnvelope(sdk.createEnvelope({ type: "discover", from: asAgent.id, payload: { agent_id: target } }), asAgent.kp);
    const r = await localNc.request(sdk.Subjects.registryGet(target), sdk.encode(env), { timeout: 5000 });
    return sdk.decode(r.data);
  };
  const register = async (a) => {
    const got = await lookup(a, a.id);
    if (got.error || !got.payload?.id) throw new Error(`the local registry has no record of it (${got.error?.code ?? "none"})`);
    // The owner is the public mesh's to say (the account the button enrolled
    // the agent into), so the local mesh's owner and its attestation stay here.
    const { owner: _owner, owner_attestation: _ownerAtt, ...own } = got.payload;
    const manifest = { ...own, node: { id: nodeKp.getPublicKey(), attestation: sdk.createAttestation(nodeKp, a.id) } };
    const env = sdk.signEnvelope(sdk.createEnvelope({ type: "register", from: a.id, payload: manifest }), a.kp);
    const r = sdk.decode((await pubNc.request(sdk.Subjects.REGISTRY_REGISTER, sdk.encode(env), { timeout: 8000 })).data);
    if (r.error) throw new Error(`${r.error.code}: ${r.error.message}`);
  };
  const registerAll = async () => {
    let n = 0;
    for (const a of agents) {
      try { await register(a); n++; log(`${a.name} is registered on ${cfg.mesh}`); } catch (e) { log(`${a.name} could not be registered there: ${e.message}`); }
    }
    return n;
  };

  // Down: the linked agents' inboxes on the public mesh.
  for (const a of agents) {
    const subject = sdk.Subjects.agentInbox(a.id);
    pubNc.subscribe(subject, { callback: (err, msg) => { if (!err) carry(msg, pubNc, localNc, subject, "down"); } });
  }

  // Down, what waited: each linked agent's mailbox on the public mesh.
  const drain = async (a) => {
    const stream = `MESH_INBOX_${a.id}`;
    const durable = `inbox_${a.id}`;
    const jsm = await pubNc.jetstreamManager({ checkAPI: false });
    let bound;
    try { bound = (await jsm.streams.info(stream)).state.last_seq; } catch { return 0; }
    let info;
    try { info = await jsm.consumers.info(stream, durable); } catch {
      info = await jsm.consumers.add(stream, { durable_name: durable, ack_policy: "explicit", deliver_policy: "all", ack_wait: 30_000_000_000, max_deliver: 5 });
    }
    let remaining = info.num_pending + info.num_ack_pending;
    if (!bound || !remaining) return 0;
    const consumer = await pubNc.jetstream().consumers.get(stream, durable);
    let carried = 0;
    while (remaining > 0) {
      const batch = await consumer.fetch({ max_messages: Math.min(remaining, 50), expires: 3000 });
      let got = 0;
      for await (const m of batch) {
        got++;
        if (m.seq > bound) return carried;
        localNc.publish(sdk.Subjects.agentInbox(a.id), m.data, { headers: (() => { const h = headers(); h.set(HOP_HEADER, "1"); return h; })() });
        m.ack();
        carried++;
      }
      if (!got) break;
      remaining -= got;
    }
    return carried;
  };
  const drainAll = async () => {
    for (const a of agents) {
      try { const n = await drain(a); if (n) log(`${a.name}: carried ${n} message(s) that waited while the link was down`); } catch (e) { log(`${a.name}: its mailbox could not be read (${e.message})`); }
    }
  };

  // Up: what the local mesh's agents send to agents it does not hold.
  const heldCache = new Map();
  let registryKv = null;
  const heldHere = async (target) => {
    const c = heldCache.get(target);
    if (c && c.until > Date.now()) return c.held;
    // Read from the registry's own store, not asked of the registry service:
    // the service answers "not found" for a private agent to anyone but its
    // owner, and that answer would send a local message out.
    let held = null;
    try {
      registryKv ??= await localNc.jetstream().views.kv("mesh_registry", { bindOnly: true });
      const e = await registryKv.get(target);
      held = !!e && e.operation === "PUT" && e.value?.length > 0;
    } catch (e) { log(`the local registry could not be read: ${e.message}`); held = null; }
    if (held !== null) heldCache.set(target, { held, until: Date.now() + (held ? 300_000 : 30_000) });
    return held;
  };
  localNc.subscribe("mesh.agent.*.inbox", {
    callback: (err, msg) => {
      if (err) return;
      const to = inboxAgentOf(msg.subject);
      if (!to || linked.has(to)) return;
      let from = null;
      try { from = sdk.decode(msg.data).from; } catch { return; }
      if (!linked.has(from)) return;
      void heldHere(to).then((held) => {
        if (goesUp({ to, from, linked, held })) carry(msg, localNc, pubNc, msg.subject, "up");
        else if (held === null) log(`up: held back a message for ${to.slice(0, 12)}…: the local registry could not say whether it holds that agent`);
      });
    },
  });

  if (!(await registerAll())) throw new Error("no linked agent could be registered on the public mesh");
  await drainAll();
  log(`linked: ${agents.map((a) => a.name).join(", ")}`);
  // Keep the registrations fresh, and carry what waited after a reconnect.
  setInterval(() => { void registerAll(); }, 6 * 3_600_000).unref?.();
  (async () => { for await (const s of pubNc.status()) if (s.type === "reconnect") { log("reconnected to the public mesh"); await registerAll(); await drainAll(); } })();
  await Promise.race([pubNc.closed(), localNc.closed()]);
  throw new Error("a connection closed");
}

if (process.argv[1] && process.argv[1].endsWith("link.mjs") && process.env.LINK_CONFIG) {
  main().catch((e) => { console.error(`[link] stopped: ${e.message}`); process.exit(1); });
}
