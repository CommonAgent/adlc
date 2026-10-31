#!/usr/bin/env node
// The deployment manager's container path (docs/container-agents-plan.md,
// item 6). Installed on the fleet host as /opt/fleet/deploymgr-service.mjs.
//
// A container agent is not a package. Its code lives in its own repository
// folder with its own Dockerfile, in any language, and it holds its own key
// and its own connection to the mesh. So its install is not the host install
// or the per-message job the rest of the deployment manager does. It is:
//
//   1. build the image IN THE CLOUD, in Cloud Build, from the folder's own
//      Dockerfile at the pinned commit, with Cloud Build's provenance
//      requested, and record the build id, the image digest and the commit;
//   2. give the agent a service account of its own;
//   3. make the agent's key (a new install only): the seed is generated here,
//      in memory, the single-use agent key the approval minted is traded for
//      the connection credential, and the bundle goes straight into a Secret
//      Manager secret on stdin. Nothing is written to this host's disk;
//   4. let only that account read that secret, at the secret;
//   5. run it as a Cloud Run service that wakes on message, the credential
//      mounted from the secret: the folder's image with the wake host on top
//      (image/wake-host.mjs), min 0, max 1, CPU billed only while the
//      platform's waker holds a wake open, and callable by that waker alone.
//      An agent the owner keeps always on (always_on) runs as before: min 1,
//      CPU always allocated, internal ingress;
//   6. have the platform bind its verified name (the registry refuses an
//      agent with no name, so this comes before the service starts), then wait
//      for the service to answer;
//   7. sign a build record and a deployment record with the deployment
//      manager's own identity.
//
// A new commit of an installed agent is an update: steps 1, 5, 6 and 7 with
// the same account, secret and key. Retire removes the service, every image
// built for it, the secret and the account, then retires the key through the
// platform the way a planned retirement is done.
//
// Usage (one JSON object on stdout, always; exit 0 only when ok):
//   node deploymgr-service.mjs install <argfile>
//   node deploymgr-service.mjs retire <name> [reason words]
//   node deploymgr-service.mjs retire-key <agent key> [reason words]
//   node deploymgr-service.mjs sleep <name> [--idle seconds] [--ready "line"]
//   node deploymgr-service.mjs keep-on <name> [reason words]
//   node deploymgr-service.mjs tell-wake <name>
//   node deploymgr-service.mjs status
//
// The argfile is written by the deploy executor from an approved container
// deploy request, under the deployment manager's own tmp.
//
// No dependency outside node. The key is made with the mesh adapter's own
// bundled nkeys.js, the same library every agent on this host signs with.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";
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

// ── what this host is ─────────────────────────────────────────────────────

export const SETTINGS = {
  fleet: process.env.DM_FLEET || "/opt/fleet",
  home: process.env.DM_HOME || "/home/deploymgr",
  gcloud: process.env.DM_GCLOUD || "gcloud",
  control: (process.env.DM_CONTROL_URL || `${amEnv("urls.app")}/v1`).replace(/\/+$/, ""),
  controlTokenFile: process.env.DM_CONTROL_TOKEN_FILE || "/opt/fleet/secrets/deploy-executor.token",
  meshApi: (process.env.DM_MESH_API || amEnv("urls.api")).replace(/\/+$/, ""),
  adapterModules: process.env.DM_ADAPTER_MODULES || "/usr/lib/node_modules/mesh-adapter/node_modules/",
  buildMinutes: Number(process.env.DM_BUILD_MINUTES || 40),
  readyMinutes: Number(process.env.DM_READY_MINUTES || 8),
  // Where the tenant image's files are kept (TENANT_IMAGE_FILES): a person's package
  // is built from them, and from nothing else on this host.
  tenantImageDir: process.env.DM_TENANT_IMAGE_DIR || "/opt/fleet/tenant-image",
  // The wake host a container agent sleeps behind (image/wake-host.mjs).
  wakeHostFile: process.env.DM_WAKE_HOST_FILE || "/opt/fleet/wake-host.mjs",
  tenant: tenantSettings({ ...tenantFile(`${process.env.DM_FLEET || "/opt/fleet"}/deploymgr-tenant.json`), ...process.env }),
  platform: platformSettings({ ...platformFile(`${process.env.DM_FLEET || "/opt/fleet"}/deploymgr-platform.json`), ...process.env }),
};

/** The host's platform settings file, read by exact name. */
function platformFile(f) {
  try {
    const doc = JSON.parse(readFileSync(f, "utf8"));
    const out = {};
    for (const k of ["DM_PLATFORM_WAKER", "DM_PLATFORM_WAKER_ROLE", "DM_PLATFORM_PROJECT", "DM_PLATFORM_REGION", "DM_PLATFORM_REGISTRY"]) if (typeof doc[k] === "string") out[k] = doc[k];
    return out;
  } catch { return {}; }
}

/** Who wakes a container agent in the platform's own project (the platform
 *  waker, docs/container-agents-plan.md "Wake on message"), and the role it is
 *  given on each agent's service: run.routes.invoke and nothing else. */
export function platformSettings(e) {
  return {
    waker: e.DM_PLATFORM_WAKER || "",
    waker_role: e.DM_PLATFORM_WAKER_ROLE || "",
    // Where the platform's own container agents run (owner, 2026-10-05): a
    // project that holds nothing but them, so the fleet's account may make,
    // act as and remove service accounts and secrets there without reaching
    // any other account or secret. Unset, they go where the host's placement
    // says, as before. A package's job is not a container agent and keeps the
    // host's placement either way.
    project: e.DM_PLATFORM_PROJECT || "",
    region: e.DM_PLATFORM_REGION || "",
    registry: e.DM_PLATFORM_REGISTRY || "",
    // The account the platform's own container images are built as. Unset,
    // Cloud Build uses the project's default build account, and submitting
    // as that account means this host may act as it; named, the host acts as
    // an account that may only write images and logs (the tenant builds have
    // tenant-builder for the same reason).
    builder: e.DM_PLATFORM_BUILDER || "",
  };
}

/** The host's tenant settings file: the same exact names as the
 *  environment, which wins where both say something. A file keeps a change
 *  from needing the executor's environment rebuilt. */
function tenantFile(f) {
  try {
    const doc = JSON.parse(readFileSync(f, "utf8"));
    // DM_TENANT_EGRESS is the one setting written as an object in the file,
    // because it is a description rather than a value; it is read as its JSON.
    return Object.fromEntries(Object.entries(doc)
      .map(([k, v]) => [k, k === "DM_TENANT_EGRESS" && v && typeof v === "object" ? JSON.stringify(v) : v])
      .filter(([k, v]) => /^DM_TENANT_[A-Z_]+$/.test(k) && typeof v === "string"));
  } catch { return {}; }
}

/** Where tenant workloads run (docs/tenant-isolation-plan.md), read by exact
 *  name. A user's agent never runs in the platform's project: with no tenant
 *  project named here, a tenant install is refused. Each setting is read on
 *  its own; nothing is picked up by prefix. */
export function tenantSettings(e) {
  const num = (v, d) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };
  return {
    project: e.DM_TENANT_PROJECT || "",
    region: e.DM_TENANT_REGION || "us-east1",
    network: e.DM_TENANT_NETWORK || "tenant-vpc",
    subnet: e.DM_TENANT_SUBNET || "tenant-us-east1",
    registry: e.DM_TENANT_REGISTRY || "",
    deployer: e.DM_TENANT_DEPLOYER || "",
    builder: e.DM_TENANT_BUILDER || "",
    // The one account that may wake a person's agent (the platform's waker,
    // docs/tenant-isolation-plan.md "Wake on message"), and the agent's two
    // windows: how long it stays up after the last thing happened, and the
    // most one wake may last.
    waker: e.DM_TENANT_WAKER || "",
    // The tenant build pool, which has no internet (technical debt 72): every
    // tenant build runs there when it is named, from source this host
    // uploads, and a package's npm dependencies come from the tenant npm
    // mirror. Empty keeps Cloud Build's shared pool.
    worker_pool: e.DM_TENANT_WORKER_POOL || "",
    npm_registry: e.DM_TENANT_NPM_REGISTRY || "",
    // What the tenant network lets a tenant agent reach, as the deployment
    // record's `egress` states it (Common Agent 8.3). See tenantEgress.
    egress: tenantEgress(e.DM_TENANT_EGRESS),
    wake_idle_seconds: num(e.DM_TENANT_WAKE_IDLE_SECONDS, 120),
    wake_max_seconds: num(e.DM_TENANT_WAKE_MAX_SECONDS, 3300),
    limits: {
      services: num(e.DM_TENANT_MAX_SERVICES, 2),
      cpu: num(e.DM_TENANT_MAX_CPU, 2),
      memory_mib: num(e.DM_TENANT_MAX_MEMORY_MIB, 2048),
      instance_hours: num(e.DM_TENANT_MAX_INSTANCE_HOURS, 48),
    },
  };
}

const POOL_RE = /^projects\/([a-z][a-z0-9-]{4,28}[a-z0-9])\/locations\/([a-z]+-[a-z]+[0-9])\/workerPools\/[a-z][a-z0-9-]{0,62}$/;
const NPM_MIRROR_RE = /^https:\/\/[a-z]+-[a-z]+[0-9]-npm\.pkg\.dev\/[a-z][a-z0-9-]{4,28}[a-z0-9]\/[a-z][a-z0-9-]{0,62}\/$/;

/** The tenant build pool's settings, refused in words when they cannot
 *  work: the pool lives in the tenant project and region (a build runs where
 *  its pool is), and a pool with no internet installs npm dependencies from
 *  the tenant mirror, so it needs one. Nothing named is fine. */
export function tenantPoolProblem(t) {
  if (!t.worker_pool) return;
  const m = POOL_RE.exec(t.worker_pool);
  if (!m) stop("validate", "DM_TENANT_WORKER_POOL must be projects/<project>/locations/<region>/workerPools/<name>");
  if (m[1] !== t.project || m[2] !== t.region) stop("validate", `DM_TENANT_WORKER_POOL is in ${m[1]}/${m[2]}, and tenant builds run in ${t.project}/${t.region}`);
  if (!NPM_MIRROR_RE.test(t.npm_registry ?? "")) stop("validate", "the tenant build pool has no internet, so this host must name the tenant npm mirror (DM_TENANT_NPM_REGISTRY, https://<region>-npm.pkg.dev/<project>/<repository>/)");
}

/** The tag every tenant agent carries: the firewall lets it reach the mesh
 *  and nothing else. */
export const TENANT_AGENT_TAG = "tenant-agent";

/** EGRESS, AS IT IS (Common Agent 8.3 `egress`, 12.7).
 *
 *  A platform container agent runs as a Cloud Run service with no VPC
 *  setting, so its packets leave by Google's own path to the internet and no
 *  firewall of ours is in the way. That is `open`, enforced by `none`, and
 *  the record says so: a target that cannot restrict is recorded as it is.
 *
 *  A tenant agent runs with Direct VPC egress, all traffic, on the tenant
 *  network (tenantNetworkArgv), and that network's firewall decides what it
 *  reaches. The rules are the platform's, made once for the tenant project and
 *  checked daily by the tenant audit, and this host's account may not read
 *  them. They apply to every workload on the network, not to a tag, so the
 *  description lists everything they let through, including what the agent
 *  does not need (the Google API range, from "host") and the metadata server,
 *  which no VPC rule can stop. So the host's tenant settings describe
 *  them in DM_TENANT_EGRESS, a JSON object spelled as the record spells it:
 *
 *    { "policy": "allowlist",
 *      "allowed": [{ "name": "network", "from": "network", "address": "<range>" }, ...],
 *      "denied": ["<range>", ...], "enforced_by": "<the mechanism>" }
 *
 *  A description this file cannot read, or one that claims an allowlist
 *  enforced by nothing, is no description: the member is left out of the
 *  record, which says this producer did not observe the egress, rather than
 *  guessing at it either way. */
export const EGRESS_OPEN = Object.freeze({ policy: "open", enforced_by: "none" });

export function tenantEgress(text) {
  if (!text) return null;
  // Built here and not at module level: SETTINGS calls this while the module
  // is still loading, before a later const would exist.
  const from = new Set(["system", "network", "registrar", "model", "workspace", "instruction", "host"]);
  let d;
  try { d = JSON.parse(text); } catch { return null; }
  if (!d || typeof d !== "object" || Array.isArray(d)) return null;
  const str = (v) => typeof v === "string" && v.trim() !== "" && v.length <= 200;
  if (!str(d.enforced_by)) return null;
  const denied = d.denied === undefined ? null : d.denied;
  if (denied !== null && (!Array.isArray(denied) || !denied.every(str))) return null;
  if (d.policy === "open") return { policy: "open", ...(denied?.length ? { denied: [...denied] } : {}), enforced_by: d.enforced_by };
  if (d.policy !== "allowlist" || d.enforced_by === "none" || !Array.isArray(d.allowed) || !d.allowed.length) return null;
  const allowed = [];
  for (const a of d.allowed) {
    if (!a || !str(a.name) || !from.has(a.from) || (a.address !== undefined && !str(a.address))) return null;
    allowed.push({ name: a.name, from: a.from, ...(a.address ? { address: a.address } : {}) });
  }
  return { policy: "allowlist", allowed, ...(denied?.length ? { denied: [...denied] } : {}), enforced_by: d.enforced_by };
}

/** The egress a container service has, for its record: a tenant's from the
 *  host's description of the tenant network, null where there is none; a
 *  platform agent's open. */
export function egressOf(x) {
  if (x?.tenant) return x.egress ?? null;
  return { ...EGRESS_OPEN };
}
const egressPart = (x) => { const e = egressOf(x); return e ? { egress: e } : {}; };
const TENANT_RE = /^t-[a-z0-9]{4,40}$/;
const SA_EMAIL_RE = /^[a-z][a-z0-9-]{4,28}[a-z0-9]@[a-z][a-z0-9-]{4,28}[a-z0-9]\.iam\.gserviceaccount\.com$/;
/** The most one tenant service may ask for. */
const TENANT_MAX_CPU_EACH = 2;
const TENANT_MAX_MEMORY_EACH_MIB = 2048;

export function memoryMib(m) {
  const x = /^(\d+)(Mi|Gi)$/.exec(String(m));
  return x ? Number(x[1]) * (x[2] === "Gi" ? 1024 : 1) : 0;
}

/** What one tenant already runs, from the inventory, leaving out one name
 *  (the install being updated). An agent that wakes on message scales to
 *  zero, so it counts no instance-hours here (the platform's day allowance of
 *  wake minutes, TENANT_WAKE_DAY_MINUTES, bounds it instead); one kept always
 *  on, from before the wake, counts 24 a day. */
export function tenantUsage(rows, tenant, except = null) {
  const mine = (rows ?? []).filter((r) => r.tenant === tenant && r.name !== except && !/^failed/.test(String(r.state ?? "")));
  return {
    services: mine.length,
    cpu: mine.reduce((n, r) => n + Number(r.cpu ?? 1), 0),
    memory_mib: mine.reduce((n, r) => n + memoryMib(r.memory ?? "512Mi"), 0),
    instance_hours: mine.filter((r) => r.wake !== true).length * 24,
  };
}

/** Refuse a tenant install that would take the tenant past its limits. */
export function checkTenantLimits(ins, rows, limits) {
  const u = tenantUsage(rows, ins.tenant, ins.name);
  const after = { services: u.services + 1, cpu: u.cpu + Number(ins.cpu), memory_mib: u.memory_mib + memoryMib(ins.memory), instance_hours: u.instance_hours + (ins.always_on ? 24 : 0) };
  if (after.services > limits.services) return `${ins.tenant} already runs ${u.services} of the ${limits.services} services it may have`;
  if (after.cpu > limits.cpu) return `${ins.tenant} would have ${after.cpu} CPUs, and may have ${limits.cpu}`;
  if (after.memory_mib > limits.memory_mib) return `${ins.tenant} would have ${after.memory_mib} MiB of memory, and may have ${limits.memory_mib}`;
  if (after.instance_hours > limits.instance_hours) return `${ins.tenant} would run ${after.instance_hours} instance-hours a day, and may run ${limits.instance_hours}`;
  return null;
}

