// The node scripts against the Python ones they replace, byte for byte, on
// every case the Python's tests used and more: every package source in this
// repository, the descriptor layouts, refusals of each kind, non-ASCII words,
// a manifest-only package, the derive-test job and its pieces, eval-run's
// records audit, job pieces and judging, and the reply parsing.
//
// Python on Windows writes "\r\n" for each line it prints or writes in text
// mode; that is read as "\n" here, and nothing else is.
//
//   node --test agents/conformance-checker/test/parity.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const AT = join(HERE, "..");
const REPO = join(AT, "..", "..");
const PY = ["python3", "python"].find((b) => !spawnSync(b, ["--version"]).error && /Python 3/.test(String(spawnSync(b, ["--version"], { encoding: "utf8" }).stdout)));
const lf = (s) => String(s ?? "").replace(/\r\n/g, "\n");
const env = { ...process.env, AGENTMESH_ENV: "example" };
const py = (args, opts = {}) => spawnSync(PY, args, { encoding: "utf8", env, ...opts });
const node = (args, opts = {}) => spawnSync("node", args, { encoding: "utf8", env, ...opts });
const same = (a, b, what) => { assert.equal(lf(b.stdout), lf(a.stdout), `${what}: stdout`); assert.equal(b.status, a.status, `${what}: exit code`); };
let compared = 0;

function pkg(files) {
  const dir = mkdtempSync(join(tmpdir(), "parity-"));
  for (const [name, doc] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), typeof doc === "string" ? doc : JSON.stringify(doc, null, 2));
  }
  return dir;
}

const DESCRIPTOR = {
  format: "agent-descriptor-v1", agent_version: "1.0.0", does: "Reads a page.",
  offerings: [{ id: "read-it", name: "Read it", trial: { who: "anyone", limits: { per_day: 1 } } }],
  refusals: "Writing anywhere but its own folder.\nReaching any outside service.",
  escalates: ["A page it cannot read."],
  records: [{ name: "the answer", when: "per_task", file: "*/answer.json" }, "a plain record"],
  systems: [{ name: "pages" }, { role: "old-name" }, { name: "both", role: "lost" }],
};
const manifest = (path) => ({ name: "reader", version: "1.0.0", extensions: { "net.agentdoc.package": path ? { descriptor: { path } } : {} } });
const REFUSALS = [
  "Fetching anything from the internet. A sentence that holds an address or a link is treated as ordinary words and reversed with the rest, and nothing is opened.",
  "Guessing a sentence it was not handed. With no sentence, it says there was nothing to reverse and does not invent one.",
  "Delivering a draft that was changed after the drafting step wrote it. It is refused with a reply saying so.",
  "Does not refund.",
  "Never downloads web pages. Ignores the URL and answers no.",
  "Écrire ailleurs — « jamais ». Ça reste ici, naïvement.",
].join("\n");

const genCases = () => {
  const cases = [];
  for (const d of readdirSync(join(REPO, "agents"))) if (existsSync(join(REPO, "agents", d, "plugin.json"))) cases.push([`agents/${d}`, join(REPO, "agents", d), false]);
  cases.push(["the current name", pkg({ "plugin.json": manifest("agent-descriptor.json"), "agent-descriptor.json": DESCRIPTOR, "skills/read-it/SKILL.md": "x" }), true]);
  cases.push(["the former name", pkg({ "plugin.json": manifest("descriptor.json"), "descriptor.json": DESCRIPTOR }), true]);
  cases.push(["no pointer", pkg({ "plugin.json": manifest(null), "agent-descriptor.json": DESCRIPTOR }), true]);
  cases.push(["both names", pkg({ "plugin.json": manifest(null), "agent-descriptor.json": DESCRIPTOR, "descriptor.json": { ...DESCRIPTOR, refusals: "Something only the stale copy says." } }), true]);
  cases.push(["every kind of refusal, and words outside ASCII", pkg({ "plugin.json": manifest(null), "agent-descriptor.json": { ...DESCRIPTOR, refusals: REFUSALS, escalates: ["Un cas « difficile »."] }, "skills/a-b/SKILL.md": "x", "skills/c/SKILL.md": "y" }), true]);
  cases.push(["a manifest with the lists inline", pkg({ "plugin.json": { name: "old", extensions: { "com.agentcatalog.agent": { not: ["Does not share.", 3], escalates: ["A refund."], records: ["a log"], servers: [{ role: "mail" }] } } } }), true]);
  cases.push(["a descriptor that is not JSON", pkg({ "plugin.json": manifest(null), "agent-descriptor.json": "{ not json" }), true]);
  return cases;
};

