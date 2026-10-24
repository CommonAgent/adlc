// The caller's grant for one external input, the same call wherever the agent
// runs (docs/caller-grants-plan.md section 8).
//
//   const c = await connectionFor({ input: "property", provider: "google-analytics",
//                                   grant: "identity", what: "Google Analytics", text });
//   const token = await c.token(["https://www.googleapis.com/auth/analytics.readonly"]);
//
// One copy of this file lives in every package that reads something its
// caller owns (scripts/connection.mjs). The canonical copy is
// fleet-manager/agentbuilder/shared/connection.mjs, and a services test keeps
// the copies identical. Node 22, nothing outside node.
//
// TWO MODES, chosen by MESH_CONNECTIONS (platform or store). When it is not
// set: platform when MESH_API_TOKEN is set, else store when MESH_KEY_STORE is
// set, else a setup refusal naming both.
//
// platform (AgentMesh hosts the agent). THE IDENTITY COMES FROM THE PLATFORM'S
// LOOKUP, NEVER FROM THE MESSAGE. The lookup is asked with the envelope's
// signature-checked sender key (MESH_SENDER, else the inbox entry's from) and
// the run accounting record it carried (acct or meta.acct on the inbox entry
// in MESH_MESSAGE_FILE), plus the process runner's own run id from the first
// line of its message. Nothing here reads a service account, an account id, a
// secret name or a token from the message's words, whatever they say. Every
// token minted and every key read is preceded by a lookup that says which
// (use: token or key), because the lookup is the step the caller sees in the
// connection's audit. Then: this runtime's own token from the metadata
// server, and either a five-minute token for the connection's service account
// with only the scopes asked, or the one secret the connection names in
// Secret Manager, which this runtime may read and nothing else.
//
// store (the customer's own cloud or machines). The platform is never called
// and never sees the value. The credential is bound by NAME in a store the
// runtime's owner keeps (docs/account-stack.md section 9): MESH_KEY_STORE is
// host (the folder MESH_CREDENTIALS_DIR, default ~/.agentmesh/credentials),
// host:<folder>, or google-secret-manager:<project>; aws-secrets-manager:<region>
// is reserved and refused as not built yet. The name is MESH_CONNECTION_<INPUT>,
// else <provider>-<grant>. Whoever runs the agent there owns it, so the
// credential is theirs and there is no per-caller lookup.
//
// Nothing here logs or writes a token, a key or a response body. A refusal
// opens "I cannot", is under 600 characters, and names the step and the HTTP
// status at most.
//
// Written by the harness under the owner's exception of 2026-09-23.
//
//   needs: node >= 22
import { createSign } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const METADATA_TOKEN = "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token";
export const IAM_CREDENTIALS = "https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts";
export const SECRET_MANAGER = "https://secretmanager.googleapis.com/v1";
export const GOOGLE_TOKEN_URI = "https://oauth2.googleapis.com/token";
export const DEFAULT_BASE = "https://app.agentmesh.ai"; // env-literal-ok: copied byte-identical into packages, which cannot read env/; MESH_API_BASE overrides it
export const LIFETIME_SECONDS = 300;
const TIMEOUT_MS = 15000;
const METADATA_TIMEOUT_MS = 3000;
const ACCT = /^acct_[a-z0-9]{8,40}$/;
const SERVICE_ACCOUNT = /^[^@\s]+@[^@\s]+\.iam\.gserviceaccount\.com$/;
const SECRET_NAME = /^projects\/[a-z0-9-]{1,63}\/secrets\/[A-Za-z0-9_-]{1,255}$/;
const CREDENTIAL_NAME = /^[A-Za-z0-9_-]{1,128}$/;
const GCP_PROJECT = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;

/** A refusal the agent says as its reply: opens "I cannot", is under 600
 *  characters (each one here is built to be; the tests hold it), names the
 *  step and the HTTP status at most, and never carries a value, a token or a body. */
export class Refusal extends Error {
  constructor(message, { step = null, status = null, code = null } = {}) {
    super(message);
    this.step = step;
    this.status = status;
    this.code = code;
  }
}

const trim = (v) => (typeof v === "string" ? v.trim() : "");
const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const VERB = { read: "read", write: "write to", trigger: "use" };

