// The fleet host's half of a rename (docs/agent-sdlc-revision-plan.md, A3).
//
// A rename happens at the naming service: the rename batch (services
// agent-moves.ts) binds a new handle to an agent's key, and the naming
// service then answers the new handle for that key. Nothing on this host
// learns of it by itself, and four things here carry the old handle:
//
//   * a deployed agent's inventory row (deploymgr-agents.json `handle`, which
//     the supervisor hands the agent as its own name) and its descriptor on
//     file (subject.handle and the samples address). `deploymgr-steps.py
//     rebind <name>` follows the naming service for both, from the agent's own
//     package, and `runtime <name>` publishes the runtime record again;
//   * an ops agent's descriptor (agentbuilder, deploymgr and agentevaluator
//     live in a node folder with no inventory row): subject.handle is
//     rewritten and the descriptor is signed again with the agent's own key;
//   * the supervisor roster, which the supervisor regenerates itself when the
//     inventory changes (roster.mjs --check says whether it did);
//   * each node's registration, which carries the name the node read when it
//     started: the node serving a changed agent is restarted (pm2 restart,
//     never --update-env), and it registers under the new name and files the
//     new descriptor.
//
// On 2026-09-26 this was a script in a session's scratchpad (after-moves.sh).
// It lives here now, and it follows the naming service instead of a list, so
// it is the same step for any rename and safe to run twice: an agent whose
// files already say what the naming service answers is left alone.
//
// It changes nothing unless told to. Without --apply it prints what it would
// do. With --apply it does it, keeping a .bak-<stamp> beside every file it
// rewrites itself. It never releases a name and never touches the registrar:
// releasing the old name is a separate, later step at the services.
//
//   sudo node /opt/fleet/follow-names.mjs [--apply] [--only <name>,<name>]
import { existsSync, readFileSync, readdirSync, writeFileSync, copyFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

export const FLEET = "/opt/fleet";
export const INVENTORY = `${FLEET}/deploymgr-agents.json`;
export const STEPS = `${FLEET}/deploymgr-steps.py`;
export const DESCRIPTOR_TAG = "descriptor-statement-v1";

/** The pm2 process that serves a node root, by the fleet's naming rule
 *  (/opt/fleet/node -> mesh-node, /opt/fleet/node-ops -> mesh-node-ops). An
 *  inventory row that names its process wins over the rule. */
export function nodeProcOf(root, row = null) {
  if (row?.node_proc) return row.node_proc;
  const base = root.replace(/\/+$/, "").split("/").pop() ?? "";
  return base === "node" ? "mesh-node" : `mesh-${base}`;
}

/**
 * What following the naming service means for each agent, from facts alone.
 *
 * `agents`: one entry per agent folder on a node, { name, root, key,
 * descriptor_handle } (descriptor_handle null when it has no descriptor).
 * `rows`: the inventory rows { name, agent_key, handle, node_proc? }.
 * `named`: key -> the handle the naming service answers now, or null when it
 * answered nothing, or undefined when it could not be asked.
 *
 * An agent the naming service could not be asked about, or answers nothing
 * for, is left alone: no answer is never a reason to change a name.
 */
export function planFollow(agents, rows, named) {
  const out = [];
  const byName = new Map(rows.map((r) => [r.name, r]));
  for (const a of agents) {
    const now = named.get(a.key);
    if (typeof now !== "string" || !now) continue;
    const row = byName.get(a.name) ?? null;
    if (row && row.agent_key && row.agent_key !== a.key) continue; // a leftover folder, not the installed agent
    const acts = [];
    if (row) {
      if ((row.handle ?? "") !== now) acts.push({ act: "rebind", from: row.handle ?? null, to: now });
    } else if (a.descriptor_handle !== null && a.descriptor_handle !== now) {
      acts.push({ act: "resign-descriptor", from: a.descriptor_handle, to: now });
    }
    if (acts.length) out.push({ name: a.name, key: a.key, root: a.root, node_proc: nodeProcOf(a.root, row), acts });
  }
  return out;
}

/** The nodes to restart after a plan: one each, in the order first met. */
export function nodesToRestart(plan) {
  return [...new Set(plan.map((p) => p.node_proc))];
}

/**
 * A descriptor given a new subject handle and signed again by its subject.
 * `sign(message)` signs with the agent's own key and returns base64, and
 * `canonicalize` is the SDK's canonicalJSON, which the signature is defined
 * over; both are passed in so this stays pure. Refuses a descriptor whose
 * subject is not the signer.
 */
export function resignWithHandle(doc, handle, key, sign, canonicalize) {
  if (!doc || typeof doc !== "object") throw new Error("the descriptor is not a JSON object");
  if (doc.subject?.id && doc.subject.id !== key) throw new Error(`the descriptor's subject ${String(doc.subject.id).slice(0, 12)}... is not this agent's key`);
  const body = { ...doc, subject: { ...(doc.subject ?? {}), id: key, handle } };
  delete body.signatures;
  const message = `${DESCRIPTOR_TAG}\n${canonicalize(body)}`;
  return { ...body, signatures: [{ tag: DESCRIPTOR_TAG, by: key, sig: sign(message), alg: "ed25519" }] };
}

// ── the host ────────────────────────────────────────────────────────────────

function readJson(path, fallback = null) {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return fallback; }
}

function nodeRoots() {
  return readdirSync(FLEET).filter((d) => /^node(-[a-z0-9-]+)?$/.test(d)).map((d) => join(FLEET, d)).filter((d) => existsSync(join(d, "agents")));
}