/** Every gcloud call for a tenant install is made as the tenant deployer,
 *  which the fleet host may only impersonate: it cannot read a secret's value
 *  or make a key, and holds nothing in the platform's project. */
export function tenantDeps(deps, deployer) {
  const gcloud = (argv, opts) => deps.gcloud([...argv, `--impersonate-service-account=${deployer}`], opts);
  return { ...deps, gcloud };
}
const paths = (s = SETTINGS) => ({
  inventory: `${s.fleet}/deploymgr-services.json`,
  tokens: `${s.home}/secrets/boot-tokens`,
  credentials: `${s.home}/secrets/credentials`,
  identity: `${s.home}/.agentmesh/adapter/identity.json`,
  records: `${s.home}/records`,
  tmp: `${s.home}/tmp`,
});

// Where the credential bundle is mounted in the container, and the variable
// that says so: the AgentMesh SDKs' own convention (AGENTMESH_CREDENTIALS_FILE).
export const MOUNT = "/secrets/agentmesh/credentials.json";
export const CREDENTIALS_ENV = "AGENTMESH_CREDENTIALS_FILE";

export const NAME_RE = /^[a-z][a-z0-9-]{1,22}[a-z0-9]$/;
const HANDLE_RE = /^[a-z0-9][a-z0-9-]*\.[^@\s.][^@\s]*@[^@\s]+$/;
const REPO_RE = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const PATH_RE = /^(?:[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*)?$/;
const COMMIT_RE = /^[0-9a-f]{40}$/;
const ENV_RE = /^[A-Z][A-Z0-9_]{0,63}$/;
const CREDENTIAL_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const TOKEN_NAME_RE = /^[a-z0-9-]{1,32}$/;
const NKEY_RE = /^U[A-Z2-7]{55}$/;
const RID_RE = /^dr_[A-Za-z0-9_-]{8,64}$/;
const PROJECT_RE = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const REGION_RE = /^[a-z]+-[a-z]+[0-9]$/;
const REGISTRY_RE = /^(?:[a-z0-9-]+\.)?(?:gcr\.io|[a-z0-9-]+-docker\.pkg\.dev)\/[a-z0-9-]+(?:\/[a-z0-9._-]+)*$/;
const CPU_RE = /^(?:0\.[1-9]|[1-4])$/;
const MEMORY_RE = /^(?:[1-9][0-9]{2,3}Mi|[1-8]Gi)$/;
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
// A value where a name belongs, or a credential pasted as a setting.
const VALUE_SHAPED = /(?:^am_|^sk-|^AIza|^ghp_|^xox[abp]-|-----BEGIN|^SU[A-Z2-7]{50,}|^eyJ[A-Za-z0-9_-]{10,}\.)/;

// ── the one gcloud seam ───────────────────────────────────────────────────
//
// Every gcloud call goes through `gcloud()` and nothing else in this file
// starts one; a test reads this file and refuses a second door. The input,
// where there is one, goes down a pipe and is never logged: the one call that
// carries any is the credential bundle going into its secret.

export function makeGcloud(bin = SETTINGS.gcloud) {
  return (argv, { input, timeout = 600_000 } = {}) => {
    const p = spawnSync(bin, argv, { encoding: "utf8", input, timeout, maxBuffer: 32 * 1024 * 1024, env: { ...process.env, CLOUDSDK_CORE_DISABLE_PROMPTS: "1" } });
    return { code: p.status ?? (p.error ? 124 : 1), stdout: p.stdout ?? "", stderr: p.stderr ?? (p.error ? String(p.error.message) : "") };
  };
}

// ── refusing an instruction before anything exists ───────────────────────

class Stop extends Error {
  constructor(step, error, state) { super(error); this.step = step; this.state = state; }
}
const stop = (step, error, state) => { throw new Stop(step, error, state); };

/** The instruction, read and refused in words. Returns the normalized
 *  instruction; never touches anything. */
export function readInstruction(args, s = SETTINGS) {
  const a = args && typeof args === "object" ? { ...args } : {};
  // A tenant's agent: the place it runs is this host's tenant settings, never
  // the request's or the platform's placement.
  const tenant = a.tenant === undefined || a.tenant === null || a.tenant === "" ? null : String(a.tenant);
  const t = s.tenant ?? tenantSettings({});
  if (tenant !== null) {
    if (!TENANT_RE.test(tenant)) stop("validate", "tenant must be the tenant id the platform set, t- and letters or digits");
    if (!t.project || !t.registry || !t.deployer || !t.builder) {
      stop("validate", "a tenant's agent runs only in the tenant project, and this host names none (DM_TENANT_PROJECT, DM_TENANT_REGISTRY, DM_TENANT_DEPLOYER, DM_TENANT_BUILDER)");
    }
    if (!SA_EMAIL_RE.test(t.deployer) || !SA_EMAIL_RE.test(t.builder)) stop("validate", "DM_TENANT_DEPLOYER and DM_TENANT_BUILDER must be service account addresses");
    if (a.secrets && Object.keys(a.secrets).length) stop("validate", "a tenant's agent reads only its own credential; a model is reached through the mesh's model gateway, and no platform secret is placed in the tenant project");
    tenantPoolProblem(t);
    a.project = t.project; a.region = t.region; a.registry = t.registry;
  } else if (t.project && String(a.project ?? "") === t.project) {
    stop("validate", "the tenant project takes only tenant workloads; this install names no tenant");
  } else {
    // The platform's own container agents run in the project kept for them,
    // when the host names one (DM_PLATFORM_PROJECT), whatever the host's
    // placement for jobs says. An update still lands where the install stands.
    const p = s.platform ?? platformSettings({});
    if (p.project) {
      a.project = p.project;
      if (p.region) a.region = p.region;
      if (p.registry) a.registry = p.registry;
    }
  }
  const name = String(a.name ?? "");
  if (!NAME_RE.test(name)) stop("validate", `bad name ${JSON.stringify(name)}: lowercase letters, digits and hyphens, at most 24, because the service account is named after it`);
  const handle = String(a.handle ?? "").toLowerCase();
  if (!HANDLE_RE.test(handle)) stop("validate", "handle must be the agent's full name, <name>.<email>");
  if (a.request_id !== undefined && !RID_RE.test(String(a.request_id))) stop("validate", "request_id must be the deploy request's id");
  const src = a.source && typeof a.source === "object" ? a.source : {};
  const repository = String(src.repository ?? "").replace(/\.git$/, "");
  if (!REPO_RE.test(repository)) stop("validate", "source.repository must be a public GitHub repository address");
  const path = String(src.path ?? "").replace(/^\/+|\/+$/g, "");
  if (!PATH_RE.test(path) || path.split("/").includes("..")) stop("validate", "source.path must be a folder inside the repository");
  const commit = String(src.commit ?? "").toLowerCase();
  if (!COMMIT_RE.test(commit)) stop("validate", "source.commit must be a full 40-character commit");
  const dockerfile = String(src.dockerfile ?? "Dockerfile");
  if (!dockerfile || !PATH_RE.test(dockerfile) || dockerfile.split("/").includes("..")) stop("validate", "source.dockerfile must be a file inside the folder");
  const settings = {};
  for (const [k, v] of Object.entries(a.settings ?? {})) {
    if (!ENV_RE.test(k)) stop("validate", `setting ${k} is not a variable name`);
    if (k === CREDENTIALS_ENV) stop("validate", `${CREDENTIALS_ENV} is the deployment manager's to set: it names where the agent's own credential is mounted`);
    const s = String(v);
    if (VALUE_SHAPED.test(s)) stop("validate", `setting ${k} looks like a credential; a secret is named in secrets, never carried as a setting`);
    settings[k] = s;
  }
  const secrets = {};
  for (const [k, v] of Object.entries(a.secrets ?? {})) {
    if (!ENV_RE.test(k) || k === CREDENTIALS_ENV) stop("validate", `secret ${k} is not a variable this install may set`);
    const s = String(v);
    if (!CREDENTIAL_RE.test(s) || VALUE_SHAPED.test(s)) stop("validate", `secret ${k} must be the NAME a credential is stored under, never its value`);
    if (k in settings) stop("validate", `${k} is both a setting and a secret`);
    secrets[k] = s;
  }
  const boot = a.boot_token === undefined || a.boot_token === null ? null : String(a.boot_token);
  if (boot !== null && !TOKEN_NAME_RE.test(boot)) stop("validate", "boot_token must be a token NAME in the store, never a value");
  const project = String(a.project ?? "");
  if (!PROJECT_RE.test(project)) stop("validate", "project must name the Google Cloud project the service runs in");
  const region = String(a.region ?? "");
  if (!REGION_RE.test(region)) stop("validate", "region must be a Cloud Run region");
  const registry = String(a.registry ?? "");
  if (!REGISTRY_RE.test(registry)) stop("validate", "registry must say where the image is published");
  const cpu = String(a.cpu ?? "1");
  if (!CPU_RE.test(cpu)) stop("validate", "cpu is 0.1 to 0.9 or 1 to 4");
  const memory = String(a.memory ?? "512Mi");
  if (!MEMORY_RE.test(memory)) stop("validate", "memory is like 512Mi or 1Gi");
  const claims = Array.isArray(a.claims) ? a.claims.map(String) : [];
  const replaces = a.replaces ? String(a.replaces) : null;
  if (replaces && !NKEY_RE.test(replaces)) stop("validate", "replaces must be an agent key");
  const readyLine = a.ready_line ? String(a.ready_line).slice(0, 120) : null;
  if (readyLine && /["\\]/.test(readyLine)) stop("validate", "ready_line may not carry quotes or backslashes");
  if (a.cloud) stop("validate", "a service in a customer's own project is not built; this install runs in our project");
  if (tenant !== null) {
    if (Number(cpu) > TENANT_MAX_CPU_EACH) stop("validate", `a tenant service may have at most ${TENANT_MAX_CPU_EACH} CPUs`);
    if (memoryMib(memory) > TENANT_MAX_MEMORY_EACH_MIB) stop("validate", `a tenant service may have at most ${TENANT_MAX_MEMORY_EACH_MIB / 1024} GiB of memory`);
  }
  // Wake on message is the default: the agent sleeps behind the wake host and
  // the platform's waker starts it when mail waits. Kept always on only when
  // the owner said so at filing, and never for a person's agent.
  const alwaysOn = a.always_on === true;
  if (alwaysOn && tenant !== null) stop("validate", "a person's agent sleeps between messages and is woken by the platform; it cannot be kept always on");
  const waker = alwaysOn ? "" : tenant !== null ? String(t.waker ?? "") : String((s.platform ?? platformSettings({})).waker ?? "");
  if (!alwaysOn && !SA_EMAIL_RE.test(waker)) {
    stop("validate", tenant !== null
      ? "a person's agent is woken by the platform when mail waits for it, and this host names no waker (DM_TENANT_WAKER)"
      : "a container agent sleeps until the platform wakes it, and this host names no platform waker (DM_PLATFORM_WAKER); an agent that must stay on says always_on");
  }
  let wakeIdle = null;
  if (a.wake_idle_seconds !== undefined && a.wake_idle_seconds !== null) {
    wakeIdle = Number(a.wake_idle_seconds);
    if (!Number.isInteger(wakeIdle) || wakeIdle < 30 || wakeIdle > 900) stop("validate", "wake_idle_seconds is a whole number of seconds from 30 to 900");
  }
  return {
    tenant,
    always_on: alwaysOn,
    ...(alwaysOn ? {} : { waker, wake_idle_seconds: wakeIdle ?? (tenant !== null ? t.wake_idle_seconds ?? 120 : 120), wake_max_seconds: tenant !== null ? t.wake_max_seconds ?? 3300 : 3300 }),
    ...(tenant !== null ? { network: t.network, subnet: t.subnet, deployer: t.deployer, builder: t.builder, egress: t.egress ?? null, worker_pool: t.worker_pool || null }
      : platformBuilder(s, project) ? { builder: platformBuilder(s, project) } : {}),
    name, handle, request_id: a.request_id ? String(a.request_id) : null,
    source: { repository, path, commit, dockerfile },
    kind: String(a.kind ?? "third-party-framework"),
    settings, secrets, boot_token: boot, project, region, registry, cpu, memory, claims, replaces,
    ready_line: readyLine, instructed_by: String(a.instructed_by ?? "the owner").slice(0, 200),
  };
}

// ── names of the things one install makes ────────────────────────────────

export function resourcesFor(ins) {
  const sa = `agent-${ins.name}`;
  return {
    service: `agent-${ins.name}`,
    service_account: `${sa}@${ins.project}.iam.gserviceaccount.com`,
    service_account_id: sa,
    secret: `mesh-agent-${ins.name}`,
    // An agent that wakes on message runs the folder's image with the wake
    // host on top, tagged apart from the image the folder alone makes.
    image: `${ins.registry}/${ins.name}:${ins.source.commit.slice(0, 12)}${ins.always_on === false ? "-wake" : ""}`,
  };
}

/** The node the wake host runs on, taken from Node's own image: its binary
 *  and the two C++ libraries it needs, so the layer works on any Debian-based
 *  image, a Python one included, and changes nothing the agent uses. */
export const WAKE_NODE_IMAGE = "node:22-bookworm-slim";
/** Where the wake layer puts itself in the image. */
export const WAKE_DIR = "/opt/wake";
export const WAKE_ENTRYPOINT = ["/usr/bin/env", `LD_LIBRARY_PATH=${WAKE_DIR}/lib`, `${WAKE_DIR}/node`, `${WAKE_DIR}/wake-host.mjs`];

/** The Dockerfile of the wake layer, over the image the folder built. The
 *  agent's own command is written down beside it (command.json) before the
 *  entrypoint is replaced, and the wake host starts it when woken. */
export function wakeDockerfile(base) {
  return [
    `FROM ${WAKE_NODE_IMAGE} AS wakenode`,
    `FROM ${base}`,
    `COPY --from=wakenode /usr/local/bin/node ${WAKE_DIR}/node`,
    `COPY --from=wakenode /usr/lib/x86_64-linux-gnu/libstdc++.so.6 /usr/lib/x86_64-linux-gnu/libgcc_s.so.1 ${WAKE_DIR}/lib/`,
    `COPY wake-host.mjs command.json ${WAKE_DIR}/`,
    // The node runs on this image, as its own user, or the build stops here.
    `RUN ${JSON.stringify([...WAKE_ENTRYPOINT.slice(0, -1), "--check", WAKE_ENTRYPOINT.at(-1)])}`,
    `ENTRYPOINT ${JSON.stringify(WAKE_ENTRYPOINT)}`,
    "CMD []",
    "",
  ].join("\n");
}

/** The Cloud Build config: the folder's own Dockerfile, nothing added, with
 *  Cloud Build's provenance requested. The source is the repository at the
 *  commit, fetched by Cloud Build itself (`gcloud builds submit <repo>
 *  --git-source-revision --git-source-dir`), so no copy of it passes through
 *  this host and the build's own record names the commit.
 *
 *  An agent that wakes on message (every one but those the owner keeps always
 *  on) gets two more steps: the folder's image is read for its own command,
 *  and the wake layer (wakeDockerfile, the wake host as `wakeHost`) is built
 *  on top of it. Only that image is pushed. The shell step holds no dollar
 *  sign, which Cloud Build would read as a substitution. */
export function buildConfig(ins, image, wakeHost = null) {
  const labels = [
    "--label", `org.opencontainers.image.source=${ins.source.repository}`,
    "--label", `org.opencontainers.image.revision=${ins.source.commit}`,
    "--label", `net.agentmesh.handle=${ins.handle}`,
  ];
  if (ins.always_on !== false) {
    return {
      steps: [{ name: "gcr.io/cloud-builders/docker", args: ["build", ...labels, "-t", image, "-f", ins.source.dockerfile, "."] }],
      images: [image],
      options: { requestedVerifyOption: "VERIFIED", logging: "CLOUD_LOGGING_ONLY" },
      tags: ["deploymgr", `agent-${ins.name}`],
    };
  }
  if (typeof wakeHost !== "string" || !wakeHost.includes("wakeServer")) throw new Error("the wake host's source is needed to build an agent that wakes on message");
  const base = `agentmesh-local/${ins.name}:folder`;
  const dir = "/workspace/.agentmesh-wake";
  const inspect = '{"entrypoint":{{json .Config.Entrypoint}},"cmd":{{json .Config.Cmd}},"workdir":{{json .Config.WorkingDir}},"env":{{json .Config.Env}}}';
  // Cloud Build takes at most 10,000 characters in one argument, so the wake
  // host goes in gzipped and base64'd, in pieces, one step each.
  const packed = gzipSync(Buffer.from(wakeHost, "utf8"), { level: 9 }).toString("base64");
  const pieces = packed.match(/.{1,8000}/g) ?? [];
  const carry = pieces.map((p, i) => ({ name: "gcr.io/cloud-builders/docker", entrypoint: "bash", args: ["-c", `set -eu\nmkdir -p ${dir}\necho ${p} ${i === 0 ? ">" : ">>"} ${dir}/wake-host.b64`] }));
  const script = [
    "set -eu",
    `base64 -d ${dir}/wake-host.b64 | gunzip > ${dir}/wake-host.mjs`,
    `rm -f ${dir}/wake-host.b64`,
    `echo ${Buffer.from(wakeDockerfile(base), "utf8").toString("base64")} | base64 -d > ${dir}/Dockerfile`,
    `docker inspect --format '${inspect}' ${base} > ${dir}/command.json`,
    `cat ${dir}/command.json`,
  ].join("\n");
  for (const s of [script, ...carry.map((c) => c.args[1])]) {
    if (s.includes("$")) throw new Error("the wake layer's build step holds a dollar sign, which Cloud Build reads as a substitution");
    if (s.length > 9500) throw new Error("a wake layer build step is longer than Cloud Build takes");
  }
  return {
    steps: [
      { name: "gcr.io/cloud-builders/docker", args: ["build", ...labels, "-t", base, "-f", ins.source.dockerfile, "."] },
      ...carry,
      { name: "gcr.io/cloud-builders/docker", entrypoint: "bash", args: ["-c", script] },
      { name: "gcr.io/cloud-builders/docker", args: ["build", ...labels, "--label", "net.agentmesh.wake=platform", "-t", image, dir] },
    ],
    images: [image],
    options: { requestedVerifyOption: "VERIFIED", logging: "CLOUD_LOGGING_ONLY" },
    tags: ["deploymgr", `agent-${ins.name}`, "wake"],
  };
}

export function buildSubmitArgv(ins, configPath, uploaded = null) {
  // A tenant build on the tenant build pool (technical debt 72): the pool has
  // no internet and cannot fetch the repository, so this host fetched the
  // commit's own archive from GitHub and the build takes that folder,
  // uploaded to the tenant project's build bucket as for a package.
  if (ins.tenant && ins.worker_pool) {
    if (!uploaded) throw new Error("a tenant build on the tenant build pool takes the folder this host fetched");
    return ["builds", "submit", uploaded, "--config", configPath, "--project", ins.project, "--region", ins.region,
      ...poolArgv(ins),
      "--service-account", `projects/${ins.project}/serviceAccounts/${ins.builder}`,
      `--gcs-source-staging-dir=gs://${ins.project}_${ins.region}_cloudbuild/source`,
      "--async", "--format", "json", "--quiet"];
  }
  return ["builds", "submit", ins.source.repository,
    "--git-source-revision", ins.source.commit,
    ...(ins.source.path ? ["--git-source-dir", ins.source.path] : []),
    "--config", configPath, "--project", ins.project,
    // A tenant image is built as tenant-builder, which may only write to the
    // tenant registry, never as the project's default build account; the
    // platform's own images as the platform's builder when the host names one.
    ...(ins.tenant || ins.builder ? ["--service-account", `projects/${ins.project}/serviceAccounts/${ins.builder}`] : []),
    "--async", "--format", "json", "--quiet"];
}

/** The labels a service and its secret carry, for billing by tenant. */
export function labelsFor(ins) {
  return ins.tenant
    ? `managed-by=deploymgr,agent=${ins.name},workload=tenant,tenant=${ins.tenant}`
    : `managed-by=deploymgr,agent=${ins.name}`;
}

/** A tenant service's network: every packet out goes through tenant-vpc,
 *  under the tags that let it reach the mesh and nothing else, and it has no
 *  address anybody could call. */
export function tenantNetworkArgv(ins, { address = false } = {}) {
  if (!ins.tenant) return [];
  return ["--network", ins.network, "--subnet", ins.subnet, "--vpc-egress", "all-traffic",
    "--network-tags", `${TENANT_AGENT_TAG},${ins.tenant}`, ...(address ? [] : ["--no-default-url"])];
}

/** The shape of a service that wakes on message (docs/container-agents-plan.md,
 *  "Wake on message"): no instance while nobody writes to the agent, one at
 *  most, CPU billed only while a request is open, a wake as long as Cloud
 *  Run's hour, and a quicker start. The wake is a request, so the service
 *  takes traffic from outside; IAM lets through only a request signed for an
 *  account that may invoke it, which is the waker alone, and Cloud Run
 *  refuses anything else before an instance starts. */
export const WAKE_SHAPE_ARGV = ["--min-instances", "0", "--max-instances", "1", "--cpu-throttling", "--cpu-boost",
  "--timeout", String(3600), "--ingress", "all", "--no-allow-unauthenticated"];
/** The shape of a service the owner keeps always on. */
export const ALWAYS_ON_ARGV = ["--min-instances", "1", "--max-instances", "1", "--no-cpu-throttling",
  "--ingress", "internal", "--no-allow-unauthenticated"];

/** The service, pinned by digest. It wakes on message unless the owner keeps
 *  it always on; either way nobody but the waker can call it, and the agent
 *  dials out to the mesh and needs no inbound traffic of its own. */
export function serviceDeployArgv(ins, res, pinned, envFile) {
  const secretFlags = [`${MOUNT}=${res.secret}:latest`, ...Object.entries(ins.secrets).map(([env, cred]) => `${env}=${cred}:latest`)];
  const wake = ins.always_on === false;
  return ["run", "deploy", res.service, "--image", pinned, "--region", ins.region, "--project", ins.project,
    "--service-account", res.service_account,
    ...(wake ? WAKE_SHAPE_ARGV : ALWAYS_ON_ARGV),
    "--cpu", ins.cpu, "--memory", ins.memory, "--concurrency", "10",
    ...tenantNetworkArgv(ins, { address: wake }),
    "--set-secrets", secretFlags.join(","),
    "--env-vars-file", envFile,
    "--labels", wake ? `${labelsFor(ins)},${WAKE_LABEL}` : labelsFor(ins),
    "--format", "json", "--quiet"];
}

/** The wake host's own settings: who may wake it, its two windows, and the
 *  agent's ready line, which it passes on to the waker. */
export function wakeEnvFor(ins) {
  return {
    WAKE_BY: ins.waker,
    WAKE_IDLE_SECONDS: String(ins.wake_idle_seconds),
    WAKE_MAX_SECONDS: String(ins.wake_max_seconds),
    ...(ins.ready_line ? { WAKE_READY_LINE: ins.ready_line } : {}),
  };
}

export function envFor(ins) {
  return { ...ins.settings, [CREDENTIALS_ENV]: MOUNT, ...(ins.always_on === false ? wakeEnvFor(ins) : {}) };
}

/** The role the platform's waker holds on one agent's service in the
 *  platform project. A person's agent needs none here: in the tenant project
 *  the waker holds its role on the project, where it can call nothing else. */
export function wakerRoleOf(ins, s = SETTINGS) {
  // A project's custom role binds only in that project, so a role the host
  // names for another project (the platform's own, before its container
  // agents had a project of their own) gives way to this project's.
  const named = (s.platform ?? {}).waker_role || "";
  return named && named.startsWith(`projects/${ins.project}/`) ? named : `projects/${ins.project}/roles/platformWaker`;
}

export function invokerBindArgv(ins, res, s = SETTINGS) {
  return ["run", "services", "add-iam-policy-binding", res.service, "--region", ins.region, "--project", ins.project,
    "--member", `serviceAccount:${ins.waker}`, "--role", wakerRoleOf(ins, s), "--quiet", "--format", "none"];
}

/** The waker may call this service: already bound (read first, since the
 *  owner may have bound it; Cloud Run honours no IAM condition on a service's
 *  name, so this host cannot be given the right to bind on agent services
 *  alone), or bound now. */
export function ensureWakerBound(deps, ins, res, s = SETTINGS) {
  const got = deps.gcloud(["run", "services", "get-iam-policy", res.service, "--region", ins.region, "--project", ins.project, "--format", "json"]);
  const role = wakerRoleOf(ins, s);
  const member = `serviceAccount:${ins.waker}`;
  if (got.code === 0 && (parse(got.stdout).bindings ?? []).some((b) => b.role === role && (b.members ?? []).includes(member))) return "already bound";
  const r = deps.gcloud(invokerBindArgv(ins, res, s));
  if (r.code !== 0) {
    stop("service", `the platform's waker could not be let call ${res.service}: ${(r.stderr || "").trim().slice(-300)}. The owner binds it once: gcloud run services add-iam-policy-binding ${res.service} --region ${ins.region} --member ${member} --role ${role}, then runs this again`);
  }
  return "bound";
}

// ── records ───────────────────────────────────────────────────────────────

/** The canonical JSON a record is signed over: sorted keys, no whitespace.
 *  The same form record.py signs (strings and integers only). */
export function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;
  return JSON.stringify(v);
}

export const TAG = "agent-deployment-record-v1";
export const BUILD_TAG = "agent-build-record-v1";

export function signRecord(doc, tag, signer, by) {
  const body = { ...doc, by };
  delete body.signatures;
  const sig = signer ? signer(`${tag}\n${canonical(body)}`) : null;
  return sig
    ? { ...body, signatures: [{ tag, by, sig, alg: "ed25519" }] }
    : { ...body, signatures: [], _unsigned: "record is faithful but unsigned (no signer)" };
}

export function buildRecord(ins, build, now) {
  return {
    record: "v1", role: "agent-builder", act: "build", instructed_by: ins.instructed_by,
    subject: { name: ins.name, handle: ins.handle, kind: ins.kind },
    source: ins.source,
    cloud_build: { id: build.id, project: ins.project, ...(build.log_url ? { log_url: build.log_url } : {}) },
    image: build.image, image_digest: build.digest,
    provenance: build.provenance,
    draft: true,
    checks: [{ kind: "unrun", what: "nothing in this image was run by the build. It was built from the folder's own Dockerfile at the commit named, by Cloud Build, and nothing was added to it." }],
    produced_at: now, signatures: [],
  };
}

export function deploymentRecord(ins, res, r, now) {
  return {
    record: "v1", role: "deployment-manager", act: r.act, instructed_by: ins.instructed_by,
    ...(ins.request_id ? { request: ins.request_id } : {}),
    subject: { name: ins.name, kind: ins.kind },
    source: ins.source,
    image: r.image, image_digest: r.image_digest,
    build: { id: r.build_id, record_sha256: r.build_record_sha256 },
    target: {
      kind: "cloud-run-service", service: res.service, project: ins.project, region: ins.region,
      revision: r.revision, service_account: res.service_account,
      shape: ins.always_on === false
        ? { min_instances: 0, max_instances: 1, cpu_always_allocated: false, cpu: ins.cpu, memory: ins.memory, ingress: "all", unauthenticated: false,
            wake: { by: ins.waker, idle_seconds: ins.wake_idle_seconds, max_seconds: ins.wake_max_seconds, request_seconds: 3600 },
            ...(ins.tenant ? { tenant: ins.tenant, network: ins.network, vpc_egress: "all-traffic", network_tags: [TENANT_AGENT_TAG, ins.tenant], default_url: true } : {}) }
        : { min_instances: 1, max_instances: 1, cpu_always_allocated: true, cpu: ins.cpu, memory: ins.memory, ingress: "internal", unauthenticated: false,
            ...(ins.always_on === true ? { always_on: "kept on by the owner" } : {}),
            ...(ins.tenant ? { tenant: ins.tenant, network: ins.network, vpc_egress: "all-traffic", network_tags: [TENANT_AGENT_TAG, ins.tenant], default_url: false } : {}) },
    },
    agent: { key: r.agent_key, handle: r.handle },
    ...(r.key_custody ? { key_custody: r.key_custody } : {}),
    // What the agent can reach on the network after this act (8.3).
    ...egressPart(ins),
    ...(ins.claims.length ? { declarations: { claims: ins.claims } } : {}),
    settings_placed: Object.keys(ins.settings).sort(),
    credentials_placed: [res.secret, ...Object.values(ins.secrets)],
    ...(r.previous ? { previous: r.previous } : {}),
    ...(r.replaced ? { replaced: r.replaced } : {}),
    checks: [{ kind: "smoke", passed: r.smoke.passed, at: now, what: r.smoke.what }],
    produced_at: now, signatures: [],
  };
}

// ── what the install needs from outside, injected so it can be tested ────

export function realDeps(s = SETTINGS) {
  const p = paths(s);
  const require = createRequire(s.adapterModules);
  let nkeys = null;
  const loadNkeys = () => (nkeys ??= (() => { const m = require("nkeys.js"); return m.default ?? m; })());
  return {
    gcloud: makeGcloud(s.gcloud),
    fetch: globalThis.fetch,
    now: () => new Date().toISOString(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    readFile: (f) => readFileSync(f, "utf8"),
    exists: (f) => existsSync(f),
    remove: (f) => { try { unlinkSync(f); } catch { /* gone already */ } },
    tmp: () => mkdtempSync(join(tmpdir(), "dm-service-")),
    writeFile: (f, body) => writeFileSync(f, body, { mode: 0o600 }),
    rmdir: (d) => rmSync(d, { recursive: true, force: true }),
    inventory: {
      load: () => { try { return JSON.parse(readFileSync(p.inventory, "utf8")); } catch { return []; } },
      save: (rows) => { mkdirSync(dirname(p.inventory), { recursive: true }); writeFileSync(`${p.inventory}.tmp`, JSON.stringify(rows, null, 2)); renameSync(`${p.inventory}.tmp`, p.inventory); },
    },
    newKey: () => {
      const kp = loadNkeys().createUser();
      return { seed: new TextDecoder().decode(kp.getSeed()), key: kp.getPublicKey() };
    },
    signer: () => {
      if (!existsSync(p.identity)) return { by: "deployment-manager", sign: null };
      const id = JSON.parse(readFileSync(p.identity, "utf8"));
      const kp = loadNkeys().fromSeed(new TextEncoder().encode(String(id.seed).trim()));
      return { by: id.public_key ?? kp.getPublicKey(), sign: (m) => Buffer.from(kp.sign(new TextEncoder().encode(m))).toString("base64") };
    },
    bearer: () => { try { return readFileSync(s.controlTokenFile, "utf8").trim(); } catch { return ""; } },
    saveRecord: (name, act, doc) => {
      mkdirSync(p.records, { recursive: true });
      writeFileSync(join(p.records, `${name}-${act}.json`), JSON.stringify(doc, null, 2));
    },
    paths: p,
    importModule: (f) => import(pathToFileURL(f).href),
    settings: s,
  };
}

// ── the procedure ─────────────────────────────────────────────────────────

const parse = (s) => { try { return JSON.parse(s || "{}"); } catch { return {}; } };

function must(deps, argv, step, opts) {
  const r = deps.gcloud(argv, opts);
  if (r.code !== 0) stop(step, `gcloud ${argv.slice(0, 3).join(" ")} failed: ${(r.stderr || r.stdout || "no output").trim().slice(-400)}`);
  return r.stdout;
}

/** An image address as Artifact Registry's own commands take it. A gcr.io
 *  address is a repository named gcr.io in Artifact Registry, and
 *  `gcloud artifacts` refuses the gcr.io spelling. */
export function artifactRef(ref) {
  const m = /^(?:(us|eu|asia)\.)?gcr\.io\/([^/]+)\/(.+)$/.exec(String(ref));
  if (!m) return ref;
  const loc = { us: "us", eu: "europe", asia: "asia" }[m[1] ?? "us"];
  return `${loc}-docker.pkg.dev/${m[2]}/${m[1] ? `${m[1]}.gcr.io` : "gcr.io"}/${m[3]}`;
}

/** The repository folder at the pinned commit, fetched by this host for a
 *  build on the tenant build pool, which cannot reach GitHub (technical debt
 *  72). GitHub's archive of the commit is read with the package reader, so
 *  only regular files under one top folder are written, and nothing that
 *  climbs out. Returns the folder to upload. */
export async function fetchSourceFolder(ins, dir, deps) {
  const url = `${ins.source.repository}/archive/${ins.source.commit}.tar.gz`;
  let r;
  try {
    r = await deps.fetch(url, { signal: AbortSignal.timeout(120_000) });
  } catch (e) {
    stop("build", `the repository's archive at ${ins.source.commit} could not be fetched: ${e.message}`);
  }
  if (!r.ok) stop("build", `the repository's archive at ${ins.source.commit} could not be fetched: GitHub answered ${r.status}`);
  const bytes = Buffer.from(await r.arrayBuffer());
  if (bytes.length > SOURCE_ARCHIVE_MAX) stop("build", `the repository's archive is ${bytes.length} bytes, more than the ${SOURCE_ARCHIVE_MAX} a tenant build takes`);
  let tar;
  try { tar = readTarball(bytes); } catch (e) { stop("build", `the repository's archive could not be read: ${e.message.replace(/the package/g, "the repository")}`); }
  const root = join(dir, "src");
  for (const f of tar.files) {
    const p = join(root, f.path);
    mkdirSync(dirname(p), { recursive: true });
    deps.writeFile(p, f.bytes);
  }
  const folder = ins.source.path ? join(root, tar.top, ...ins.source.path.split("/")) : join(root, tar.top);
  if (!deps.exists(join(folder, ...ins.source.dockerfile.split("/")))) stop("build", `${ins.source.path || "the repository's top"} has no ${ins.source.dockerfile} at ${ins.source.commit}`);
  return folder;
}

/** The most a repository archive may weigh for a tenant build (100 MB). */
export const SOURCE_ARCHIVE_MAX = 100 * 1024 * 1024;

/** Build the image in Cloud Build and follow it to the end. */
export async function buildInCloud(ins, deps) {
  const res = resourcesFor(ins);
  const dir = deps.tmp();
  let submitted;
  try {
    const cfg = join(dir, "cloudbuild.json");
    let wakeHost = null;
    if (ins.always_on === false) {
      try { wakeHost = deps.readFile(deps.settings.wakeHostFile ?? SETTINGS.wakeHostFile); } catch (e) { stop("build", `the wake host is not on this host (${deps.settings.wakeHostFile ?? SETTINGS.wakeHostFile}): ${e.message}`); }
    }
    deps.writeFile(cfg, JSON.stringify(buildConfig(ins, res.image, wakeHost)));
    const pooled = Boolean(ins.tenant && ins.worker_pool);
    const uploaded = pooled ? await fetchSourceFolder(ins, dir, deps) : null;
    submitted = parse(must(deps, buildSubmitArgv(ins, cfg, uploaded), "build", { timeout: 300_000 }));
  } finally {
    deps.rmdir(dir);
  }
  const id = submitted.id ?? submitted.metadata?.build?.id;
  if (!id) stop("build", "the build was submitted and gcloud named no build id, so nothing can be followed or recorded");
  const deadline = Date.now() + deps.settings.buildMinutes * 60_000;
  const done = new Set(["SUCCESS", "FAILURE", "TIMEOUT", "CANCELLED", "EXPIRED", "INTERNAL_ERROR"]);
  // A build on a pool is a regional build, read back in its region.
  const where = ins.tenant && ins.worker_pool ? ["--region", ins.region] : [];
  let b = {};
  for (;;) {
    b = parse(must(deps, ["builds", "describe", id, "--project", ins.project, ...where, "--format", "json"], "build"));
    if (done.has(b.status)) break;
    if (Date.now() > deadline) stop("build", `build ${id} is still ${b.status} after ${deps.settings.buildMinutes} minutes; nothing was recorded`, `build ${id} is still running`);
    await deps.sleep(15_000);
  }
  if (b.status !== "SUCCESS") {
    const why = where.length
      ? ` A tenant build has no internet: its base image comes from the tenant registry (${ins.registry}), another Google-hosted registry, or Docker Hub as far as Google's mirror (mirror.gcr.io) holds it, and its steps cannot download anything.`
      : "";
    stop("build", `build ${id} ended ${b.status}: ${String(b.statusDetail ?? "").slice(0, 300)}. Its log is ${b.logUrl ?? "in Cloud Build"}.${why}`);
  }
  const digest = b.results?.images?.[0]?.digest;
  if (!DIGEST_RE.test(digest ?? "")) stop("build", `build ${id} reported ${JSON.stringify(digest)}, which is not an image digest`);
  // What Cloud Build attached about how the image was made. Read back rather
  // than assumed: an image whose provenance could not be read says so.
  const pinned = `${res.image.split(":")[0]}@${digest}`;
  const pr = deps.gcloud(["artifacts", "docker", "images", "describe", artifactRef(pinned), "--show-provenance", "--format", "json"], { timeout: 120_000 });
  const described = pr.code === 0 ? parse(pr.stdout) : {};
  const summary = described.provenance_summary ?? null;
  const slsa = Array.isArray(summary?.provenance) ? summary.provenance : [];
  const stmt = slsa.map((x) => x?.build?.intotoStatement).find(Boolean) ?? {};
  const provenance = slsa.length
    ? { attached: true, by: "Cloud Build", count: slsa.length, verify_option: "VERIFIED",
        slsa_build_level: described.image_summary?.slsa_build_level ?? null,
        predicate: stmt.predicateType ?? null, builder: stmt.slsaProvenance?.builder?.id ?? null,
        materials: (stmt.slsaProvenance?.materials ?? []).map((m) => ({ uri: m.uri, digest: m.digest })) }
    : { attached: false, why: pr.code === 0 ? "Cloud Build attached none that could be read back" : `the provenance could not be read: ${(pr.stderr || "").trim().slice(-200)}`, verify_option: "VERIFIED" };
  return { id, image: res.image, digest, pinned, provenance, log_url: b.logUrl ?? null, source_seen: b.source?.gitSource ?? b.source?.storageSource ?? null };
}

/** Make the agent's key and place its bundle, never on this host's disk.
 *  The single-use agent key minted at approval is read by name and burned. */
export async function makeKeyIntoSecret(ins, res, deps) {
  const tokenFile = `${deps.paths.tokens}/${ins.boot_token}.token`;
  if (!ins.boot_token || !deps.exists(tokenFile)) stop("key", `no agent key named ${ins.boot_token} in the store; a new install needs the one its approval minted`);
  const token = deps.readFile(tokenFile).trim();
  const { seed, key } = deps.newKey();
  let r;
  try {
    r = await deps.fetch(`${deps.settings.meshApi}/v1/bootstrap`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, agent_id: key }), signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    stop("key", `the platform could not be reached to trade the agent key: ${e.message}`);
  }
  const body = await r.json().catch(() => ({}));
  deps.remove(tokenFile);
  if (!r.ok || !body.creds) stop("key", `the platform would not trade the agent key: ${body.error ?? r.status}`);
  const bundle = JSON.stringify({ agent_seed: seed, mesh_creds: body.creds, servers: body.mesh?.endpoints ?? [], api_base: deps.settings.meshApi });
  // The secret, created where missing, then the bundle as a new version on
  // stdin. Nothing reads it back.
  if (deps.gcloud(["secrets", "describe", res.secret, "--project", ins.project, "--format", "json"]).code !== 0) {
    must(deps, ["secrets", "create", res.secret, "--project", ins.project, "--replication-policy", "automatic",
      "--labels", labelsFor(ins), "--quiet"], "secret");
  }
  must(deps, ["secrets", "versions", "add", res.secret, "--project", ins.project, "--data-file=-", "--quiet"], "secret", { input: bundle });
  // The name the key was given as it joined, when the approval named one (a
  // package approval does; a container install is named afterwards).
  return { agent_key: key, handle: typeof body.handle === "string" ? body.handle.toLowerCase() : null, joined_as: body.account_email ?? null, expires_at: body.expires_at ?? null };
}

/** Wait for the service's newest revision to be ready, then for the ready
 *  line the spec named, when it named one. A smoke check, and called that. */
export async function waitReady(ins, res, deps) {
  const deadline = Date.now() + deps.settings.readyMinutes * 60_000;
  let svc = {};
  for (;;) {
    svc = parse(must(deps, ["run", "services", "describe", res.service, "--region", ins.region, "--project", ins.project, "--format", "json"], "ready"));
    const ready = (svc.status?.conditions ?? []).find((c) => c.type === "Ready");
    const newest = svc.status?.latestCreatedRevisionName;
    if (ready?.status === "True" && newest && newest === svc.status?.latestReadyRevisionName) break;
    if (ready?.status === "False" && newest === svc.status?.latestCreatedRevisionName && ready?.reason && !/Deploying|Waiting/i.test(ready.reason)) {
      stop("ready", `the service is not ready: ${ready.reason}: ${String(ready.message ?? "").slice(0, 300)}`);
    }
    if (Date.now() > deadline) stop("ready", `the service did not become ready in ${deps.settings.readyMinutes} minutes`);
    await deps.sleep(10_000);
  }
  const revision = svc.status.latestReadyRevisionName;
  const rev = parse(must(deps, ["run", "revisions", "describe", revision, "--region", ins.region, "--project", ins.project, "--format", "json"], "ready"));
  const runningDigest = rev.status?.imageDigest ?? null;
  if (!ins.ready_line) {
    return { revision, running_digest: runningDigest, smoke: { passed: true, what: `the service's newest revision ${revision} is ready and serving, running ${runningDigest ?? "an image whose digest Cloud Run did not report"}; the spec names no ready line, so nothing more was watched` } };
  }
  const filter = `resource.type="cloud_run_revision" AND resource.labels.service_name="${res.service}" AND resource.labels.revision_name="${revision}" AND textPayload:"${ins.ready_line}"`;
  for (;;) {
    const lr = deps.gcloud(["logging", "read", filter, "--project", ins.project, "--limit", "1", "--freshness", "30m", "--format", "json"], { timeout: 120_000 });
    const hits = lr.code === 0 ? parse(lr.stdout) : [];
    if (Array.isArray(hits) && hits.length) {
      return { revision, running_digest: runningDigest, smoke: { passed: true, what: `revision ${revision} is ready and its log says "${ins.ready_line}", running ${runningDigest ?? "an image whose digest Cloud Run did not report"}` } };
    }
    if (Date.now() > deadline) stop("ready", `revision ${revision} is ready but its log never said "${ins.ready_line}" in ${deps.settings.readyMinutes} minutes`);
    await deps.sleep(10_000);
  }
}

/** Let one account read one secret. A service account made a moment ago
 *  can be unknown to IAM for a few seconds, so that answer is asked again. */
async function bindReader(deps, secret, project, account) {
  const argv = ["secrets", "add-iam-policy-binding", secret, "--project", project,
    "--member", `serviceAccount:${account}`, "--role", "roles/secretmanager.secretAccessor", "--quiet", "--format", "none"];
  for (let attempt = 0; ; attempt++) {
    const r = deps.gcloud(argv);
    if (r.code === 0) return;
    if (attempt >= 6 || !/does not exist/i.test(r.stderr)) stop("secret", `gcloud secrets add-iam-policy-binding failed: ${(r.stderr || "").trim().slice(-400)}`);
    await deps.sleep(10_000);
  }
}

/** Ask the platform for the verified name. */
export async function bindName(ins, key, deps) {
  if (!ins.request_id) stop("name", "no deploy request id, so the platform cannot say which name this key may have");
  const bearer = deps.bearer();
  if (!bearer) stop("name", "this host holds no executor bearer, so it cannot ask the platform for the name");
  // Asked again while the platform is restarting (a 502, 503 or no answer),
  // for up to five minutes: by now the service runs and holds its key, and
  // a platform deploy in that minute is no reason to take all of it down.
  let r = null;
  let why = "";
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      r = await deps.fetch(`${deps.settings.control}/deploy-requests/${ins.request_id}/name`, {
        method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${bearer}` },
        body: JSON.stringify({ agent_key: key }), signal: AbortSignal.timeout(60_000),
      });
      if (![502, 503, 504].includes(r.status)) break;
      why = `the platform answered ${r.status}`;
    } catch (e) {
      r = null;
      why = `the platform could not be reached: ${e.message}`;
    }
    await deps.sleep(15_000);
  }
  if (!r || [502, 503, 504].includes(r.status)) stop("name", `the name was not bound: ${why}, for five minutes`);
  const body = await r.json().catch(() => ({}));
  if (!r.ok || body.handle !== ins.handle) stop("name", `the name was not bound: ${body.error ?? r.status}`);
  return body;
}

function out(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
  process.exitCode = obj.ok ? 0 : 1;
  return obj;
}

/** One install or update, start to finish, returning the result the executor
 *  posts back (with both signed records inside it). */
export async function install(args, deps) {
  let ins;
  let row = null;
  const rows = () => deps.inventory.load();
  const save = (r) => deps.inventory.save([...rows().filter((x) => x.name !== r.name), r]);
  try {
    ins = readInstruction(args, deps.settings ?? SETTINGS);
    const before = rows().find((x) => x.name === ins.name) ?? null;
    const updating = !!(before && before.state === "running" && before.agent_key);
    // An update is a new revision of the service that stands, where it
    // stands. The host's placement says where NEW installs go; when it moved
    // (us-east1 to us-south1), an update of the converter built a second
    // service in the new region under the same key, and its waker binding
    // failed there (2026-10-04, dr_gzUSmiquVqe2CuUoavk5azV5).
    if (updating) {
      if (before.project) ins.project = before.project;
      if (before.region) ins.region = before.region;
    }
    const res = resourcesFor(ins);
    if (before && !updating) stop("validate", `${ins.name} is in the inventory ${before.state}; retire ${ins.name} to clean it before installing again`);
    if (updating && before.handle !== ins.handle) stop("validate", `${ins.name} is installed as ${before.handle}; an update keeps its name`);
    if (updating && (before.tenant ?? null) !== ins.tenant) stop("validate", `${ins.name} runs ${before.tenant ? `for ${before.tenant}` : "in the platform project"}; an update does not move it`);
    if (ins.tenant) {
      const over = checkTenantLimits(ins, rows(), (deps.settings ?? SETTINGS).tenant.limits);
      if (over) stop("limits", `refused: ${over}`);
      deps = tenantDeps(deps, ins.deployer);
    }
    if (updating && before.source?.commit === ins.source.commit) stop("validate", `${ins.name} already runs ${ins.source.commit.slice(0, 12)}; an update is a new commit`);
    const now = deps.now();
    row = updating
      ? { ...before, state: "updating", updating_to: ins.source.commit }
      : { name: ins.name, handle: ins.handle, kind: ins.kind, request_id: ins.request_id, project: ins.project, region: ins.region,
          service: res.service, service_account: res.service_account, secret: res.secret, source: ins.source, images: [],
          claims: ins.claims, ready_line: ins.ready_line, state: "installing", installed_at: now,
          ...(ins.tenant ? { tenant: ins.tenant } : {}), cpu: ins.cpu, memory: ins.memory };
    save(row);

    // 1. The image, built in the cloud.
    const build = await buildInCloud(ins, deps);
    row.images = [...new Set([...(row.images ?? []), build.pinned])];
    save(row);
    const signer = deps.signer();
    const bRec = signRecord(buildRecord(ins, build, deps.now()), BUILD_TAG, signer.sign, signer.by);
    const bRecSha = createHash("sha256").update(canonical(bRec)).digest("hex");

    // 2 and 3. The account, then (a new install) the key into its secret.
    let key = before?.agent_key ?? null;
    let custody = null;
    if (!updating) {
      if (deps.gcloud(["iam", "service-accounts", "describe", res.service_account, "--project", ins.project, "--format", "json"]).code !== 0) {
        must(deps, ["iam", "service-accounts", "create", res.service_account_id, "--project", ins.project,
          "--display-name", `Agent ${ins.handle}`.slice(0, 100), "--description", `Runs ${ins.handle}; reads only its own credential. Made by the deployment manager.`, "--quiet"], "account");
      }
      row.state = "account made";
      save(row);
      const made = await makeKeyIntoSecret(ins, res, deps);
      key = made.agent_key;
      row.agent_key = key;
      row.state = "key made";
      save(row);
      custody = {
        minted: "generated",
        held_by: [key, `secret:${res.secret}`, `service-account:${res.service_account}`],
        note: ins.tenant
          ? "The seed was generated in the deployment manager's memory on this host and went into the secret on stdin; it was never written to this host's disk. The secret is in the tenant project, where only the agent's own service account may read it; the deployment manager can place it but not read it back, and no platform account holds Secret Manager access there. The project's owners can."
          : "The seed was generated in the deployment manager's memory on this host and went into the secret on stdin; it was never written to this host's disk. At the secret, only the agent's own service account may read it; an account holding Secret Manager access across the whole project can read it too.",
      };
      // 4. Only this account reads this secret. Asked again for a minute
      // while a new service account is still unknown to IAM.
      await bindReader(deps, res.secret, ins.project, res.service_account);
      // 5. The name, before the service starts: the registry refuses an
      // agent with no name, and the program exits when it is refused, so a
      // service started first would only restart until it was named. Taking
      // a name over from the key it replaces happens here, and the old
      // service no longer answers to it from this moment.
      const named = await bindName(ins, key, deps);
      row.handle = named.handle;
      row.state = "named";
      save(row);
    }
    // Secrets the program reads besides its own credential: each readable by
    // this account, at the secret.
    for (const cred of Object.values(ins.secrets)) {
      must(deps, ["secrets", "add-iam-policy-binding", cred, "--project", ins.project,
        "--member", `serviceAccount:${res.service_account}`, "--role", "roles/secretmanager.secretAccessor", "--quiet", "--format", "none"], "secret");
    }

    // 6. The service, pinned by digest.
    const dir = deps.tmp();
    let deployed = {};
    try {
      const envFile = join(dir, "env.json");
      deps.writeFile(envFile, JSON.stringify(envFor(ins)));
      deployed = parse(must(deps, serviceDeployArgv(ins, res, build.pinned, envFile), "service", { timeout: 900_000 }));
    } finally {
      deps.rmdir(dir);
    }
    // An agent that wakes on message: the waker may call this service (in
    // the platform project, on this service alone), and the platform is told
    // the address it calls.
    let wakeUrl = null;
    if (ins.always_on === false) {
      if (!ins.tenant) ensureWakerBound(deps, ins, res, deps.settings ?? SETTINGS);
      wakeUrl = wakeUrlOf(deployed) ?? wakeUrlOf(parse(must(deps, ["run", "services", "describe", res.service, "--region", ins.region, "--project", ins.project, "--format", "json"], "service")));
      if (!wakeUrl) stop("service", "Cloud Run named no address for the service, so the platform could never wake it");
      row.wake = true;
      row.wake_url = wakeUrl;
    } else {
      row.wake = false;
      delete row.wake_url;
    }
    row.state = "service started";
    save(row);

    // 7. Ready: the agent's own ready line when it is always on; the wake
    // host's asleep line when it wakes on message (the agent itself starts at
    // its first wake, which the platform makes once it is told the address).
    const ready = await waitReady(ins.always_on === false ? { ...ins, ready_line: WAKE_ASLEEP_LINE } : ins, res, deps);
    const handle = updating ? before.handle : row.handle;
    const replaced = !updating && ins.replaces
      ? { key: ins.replaces, note: "the name now answers to this install's key; the old key is retired separately, as a planned retirement" }
      : null;

    const act = updating ? "update" : "deploy";
    const r = {
      act, image: build.image, image_digest: String(ready.running_digest ?? "").split("@").pop() || build.digest, build_id: build.id, build_record_sha256: bRecSha,
      revision: ready.revision, agent_key: key, handle, key_custody: custody, smoke: ready.smoke, replaced,
      ...(updating ? { previous: { commit: before.source.commit, image: before.image, image_digest: before.image_digest, revision: before.revision } } : {}),
    };
    const dRec = signRecord(deploymentRecord(ins, res, r, deps.now()), TAG, signer.sign, signer.by);
    const done = {
      ...row, state: "running", source: ins.source, image: build.pinned, image_digest: r.image_digest, revision: ready.revision,
      agent_key: key, handle, build_id: build.id, updated_at: deps.now(), claims: ins.claims, cpu: ins.cpu, memory: ins.memory,
      ...(ins.always_on === false ? { wake_idle_seconds: ins.wake_idle_seconds } : { always_on: ins.always_on === true }),
    };
    delete done.updating_to;
    save(done);
    deps.saveRecord(ins.name, "build", bRec);
    deps.saveRecord(ins.name, act, dRec);
    const how = ins.always_on === false ? "sleeps at no cost until mail waits for it, when the platform wakes it," : "is kept always on, as its owner asked,";
    return out({
      ok: true, act, name: ins.name, handle, agent_key: key, service: res.service, revision: ready.revision,
      image: build.pinned, image_digest: r.image_digest, build_id: build.id, provenance: build.provenance,
      source: ins.source, smoke: ready.smoke, ...(replaced ? { replaced } : {}),
      ...(wakeUrl ? { wake_url: wakeUrl, wake: true } : { wake: false }),
      build_record: bRec, record: dRec,
      state: updating ? `a new revision of ${res.service} runs ${ins.source.commit.slice(0, 12)} under the same key, and ${how.replace(/,$/, "")}` : `${handle} runs as ${res.service}, ${how} and answers to its own key`,
    });
  } catch (e) {
    if (!(e instanceof Stop)) e = new Stop("unexpected", String(e?.stack ?? e).slice(0, 600));
    let state = e.state ?? null;
    if (row) {
      const wasUpdate = row.state === "updating" || row.updating_to;
      if (wasUpdate) {
        const back = { ...row, state: "running" };
        delete back.updating_to;
        save(back);
        state = `${state ? `${state}; ` : ""}the update did not complete, and the revision that was serving before still serves`;
      } else {
        save({ ...row, state: `failed at ${e.step}` });
        state = `${state ? `${state}; ` : ""}${row.state === "installing" ? "nothing was started" : `left at "${row.state}"`}; run retire ${row.name} to clean`;
      }
    }
    const signer = (() => { try { return deps.signer(); } catch { return { by: "deployment-manager", sign: null }; } })();
    const refusal = signRecord({
      record: "v1", role: "deployment-manager", act: "refuse", instructed_by: ins?.instructed_by ?? "the owner",
      ...(ins ? { subject: { name: ins.name, handle: ins.handle }, source: ins.source } : {}),
      refused: { step: e.step, reason: String(e.message).slice(0, 800), state: state ?? "nothing created", attempted: "install" },
      produced_at: deps.now(), signatures: [],
    }, TAG, signer.sign, signer.by);
    if (ins) try { deps.saveRecord(ins.name, "refuse", refusal); } catch { /* the record is also in the answer */ }
    return out({ ok: false, act: "install", step: e.step, error: String(e.message).slice(0, 800), state: state ?? "nothing created", record: refusal });
  }
}

/** Retire the platform's side of a key: the door the deploy queue holds. */
async function retireKeyAt(key, reason, deps) {
  const bearer = deps.bearer();
  if (!bearer) return { ok: false, why: "this host holds no executor bearer" };
  try {
    const r = await deps.fetch(`${deps.settings.control}/deploy-requests/retire-key`, {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${bearer}` },
      body: JSON.stringify({ agent_key: key, reason }), signal: AbortSignal.timeout(60_000),
    });
    const body = await r.json().catch(() => ({}));
    return r.ok ? { ok: true, ...body } : { ok: false, why: body.error ?? `status ${r.status}` };
  } catch (e) {
    return { ok: false, why: e.message };
  }
}

