// What the tester's tests share: an agent on a platform served from memory in
// place of the network (fetchImpl), which runs a job the way the platform's
// job record shows it, asks a question when told to, and takes a change.
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const BASE = "https://api.dev.example";
export const KEY = "UAGENTKEYAGENTKEYAGENTKEYAGENTKEYAGENTKEYAGENTKEYAGENTK";
const sha = (b) => createHash("sha256").update(b).digest("hex");

/** A Descriptor a person can use: a summary, settings, presentation and an example. */
export function goodDescriptor(extra = {}) {
  return {
    format: "agent-descriptor-v1", agent_version: "1.2.0", name: "Note writer",
    summary: "Writes a short note from a page you give it.",
    does: "Writes a short note in Markdown from a public page.",
    subject: { id: KEY, handle: "note-writer.platform@example.com" },
    offerings: [{
      id: "write-a-note", name: "Write a note", does: "Writes a note from the page.",
      started_by: ["person", "agent"], works_as: "job",
      inputs: [
        { name: "page", kind: "url", required: true, given_by: "person", about: "The page to write the note from." },
        { name: "audience", kind: "text", required: false, given_by: "person", about: "Who reads the note." },
        { name: "run-context", kind: "application/vnd.agentmesh.run-context+json", required: false, given_by: "agent", about: "The run context." },
      ],
      outputs: [{ name: "note", kind: "text/markdown", when: "per_task", presentation: "document", about: "The note." }],
      revisions: { included: { count: 1, window_days: 14 }, flat: { model: "flat", amount_micro: 0, currency: "USD" } },
      example: { inputs: { page: "https://example.com/a.html", audience: "Engineers new to the team" }, good_result: "A note of a few paragraphs about the page, for engineers." },
    }],
    run_config: { settings: [{ name: "length", kind: "preference", default: "short", allowed: ["short", "long"], value_labels: { short: "Short", long: "Long" }, label: "Length", about: "How long the note is.", job_may_set: true }] },
    ...extra,
  };
}

/** A Descriptor a person cannot use: JSON in and out, no summary, no example. */
export function badDescriptor() {
  return {
    format: "agent-descriptor-v1", agent_version: "2.0.0",
    does: "Writes facts.",
    subject: { id: KEY, handle: "facts.platform@example.com" },
    offerings: [{
      id: "write-facts", name: "Write facts",
      inputs: [{ name: "site-read", kind: "application/json", required: true }, { name: "tone", kind: "text", required: false }],
      outputs: [{ name: "facts", kind: "application/json", when: "per_task" }],
    }],
    run_config: { settings: [{ name: "model", kind: "rule", default: "m1", allowed: ["m1", "m2"], job_may_set: false }] },
  };
}

/**
 * The platform: `descriptor` served for `handle`; a run delivers `pieces`
 * ({name, media_type, step, text|bytes}); `ask` makes the agent ask first;
 * `change` is "take" (a second version), "refuse" or "silent".
 */