/** The env name for an input: MESH_CONNECTION_<INPUT>, upper-cased, non-alphanumerics to _. */
export function connectionEnv(input) {
  return `MESH_CONNECTION_${String(input).toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
}

/** Which mode this runtime is in: "platform" or "store", or a setup Refusal. */
export function modeOf(env = process.env, doing = "read it") {
  const set = trim(env.MESH_CONNECTIONS).toLowerCase();
  if (set === "platform" || set === "store") return set;
  if (set) {
    throw new Refusal(`I cannot ${doing}: MESH_CONNECTIONS takes platform or store, and it is set to something else. Nothing was read.`, { step: "setup", code: "SETUP" });
  }
  if (trim(env.MESH_API_TOKEN)) return "platform";
  if (trim(env.MESH_KEY_STORE)) return "store";
  throw new Refusal(`I cannot ${doing}: this agent was not given its platform account and token (MESH_ACCOUNT and MESH_API_TOKEN), so it cannot look up whose connection to use, nor a store of its own to read a credential from (MESH_KEY_STORE, for example host or google-secret-manager:<project>). Nothing was read.`, { step: "setup", code: "SETUP" });
}

// ---- the envelope (platform mode) ----

/** What the job's envelope says, from the environment and the inbox entry:
 *  { sender, acct }. Never from the message's words. */
export function envelopeFacts(env = process.env) {
  let entry = null;
  const file = trim(env.MESH_MESSAGE_FILE);
  if (file && existsSync(file)) {
    try { entry = JSON.parse(readFileSync(file, "utf8")); } catch { entry = null; }
  }
  const sender = trim(env.MESH_SENDER) || trim(entry?.from);
  const raw = trim(entry?.acct) || trim(entry?.meta?.acct);
  return { sender, acct: ACCT.test(raw) ? raw : null };
}

/** Who this agent is, as the lookup is told: its key when the host gives it, and its handle. */
export function selfOf(env = process.env) {
  return { key: trim(env.MESH_SELF_KEY) || trim(env.MESH_AGENT_KEY), handle: trim(env.MESH_SELF_HANDLE) || trim(env.AGENT_HANDLE) };
}

/** The process runner's own run id, from the first line of its message,
 *  "run r-20261022-20e5 phase traffic-report: here is work". The platform reads
 *  it only when the signed sender IS the process runner, and then works out
 *  whose run it is from its own records; from anybody else it is ignored. */
export function runnerRunOf(text) {
  const first = String(text ?? "").trimStart().split(/\r?\n/, 1)[0];
  const m = /^run (r-\d{8}-[a-z0-9]{4,12}) phase /.exec(first);
  return m ? m[1] : null;
}

/** The body the lookup is sent. Every member comes from the environment or
 *  the envelope; none from the message's words. */
export function resolveBody(env = process.env, text = "", input = "property", use = null) {
  const { sender, acct } = envelopeFacts(env);
  const { key, handle } = selfOf(env);
  const run = runnerRunOf(text);
  return {
    ...(key ? { agent: key } : {}),
    ...(handle ? { agent_handle: handle } : {}),
    input,
    sender,
    ...(acct ? { acct } : {}),
    ...(run ? { run } : {}),
    ...(use ? { use } : {}),
  };
}

/** Where the platform is and how this agent signs in to it, or a Refusal. */
export function platformOf(env = process.env, doing = "read it") {
  const account = trim(env.MESH_ACCOUNT);
  const token = trim(env.MESH_API_TOKEN);
  if (!account || !token) {
    throw new Refusal(`I cannot ${doing}: this agent was not given its platform account and token (MESH_ACCOUNT and MESH_API_TOKEN), so it cannot look up whose connection to use. Nothing was read.`, { step: "setup", code: "SETUP" });
  }
  return { account, token, base: (trim(env.MESH_API_BASE) || DEFAULT_BASE).replace(/\/+$/, "") };
}

async function call(doing, step, fetchImpl, url, init, timeout = TIMEOUT_MS) {
  let res;
  try {
    res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeout) });
  } catch (e) {
    const why = e?.name === "TimeoutError" || e?.name === "AbortError" ? `did not answer within ${timeout / 1000} seconds` : "could not be reached";
    throw new Refusal(`I cannot ${doing}: ${step} ${why}. Nothing was read.`, { step: stepCode(step) });
  }
  let body = null;
  try { body = JSON.parse(await res.text()); } catch { body = null; }
  return { status: res.status, ok: res.ok, body };
}

const STEPS = {
  "the connection lookup": "resolve",
  "the metadata server": "metadata",
  "Google's token service": "generateAccessToken",
  "Secret Manager": "secret",
  "Google's sign-in service": "jwt",
};
const stepCode = (s) => STEPS[s] ?? s;

/**
 * The platform's answer for this agent's input: the grant object
 * ({ id, provider, grant, access, property, service_account, secret, state }).
 * `use` is "token" or "key": what the caller's audit records this lookup was for.
 */
export async function platformResolve({ input = "property", provider = null, grant = null, what = "it", access = "read", text = "", use = null, env = process.env, fetch: fetchImpl = globalThis.fetch } = {}) {
  const doing = `${VERB[access] ?? "read"} ${what}`;
  const p = platformOf(env, doing);
  const body = resolveBody(env, text, input, use);
  if (!body.sender) {
    throw new Refusal(`I cannot ${doing}: this message came with no sender key, so I cannot tell whose connection to use. Nothing was read.`, { step: "envelope", code: "SETUP" });
  }
  if (!body.agent && !body.agent_handle) {
    throw new Refusal(`I cannot ${doing}: this agent was not told its own key or handle (MESH_SELF_HANDLE), so the connection lookup cannot be asked. Nothing was read.`, { step: "setup", code: "SETUP" });
  }
  const url = `${p.base}/v1/accounts/${encodeURIComponent(p.account)}/caller-grants/resolve`;
  const r = await call(doing, "the connection lookup", fetchImpl, url, {
    method: "POST",
    headers: { authorization: `Bearer ${p.token}`, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (r.status === 404 && r.body?.code === "NO_CONNECTION") {
    throw new Refusal(`I cannot ${VERB[access] ?? "read"} your ${what} yet: you have not connected it. Connect ${what} first: in AgentMesh, run this agent or open Settings, Data connections.`, { step: "resolve", status: 404, code: "NO_CONNECTION" });
  }
  if (r.status === 403) {
    // Not an outage: the platform could not tell whose task this is, and a retry would not change that.
    const code = typeof r.body?.code === "string" && /^[A-Z_]{2,40}$/.test(r.body.code) ? r.body.code : null;
    throw new Refusal(`I cannot ${doing} for this task: the platform could not confirm whose task it is (the run may have ended, or it could not be confirmed as yours), so no connection was used. Nothing was read.`, { step: "resolve", status: 403, code });
  }
  if (r.status !== 200 || !isObj(r.body?.grant)) {
    throw new Refusal(`I cannot ${doing}: the connection lookup answered ${r.status}. Nothing was read; try again in a few minutes.`, { step: "resolve", status: r.status });
  }
  const g = r.body.grant;
  const kind = grant ?? g.grant;
  const fits = g.grant === kind && (!provider || g.provider === provider)
    && (kind === "identity" ? typeof g.service_account === "string" && SERVICE_ACCOUNT.test(g.service_account)
      : kind === "key" ? typeof g.secret === "string" && SECRET_NAME.test(g.secret) : false);
  if (!fits) {
    throw new Refusal(`I cannot ${doing}: your connection has no ${kind === "key" ? "key" : "identity"} for ${what} to ${kind === "key" ? "use" : "read with"}. Connect ${what} first: in AgentMesh, run this agent or open Settings, Data connections.`, { step: "resolve", status: 200, code: "WRONG_GRANT" });
  }
  return g;
}

// ---- Google ----

/** This runtime's own Google token from the metadata server of the machine it runs on. */
export async function metadataToken(fetchImpl, doing, timeout = TIMEOUT_MS) {
  const r = await call(doing, "the metadata server", fetchImpl, METADATA_TOKEN, { method: "GET", headers: { "Metadata-Flavor": "Google" } }, timeout);
  if (r.status !== 200 || typeof r.body?.access_token !== "string" || !r.body.access_token) {
    throw new Refusal(`I cannot ${doing}: getting this agent's own token from the metadata server answered ${r.status}. Nothing was read.`, { step: "metadata", status: r.status });
  }
  return r.body.access_token;
}

