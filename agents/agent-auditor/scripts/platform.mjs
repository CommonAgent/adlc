// What the auditor reads from the platform, and nothing else.
//
// Every read is a GET. All but one are public, the same doors any reader of
// an agent uses; the stage-records door needs the auditor's key
// (AUDIT_TOKEN, the Secret Manager key `agent-audit-key`, scope `agent-audit`):
//
//   GET <base>/a/<handle>                         the storefront: the agent's key,
//                                                 its handle and its presence
//   GET <base>/a/<handle>/agentdoc.json           the AgentDoc, with the digest and
//                                                 version of the Descriptor it was read from
//   GET <base>/v1/agents/<key>/descriptor         the registry's stored Descriptor,
//                                                 exact bytes, X-Descriptor-Digest
//   GET <base>/v1/agents/<key>/eval-record        the newest signed conformance verdict
//   GET <base>/v1/operator/audit/stage-records?agent=<key>&package=<name>
//                                                 AUDIT_TOKEN: the deploy queue's signed
//                                                 build and deployment records
//   GET <base>/v1/deploy-requests/<id>/package.tar.gz
//                                                 the package bytes a request filed
//
// The same public reads go to the prod origin (PROD_API_BASE) for the version
// prod runs. Each answer is kept with its address and time. A read that fails
// is said, never filled in.
//
//   needs: node >= 22
//   import { platform } from "./platform.mjs"

const trim = (s) => String(s ?? "").trim();

async function get(url, { token = "", fetchImpl = globalThis.fetch, timeoutMs = 30_000, now = () => new Date(), binary = false } = {}) {
  const at = now().toISOString();
  try {
    const r = await fetchImpl(url, {
      method: "GET",
      headers: { accept: binary ? "*/*" : "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const bytes = Buffer.from(await r.arrayBuffer());
    let body = null;
    if (!binary) { try { body = bytes.length ? JSON.parse(bytes.toString("utf8")) : null; } catch { body = null; } }
    const header = (n) => (typeof r.headers?.get === "function" ? r.headers.get(n) : null);
    const error = r.ok ? null : (body?.error ? String(body.error) : `the platform answered ${r.status}`);
    return { ok: r.ok, status: r.status, body, bytes, url, at, error, header };
  } catch (e) {
    return { ok: false, status: 0, body: null, bytes: null, url, at, error: `no answer from ${url.split("/").slice(0, 3).join("/")} (${trim(e?.message ?? e)})`, header: () => null };
  }
}

/** The platform at one origin. */
export function platform({ base = "", token = "", fetchImpl, now } = {}) {
  const root = trim(base).replace(/\/+$/, "");
  const opts = { fetchImpl, now };
  const enc = encodeURIComponent;
  return {
    root,
    hasToken: Boolean(trim(token)),
    storefront: (handle) => get(`${root}/a/${enc(handle)}`, opts),
    agentdoc: (handle) => get(`${root}/a/${enc(handle)}/agentdoc.json`, opts),
    descriptor: (key) => get(`${root}/v1/agents/${enc(key)}/descriptor`, opts),
    evalRecord: (key) => get(`${root}/v1/agents/${enc(key)}/eval-record`, opts),
    stageRecords: ({ agent = "", pkg = "" } = {}) => {
      const q = new URLSearchParams();
      if (agent) q.set("agent", agent);
      if (pkg) q.set("package", pkg);
      return get(`${root}/v1/operator/audit/stage-records?${q}`, { ...opts, token });
    },
    packageBytes: (requestId) => get(`${root}/v1/deploy-requests/${enc(requestId)}/package.tar.gz`, { ...opts, binary: true }),
  };
}
