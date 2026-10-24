#!/usr/bin/env node
// agentevaluator's trial check (Common Agent 7.7, "Conformance"), run live
// against installed agents through the front door, the way any caller asks
// for a trial: the trial door of the mesh API (docs/trials-plan.md,
// POST /v1/trials/<handle>/<offering>), which sends the request on to the
// agent with `trial: true`.
//
// For each agent it reads the published Descriptor, makes the three trial
// cases for every offering that declares a trial (trial-cases.mjs), sends
// them in order (input, budget, then the requester's day), and judges the
// answers. It spends the publisher's trial money only as the cases require:
// the input and budget cases are owed a refusal, and the day case sends no
// more than per_requester_per_day + 1 requests less any trial the first two
// cases had wrongly admitted, so at most per_requester_per_day + 1 trials of
// an offering are ever admitted for one run.
//
// Usage (one JSON object on stdout; exit 0 only when every case passed):
//   AGENTMESH_TOKEN_FILE=<file holding an amt_ token> \
//   node trial-check.mjs [--record] <handle> [<handle> ...]
// --record prints, for one handle, `{ cases }` in the evaluation record's
// shape (agent-eval-record-v1 cases[], kind trial), which is what eval-run.py
// and role-check.mjs fold into the record they sign. With no token every
// case is inconclusive and nothing is sent. The token is read from the file
// and never printed.
//
// Settings: AGENTMESH_API (default the environment's urls.api, env/prod.json),
// AGENTMESH_NAMING (default its urls.naming).
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
// On the fleet host the files sit flat in /opt/fleet with an agenteval- prefix.
const CASES = [join(HERE, "agenteval-trial-cases.mjs"), join(HERE, "trial-cases.mjs")].find((p) => existsSync(p));
const { descriptorTrialCases, judgeTrialCase, requesterDayRequests, readAnswer, TRIAL_CASE_WINDOW_MS } = await import(pathToFileURL(CASES).href);

/**
 * Send every trial case of a Descriptor and judge it. `send(offeringId,
 * request)` makes one trial request and answers `{ status, body, ms }`, or
 * null when nothing came back. Cases run in order, and the day case is sized
 * by what the earlier cases had admitted. Returns eval-record cases.
 */
export async function runTrialCases(descriptor, send, { now = () => new Date(), windowMs = TRIAL_CASE_WINDOW_MS } = {}) {
  const out = [];
  const admittedBy = new Map();
  for (const c of descriptorTrialCases(descriptor)) {
    if (c.cannot) { out.push(judgeTrialCase(c, [], { now: now(), windowMs })); continue; }
    const answers = [];
    const times = c.case === "requester_day" ? requesterDayRequests(c.per_day, admittedBy.get(c.offering) ?? 0) : 1;
    for (let i = 0; i < times; i++) {
      const a = await send(c.offering, c.request).catch((e) => ({ status: null, body: { message: String(e?.message ?? e) }, ms: null }));
      answers.push(a);
      const r = readAnswer(a);
      if (r.what === "admitted") admittedBy.set(c.offering, (admittedBy.get(c.offering) ?? 0) + 1);
      // The day case stops at its first refusal or anything that is neither;
      // a further request could only spend more.
      if (r.what !== "admitted") break;
    }
    out.push(judgeTrialCase(c, answers, { now: now(), windowMs }));
  }
  return out;
}

/** Every case of a Descriptor, inconclusive and unsent, with the reason. */
export function unsentCases(descriptor, why) {
  return descriptorTrialCases(descriptor).map((c) => ({ id: c.id, kind: "trial", source: c.source, verdict: "inconclusive", observed: why }));
}

// ── the live run ────────────────────────────────────────────────────────────

let amEnvLib;
function amEnv(key) {
  if (!amEnvLib) {
    const dirs = [process.env.AGENTMESH_ENV_DIR, join(HERE, "../../env"), join(HERE, "env"), "/opt/fleet/env", "/opt/agentmesh/env"].filter(Boolean);
    for (let d = process.cwd(); ; d = dirname(d)) { dirs.push(join(d, "env")); if (dirname(d) === d) break; }
    const dir = dirs.find((d) => existsSync(join(d, "load.cjs")));
    if (!dir) throw new Error(`the AgentMesh environment loader (env/load.cjs) was not found; looked in ${dirs.join(", ")}`);
    amEnvLib = createRequire(import.meta.url)(join(dir, "load.cjs"));
  }
  return amEnvLib.get(key);
}