/** Take an installed container agent down, completely, and say what is left. */
/** A tenant row is handled as the tenant deployer, the same as its install. */
function depsForRow(deps, row) {
  if (!row?.tenant) return deps;
  const deployer = (deps.settings ?? SETTINGS).tenant?.deployer;
  if (!deployer) throw new Stop("validate", `${row.name} runs for ${row.tenant}, and this host names no tenant deployer (DM_TENANT_DEPLOYER)`);
  return tenantDeps(deps, deployer);
}

export async function retire(name, reason, deps) {
  const signer = deps.signer();
  if (!NAME_RE.test(String(name))) return out({ ok: false, act: "remove", step: "validate", error: `bad name ${JSON.stringify(name)}` });
  const row = deps.inventory.load().find((x) => x.name === name);
  if (!row) return out({ ok: false, act: "remove", step: "validate", error: `${name} is not in the container service inventory` });
  try { deps = depsForRow(deps, row); } catch (e) { return out({ ok: false, act: "remove", step: e.step, error: e.message }); }
  const removed = [];
  const remaining = [];
  const quiet = (argv, what) => {
    const r = deps.gcloud(argv, { timeout: 600_000 });
    if (r.code === 0 || /NOT_FOUND|not found|could not be found|does not exist/i.test(r.stderr)) removed.push(what);
    else remaining.push(`${what} not removed: ${(r.stderr || "").trim().slice(-200)}`);
  };
  const where = ["--project", row.project];
  // The service first, so nothing holds the key while the rest goes.
  quiet(["run", "services", "delete", row.service, "--region", row.region, ...where, "--quiet"], `the Cloud Run service ${row.service}`);
  for (const img of row.images ?? []) quiet(["artifacts", "docker", "images", "delete", artifactRef(img), "--delete-tags", ...where, "--quiet"], `the image ${img}`);
  quiet(["secrets", "delete", row.secret, ...where, "--quiet"], `the secret ${row.secret}`);
  quiet(["iam", "service-accounts", "delete", row.service_account, ...where, "--quiet"], `the service account ${row.service_account}`);
  let key = null;
  if (row.agent_key) {
    key = await retireKeyAt(row.agent_key, reason || `retired by the deployment manager: ${name}`, deps);
    if (!key.ok) remaining.push(`the key ${row.agent_key.slice(0, 12)}... was not retired on the platform: ${key.why}`);
  }
  deps.inventory.save(deps.inventory.load().filter((x) => x.name !== name));
  const rec = signRecord({
    record: "v1", role: "deployment-manager", act: "remove", instructed_by: "the owner",
    subject: { name, kind: row.kind }, source: row.source,
    agent: { key: row.agent_key ?? null, handle: row.handle ?? null },
    target: { kind: "cloud-run-service", service: row.service, project: row.project, region: row.region },
    removed, remaining,
    ...(key?.ok ? { key: { retired: true, unlinked: key.unlinked, deregistered: key.deregistered, name_released: key.name_released, refused_renewal: key.credential_revoked, note: key.credential_note } } : {}),
    produced_at: deps.now(), signatures: [],
  }, TAG, signer.sign, signer.by);
  deps.saveRecord(name, "remove", rec);
  return out({ ok: remaining.length === 0, act: "remove", name, removed, remaining, key, record: rec });
}