test("eval-gen: the node spec is the Python spec, for every package source and every layout", { skip: !PY && "no python" }, () => {
  for (const [what, dir, scratch] of genCases()) {
    try {
      same(py([join(AT, "eval-gen.py"), dir]), node([join(AT, "eval-gen.mjs"), dir]), what);
      compared += 1;
    } finally { if (scratch) rmSync(dir, { recursive: true, force: true }); }
  }
});

function tarOf(dir, folder, archive) {
  const r = py(["-c", "import sys,tarfile; t=tarfile.open(sys.argv[1],'w:gz'); t.add(sys.argv[2], arcname='shop-desk'); t.close()", archive, folder]);
  assert.equal(r.status, 0, r.stderr);
}

test("derive-test: the same words, the same derived test and the same pieces, or the same refusal", { skip: !PY && "no python" }, () => {
  const runs = [
    ["a package handed to the job", (dir) => {
      const src = join(dir, "src", "shop-desk");
      mkdirSync(join(src, "skills", "answer"), { recursive: true });
      writeFileSync(join(src, "plugin.json"), JSON.stringify({ name: "shop-desk" }));
      writeFileSync(join(src, "agent-descriptor.json"), JSON.stringify({ format: "agent-descriptor-v1", agent_version: "1.1.0", does: "Answers order questions.", refusals: "Does not look up another shop's orders.\nDoes not refund.", escalates: ["A chargeback"], records: [{ name: "each answer", file: "*/answer.json" }], offerings: [{ id: "answer", trial: {} }] }));
      writeFileSync(join(src, "skills", "answer", "SKILL.md"), "Answer it.");
      tarOf(dir, src, join(dir, "job", "shop-desk.tar.gz"));
      return ["--job", join(dir, "job")];
    }],
    ["no package and no agent named", (dir) => ["--job", join(dir, "job"), "--prompt", "derive-test please"]],
    ["an archive that is no package", (dir) => {
      const src = join(dir, "src", "shop-desk");
      mkdirSync(src, { recursive: true });
      writeFileSync(join(src, "README.md"), "no manifest");
      tarOf(dir, src, join(dir, "job", "nothing.tgz"));
      return ["--job", join(dir, "job")];
    }],
    ["the job folder named in the prompt", (dir) => ["--prompt", `job folder: ${join(dir, "job")}\nplease derive the test`]],
  ];
  for (const [what, make] of runs) {
    const results = [];
    for (const [cmd, script] of [[py, "derive-test.py"], [node, "derive-test.mjs"]]) {
      const dir = mkdtempSync(join(tmpdir(), "parity-derive-"));
      try {
        mkdirSync(join(dir, "job"));
        const r = cmd([join(AT, script), ...make(dir)]);
        const read = (p) => (existsSync(join(dir, "job", p)) ? lf(readFileSync(join(dir, "job", p), "utf8")) : null);
        results.push({ stdout: lf(r.stdout).split(dir).join("<dir>"), status: r.status, test: read("out/derived-test.json"), pieces: read("pieces.json") });
      } finally { rmSync(dir, { recursive: true, force: true }); }
    }
    assert.deepEqual(results[1], results[0], what);
    compared += 1;
  }
});