export function fakePlatform({ handle = "note-writer.platform@example.com", descriptor = goodDescriptor(), pieces = null, ask = false, answerFirst = "", change = "take", refuseRun = "", files = {} } = {}) {
  const calls = [];
  const arts = new Map();
  const bytesOf = (p) => (p.bytes ? Buffer.from(p.bytes) : Buffer.from(p.text ?? "", "utf8"));
  const made = pieces ?? [{ name: "note", media_type: "text/markdown", step: "write-a-note", text: "# A note\n\nThe page says the team ships on Fridays, and the release is reviewed first.\n" }];
  let polls = 0;
  let replied = false;
  let job = null;
  const version = (n, list) => ({
    version: n, at: new Date(Date.now() + n).toISOString(), agent_version: descriptor.agent_version, package_digest: "a".repeat(64),
    manifest: {
      format: "job-manifest-v1", agent: KEY, version: n, package_digest: "a".repeat(64), agent_version: descriptor.agent_version,
      pieces: list.map((p, i) => { const id = `art${n}-${i}`; arts.set(id, bytesOf(p)); return { name: p.name, media_type: p.media_type, step: p.step, ref: `mesh:artifacts:${id}`, size: bytesOf(p).length, digest: `sha256:${sha(bytesOf(p))}` }; }),
      sig: "x",
    },
  });
  const json = (status, data, headers = {}) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...headers } });
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ method, path: u.pathname, body });
    if (u.origin !== BASE) {
      const f = files[url];
      return f ? new Response(Buffer.from(f), { status: 200 }) : new Response("no", { status: 404 });
    }
    if (method === "GET" && u.pathname === `/a/${encodeURIComponent(handle)}`) return json(200, { agent_id: KEY });
    if (method === "GET" && u.pathname.startsWith("/a/")) return json(404, { error: "no such agent" });
    if (method === "GET" && u.pathname === `/v1/agents/${KEY}/descriptor`) {
      const b = Buffer.from(JSON.stringify(descriptor));
      return new Response(b, { status: 200, headers: { "x-descriptor-digest": sha(b) } });
    }
    if (method === "POST" && u.pathname === "/v1/operator/test-accounts") return json(200, { session: "sess", account: "acct1", email: body.email });
    if (u.pathname === "/v1/accounts/acct1/display-name" || u.pathname === "/v1/accounts/acct1/claim-name") return json(200, { handle: "usabilityx@example.com" });
    if (method === "POST" && u.pathname === "/v1/accounts/acct1/try") {
      if (body.job) { replied = true; return json(200, { ok: true }); }
      if (refuseRun) {
        job = { job: "ctx:1", agent: KEY, state: "refused", versions: [], refusal: { at: new Date().toISOString(), reason: refuseRun } };
        return json(200, { ok: false, queued: true, job: { job: "ctx:1" } });
      }
      job = answerFirst
        ? { job: "ctx:1", agent: KEY, state: "answered", versions: [], asked: { text: body.text }, answered: { at: new Date(Date.now() - 1000).toISOString(), text: answerFirst } }
        : { job: "ctx:1", agent: KEY, state: "asked", versions: [], asked: { text: body.text } };
      return json(200, { ok: false, queued: true, job: { job: "ctx:1" } });
    }
    if (method === "GET" && /^\/v1\/accounts\/acct1\/jobs\//.test(u.pathname)) {
      polls++;
      if (job && job.state === "answered" && replied) { const { answered, ...rest } = job; job = { ...rest, job: "J1", state: "delivered", versions: [version(1, made)] }; }
      if (job && job.state === "asked" && (!ask || replied) && polls >= 2) { job = { ...job, job: "J1", state: "delivered", versions: [version(1, made)] }; }
      return job ? json(200, job) : json(404, { error: "no job" });
    }
    if (method === "GET" && u.pathname === "/v1/accounts/acct1/cloud-agent/inbox") {
      return json(200, { messages: ask && !replied ? [{ id: "m1", from: KEY, text: "Who reads this note?", received_at: new Date().toISOString() }] : [] });
    }
    if (method === "POST" && u.pathname === "/v1/accounts/acct1/jobs/J1/revise") {
      if (change === "refuse") return json(200, { ok: false, error: { code: "NOT_REVISABLE", message: "This job does not take changes." } });
      if (change === "take") job = { ...job, versions: [...job.versions, version(2, made)], state: "delivered" };
      else job = { ...job, state: "changing", pending_revision: { at: new Date().toISOString(), text: body.text, steps: body.steps } };
      return json(200, { ok: true });
    }
    const am = /^\/v1\/accounts\/acct1\/artifacts\/(.+)$/.exec(u.pathname);
    if (method === "GET" && am) { const b = arts.get(decodeURIComponent(am[1])); return b ? new Response(b, { status: 200 }) : json(404, { error: "gone" }); }
    return json(404, { error: `not served: ${method} ${u.pathname}` });
  };
  return { fetchImpl, calls, get job() { return job; } };
}

/** A job folder with its message and files. */
export function jobFolder(message, files = {}) {
  const root = mkdtempSync(join(tmpdir(), "usability-"));
  const job = join(root, "job-1");
  mkdirSync(job, { recursive: true });
  writeFileSync(join(job, "message.txt"), message);
  const paths = [];
  for (const [name, content] of Object.entries(files)) {
    const p = join(job, name);
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, typeof content === "string" ? content : JSON.stringify(content));
    paths.push(p);
  }
  return { root, job, records: join(root, "records"), work: join(root, "work"), paths };
}

export const ENV = { MESH_API_BASE: BASE, TEST_ACCOUNT_KEY: "test-key" };
export const noSleep = async () => {};