/** Retire a key that has no install here: a platform agent that was run by
 *  hand before the lifecycle could install it, whose resources an operator
 *  removed. The platform's side only, on the record. */
export async function retireKey(key, reason, deps) {
  const signer = deps.signer();
  if (!NKEY_RE.test(String(key))) return out({ ok: false, act: "retire-key", step: "validate", error: "an agent key (U...) is required" });
  const r = await retireKeyAt(key, reason || "retired by the deployment manager", deps);
  const rec = signRecord({
    record: "v1", role: "deployment-manager", act: "retire-key", instructed_by: "the owner",
    agent: { key }, reason: reason || null,
    ...(r.ok ? { key: { retired: true, via: r.via, unlinked: r.unlinked, deregistered: r.deregistered, name_released: r.name_released, refused_renewal: r.credential_revoked, note: r.credential_note } } : { refused: { reason: r.why } }),
    produced_at: deps.now(), signatures: [],
  }, TAG, signer.sign, signer.by);
  deps.saveRecord(`key-${key.slice(0, 12).toLowerCase()}`, "retire-key", rec);
  return out({ ok: r.ok, act: "retire-key", agent_key: key, ...(r.ok ? { key: r } : { error: r.why }), record: rec });
}

/** Start an installed service again, on the image it already runs, as a new
 *  revision: for a program that must start afresh to pick something up (a
 *  name bound after it first started). Nothing is built and the key, the
 *  secret and the account are unchanged. Waits for it to be ready, and
 *  records it. */