/** The ambient Google token in store mode: the metadata server, else
 *  GOOGLE_OAUTH_ACCESS_TOKEN. Asked once per connection, so a machine with no
 *  metadata server waits for it only once. */
function ambientOnce(env, fetchImpl, doing) {
  let got = null;
  return () => (got ??= ambientToken(env, fetchImpl, doing).catch((e) => { got = null; throw e; }));
}

async function ambientToken(env, fetchImpl, doing) {
  try {
    return await metadataToken(fetchImpl, doing, METADATA_TIMEOUT_MS);
  } catch (e) {
    if (!(e instanceof Refusal)) throw e;
    const t = trim(env.GOOGLE_OAUTH_ACCESS_TOKEN);
    if (t) return t;
    throw new Refusal(`I cannot ${doing}: this runtime has no Google token of its own (no metadata server here, and GOOGLE_OAUTH_ACCESS_TOKEN is not set). Nothing was read.`, { step: "ambient", status: e.status, code: "SETUP" });
  }
}

function checkScopes(scopes, doing) {
  if (!Array.isArray(scopes) || !scopes.length || !scopes.every((s) => typeof s === "string" && /^https:\/\/www\.googleapis\.com\/auth\/[a-z0-9._/-]+$/i.test(s))) {
    throw new Refusal(`I cannot ${doing}: the agent asked for a token without naming Google scopes. Nothing was read.`, { step: "scopes", code: "SETUP" });
  }
}

