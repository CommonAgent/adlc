// What the suites share: a job folder with attached files, and a ledger that
// keeps what is filed in memory and answers the two doors the analyst uses.
//   import { job, memoryLedger, descriptor } from "./helpers.mjs"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** A job folder holding message.txt and the attached files, and the argv the
 *  run command would be given. Each file is {name, doc|text, type}. */
export function job({ message = "", files = [], id = "job-1", root = mkdtempSync(join(tmpdir(), "impact-analyst-")) } = {}) {
  const jobDir = join(root, "jobs", id);
  mkdirSync(jobDir, { recursive: true });
  writeFileSync(join(jobDir, "message.txt"), message);
  const argv = ["--job", jobDir, "--records", join(root, "records"), "--work", join(root, "work"), "--text-file", join(jobDir, "message.txt")];
  for (const f of files) {
    const at = join(root, "attached", f.name);
    mkdirSync(join(root, "attached"), { recursive: true });
    writeFileSync(at, f.text ?? JSON.stringify(f.doc, null, 2));
    argv.push("--file", `${at}::${f.type ?? ""}`);
  }
  return { root, jobDir, argv, recordsDir: join(root, "records", id) };
}

/** A ledger in memory, answering GET /v1/operator/debt and
 *  POST /v1/operator/debt/items the way the platform's does, with the key it
 *  was made with. */
export function memoryLedger({ key = "ledger-test-key", refuse = null } = {}) {
  const items = [];
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    calls.push({ method: init.method ?? "GET", path: u.pathname, search: u.search });
    const answer = (status, body) => ({ ok: status < 300, status, text: async () => JSON.stringify(body) });
    if ((init.headers?.authorization ?? "") !== `Bearer ${key}`) return answer(401, { error: "Authentication required" });
    if (u.pathname === "/v1/operator/debt" && (init.method ?? "GET") === "GET") {
      const against = u.searchParams.getAll("against");
      const got = items.filter((i) => !against.length || against.includes(i.against));
      return answer(200, { total: got.length, counts: {}, kinds: {}, items: [...got].reverse() });
    }
    if (u.pathname === "/v1/operator/debt/items" && init.method === "POST") {
      if (refuse) return answer(400, { error: refuse });
      const body = JSON.parse(init.body);
      if (body.kind !== "dependency" || !body.against || !body.what || !body.owed_to || !body.who) return answer(400, { error: "a field is missing" });
      const item = { number: 500 + items.length + 1, state: "open", filed_by: body.who, ...body };
      items.push(item);
      return answer(201, { ok: true, item });
    }
    return answer(404, { error: "no such door" });
  };
  return { items, calls, fetchImpl, key, env: { LEDGER_TOKEN: key, MESH_API_BASE: "https://app.mesh.example.com" } };
}

/** A small agent's declaration, to change one thing at a time. */
export function descriptor(version = "1.0.0", change = (d) => d) {
  const d = {
    format: "agent-descriptor-v1",
    agent_version: version,
    does: "Checks the tone of a piece of writing.",
    offerings: [{
      id: "check",
      name: "Check the tone",
      does: "Checks the tone and says what to change.",
      inputs: [{ name: "text", kind: "text/markdown", required: true }],
      outputs: [
        { name: "verdict", kind: "application/vnd.example.verdict+json", when: "per_task" },
        { name: "notes", kind: "text/markdown", when: "per_task" },
      ],
      how: { control: "script", intelligence: "called", cost: "metered", contract: "full" },
    }],
    refusals: "Rewriting the text. It says what to change and changes nothing.",
    records: [{ name: "the verdict, per job", when: "per_task", file: "*/verdict.json" }],
    systems: [{ name: "text-reasoning", access: "trigger", needs: "to read the tone" }],
  };
  return change(JSON.parse(JSON.stringify(d)));
}

export const KEY = "UTONECHECKKEY000000000000000000000000000000000000000000000";
export const HANDLE = "tone-check.example.com@example.com";

/** A canvas with Start, the agent and one reader of one of its outputs. */
export function canvas({ id, org, output, reader, readerPort, readerKind }) {
  return {
    id, name: `Solution ${id}`, org,
    nodes: [
      { id: "n_start", kind: "start", agent: "", label: "Start", ports: { agent: "", label: "Start", offerings: [{ id: "start", name: "Start", inputs: [], outputs: [{ id: "start.out.text", name: "text", media_type: "text/markdown" }] }] } },
      { id: "n_tone", kind: "agent", agent: KEY, label: "Tone check", ports: null },
      { id: "n_reader", kind: "agent", agent: `U${reader.toUpperCase()}`, label: reader, ports: { agent: `U${reader.toUpperCase()}`, label: reader, offerings: [{ id: "work", name: "Work", inputs: [{ id: `work.in.${readerPort}`, name: readerPort, media_type: readerKind, required: true }], outputs: [] }] } },
    ],
    connections: [
      { from_node: "n_start", from_port: "start.out.text", to_node: "n_tone", to_port: "check.in.text" },
      { from_node: "n_tone", from_port: `check.out.${output}`, to_node: "n_reader", to_port: `work.in.${readerPort}` },
    ],
  };
}

/** The platform's list: two solutions whose canvases place the agent, and an
 *  account known only from the record of who called it. */
export function dependents() {
  return {
    subject: { kind: "agent", id: KEY, name: HANDLE },
    view: "owner", window_days: 90, read_at: "2026-10-27T12:00:00.000Z",
    dependents: [
      { kind: "solution", id: "sol_a", name: "Review desk", owner: { org: "org_a", name: "Org A", yours: false, platform: false }, declared: true, observed: false, found_by: [{ source: "canvas", observed: false, words: "It uses this agent." }], via: null, use: null, public: false, url: null },
      { kind: "solution", id: "sol_b", name: "Writing room", owner: { org: "org_b", name: "Org B", yours: false, platform: false }, declared: true, observed: false, found_by: [{ source: "canvas", observed: false, words: "It uses this agent." }], via: null, use: null, public: false, url: null },
      { kind: "account", id: null, name: null, owner: { org: "org_c", name: "Org C", yours: false, platform: false }, declared: false, observed: true, found_by: [{ source: "calls", observed: true, words: "It sent this agent work 4 times in the last 90 days." }], via: null, use: { count: 4, last_at: "2026-10-26T09:00:00.000Z", offerings: [] }, public: false, url: null },
    ],
    unread: [],
    not_read: ["competitor watches"],
  };
}

export const SOLUTIONS = () => [
  canvas({ id: "sol_a", org: "org_a", output: "verdict", reader: "Reviewer", readerPort: "verdict", readerKind: "application/vnd.example.verdict+json" }),
  canvas({ id: "sol_b", org: "org_b", output: "notes", reader: "Writer", readerPort: "notes", readerKind: "text/markdown" }),
];

/** The files for one change: the two declarations, the list and the canvases. */
export function changeFiles(before, after, { runtimes = [], extra = [] } = {}) {
  const T = { d: "application/vnd.agentmesh.agent-descriptor+json", l: "application/vnd.agentmesh.dependents+json", s: "application/vnd.agentmesh.solution+json", r: "application/vnd.agentmesh.agent-runtime-requirements+json" };
  return [
    { name: "running.json", doc: before, type: T.d },
    { name: "changed.json", doc: after, type: T.d },
    { name: "dependents.json", doc: dependents(), type: T.l },
    ...SOLUTIONS().map((s) => ({ name: `${s.id}.json`, doc: s, type: T.s })),
    ...runtimes.map((r, i) => ({ name: `runtime-${i}.json`, doc: r, type: T.r })),
    ...extra,
  ];
}