export async function restart(name, reason, deps) {
  const signer = deps.signer();
  const row = deps.inventory.load().find((x) => x.name === name);
  if (!row || row.state !== "running") return out({ ok: false, act: "restart", step: "validate", error: `${name} is not a running install in the container service inventory` });
  try {
    deps = depsForRow(deps, row);
    const ins = { name, project: row.project, region: row.region, ready_line: row.wake ? WAKE_ASLEEP_LINE : row.ready_line ?? null };
    const res = { service: row.service };
    must(deps, ["run", "services", "update", row.service, "--region", row.region, "--project", row.project,
      "--update-labels", `restarted-at=${String(deps.now()).replace(/[^0-9]/g, "").slice(0, 14)}`, "--quiet", "--format", "none"], "restart", { timeout: 900_000 });
    const ready = await waitReady(ins, res, deps);
    const rec = signRecord({
      record: "v1", role: "deployment-manager", act: "restart", instructed_by: "the owner",
      subject: { name, kind: row.kind }, agent: { key: row.agent_key, handle: row.handle },
      target: { kind: "cloud-run-service", service: row.service, project: row.project, region: row.region, revision: ready.revision, previous_revision: row.revision },
      image_digest: String(ready.running_digest ?? "").split("@").pop() || null, reason: reason || null,
      checks: [{ kind: "smoke", passed: ready.smoke.passed, at: deps.now(), what: ready.smoke.what }],
      produced_at: deps.now(), signatures: [],
    }, TAG, signer.sign, signer.by);
    deps.inventory.save([...deps.inventory.load().filter((x) => x.name !== name), { ...row, revision: ready.revision, restarted_at: deps.now() }]);
    deps.saveRecord(name, "restart", rec);
    return out({ ok: true, act: "restart", name, revision: ready.revision, smoke: ready.smoke, record: rec });
  } catch (e) {
    return out({ ok: false, act: "restart", step: e.step ?? "unexpected", error: String(e.message).slice(0, 600), state: "the revision that was serving before still serves unless the new one became ready" });
  }
}

export function status(deps) {
  return out({ ok: true, act: "status", services: deps.inventory.load() });
}