/** A five-minute token for a service account, with only the scopes asked, acting as it with `own`. */
async function impersonate(serviceAccount, scopes, own, fetchImpl, doing) {
  const url = `${IAM_CREDENTIALS}/${encodeURIComponent(serviceAccount)}:generateAccessToken`;
  const r = await call(doing, "Google's token service", fetchImpl, url, {
    method: "POST",
    headers: { authorization: `Bearer ${own}`, "content-type": "application/json" },
    body: JSON.stringify({ scope: scopes, lifetime: `${LIFETIME_SECONDS}s` }),
  });
  if (r.status !== 200 || typeof r.body?.accessToken !== "string" || !r.body.accessToken) {
    throw new Refusal(`I cannot ${doing}: Google's token service answered ${r.status} when asked to act as your connection's address. Nothing was read.`, { step: "generateAccessToken", status: r.status });
  }
  return r.body.accessToken;
}

/** The latest version of one Secret Manager secret, by its resource name, read with `own`. */
async function secretValue(secret, own, fetchImpl, doing) {
  const r = await call(doing, "Secret Manager", fetchImpl, `${SECRET_MANAGER}/${secret}/versions/latest:access`, {
    method: "GET",
    headers: { authorization: `Bearer ${own}`, accept: "application/json" },
  });
  if (r.status === 404) throw new Refusal(`I cannot ${doing}: Secret Manager has no such secret (404). Nothing was read.`, { step: "secret", status: 404, code: "NO_CONNECTION" });
  if (r.status === 403) throw new Refusal(`I cannot ${doing}: Secret Manager says this runtime may not read that secret (403). Nothing was read.`, { step: "secret", status: 403, code: "STORE_DENIED" });
  const data = r.body?.payload?.data;
  if (r.status !== 200 || typeof data !== "string") {
    throw new Refusal(`I cannot ${doing}: Secret Manager answered ${r.status}. Nothing was read.`, { step: "secret", status: r.status });
  }
  return Buffer.from(data, "base64").toString("utf8");
}

const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

/** A token for a Google service account key file: an RS256 JWT, signed here,
 *  exchanged at its token_uri for the scopes asked. Google sets the token's
 *  life (an hour); it is held in memory only. */