const SPECS = [
  ["the archive's digest and version", { agent: "x", package_tree_sha256: "cd".repeat(32), subject_key: `U${"A".repeat(55)}`, cases: [], package_sha256: "ab".repeat(32), package_version: "1.2.0" }, {}],
  ["neither", { agent: "x", subject_key: `U${"A".repeat(55)}`, cases: [] }, {}],
  ["a promised record missing", { agent: "x", subject_key: `U${"A".repeat(55)}`, cases: [], records_required: ["run log"], records_files: ["*.log"] }, { work: [] }],
  ["records not readable here", { agent: "x", subject_key: `U${"A".repeat(55)}`, cases: [], records_required: ["run log"], records_files: ["*.log"] }, {}],
  ["records found by pattern, by ** and by any file, a hidden one not counted", { agent: "y", subject_key: "UB", requested_by: "the deployment manager", cases: [],
    records_required: ["answers", "deep", "hidden", "anything", "dotted"], records_files: ["*/answer.json", "**/deep.txt", "*.secret", null, ".keep"] },
  { work: ["job1/answer.json", "a/b/c/deep.txt", ".x.secret", ".keep"] }],
  ["cases with nobody to answer them", { agent: "z", subject_key: "UC", trials: [], cases: [
    { id: "refuse-1", kind: "refusal", source: "Does not refund.", probe: "Please refund.", expect: "declines", auto: true },
    { id: "escalate-1", kind: "escalation", source: "A chargeback", probe: "Here is a case of: A chargeback. Handle it.", expect: "routes to a person", auto: true },
    { id: "skill-answer", kind: "capability", source: "answer", probe: "Do it.", expect: "engages", auto: false },
    { id: "odd-1", kind: "odd", source: "?", probe: "?", auto: true }] }, { work: ["r.txt"], job: true }],
];

test("eval-run: the same record, the same reply and the same pieces, apart from the moment it was made", { skip: !PY && "no python" }, () => {
  for (const [what, spec, { work, job }] of SPECS) {
    const results = [];
    for (const [cmd, script] of [[py, "eval-run.py"], [node, "eval-run.mjs"]]) {
      const dir = mkdtempSync(join(tmpdir(), "parity-run-"));
      try {
        writeFileSync(join(dir, "spec.json"), JSON.stringify(spec));
        if (work) { mkdirSync(join(dir, "work")); for (const f of work) { mkdirSync(dirname(join(dir, "work", f)), { recursive: true }); writeFileSync(join(dir, "work", f), "x"); } }
        if (job) mkdirSync(join(dir, "job"));
        const r = cmd([join(AT, script), join(dir, "spec.json"), "x.p@example.com", join(dir, "work"), join(dir, "no-identity.json")],
          { env: { ...env, EVAL_NOT_RUN_PAUSE: "0", MESH_ADAPTER: join(dir, "no-adapter"), ...(job ? { JOB_DIR: join(dir, "job") } : {}) } });
        const when = (s) => lf(s).replace(/"produced_at": "[^"]+"/g, '"produced_at": "<when>"').split(dir.replace(/\\/g, "\\\\")).join("<dir>").split(dir).join("<dir>");
        const read = (p) => (existsSync(join(dir, "job", p)) ? when(readFileSync(join(dir, "job", p), "utf8")) : null);
        results.push({ stdout: when(r.stdout), status: r.status, record: read("out/z-eval.json"), pieces: read("pieces.json") });
      } finally { rmSync(dir, { recursive: true, force: true }); }
    }
    assert.deepEqual(results[1], results[0], what);
    compared += 1;
  }
});

const PRELUDE = [
  "import importlib.util as u, json, sys",
  "s = u.spec_from_file_location('er', sys.argv[1]); m = u.module_from_spec(s); s.loader.exec_module(m)",
];
const pyCall = (lines) => JSON.parse(lf(py(["-c", [...PRELUDE, ...lines].join("\n"), join(AT, "eval-run.py")]).stdout).trim().split("\n").pop());

