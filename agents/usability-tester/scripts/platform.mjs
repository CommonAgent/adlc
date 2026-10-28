// The calls a page makes, and nothing else.
//
// The tester runs an agent the way the App's agent page does: as a signed-in
// account, through the same doors (AgentMesh app-next src/runtime.ts):
//
//   GET  <base>/a/<handle>                          the storefront: the agent's key
//   GET  <base>/v1/agents/<key>/descriptor          the Descriptor the page is drawn from,
//                                                   exact bytes, X-Descriptor-Digest
//   POST <base>/v1/accounts/<id>/try                Run: {to, text, offering, files}; and an
//                                                   answer to the agent's question: {job, text}
//   GET  <base>/v1/accounts/<id>/jobs/<job>         the job record: its state and versions
//   GET  <base>/v1/accounts/<id>/cloud-agent/inbox  what the agent said to the person
//   POST <base>/v1/accounts/<id>/jobs/<job>/revise  Ask for a change: {text, steps}
//   GET  <base>/v1/accounts/<id>/artifacts/<id>     a delivered piece's bytes
//
// The account is the install's own, signed in (TESTER_SESSION and
// TESTER_ACCOUNT), or, where the platform keeps test accounts (dev), a fresh
// one for each job, made with the platform's test-account key:
//   POST <base>/v1/operator/test-accounts {email}    TEST_ACCOUNT_KEY, scope `test`
// which can make test accounts under the platform's test domain and do
// nothing else. A fresh account starts with nothing of anyone's, so what a
// person new to the agent meets is what the tester meets. A 429, 502 or 503
// is waited out and asked again (retry.mjs).
//
//   needs: node >= 22
//   import { platform } from "./platform.mjs"
import { createHash } from "node:crypto";
import { fetchRetrying } from "./retry.mjs";

const trim = (s) => String(s ?? "").trim();

async function call(url, { method = "GET", token = "", body, fetchImpl, timeoutMs = 60_000, sleep, binary = false, write = false } = {}) {
  const at = new Date().toISOString();
  try {
    const r = await fetchRetrying(url, {
      method,
      headers: { accept: binary ? "*/*" : "application/json", ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }, { fetchImpl, timeoutMs, ...(sleep ? { sleep } : {}), ...(write ? { codes: new Set([429]) } : {}) });
    const bytes = Buffer.from(await r.arrayBuffer());
    let data = null;
    if (!binary) { try { data = bytes.length ? JSON.parse(bytes.toString("utf8")) : null; } catch { data = null; } }
    const header = (n) => (typeof r.headers?.get === "function" ? r.headers.get(n) : null);
    const said = data?.error ? (typeof data.error === "string" ? data.error : trim(data.error.message) || trim(data.error.code)) : "";
    return { ok: r.ok, status: r.status, data, bytes, header, at, url, error: r.ok ? null : said || `the platform answered ${r.status}` };
  } catch (e) {
    return { ok: false, status: 0, data: null, bytes: null, header: () => null, at, url, error: `no answer from ${url.split("/").slice(0, 3).join("/")} (${trim(e?.message ?? e)})` };
  }
}

/** The platform at one origin, as the account `session` once signed in. */
export function platform({ base = "", fetchImpl = globalThis.fetch, sleep } = {}) {
  const root = trim(base).replace(/\/+$/, "");
  const enc = encodeURIComponent;
  const o = { fetchImpl, sleep };
  let s = null;
  const acct = (method, rest, body, extra = {}) => {
    if (!s) return Promise.resolve({ ok: false, status: 401, data: null, error: "no account is signed in" });
    return call(`${root}/v1/accounts/${enc(s.account)}${rest}`, { ...o, method, token: s.token, body, ...extra });
  };
  return {
    root,
    get session() { return s; },
    /** Sign in: the install's session, or a fresh test account. */
    async signIn({ session = "", account = "", testKey = "", domain = "agentmesh.test", label = "usability" } = {}) {
      if (trim(session) && trim(account)) { s = { token: trim(session), account: trim(account), how: "the install's own account" }; return { ok: true, how: s.how }; }
      if (!trim(testKey)) return { ok: false, error: "this host binds no account to run agents as (TESTER_SESSION and TESTER_ACCOUNT) and no test-account key (TEST_ACCOUNT_KEY)" };
      const tag = createHash("sha256").update(`${Date.now()} ${Math.random()}`).digest("hex").slice(0, 8);
      const m = await call(`${root}/v1/operator/test-accounts`, { ...o, method: "POST", token: trim(testKey), body: { email: `${label}-${tag}@${trim(domain) || "agentmesh.test"}` }, write: true });
      if (!m.ok || !m.data?.session || !m.data?.account) return { ok: false, error: `the platform would not make a test account (${m.error ?? "no session in its answer"})` };
      s = { token: m.data.session, account: m.data.account, how: "a fresh test account made for this job" };
      // A name, as a person new to the platform has once they sign up: the
      // platform sends nothing for an account without one.
      await acct("PUT", "/display-name", { name: `Usability tester ${tag}` }, { write: true });
      const n = await acct("POST", "/claim-name", { name: `usability${tag}` }, { write: true });
      s.handle = trim(n.data?.handle) || null;
      return { ok: true, how: s.how, handle: s.handle };
    },
    storefront: (handle) => call(`${root}/a/${enc(handle)}`, o),
    descriptor: (key) => call(`${root}/v1/agents/${enc(key)}/descriptor`, o),
    run: (to, { text, offering, files }) => acct("POST", "/try", { to, text, ...(offering ? { offering } : {}), ...(files?.length ? { files } : {}) }, { write: true, timeoutMs: 120_000 }),
    reply: (job, text) => acct("POST", "/try", { job, text }, { write: true, timeoutMs: 120_000 }),
    job: (id) => acct("GET", `/jobs/${enc(id)}`),
    inbox: () => acct("GET", "/cloud-agent/inbox"),
    revise: (job, text, steps) => acct("POST", `/jobs/${enc(job)}/revise`, { text, steps }, { write: true, timeoutMs: 120_000 }),
    piece: (ref) => acct("GET", `/artifacts/${enc(trim(ref).replace(/^mesh:artifacts:/, ""))}`, undefined, { binary: true }),
  };
}

/** A file at a public address, fetched with no credentials, at most `max` bytes. */
export async function fetchPublic(url, { fetchImpl = globalThis.fetch, max = 20 * 1024 * 1024, timeoutMs = 60_000 } = {}) {
  if (!/^https:\/\/\S+$/.test(trim(url))) return { ok: false, error: "it is not an https address" };
  try {
    const r = await fetchImpl(trim(url), { headers: { accept: "*/*" }, redirect: "follow", signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) return { ok: false, error: `the address answered ${r.status}` };
    const bytes = Buffer.from(await r.arrayBuffer());
    if (bytes.length > max) return { ok: false, error: `it is ${bytes.length} bytes, more than ${max}` };
    return { ok: true, bytes, type: trim(r.headers?.get?.("content-type")).split(";")[0] };
  } catch (e) {
    return { ok: false, error: trim(e?.message ?? e) };
  }
}