export async function keyFileToken(file, scopes, fetchImpl, doing, now = () => Date.now()) {
  const uri = trim(file.token_uri) || GOOGLE_TOKEN_URI;
  if (!/^https:\/\/[a-z0-9.-]+\.googleapis\.com\//.test(uri)) {
    throw new Refusal(`I cannot ${doing}: the key file's token_uri is not a Google address. Nothing was read.`, { step: "jwt", code: "BAD_CREDENTIAL" });
  }
  const iat = Math.floor(now() / 1000);
  const header = { alg: "RS256", typ: "JWT", ...(trim(file.private_key_id) ? { kid: trim(file.private_key_id) } : {}) };
  const claims = { iss: file.client_email, scope: scopes.join(" "), aud: uri, iat, exp: iat + LIFETIME_SECONDS };
  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  let signature;
  try {
    signature = createSign("RSA-SHA256").update(unsigned).sign(file.private_key);
  } catch {
    throw new Refusal(`I cannot ${doing}: the key file's private key could not sign. Nothing was read.`, { step: "jwt", code: "BAD_CREDENTIAL" });
  }
  const r = await call(doing, "Google's sign-in service", fetchImpl, uri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${b64url(signature)}` }).toString(),
  });
  if (r.status !== 200 || typeof r.body?.access_token !== "string" || !r.body.access_token) {
    throw new Refusal(`I cannot ${doing}: Google's sign-in service answered ${r.status} for the key file's address. Nothing was read.`, { step: "jwt", status: r.status });
  }
  return r.body.access_token;
}

// ---- the customer's own store ----

/** The store MESH_KEY_STORE names: { kind, folder?, project?, region?, said }. */
export function storeOf(env = process.env, doing = "read it") {
  const raw = trim(env.MESH_KEY_STORE);
  const [kind, ...rest] = raw.split(":");
  const arg = rest.join(":").trim();
  if (kind === "host") {
    const folder = arg || trim(env.MESH_CREDENTIALS_DIR) || join(homedir(), ".agentmesh", "credentials");
    // The folder is not named in a refusal: a refusal is a reply, and the
    // caller who reads it has no business knowing the owner's file layout.
    return { kind, folder, said: "host folder" };
  }
  if (kind === "google-secret-manager" && GCP_PROJECT.test(arg)) return { kind, project: arg, said: "Google Secret Manager" };
  if (kind === "aws-secrets-manager") {
    throw new Refusal(`I cannot ${doing}: reading a credential from AWS Secrets Manager is not built yet. Use MESH_KEY_STORE=host or google-secret-manager:<project>. Nothing was read.`, { step: "store", code: "NOT_BUILT" });
  }
  throw new Refusal(`I cannot ${doing}: MESH_KEY_STORE must be host, host:<folder> or google-secret-manager:<project>, and it is not. Nothing was read.`, { step: "store", code: "SETUP" });
}

/** The credential's text from the store, or a Refusal. Never echoed anywhere. */
async function readStored(store, name, ambient, fetchImpl, doing, missing) {
  if (store.kind === "host") {
    const file = join(store.folder, `${name}.secret`);
    if (!existsSync(file)) throw missing();
    try { return readFileSync(file, "utf8"); } catch {
      throw new Refusal(`I cannot ${doing}: the credential ${name} in your ${store.said} could not be read. Nothing was read.`, { step: "store", code: "STORE_DENIED" });
    }
  }
  const own = await ambient();
  try {
    return await secretValue(`projects/${store.project}/secrets/${name}`, own, fetchImpl, doing);
  } catch (e) {
    if (e instanceof Refusal && e.code === "NO_CONNECTION") throw missing();
    throw e;
  }
}

/** What a stored credential holds: { address, property, value?, file?, impersonate? }. */
function parseStored(textValue, grant, name, doing) {
  const raw = String(textValue).trim();
  let json = null;
  if (raw.startsWith("{")) { try { json = JSON.parse(raw); } catch { json = null; } }
  const prop = isObj(json) && (typeof json.property === "string" || typeof json.property === "number") ? String(json.property) : null;
  const bad = (why) => new Refusal(`I cannot ${doing}: the credential ${name} in your own store ${why}. Nothing was read.`, { step: "store", code: "BAD_CREDENTIAL" });
  if (grant === "key") {
    if (isObj(json)) {
      if (typeof json.key === "string" && json.key) return { value: json.key, property: prop, address: null };
      throw bad("is JSON without a key member: it should be the raw value, or {\"key\": \"...\"}");
    }
    if (!raw) throw bad("is empty");
    return { value: raw, property: null, address: null };
  }
  if (!isObj(json)) throw bad("is not JSON: it should be a Google service account key file, or {\"service_account\": \"<address>\"}");
  // The slot for identities other than Google's (an AWS role, an Azure federated credential).
  if (typeof json.cloud === "string" && json.cloud !== "google") {
    throw new Refusal(`I cannot ${doing}: an identity for ${/^[a-z0-9-]{1,20}$/i.test(json.cloud) ? json.cloud : "that cloud"} is not built yet; only Google identities are. Nothing was read.`, { step: "store", code: "NOT_BUILT" });
  }
  if (json.type === "service_account") {
    if (typeof json.client_email !== "string" || !SERVICE_ACCOUNT.test(json.client_email) || typeof json.private_key !== "string" || !json.private_key.includes("PRIVATE KEY")) {
      throw bad("is a service account key file without a client_email or private_key");
    }
    return { file: json, address: json.client_email, property: prop };
  }
  if (typeof json.service_account === "string" && SERVICE_ACCOUNT.test(json.service_account)) {
    return { impersonate: json.service_account, address: json.service_account, property: prop };
  }
  throw bad("is neither a Google service account key file nor {\"service_account\": \"<address>\"}");
}

// ---- the contract ----

/**
 * The caller's grant for one external input, in whichever mode this runtime is in:
 *   { where: "platform" | "own-store", grant, provider, id, name, property, address, state,
 *     token(scopes): Promise<string>, key(): Promise<string> }
 * token() is for identity grants and key() for key grants; each holds what it
 * returns in memory only. Throws a Refusal opening "I cannot".
 */
export async function connectionFor({ input, provider, grant, what, access = "read", text = "", env = process.env, fetch: fetchImpl = globalThis.fetch } = {}) {
  const name0 = (trim(what).length <= 60 && trim(what)) || (typeof provider === "string" && provider.length <= 64 && provider) || "it";
  const doing = `${VERB[access] ?? "read"} ${name0}`;
  if (typeof input !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(input) || typeof provider !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(provider) || (grant !== "identity" && grant !== "key")) {
    throw new Refusal(`I cannot ${doing}: the agent asked for a connection without naming its input, its provider and its grant (identity or key). Nothing was read.`, { step: "setup", code: "SETUP" });
  }
  const wrong = (asked) => new Refusal(`I cannot ${doing}: this connection is a${grant === "identity" ? "n identity" : " key"}, and the agent asked for a ${asked}. Nothing was read.`, { step: "setup", code: "SETUP" });
  const mode = modeOf(env, doing);

  if (mode === "platform") {
    const ask = (use) => platformResolve({ input, provider, grant, what: name0, access, text, use, env, fetch: fetchImpl });
    // The first lookup is made now, with no use, so the reply can name the
    // address and the property and nothing is recorded as used. Every token
    // and every key is then preceded by a lookup of its own that says which.
    const g = await ask(null);
    return {
      where: "platform", grant, provider, id: g.id ?? null, name: null,
      property: g.property ?? null, address: grant === "identity" ? g.service_account : null, state: g.state ?? null,
      async token(scopes) {
        if (grant !== "identity") throw wrong("token");
        checkScopes(scopes, doing);
        const now = await ask("token");
        const own = await metadataToken(fetchImpl, doing);
        return impersonate(now.service_account, scopes, own, fetchImpl, doing);
      },
      async key() {
        if (grant !== "key") throw wrong("key");
        const now = await ask("key");
        const own = await metadataToken(fetchImpl, doing);
        return secretValue(now.secret, own, fetchImpl, doing);
      },
    };
  }

  const store = storeOf(env, doing);
  const envName = connectionEnv(input);
  const name = trim(env[envName]) || `${provider}-${grant}`;
  if (!CREDENTIAL_NAME.test(name)) {
    throw new Refusal(`I cannot ${doing}: ${envName} must be a credential name (letters, digits, - and _). Nothing was read.`, { step: "setup", code: "SETUP" });
  }
  const missing = () => new Refusal(`I cannot ${VERB[access] ?? "read"} your ${name0} yet: your own store (${store.said}) holds no credential named ${name}. Put the credential there under that name, or set ${envName} to the name it has. Nothing was read.`, { step: "store", code: "NO_CONNECTION" });
  const ambient = ambientOnce(env, fetchImpl, doing);
  const held = parseStored(await readStored(store, name, ambient, fetchImpl, doing, missing), grant, name, doing);
  return {
    where: "own-store", grant, provider, id: null, name,
    property: held.property ?? (trim(env[`${envName}_PROPERTY`]) || null), address: held.address, state: "unchecked",
    async token(scopes) {
      if (grant !== "identity") throw wrong("token");
      checkScopes(scopes, doing);
      if (held.file) return keyFileToken(held.file, scopes, fetchImpl, doing);
      const own = await ambient();
      return impersonate(held.impersonate, scopes, own, fetchImpl, doing);
    },
    async key() {
      if (grant !== "key") throw wrong("key");
      return held.value;
    },
  };
}