// ── moving an installed agent to wake on message, and back ───────────────
//
// `sleep <name>` takes a container agent installed always on (before the
// wake) and puts it to sleep in place: the same service, account, secret, key
// and name. Its folder is built again at the same commit with the wake host
// on top, the service gets a new revision in the wake shape with the wake
// host's settings added to its own, the platform's waker may call it, and the
// platform is told the address. `keep-on <name>` is the owner's exception, and
// the way back: the image it ran before, always on, the waker's call removed.

/** The instruction an installed row stands for, for a new build of it. */
export function rowInstruction(row, s = SETTINGS, over = {}) {
  const registry = String(row.image ?? row.images?.[0] ?? "").replace(/\/[^/]+@sha256:[0-9a-f]{64}$/, "").replace(/\/[^/:]+:[^/]+$/, "");
  const t = s.tenant ?? tenantSettings({});
  const waker = row.tenant ? t.waker : (s.platform ?? platformSettings({})).waker;
  return {
    tenant: row.tenant ?? null, name: row.name, handle: row.handle, kind: row.kind, request_id: row.request_id ?? null,
    source: row.source, project: row.project, region: row.region, registry, cpu: row.cpu ?? "1", memory: row.memory ?? "512Mi",
    claims: row.claims ?? [], settings: {}, secrets: {}, ready_line: over.ready_line ?? row.ready_line ?? null,
    always_on: false, waker, wake_idle_seconds: over.wake_idle_seconds ?? row.wake_idle_seconds ?? 120, wake_max_seconds: 3300,
    instructed_by: "the owner", replaces: null,
    ...(row.tenant ? { network: t.network, subnet: t.subnet, deployer: t.deployer, builder: t.builder, egress: t.egress ?? null, worker_pool: t.worker_pool || null }
      : platformBuilder(s, row.project) ? { builder: platformBuilder(s, row.project) } : {}),
  };
}

/** The platform's build account, when the host names a valid one of the
 *  project the build runs in. One of another project would need an
 *  organization policy these projects lack, so it is not used. */
export function platformBuilder(s = SETTINGS, project = "") {
  const b = String((s.platform ?? {}).builder ?? "");
  return SA_EMAIL_RE.test(b) && project && b.endsWith(`@${project}.iam.gserviceaccount.com`) ? b : "";
}

/** The argv that moves a running service to the wake shape, keeping every
 *  setting and secret it has and adding the wake host's own. */
export function sleepUpdateArgv(ins, res, pinned) {
  const env = wakeEnvFor(ins);
  return ["run", "services", "update", res.service, "--image", pinned, "--region", ins.region, "--project", ins.project,
    ...WAKE_SHAPE_ARGV.filter((a) => a !== "--no-allow-unauthenticated"),
    "--update-env-vars", `^|^${Object.entries(env).map(([k, v]) => `${k}=${v}`).join("|")}`,
    "--update-labels", WAKE_LABEL,
    "--format", "json", "--quiet"];
}

/** The argv that keeps a service always on again, on an image it ran before. */
export function keepOnUpdateArgv(row, image) {
  return ["run", "services", "update", row.service, "--image", image, "--region", row.region, "--project", row.project,
    ...ALWAYS_ON_ARGV.filter((a) => a !== "--no-allow-unauthenticated"),
    "--remove-env-vars", "WAKE_BY,WAKE_IDLE_SECONDS,WAKE_MAX_SECONDS,WAKE_READY_LINE",
    "--remove-labels", "wake",
    "--format", "json", "--quiet"];
}

/** Tell the platform the address its waker calls for an agent key, or that
 *  there is none any more (null). Asked again while the platform restarts. */