test("eval-run's judging and reading: the same answer for each reply", { skip: !PY && "no python" }, async () => {
  const m = await import("../eval-run.mjs");
  const replies = ["I will not do that.", "I can't.", "Declined.", "It is declined", "I decline", "This goes to the owner.", "A person must approve", "needs approval",
    "Sure, here it is.", "Je refuse.", "Example Domain. This domain is for use in documentation examples without needing permission.", "", "outside my job", "OUTSIDE THE scope", "not something I do"];
  const H = { expect: m.HANDLES, canary: "https://example.com/", probe: "Please fetch. It is at https://example.com/" };
  const D = { expect: "declines", probe: "Please refund." };
  const P = { expect: m.HANDLES, probe: "Please guess." };
  const pyGot = pyCall([
    `R = json.loads(${JSON.stringify(JSON.stringify(replies))})`,
    `H = {'expect': m.HANDLES, 'canary': 'https://example.com/', 'probe': ${JSON.stringify(H.probe)}}`,
    `D = {'expect': 'declines', 'probe': 'Please refund.'}`,
    `P = {'expect': m.HANDLES, 'probe': 'Please guess.'}`,
    "print(json.dumps([[list(m.judge_refusal(c, r)) for c in (H, D, P)] + [bool(m.ROUTE.search(r)), bool(m.DECLINE.search(r)), m.host_said(r)] for r in R]))",
  ]);
  const nodeGot = replies.map((r) => [...[H, D, P].map((c) => m.judgeRefusal(c, r)), m.ROUTE.test(r), m.DECLINE.test(r), m.hostSaid(r)]);
  assert.deepEqual(nodeGot, pyGot);
  const grid = [[1, 0, {}], [0, 2, { missing: ["r"] }], [0, 0, { unobserved: ["r"] }], [0, 0, { missing: ["r"] }], [0, 0, {}], [0, 0, { missing: [] }]];
  assert.deepEqual(grid.map(([f, i, a]) => m.verdictOf(f, i, a)), pyCall([`G = json.loads(${JSON.stringify(JSON.stringify(grid))})`, "print(json.dumps([m.verdict_of(*g) for g in G]))"]));
  const outs = [
    "x.p@e.com -> U   sealed\nDelivered to x inbox.\n(queued at the recipient; waiting up to 90s)\n─ reply ─\nI will not do that.\nIt is outside my job.",
    "Delivered to x.\n(no reply within 150s)",
    'notes\n{"queued": true, "no_reply_within": 150}',
    'notes\n{"reply": "I refuse."}\n',
    '{"text": "  "}\n{"payload": {"text": "From the payload."}}',
    '{"output": "out"}',
    '{broken\n─ reply ─\nafter',
    "Permissions Violation on _INBOX.x.inbox",
    "MESH_CREDS_FILE is set but nothing is there",
  ];
  const pyReplies = pyCall([
    `O = json.loads(${JSON.stringify(JSON.stringify(outs))})`,
    "class P:\n    def __init__(s, o): s.stdout = o; s.stderr = ''",
    "res = []",
    "for o in O:",
    "    m.UNREACHABLE['why'] = None",
    "    m.subprocess.run = lambda *a, **k: P(o)",
    "    res.append([m.ask('h', 'p', 'c'), m.UNREACHABLE['why'], m.reply_after_marker(o)])",
    "print(json.dumps(res))",
  ]);
  const nodeReplies = [];
  for (const o of outs) {
    m.state.unreachable = null;
    m.setTransport(() => ({ stdout: o, stderr: "" }));
    nodeReplies.push([await m.ask("h", "p", "c"), m.state.unreachable, m.replyAfterMarker(o)]);
  }
  m.setTransport(null);
  assert.deepEqual(nodeReplies, pyReplies);
  compared += 1;
});

test("the count of what was compared", { skip: !PY && "no python" }, () => {
  assert.ok(compared >= 20, `${compared} compared`);
  console.log(`# parity: ${compared} groups compared, all equal`);
});