function tokenOrNull() {
  const f = process.env.AGENTMESH_TOKEN_FILE;
  if (!f || !existsSync(f)) return null;
  const t = readFileSync(f, "utf8").trim();
  return t.startsWith("amt_") ? t : null;
}

async function resolveKey(naming, handle) {
  const r = await fetch(`${naming}/api/resolve?handle=${encodeURIComponent(handle)}`, { signal: AbortSignal.timeout(10_000) });
  if (!r.ok) return null;
  const card = (await r.json())?.card;
  return (card?.endpoints ?? []).find((e) => e.protocol === "agentmesh")?.agent_id ?? null;
}

async function descriptorOf(api, key) {
  const r = await fetch(`${api}/v1/agents/${encodeURIComponent(key)}/descriptor`, { signal: AbortSignal.timeout(10_000) });
  return r.ok ? r.json() : null;
}

/** The trial door, as a `send` for runTrialCases. */
export function trialDoor(api, bearer, handle, windowMs = TRIAL_CASE_WINDOW_MS) {
  return async (offering, request) => {
    const t0 = Date.now();
    const r = await fetch(`${api}/v1/trials/${encodeURIComponent(handle)}/${encodeURIComponent(offering)}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${bearer}` },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(windowMs),
    }).catch(() => null);
    if (!r) return null;
    const raw = await r.text();
    let body = {};
    try { body = JSON.parse(raw); } catch { body = { message: raw.slice(0, 160) }; } // cut-ok: a note on an answer that is not JSON
    return { status: r.status, body, ms: Date.now() - t0 };
  };
}

/** Where the live run goes and who it asks as, from the environment. */
export function liveSettings() {
  return {
    api: (process.env.AGENTMESH_API ?? amEnv("urls.api")).replace(/\/$/, ""),
    naming: (process.env.AGENTMESH_NAMING ?? amEnv("urls.naming")).replace(/\/$/, ""),
    bearer: tokenOrNull(),
  };
}

export async function checkAgent(handle, { api, naming, bearer }) {
  const key = await resolveKey(naming, handle);
  if (!key) return { handle, verdict: "inconclusive", why: "the name did not resolve", cases: [] };
  const descriptor = await descriptorOf(api, key);
  if (!descriptor) return { handle, key, verdict: "inconclusive", why: "no published descriptor", cases: [] };
  if (!descriptorTrialCases(descriptor).length) return { handle, key, verdict: "not applicable", why: "no offering declares a trial", cases: [] };
  const cases = bearer
    ? await runTrialCases(descriptor, trialDoor(api, bearer, handle))
    : unsentCases(descriptor, "not sent: no front-door token (AGENTMESH_TOKEN_FILE) to ask for a trial with");
  const v = cases.some((c) => c.verdict === "fail") ? "does not conform" : cases.every((c) => c.verdict === "pass") ? "conforms" : "inconclusive";
  return { handle, key, verdict: v, cases };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const record = args[0] === "--record";
  const handles = record ? args.slice(1) : args;
  if (!handles.length || (record && handles.length !== 1)) {
    console.error("usage: node trial-check.mjs [--record] <handle> [<handle> ...]   (--record takes one handle)");
    process.exit(2);
  }
  const { api, naming, bearer } = liveSettings();
  const agents = [];
  for (const h of handles) {
    agents.push(await checkAgent(h, { api, naming, bearer }).catch((err) => ({ handle: h, verdict: "inconclusive", why: String(err?.message ?? err), cases: [] })));
  }
  if (record) {
    // Only the cases: the record that carries them is signed by its caller.
    // An agent that could not be read at all yields one inconclusive case, so
    // a record never reads "no trial" where nobody looked.
    const a = agents[0];
    const cases = a.cases.length || a.verdict === "not applicable" ? a.cases
      : [{ id: "trial", kind: "trial", source: "Common Agent 7.7, Conformance", verdict: "inconclusive", observed: a.why }];
    console.log(JSON.stringify({ cases }));
    process.exit(0);
  }
  console.log(JSON.stringify({ at: new Date().toISOString(), window_ms: TRIAL_CASE_WINDOW_MS, agents }, null, 2));
  process.exit(agents.some((a) => a.verdict === "does not conform" || a.verdict === "inconclusive") ? 1 : 0);
}