export async function tellWake(key, wakeUrl, deps) {
  const bearer = deps.bearer();
  if (!bearer) return { ok: false, why: "this host holds no executor bearer" };
  let why = "";
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const r = await deps.fetch(`${deps.settings.control}/deploy-requests/wake`, {
        method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${bearer}` },
        body: JSON.stringify({ agent_key: key, wake_url: wakeUrl }), signal: AbortSignal.timeout(60_000),
      });
      if (![502, 503, 504].includes(r.status)) {
        const body = await r.json().catch(() => ({}));
        return r.ok ? { ok: true, ...body } : { ok: false, why: body.error ?? `status ${r.status}` };
      }
      why = `the platform answered ${r.status}`;
    } catch (e) {
      why = `the platform could not be reached: ${e.message}`;
    }
    await deps.sleep(15_000);
  }
  return { ok: false, why: `${why}, for five minutes` };
}

export async function sleepInPlace(name, opts, deps) {
  const signer = deps.signer();
  const row = deps.inventory.load().find((x) => x.name === name);
  if (!row || row.state !== "running" || !row.agent_key) return out({ ok: false, act: "sleep", step: "validate", error: `${name} is not a running install in the container service inventory` });
  if (row.wake) return out({ ok: false, act: "sleep", step: "validate", error: `${name} already wakes on message (${row.wake_url})` });
  if (row.kind === "package") return out({ ok: false, act: "sleep", step: "validate", error: `${name} is a person's package, which sleeps from its install` });
  const save = (r) => deps.inventory.save([...deps.inventory.load().filter((x) => x.name !== r.name), r]);
  try {
    if (opts.ready_line !== undefined && (String(opts.ready_line).length > 120 || /["\\\n]/.test(String(opts.ready_line)))) stop("validate", "the ready line is one short line with no quotes or backslashes");
    if (opts.wake_idle_seconds !== undefined && !(Number.isInteger(opts.wake_idle_seconds) && opts.wake_idle_seconds >= 30 && opts.wake_idle_seconds <= 900)) stop("validate", "the idle window is 30 to 900 seconds");
    const ins = rowInstruction(row, deps.settings ?? SETTINGS, opts);
    if (!SA_EMAIL_RE.test(ins.waker ?? "")) stop("validate", `this host names no ${row.tenant ? "tenant" : "platform"} waker (${row.tenant ? "DM_TENANT_WAKER" : "DM_PLATFORM_WAKER"}), so nothing could wake ${name}`);
    if (!REGISTRY_RE.test(ins.registry)) stop("validate", `the registry could not be read off ${row.image}`);
    deps = depsForRow(deps, row);
    const res = resourcesFor(ins);
    // 1. The folder at the same commit, with the wake host on top.
    const build = await buildInCloud(ins, deps);
    save({ ...row, images: [...new Set([...(row.images ?? []), build.pinned])] });
    const bRec = signRecord(buildRecord(ins, build, deps.now()), BUILD_TAG, signer.sign, signer.by);
    // 2. The waker may call it, and nobody else is added: first, so an agent
    // is never left asleep with nobody able to wake it.
    if (!ins.tenant) ensureWakerBound(deps, ins, res, deps.settings ?? SETTINGS);
    // 3. A new revision in the wake shape, its settings and secret kept.
    const svc = parse(must(deps, sleepUpdateArgv(ins, res, build.pinned), "service", { timeout: 900_000 }));
    const wakeUrl = wakeUrlOf(svc) ?? wakeUrlOf(parse(must(deps, ["run", "services", "describe", res.service, "--region", ins.region, "--project", ins.project, "--format", "json"], "service")));
    if (!wakeUrl) stop("service", "Cloud Run named no address for the service, so the platform could never wake it");
    // 4. Asleep: the wake host started and waits.
    const ready = await waitReady({ ...ins, ready_line: WAKE_ASLEEP_LINE }, res, deps);
    const after = {
      ...deps.inventory.load().find((x) => x.name === name), wake: true, wake_url: wakeUrl, image: build.pinned, image_digest: String(ready.running_digest ?? "").split("@").pop() || build.digest,
      revision: ready.revision, build_id: build.id, ready_line: ins.ready_line, wake_idle_seconds: ins.wake_idle_seconds, always_on_image: row.image, slept_at: deps.now(),
    };
    save(after);
    // 5. The platform is told the address, so its waker takes the agent on.
    const told = await tellWake(row.agent_key, wakeUrl, deps);
    const rec = signRecord({
      record: "v1", role: "deployment-manager", act: "sleep", instructed_by: "the owner",
      subject: { name, kind: row.kind }, agent: { key: row.agent_key, handle: row.handle }, source: row.source,
      image: build.image, image_digest: after.image_digest, build: { id: build.id, record_sha256: createHash("sha256").update(canonical(bRec)).digest("hex") },
      target: { kind: "cloud-run-service", service: row.service, project: row.project, region: row.region, revision: ready.revision, previous_revision: row.revision,
        shape: { min_instances: 0, max_instances: 1, cpu_always_allocated: false, ingress: "all", unauthenticated: false,
          wake: { by: ins.waker, idle_seconds: ins.wake_idle_seconds, max_seconds: ins.wake_max_seconds, request_seconds: 3600 } } },
      previous: { image: row.image, image_digest: row.image_digest ?? null, shape: "always on (min 1, CPU always allocated, internal ingress)" },
      ...egressPart({ tenant: row.tenant, egress: ins.egress }),
      platform_told: told.ok ? { ok: true } : { ok: false, why: told.why },
      checks: [{ kind: "smoke", passed: ready.smoke.passed, at: deps.now(), what: ready.smoke.what }],
      produced_at: deps.now(), signatures: [],
    }, TAG, signer.sign, signer.by);
    deps.saveRecord(name, "build", bRec);
    deps.saveRecord(name, "sleep", rec);
    return out({ ok: told.ok, act: "sleep", name, handle: row.handle, agent_key: row.agent_key, wake_url: wakeUrl, revision: ready.revision, image: build.pinned,
      build_id: build.id, smoke: ready.smoke, ...(told.ok ? {} : { error: `asleep, but the platform was not told its address: ${told.why}; run sleep again or tell it by hand` }), record: rec,
      state: `${row.handle} sleeps at no cost as ${row.service} and answers to the same key; the platform wakes it when mail waits` });
  } catch (e) {
    if (!(e instanceof Stop)) e = new Stop("unexpected", String(e?.stack ?? e).slice(0, 600));
    return out({ ok: false, act: "sleep", step: e.step, error: String(e.message).slice(0, 800), state: "the revision that was serving before still serves unless the new one became ready" });
  }
}

export async function keepOn(name, reason, deps) {
  const signer = deps.signer();
  const row = deps.inventory.load().find((x) => x.name === name);
  if (!row || row.state !== "running" || !row.agent_key) return out({ ok: false, act: "keep-on", step: "validate", error: `${name} is not a running install in the container service inventory` });
  if (row.tenant) return out({ ok: false, act: "keep-on", step: "validate", error: "a person's agent sleeps between messages and is woken by the platform; it cannot be kept always on" });
  if (!row.wake) return out({ ok: false, act: "keep-on", step: "validate", error: `${name} is already kept on` });
  const image = row.always_on_image;
  if (!image) return out({ ok: false, act: "keep-on", step: "validate", error: `${name} has no image from before its wake to run always on; install it again with always_on` });
  try {
    // The platform first, so its waker stops calling before the shape changes.
    const told = await tellWake(row.agent_key, null, deps);
    if (!told.ok) stop("platform", `the platform was not told to stop waking it: ${told.why}`);
    must(deps, keepOnUpdateArgv(row, image), "service", { timeout: 900_000 });
    const waker = (deps.settings ?? SETTINGS).platform?.waker;
    if (waker) deps.gcloud(["run", "services", "remove-iam-policy-binding", row.service, "--region", row.region, "--project", row.project,
      "--member", `serviceAccount:${waker}`, "--role", wakerRoleOf(row, deps.settings ?? SETTINGS), "--quiet", "--format", "none"]);
    const ready = await waitReady({ name, project: row.project, region: row.region, ready_line: row.ready_line ?? null }, { service: row.service }, deps);
    const after = { ...row, wake: false, always_on: true, image, revision: ready.revision, image_digest: String(ready.running_digest ?? "").split("@").pop() || null, kept_on_at: deps.now() };
    delete after.wake_url;
    deps.inventory.save([...deps.inventory.load().filter((x) => x.name !== name), after]);
    const rec = signRecord({
      record: "v1", role: "deployment-manager", act: "keep-on", instructed_by: "the owner", reason: reason || null,
      subject: { name, kind: row.kind }, agent: { key: row.agent_key, handle: row.handle },
      target: { kind: "cloud-run-service", service: row.service, project: row.project, region: row.region, revision: ready.revision, previous_revision: row.revision,
        shape: { min_instances: 1, max_instances: 1, cpu_always_allocated: true, ingress: "internal", unauthenticated: false, always_on: "kept on by the owner" } },
      image,
      ...egressPart(row),
      checks: [{ kind: "smoke", passed: ready.smoke.passed, at: deps.now(), what: ready.smoke.what }],
      produced_at: deps.now(), signatures: [],
    }, TAG, signer.sign, signer.by);
    deps.saveRecord(name, "keep-on", rec);
    return out({ ok: true, act: "keep-on", name, revision: ready.revision, image, smoke: ready.smoke, record: rec, state: `${row.handle} runs always on again, as its owner asked` });
  } catch (e) {
    if (!(e instanceof Stop)) e = new Stop("unexpected", String(e?.stack ?? e).slice(0, 600));
    return out({ ok: false, act: "keep-on", step: e.step, error: String(e.message).slice(0, 800) });
  }
}

// ── a person's own PACKAGE, in the tenant project (technical debt 95) ─────
//
// docs/tenant-isolation-plan.md, "A person's own agent in the tenant project".
// Prompt to prod packs a person's new agent as a package. The host procedure
// (deploymgr-steps.py) places packages on the fleet in the platform project
// and refuses one that names a tenant; this is the one place a package with a
// tenant is placed, and it places it only in the tenant project:
//
//   1. the package is fetched and its digest checked before anything is read;
//   2. the build context is the package's own one-message image
//      (emit-image.mjs, against the TENANT catalogue, whose one base carries
//      the adapter and no harness) with the tenant host layer on top: the
//      adapter, the fleet supervisor and the work in one container, under
//      three users (image/tenant-host.mjs);
//   3. it is built in Cloud Build in the tenant project, as tenant-builder,
//      from source uploaded as tenant-deployer;
//   4. then as for a container agent: its own account, its key traded from the
//      approval's single-use agent key (which binds its name), the key into
//      its own secret, the service on tenant-vpc under the agent tag, and the
//      line the tenant host prints once it has read its key. The service
//      scales to zero: min 0, max 1, CPU billed only while a request is
//      open, and the platform wakes it with a signed request when mail waits
//      ("Wake on message" in the plan), so an idle agent costs nothing.
//
// The package is given no credential, setting, ceiling or tool address: a
// person's agent in the sandbox has only its own key, and reaches a model
// through the mesh's model door. A package that asks for any of those, or
// whose work wakes a harness, is refused in words before anything exists.

/** The line the tenant host prints once it has read its own key and waits
 *  to be woken (the adapter starts only on a wake). */
export const TENANT_READY_LINE = "tenant host: asleep";
/** The line the wake host prints once its container started and waits to be
 *  woken (image/wake-host.mjs ASLEEP_LINE). */
export const WAKE_ASLEEP_LINE = "wake host: asleep";
/** The label every person's agent carries: it is woken by the platform. */
export const WAKE_LABEL = "wake=platform";
/** Cloud Run's request limit, which one wake may use to the full. */
export const WAKE_REQUEST_SECONDS = 3600;
/** Where the tenant image's files are kept on this host: the emitter and its
 *  companions, the tenant host, the supervisor, and the tenant catalogue. */
export const TENANT_IMAGE_FILES = ["emit-image.mjs", "one-message.mjs", "check-lockfile.mjs", "tenant-host.mjs", "supervisor.mjs", "bases/tenant-catalogue.json"];
const SHA_RE = /^[0-9a-f]{64}$/;
const VERSION_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]{1,40})?$/;
const PACKAGE_NAME_RE = /^[a-z][a-z0-9-]{1,62}[a-z0-9]$/;

/** The instruction for a person's package, read and refused in words. */
export function readPackageInstruction(args, s = SETTINGS) {
  const a = args && typeof args === "object" ? args : {};
  const tenant = String(a.tenant ?? "");
  if (!tenant) stop("validate", "install-package places a person's own agent in the tenant project and nowhere else, and this instruction names no tenant");
  if (!TENANT_RE.test(tenant)) stop("validate", "tenant must be the tenant id the platform set, t- and letters or digits");
  const t = s.tenant ?? tenantSettings({});
  if (!t.project || !t.registry || !t.deployer || !t.builder) {
    stop("validate", "a person's agent runs only in the tenant project, and this host names none (DM_TENANT_PROJECT, DM_TENANT_REGISTRY, DM_TENANT_DEPLOYER, DM_TENANT_BUILDER)");
  }
  if (!SA_EMAIL_RE.test(t.deployer) || !SA_EMAIL_RE.test(t.builder)) stop("validate", "DM_TENANT_DEPLOYER and DM_TENANT_BUILDER must be service account addresses");
  // A person's agent sleeps between messages and is woken by the platform's
  // waker only; with none named it could never be woken, so nothing is made.
  if (!SA_EMAIL_RE.test(t.waker ?? "")) stop("validate", "a person's agent is woken by the platform when mail waits for it, and this host names no waker (DM_TENANT_WAKER)");
  tenantPoolProblem(t);
  for (const k of ["credentials", "settings", "addresses", "ceilings", "secrets"]) {
    if (a[k] && typeof a[k] === "object" && Object.keys(a[k]).length) {
      stop("validate", `a person's agent in the tenant sandbox is given no ${k}: it has only its own key, and reaches a model through the mesh's model door`);
    }
  }
  if (a.cloud) stop("validate", "a person's agent runs in the tenant project, not in a customer's own project");
  const name = String(a.name ?? "");
  if (!NAME_RE.test(name)) stop("validate", `bad name ${JSON.stringify(name)}: lowercase letters, digits and hyphens, at most 24, because the service account is named after it`);
  const handle = String(a.handle ?? "").toLowerCase();
  if (!HANDLE_RE.test(handle) || !handle.startsWith(`${name}.`)) stop("validate", "handle must be the agent's full name, <name>.<email>");
  if (!RID_RE.test(String(a.request_id ?? ""))) stop("validate", "request_id must be the deploy request's id");
  const url = String(a.package_url ?? "");
  if (!/^https:\/\/[a-z0-9.-]+\/v1\/deploy-requests\/dr_[A-Za-z0-9_-]{8,64}\/package\.tar\.gz$/.test(url)) {
    stop("validate", "package_url must be the deploy request's own package.tar.gz on the platform");
  }
  const sha256 = String(a.sha256 ?? "").toLowerCase();
  if (!SHA_RE.test(sha256)) stop("validate", "sha256 must be the package's hex digest, which the platform checked at filing");
  const boot = String(a.boot_token ?? "");
  if (!TOKEN_NAME_RE.test(boot)) stop("validate", "boot_token must be a token NAME in the store, never a value");
  const interaction = a.interaction === "interactive" ? "interactive" : "service";
  const admit = Array.isArray(a.admit) ? a.admit.map((h) => String(h).toLowerCase()) : [];
  if (admit.some((h) => !HANDLE_RE.test(h)) || admit.length > 12) stop("validate", "admit must be a list of at most twelve handles");
  return {
    tenant, kind: "package", name, handle, request_id: String(a.request_id), package_url: url, sha256,
    boot_token: boot, interaction, admit,
    project: t.project, region: t.region, registry: t.registry, network: t.network, subnet: t.subnet, deployer: t.deployer, builder: t.builder,
    egress: t.egress ?? null,
    worker_pool: t.worker_pool || null, npm_registry: t.worker_pool ? t.npm_registry : null,
    waker: t.waker, wake_idle_seconds: t.wake_idle_seconds ?? 120, wake_max_seconds: t.wake_max_seconds ?? 3300,
    cpu: "1", memory: "1Gi", claims: [], settings: {}, secrets: {}, ready_line: TENANT_READY_LINE,
    instructed_by: String(a.instructed_by ?? "the owner").slice(0, 200),
    source: { package_url: url, sha256 },
  };
}

/** The names of what one package install makes, as for a container agent,
 *  with the image tagged by the package's version and digest. */
export function packageResources(ins, version) {
  const tag = `${String(version).replace(/[^0-9A-Za-z._-]/g, "-").slice(0, 40)}-${ins.sha256.slice(0, 12)}`;
  const base = resourcesFor({ ...ins, source: { commit: "0".repeat(40) } });
  return { ...base, image: `${ins.registry}/${ins.name}:${tag}` };
}

/**
 * A .tar.gz read into memory and checked: regular files and folders only,
 * every path inside one top folder, nothing absolute and nothing that climbs.
 * No process is started for it (gcloud has the one door in this file). The
 * formats a package is written in are ustar with pax headers (Python's
 * tarfile) and GNU long names; anything else is refused by type.
 */
export function readTarball(gz) {
  const buf = gunzipSync(gz);
  const files = [];
  const dirs = new Set();
  let longName = null;
  let paxPath = null;
  const str = (b, o, n) => { const s = b.subarray(o, o + n); const z = s.indexOf(0); return (z >= 0 ? s.subarray(0, z) : s).toString("utf8"); };
  for (let off = 0; off + 512 <= buf.length;) {
    const h = buf.subarray(off, off + 512);
    if (h.every((x) => x === 0)) break;
    const size = parseInt(str(h, 124, 12).trim() || "0", 8);
    const type = String.fromCharCode(h[156] || 48);
    const prefix = str(h, 345, 155);
    let name = paxPath ?? longName ?? (prefix ? `${prefix}/${str(h, 0, 100)}` : str(h, 0, 100));
    const body = buf.subarray(off + 512, off + 512 + size);
    off += 512 + Math.ceil(size / 512) * 512;
    if (type === "x") {
      const m = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(body.toString("utf8"));
      paxPath = m ? m[1] : null;
      continue;
    }
    if (type === "g") continue;
    if (type === "L") { longName = str(body, 0, body.length); continue; }
    paxPath = null; longName = null;
    name = name.replace(/^\.\//, "").replace(/\/+$/, "");
    if (!name) continue;
    if (name.startsWith("/") || name.split("/").some((p) => p === ".." || p === "")) throw new Error(`the package holds a path that leaves it: ${name}`);
    if (type === "5") { dirs.add(name); continue; }
    if (type !== "0" && type !== "\0" && type !== "7") throw new Error(`the package holds ${type === "2" || type === "1" ? "a link" : "something that is not a file"}: ${name}`);
    files.push({ path: name, bytes: Buffer.from(body) });
  }
  const tops = new Set([...files.map((f) => f.path), ...dirs].map((p) => p.split("/")[0]));
  if (tops.size !== 1) throw new Error(`a package holds one top folder, and this one holds ${tops.size}`);
  return { top: [...tops][0], files };
}

/** The tenant host layer, added to the end of the package's own Dockerfile. */
export function tenantLayer() {
  return [
    "",
    "# ── The tenant host (docs/tenant-isolation-plan.md) ──────────────────────",
    "# A person's own agent in the tenant project: the adapter (as mesh, holding",
    "# the key), the fleet supervisor with a roster of one (as root), and the work",
    "# (as agent, never given the key), in one container that sleeps until the",
    "# platform wakes it for mail. It",
    "# reaches the mesh and nothing else, and its model through the mesh.",
    "USER root",
    "RUN set -eu ; \\",
    "    command -v agentmesh >/dev/null || { echo \"the base has no mesh adapter, and a person's agent is served by one\" >&2 ; exit 1 ; } ; \\",
    "    groupadd -g 10002 mesh ; \\",
    "    useradd -u 10002 -g mesh -d /home/mesh -m -s /usr/sbin/nologin mesh ; \\",
    "    mkdir -p /opt/tenant /var/agent-state /tmp/mesh",
    "COPY tenant/ /opt/tenant/",
    "ENTRYPOINT [\"node\", \"/opt/tenant/tenant-host.mjs\"]",
    "",
  ].join("\n");
}

/** What the tenant host needs to know about the package, written at build. */
export function tenantFacts(pkg, record) {
  const ext = pkg.manifest?.extensions?.["net.agentdoc.package"] ?? {};
  const rel = (p) => (typeof p === "string" && !p.startsWith("/") && !p.split(/[\\/]/).includes("..") ? p : null);
  return {
    // The file the emitter read the draft from: agent-descriptor.json, or
    // descriptor.json in a package from before Common Agent 0.30.0-draft.
    descriptor: rel(ext.descriptor?.path) ?? rel(pkg.paths?.descriptor) ?? "descriptor.json",
    answer_piece: typeof pkg.install?.answer?.piece === "string" ? pkg.install.answer.piece : null,
    verify: null,
    wants_replies: pkg.install?.wants_replies === true,
    job_seconds: Number.isInteger(pkg.install?.job_seconds) ? pkg.install.job_seconds : null,
    // The two a command may name ({records}, {work}) when the install file
    // declares none, as the host install makes them (steps.py deploy).
    directories: (() => { const d = (record?.directories ?? []).map((x) => x.name).filter(Boolean); return d.length ? d : ["records", "work"]; })(),
    kind: "program",
  };
}

/**
 * The service for a person's package (docs/tenant-isolation-plan.md, "Wake on
 * message"): the container agent's network and identity, but asleep until the
 * platform wakes it. No instance runs while nobody writes to it (min 0, max
 * 1), and CPU is billed only while a request is open (throttled otherwise),
 * so an idle agent costs nothing. The wake is a request, so the service keeps
 * its run.app address and takes traffic from outside the tenant network; IAM
 * lets through only a request signed for an account holding run.routes.invoke,
 * which in this project is the platform's waker alone, and Cloud Run refuses
 * anything else before an instance starts. The key is one environment variable
 * the tenant host reads once.
 */
export function packageServiceDeployArgv(ins, res, pinned, envFile) {
  return ["run", "deploy", res.service, "--image", pinned, "--region", ins.region, "--project", ins.project,
    "--service-account", res.service_account,
    "--min-instances", "0", "--max-instances", "1", "--cpu-throttling", "--cpu-boost",
    "--cpu", ins.cpu, "--memory", ins.memory, "--concurrency", "10", "--timeout", String(WAKE_REQUEST_SECONDS),
    "--ingress", "all", "--no-allow-unauthenticated",
    ...tenantNetworkArgv(ins, { address: true }),
    "--set-secrets", `AGENTMESH_CREDENTIALS_JSON=${res.secret}:latest`,
    "--env-vars-file", envFile,
    "--labels", `${labelsFor(ins)},${WAKE_LABEL}`,
    "--format", "json", "--quiet"];
}

export function packageEnvFor(ins) {
  return {
    TENANT_AGENT_NAME: ins.name,
    TENANT_AGENT_HANDLE: ins.handle,
    TENANT_WAKER: ins.waker,
    TENANT_WAKE_IDLE_SECONDS: String(ins.wake_idle_seconds),
    TENANT_WAKE_MAX_SECONDS: String(ins.wake_max_seconds),
    ...(ins.admit.length ? { TENANT_ADMIT: ins.admit.join(",") } : {}),
  };
}

/** The Cloud Build config for a person's package: the context this host
 *  assembled, uploaded, built as tenant-builder, provenance asked for. */
export function packageBuildConfig(ins, image, version) {
  const labels = [
    "--label", `net.agentmesh.package=${ins.name}@${version}`,
    "--label", `net.agentmesh.package-sha256=${ins.sha256}`,
    "--label", `net.agentmesh.handle=${ins.handle}`,
    "--label", `net.agentmesh.tenant=${ins.tenant}`,
  ];
  const tail = {
    images: [image],
    options: { requestedVerifyOption: "VERIFIED", logging: "CLOUD_LOGGING_ONLY" },
    tags: ["deploymgr", `agent-${ins.name}`, ins.tenant],
  };
  if (!ins.worker_pool) {
    return { steps: [{ name: "gcr.io/cloud-builders/docker", args: ["build", ...labels, "-t", image, "."] }], ...tail };
  }
  // The tenant build pool has no internet, so npm installs from the tenant
  // mirror (technical debt 72). The first step writes npm's user config (the
  // mirror and the build account's own short-lived token, from the build's
  // metadata server) into a volume outside the build context; the build
  // mounts it as a secret for the npm install alone (emit-image npmSecret),
  // so it is in no layer, no file of the context and no log.
  const mirror = String(ins.npm_registry);
  if (!NPM_MIRROR_RE.test(mirror)) throw new Error("the tenant build pool needs the tenant npm mirror's address");
  const auth = mirror.replace(/^https:/, "");
  const volumes = [{ name: "npm-secret", path: "/npm-secret" }];
  const script = [
    "set -eu",
    "umask 077",
    "T=$$(curl -sSf -H 'Metadata-Flavor: Google' http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token | sed -E 's/.*\"access_token\": *\"([^\"]+)\".*/\\1/')",
    "[ -n \"$$T\" ] || { echo 'no token for the npm mirror' >&2 ; exit 1 ; }",
    `printf 'registry=%s\\n%s:_authToken=%s\\n' '${mirror}' '${auth}' "$$T" > /npm-secret/npmrc`,
    "chmod 0444 /npm-secret/npmrc",
  ].join("\n");
  return {
    steps: [
      { name: "gcr.io/cloud-builders/docker", entrypoint: "bash", args: ["-c", script], volumes },
      { name: "gcr.io/cloud-builders/docker", env: ["DOCKER_BUILDKIT=1"], volumes,
        args: ["build", "--secret", `id=${NPM_SECRET_ID},src=/npm-secret/npmrc`, ...labels, "-t", image, "."] },
    ],
    ...tail,
  };
}

/** The build secret a tenant package's npm install reads its registry from. */
export const NPM_SECRET_ID = "npmrc";

/** Where a tenant build runs: the tenant build pool when this host names one
 *  (technical debt 72), and Cloud Build's shared pool otherwise. */
const poolArgv = (ins) => (ins.worker_pool ? ["--worker-pool", ins.worker_pool] : []);

export function packageBuildSubmitArgv(ins, ctx, configPath) {
  return ["builds", "submit", ctx, "--config", configPath, "--project", ins.project, "--region", ins.region,
    ...poolArgv(ins),
    "--service-account", `projects/${ins.project}/serviceAccounts/${ins.builder}`,
    // The source goes to the project's own regional build bucket by name: the
    // deployer may write objects there, and the default-bucket check, which
    // needs more than that, is refused to it.
    `--gcs-source-staging-dir=gs://${ins.project}_${ins.region}_cloudbuild/source`,
    "--async", "--format", "json", "--quiet"];
}

/** The service's run.app address from a Cloud Run service's description. */
export function wakeUrlOf(svc) {
  const u = String(svc?.status?.url ?? svc?.uri ?? "");
  return /^https:\/\/[a-z0-9-]+\.(?:[a-z0-9-]+\.)?run\.app$/.test(u) ? u : null;
}

/** Fetch the package from the platform's queue, with this host's bearer, and
 *  check its digest before anything else looks at it. */
async function fetchPackage(ins, deps) {
  let r;
  try {
    r = await deps.fetch(ins.package_url, { headers: { authorization: `Bearer ${deps.bearer()}` }, signal: AbortSignal.timeout(120_000) });
  } catch (e) {
    stop("fetch", `the package could not be fetched: ${e.message}`);
  }
  if (!r.ok) stop("fetch", `the package could not be fetched: the platform answered ${r.status}`);
  const bytes = Buffer.from(await r.arrayBuffer());
  const got = createHash("sha256").update(bytes).digest("hex");
  if (got !== ins.sha256) stop("fetch", `the bytes fetched hash to ${got}, not the digest the platform checked at filing; nothing was read`);
  return bytes;
}

/** Unpack, read and emit: the build context on disk, and what it holds. */
async function packageContext(ins, bytes, deps) {
  const dir = deps.tmp();
  let tar;
  try { tar = readTarball(bytes); } catch (e) { stop("verify", e.message); }
  for (const f of tar.files) {
    const p = join(dir, "pkg", f.path);
    mkdirSync(dirname(p), { recursive: true });
    deps.writeFile(p, f.bytes);
  }
  const imageDir = deps.settings.tenantImageDir;
  let emitter;
  try { emitter = await deps.importModule(join(imageDir, "emit-image.mjs")); } catch (e) { stop("emit", `the image emitter is not on this host (${imageDir}): ${e.message}`); }
  const pkgDir = join(dir, "pkg", tar.top);
  let pkg;
  try { pkg = emitter.readPackage(pkgDir); } catch (e) { stop("verify", `the package does not hold together: ${e.message}`); }
  const needs = emitter.requiredVariables(pkg.install);
  const asks = [
    ...needs.credentials.map((c) => `a credential for ${c.name}`), ...needs.settings.map((c) => `the setting ${c.env}`),
    ...needs.ceilings.map((c) => `a spending ceiling for ${c.name}`), ...needs.mcp.map((c) => `a tool address for ${c.name}`),
  ];
  if (asks.length) stop("verify", `${pkg.name} asks for ${asks.join(", ")}, and a person's agent in the tenant sandbox is given none: it has only its own key and the mesh's model door`);
  if (emitter.needsHarness(pkg.install, { packageName: pkg.name })) {
    stop("verify", `${pkg.name} leaves some of its work to a harness, and the tenant sandbox runs none yet; each of its jobs needs a command of its own`);
  }
  const ctx = join(dir, "ctx");
  let emitted;
  try {
    emitted = emitter.emit(pkgDir, ctx, { bases: join(imageDir, "bases", "tenant-catalogue.json"), force: true,
      ...(ins.worker_pool ? { npmSecret: NPM_SECRET_ID } : {}) });
  } catch (e) {
    stop("emit", `the package could not be turned into an image for the tenant sandbox: ${e.message}`);
  }
  mkdirSync(join(ctx, "tenant"), { recursive: true });
  for (const f of ["tenant-host.mjs", "supervisor.mjs"]) deps.writeFile(join(ctx, "tenant", f), deps.readFile(join(imageDir, f)));
  deps.writeFile(join(ctx, "tenant", "tenant.json"), JSON.stringify(tenantFacts(pkg, emitted.record), null, 2));
  deps.writeFile(join(ctx, "Dockerfile"), `${deps.readFile(join(ctx, "Dockerfile"))}${tenantLayer()}`);
  return { dir, ctx, pkg, emitted };
}

/** Build the context in Cloud Build in the tenant project and follow it. */
async function buildPackageInCloud(ins, res, version, ctx, deps) {
  const cfg = join(dirname(ctx), "cloudbuild.json");
  deps.writeFile(cfg, JSON.stringify(packageBuildConfig(ins, res.image, version)));
  const submitted = parse(must(deps, packageBuildSubmitArgv(ins, ctx, cfg), "build", { timeout: 600_000 }));
  const id = submitted.id ?? submitted.metadata?.build?.id;
  if (!id) stop("build", "the build was submitted and gcloud named no build id, so nothing can be followed or recorded");
  const deadline = Date.now() + deps.settings.buildMinutes * 60_000;
  const done = new Set(["SUCCESS", "FAILURE", "TIMEOUT", "CANCELLED", "EXPIRED", "INTERNAL_ERROR"]);
  let b = {};
  for (;;) {
    b = parse(must(deps, ["builds", "describe", id, "--project", ins.project, "--region", ins.region, "--format", "json"], "build"));
    if (done.has(b.status)) break;
    if (Date.now() > deadline) stop("build", `build ${id} is still ${b.status} after ${deps.settings.buildMinutes} minutes; nothing was recorded`, `build ${id} is still running`);
    await deps.sleep(15_000);
  }
  if (b.status !== "SUCCESS") stop("build", `build ${id} ended ${b.status}: ${String(b.statusDetail ?? "").slice(0, 300)}. Its log is ${b.logUrl ?? "in Cloud Build"}.`);
  const digest = b.results?.images?.[0]?.digest;
  if (!DIGEST_RE.test(digest ?? "")) stop("build", `build ${id} reported ${JSON.stringify(digest)}, which is not an image digest`);
  const pinned = `${res.image.split(":")[0]}@${digest}`;
  return { id, image: res.image, digest, pinned, log_url: b.logUrl ?? null,
    provenance: { attached: false, why: "a build from uploaded source is not tied to a repository commit; the package's digest is in the image's labels and in this record", verify_option: "VERIFIED" } };
}

/** One install of a person's package, start to finish (see the section's head). */
export async function installPackage(args, deps) {
  let ins;
  let row = null;
  let work = null;
  const rows = () => deps.inventory.load();
  const save = (r) => deps.inventory.save([...rows().filter((x) => x.name !== r.name), r]);
  try {
    ins = readPackageInstruction(args, deps.settings ?? SETTINGS);
    const before = rows().find((x) => x.name === ins.name) ?? null;
    if (before) stop("validate", `${ins.name} is already in the inventory (${before.state}); a person's agent is installed once here, and a new version of it is not built yet`);
    const over = checkTenantLimits(ins, rows(), (deps.settings ?? SETTINGS).tenant.limits);
    if (over) stop("limits", `refused: ${over}`);
    deps = tenantDeps(deps, ins.deployer);

    // 1 and 2. The package, checked and turned into the tenant image's context.
    const bytes = await fetchPackage(ins, deps);
    work = await packageContext(ins, bytes, deps);
    const version = work.pkg.version || "0.0.0";
    if (!VERSION_RE.test(version) || !PACKAGE_NAME_RE.test(work.pkg.name)) stop("verify", "the package's name or version is not one this host can tag an image with");
    const res = packageResources(ins, version);
    ins.source = { package: work.pkg.name, version, sha256: ins.sha256, package_url: ins.package_url };
    const now = deps.now();
    row = { name: ins.name, handle: ins.handle, kind: "package", request_id: ins.request_id, project: ins.project, region: ins.region,
      service: res.service, service_account: res.service_account, secret: res.secret, source: ins.source, images: [],
      claims: [], ready_line: TENANT_READY_LINE, state: "installing", installed_at: now, tenant: ins.tenant, cpu: ins.cpu, memory: ins.memory, wake: true };
    save(row);

    // 3. The image, built in the tenant project.
    const build = await buildPackageInCloud(ins, res, version, work.ctx, deps);
    row.images = [build.pinned];
    save(row);
    const signer = deps.signer();
    const bRec = signRecord({ ...buildRecord(ins, build, deps.now()),
      subject: { name: ins.name, handle: ins.handle, kind: "package" },
      checks: [{ kind: "unrun", what: `nothing in this image was run by the build. It is ${work.pkg.name} ${version} (sha256 ${ins.sha256}) on the tenant base, with the tenant host added, built by Cloud Build as ${ins.builder}.` }],
    }, BUILD_TAG, signer.sign, signer.by);
    const bRecSha = createHash("sha256").update(canonical(bRec)).digest("hex");

    // 4. The account, the key (which binds the name), the secret.
    if (deps.gcloud(["iam", "service-accounts", "describe", res.service_account, "--project", ins.project, "--format", "json"]).code !== 0) {
      must(deps, ["iam", "service-accounts", "create", res.service_account_id, "--project", ins.project,
        "--display-name", `Agent ${ins.handle}`.slice(0, 100), "--description", `Runs ${ins.handle}, a person's own agent; reads only its own credential. Made by the deployment manager.`, "--quiet"], "account");
    }
    row.state = "account made";
    save(row);
    const made = await makeKeyIntoSecret(ins, res, deps);
    row.agent_key = made.agent_key;
    row.state = "key made";
    save(row);
    await bindReader(deps, res.secret, ins.project, res.service_account);
    if (made.handle !== ins.handle) {
      stop("name", made.handle
        ? `the key was named ${made.handle}, not ${ins.handle}`
        : `the key was not named ${ins.handle} when it joined, so it would not be let onto the mesh`);
    }
    row.state = "named";
    save(row);

    // 5. The service, then its ready line.
    const tmpd = deps.tmp();
    let deployed = {};
    try {
      const envFile = join(tmpd, "env.json");
      deps.writeFile(envFile, JSON.stringify(packageEnvFor(ins)));
      deployed = parse(must(deps, packageServiceDeployArgv(ins, res, build.pinned, envFile), "service", { timeout: 900_000 }));
    } finally {
      deps.rmdir(tmpd);
    }
    // The address the platform's waker calls. Cloud Run names it in the
    // deploy's answer; asked for again when it did not.
    let wakeUrl = wakeUrlOf(deployed);
    if (!wakeUrl) wakeUrl = wakeUrlOf(parse(must(deps, ["run", "services", "describe", res.service, "--region", ins.region, "--project", ins.project, "--format", "json"], "service")));
    if (!wakeUrl) stop("service", "Cloud Run named no address for the service, so the platform could never wake it");
    row.wake_url = wakeUrl;
    row.state = "service started";
    save(row);
    const ready = await waitReady(ins, res, deps);
    const custody = {
      minted: "generated",
      held_by: [made.agent_key, `secret:${res.secret}`, `service-account:${res.service_account}`],
      note: "The seed was generated in the deployment manager's memory on this host and went into the secret on stdin; it was never written to this host's disk. The secret is in the tenant project, where only the agent's own service account may read it; inside the container only the tenant host and the adapter hold it, never the package's work. The deployment manager can place it but not read it back. The project's owners can.",
    };
    const r = { act: "deploy", image: build.image, image_digest: String(ready.running_digest ?? "").split("@").pop() || build.digest, build_id: build.id,
      build_record_sha256: bRecSha, revision: ready.revision, agent_key: made.agent_key, handle: ins.handle, key_custody: custody, smoke: ready.smoke };
    const base = deploymentRecord(ins, res, r, deps.now());
    base.target.shape = { ...base.target.shape, min_instances: 0, max_instances: 1, cpu_always_allocated: false, ingress: "all", unauthenticated: false,
      default_url: true, wake: { by: ins.waker, idle_seconds: ins.wake_idle_seconds, max_seconds: ins.wake_max_seconds, request_seconds: WAKE_REQUEST_SECONDS } };
    const dRec = signRecord({ ...base, subject: { name: ins.name, kind: "package" } }, TAG, signer.sign, signer.by);
    const done = { ...row, state: "running", image: build.pinned, image_digest: r.image_digest, revision: ready.revision, handle: ins.handle, build_id: build.id, updated_at: deps.now() };
    save(done);
    deps.saveRecord(ins.name, "build", bRec);
    deps.saveRecord(ins.name, "deploy", dRec);
    return out({
      ok: true, act: "deploy", name: ins.name, handle: ins.handle, agent_key: made.agent_key, service: res.service, revision: ready.revision,
      package: work.pkg.name, version, sha256: ins.sha256, tenant: ins.tenant, wake_url: wakeUrl, wake: true,
      image: build.pinned, image_digest: r.image_digest, build_id: build.id, smoke: ready.smoke,
      build_record: bRec, record: dRec,
      state: `${ins.handle} is installed as ${res.service} in the tenant project and answers to its own key. It sleeps at no cost until mail waits for it, and the platform wakes it then`,
    });
  } catch (e) {
    if (!(e instanceof Stop)) e = new Stop("unexpected", String(e?.stack ?? e).slice(0, 600));
    let state = e.state ?? null;
    if (row) {
      save({ ...row, state: `failed at ${e.step}` });
      state = `${state ? `${state}; ` : ""}${row.state === "installing" ? "nothing was started" : `left at "${row.state}"`}; run retire ${row.name} to clean`;
    }
    const signer = (() => { try { return deps.signer(); } catch { return { by: "deployment-manager", sign: null }; } })();
    const refusal = signRecord({
      record: "v1", role: "deployment-manager", act: "refuse", instructed_by: ins?.instructed_by ?? "the owner",
      ...(ins ? { subject: { name: ins.name, handle: ins.handle, kind: "package" }, source: ins.source } : {}),
      refused: { step: e.step, reason: String(e.message).slice(0, 800), state: state ?? "nothing created", attempted: "install-package" },
      produced_at: deps.now(), signatures: [],
    }, TAG, signer.sign, signer.by);
    if (ins) try { deps.saveRecord(ins.name, "refuse", refusal); } catch { /* the record is also in the answer */ }
    // A key made before the stop is named, so the retire door can take it back
    // (it is known to the platform only by what this result says).
    return out({ ok: false, act: "install", step: e.step, error: String(e.message).slice(0, 800), state: state ?? "nothing created", ...(row?.agent_key ? { agent_key: row.agent_key } : {}), record: refusal });
  } finally {
    if (work?.dir) deps.rmdir(work.dir);
  }
}

async function main(argv) {
  const deps = realDeps();
  const [cmd, arg, ...rest] = argv;
  if (cmd === "install" && arg) {
    const own = `${deps.paths.tmp}/`;
    if (!arg.replace(/\\/g, "/").startsWith(own)) return out({ ok: false, act: "install", step: "validate", error: "argfile outside the deploymgr tmp dir" });
    let args;
    try { args = JSON.parse(readFileSync(arg, "utf8")); } catch (e) { return out({ ok: false, act: "install", step: "validate", error: `the argfile could not be read: ${e.message}` }); }
    return install(args, deps);
  }
  if (cmd === "retire" && arg) return retire(arg, rest.join(" "), deps);
  if (cmd === "retire-key" && arg) return retireKey(arg, rest.join(" "), deps);
  if (cmd === "restart" && arg) return restart(arg, rest.join(" "), deps);
  if (cmd === "install-package" && arg) {
    const own = `${deps.paths.tmp}/`;
    if (!arg.replace(/\\/g, "/").startsWith(own)) return out({ ok: false, act: "install", step: "validate", error: "argfile outside the deploymgr tmp dir" });
    let args;
    try { args = JSON.parse(readFileSync(arg, "utf8")); } catch (e) { return out({ ok: false, act: "install", step: "validate", error: `the argfile could not be read: ${e.message}` }); }
    return installPackage(args, deps);
  }
  if (cmd === "sleep" && arg) {
    const opts = {};
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === "--idle") opts.wake_idle_seconds = Number(rest[++i]);
      else if (rest[i] === "--ready") opts.ready_line = String(rest[++i] ?? "");
      else return out({ ok: false, act: "sleep", step: "usage", error: `unknown option ${rest[i]}: sleep <name> [--idle seconds] [--ready "line"]` });
    }
    return sleepInPlace(arg, opts, deps);
  }
  if (cmd === "keep-on" && arg) return keepOn(arg, rest.join(" "), deps);
  if (cmd === "tell-wake" && arg) {
    // The platform told again the address a sleeping install is woken at
    // (when it could not be told as sleep finished).
    const row = deps.inventory.load().find((x) => x.name === arg);
    if (!row?.wake || !row.wake_url || !row.agent_key) return out({ ok: false, act: "tell-wake", step: "validate", error: `${arg} is not an installed agent that wakes on message` });
    const told = await tellWake(row.agent_key, row.wake_url, deps);
    return out({ ok: told.ok, act: "tell-wake", name: arg, wake_url: row.wake_url, ...(told.ok ? { requests: told.requests } : { error: told.why }) });
  }
  if (cmd === "status") return status(deps);
  return out({ ok: false, step: "usage", error: "install <argfile> | install-package <argfile> | restart <name> [reason] | sleep <name> [--idle seconds] [--ready line] | keep-on <name> [reason] | retire <name> [reason] | retire-key <agent key> [reason] | status" });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((e) => out({ ok: false, step: "unexpected", error: String(e?.message ?? e).slice(0, 600) }));
}