function agentsOnHost() {
  const out = [];
  for (const root of nodeRoots()) {
    for (const name of readdirSync(join(root, "agents"))) {
      const dir = join(root, "agents", name);
      const ident = readJson(join(dir, "identity.json"));
      if (!ident?.public_key) continue;
      const desc = readJson(join(dir, "descriptor.json"));
      out.push({ name, root, key: ident.public_key, descriptor_handle: desc ? (desc.subject?.handle ?? "") : null });
    }
  }
  return out;
}

function inventoryRows() {
  const d = readJson(INVENTORY, []);
  const rows = Array.isArray(d) ? d : (d.agents ?? []);
  return rows.filter((r) => r && typeof r.name === "string");
}

function namingUrl() {
  if (process.env.DM_NAMING_URL) return process.env.DM_NAMING_URL.replace(/\/+$/, "");
  const here = dirname(fileURLToPath(import.meta.url));
  const dirs = [process.env.AGENTMESH_ENV_DIR, join(here, "../../../env"), join(here, "env"), "/opt/fleet/env"].filter(Boolean);
  const dir = dirs.find((d) => existsSync(join(d, "load.cjs")));
  if (!dir) throw new Error(`the environment loader (env/load.cjs) was not found; looked in ${dirs.join(", ")}`);
  return String(createRequire(import.meta.url)(join(dir, "load.cjs")).get("urls.naming")).replace(/\/+$/, "");
}

async function reverseHandle(base, key) {
  try {
    const r = await fetch(`${base}/api/resolve?agent_id=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(10_000) });
    if (r.status === 404) return null;
    if (!r.ok) return undefined;
    const doc = await r.json();
    const h = doc?.card?.handle ?? doc?.handle;
    return typeof h === "string" && h.includes("@") ? h.trim() : null;
  } catch {
    return undefined;
  }
}

function stamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: "utf8", timeout: 180_000 });
  return { ok: r.status === 0, out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() };
}

async function main() {
  const argv = process.argv.slice(2);
  const apply = argv.includes("--apply");
  const onlyAt = argv.indexOf("--only");
  const only = onlyAt >= 0 ? new Set(String(argv[onlyAt + 1] ?? "").split(",").map((s) => s.trim()).filter(Boolean)) : null;
  const base = namingUrl();
  const agents = agentsOnHost().filter((a) => !only || only.has(a.name));
  const rows = inventoryRows();
  const named = new Map();
  for (const a of agents) named.set(a.key, await reverseHandle(base, a.key));
  const plan = planFollow(agents, rows, named);
  const unasked = agents.filter((a) => named.get(a.key) === undefined).map((a) => a.name);
  console.log(`naming service ${base}; ${agents.length} agents on this host; ${plan.length} to follow${unasked.length ? `; could not ask about ${unasked.join(", ")}` : ""}`);
  for (const p of plan) for (const a of p.acts) console.log(`  ${p.name} (${p.node_proc}): ${a.act} ${a.from ?? "no handle"} -> ${a.to}`);
  if (!apply) {
    if (plan.length) console.log(`nothing changed (dry run); then restart ${nodesToRestart(plan).join(", ")}. Run again with --apply.`);
    return;
  }
  let failed = 0;
  for (const p of plan) {
    for (const a of p.acts) {
      if (a.act === "rebind") {
        const r1 = run("python3", [STEPS, "rebind", p.name]);
        const r2 = r1.ok ? run("python3", [STEPS, "runtime", p.name]) : { ok: false, out: "not run" };
        console.log(`  ${p.name}: rebind ${r1.ok ? "ok" : "FAILED"}; runtime ${r2.ok ? "ok" : "FAILED"}`);
        if (!r1.ok || !r2.ok) { failed++; console.log(`    ${(r1.ok ? r2.out : r1.out).split("\n").pop()}`); }
      } else {
        const dir = join(p.root, "agents", p.name);
        const ident = readJson(join(dir, "identity.json"));
        const { nkeys, canonicalJSON } = await import("agent-messaging").catch(() => import("agentmesh"));
        const kp = nkeys.fromSeed(new TextEncoder().encode(ident.seed));
        const sign = (m) => Buffer.from(kp.sign(new TextEncoder().encode(m))).toString("base64");
        const doc = resignWithHandle(readJson(join(dir, "descriptor.json")), a.to, ident.public_key, sign, canonicalJSON);
        const check = { ...doc };
        delete check.signatures;
        const ok = nkeys.fromPublic(ident.public_key).verify(new TextEncoder().encode(`${DESCRIPTOR_TAG}\n${canonicalJSON(check)}`), new Uint8Array(Buffer.from(doc.signatures[0].sig, "base64")));
        if (!ok) { failed++; console.log(`  ${p.name}: the new signature does not verify; nothing written`); continue; }
        copyFileSync(join(dir, "descriptor.json"), join(dir, `descriptor.json.bak-${stamp()}`));
        writeFileSync(join(dir, "descriptor.json"), `${JSON.stringify(doc, null, 2)}\n`);
        run("chown", ["--reference", join(dir, "identity.json"), join(dir, "descriptor.json")]);
        console.log(`  ${p.name}: descriptor names ${a.to}, signed again`);
      }
    }
  }
  for (const proc of nodesToRestart(plan)) {
    const r = run("pm2", ["restart", proc]);
    console.log(`  restart ${proc}: ${r.ok ? "ok" : "FAILED"}`);
    if (!r.ok) failed++;
  }
  if (plan.some((p) => p.acts.some((a) => a.act === "rebind")) && existsSync(`${FLEET}/roster.mjs`)) {
    const r = run("node", [`${FLEET}/roster.mjs`, "--check"]);
    console.log(`  supervisor roster: ${r.ok ? "matches this host" : "differs from this host; regenerate it with node /opt/fleet/roster.mjs"}`);
  }
  if (failed) { console.log(`${failed} step(s) failed; read the lines above`); process.exitCode = 1; }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => { console.error(`follow-names: ${err.message}`); process.exit(1); });
}
