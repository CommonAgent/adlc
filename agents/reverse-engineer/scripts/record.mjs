// Write the record: the six parts of the as-built record and the record that
// ties them to their source, from the facts read by rule, the draft as
// checked, the bill of materials, the baseline run and the tests carried
// (carried.mjs); and the completeness check (0.3.0), which reads the code
// again by code and lists, as gaps, what a rebuild needs that the record
// does not hold.
//
// Pure: it is handed everything (with `read`, which answers a file's text, for
// checking quotes byte for byte) and answers the documents; pieces.mjs writes
// them. The same inputs give the same bytes, with one exception said where it
// is: the baseline run's own results (its time and what it printed) are an
// observation, and differ from one run to the next.
//
//   needs: node >= 22. Nothing here reads or writes a file.
//   import { buildRecord } from "./record.mjs"
import { createHash } from "node:crypto";
import { checkClaims, checkEvidence, touchesChange } from "./evidence.mjs";
import { anchorsWithout, checkBehaviors, labelOf } from "./behaviors.mjs";
import { buildInterfaces } from "./interfaces.mjs";
import { KIND_NAMES } from "./kinds.mjs";
import { CODE_EXT, isTestFile } from "./facts.mjs";
import { exportsOf, stringsOf, writesOf } from "./surface.mjs";
import { readDeclarations } from "./declarations.mjs";

const trim = (s) => String(s ?? "").trim();

/** What a drafted schema is checked against: whether a field name is written
 *  in the code, and whether a constant is a literal there. Read from the
 *  surface where the code is JavaScript, and from the text of every code
 *  file otherwise. */
export function knownIn(files, read, surface) {
  let texts = null;
  const all = () => {
    texts ??= [...files].filter((f) => CODE_EXT.has(`.${f.split(".").pop()}`.toLowerCase()) && !isTestFile(f)).map((f) => read(f)).filter((t) => typeof t === "string");
    return texts;
  };
  const words = new Set();
  for (const [f, s] of surface?.scanned ?? []) if (!isTestFile(f)) for (const w of s.masked.match(/[A-Za-z_$][\w$]*/g) ?? []) words.add(w);
  const strings = surface?.strings ?? new Set();
  const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return {
    inCode: (name) => words.has(name) || strings.has(name) || all().some((t) => new RegExp(`(^|[^\\w$])${esc(name)}([^\\w$]|$)`).test(t)),
    literalInCode: (v) => {
      if (v === null) return true;
      if (typeof v === "string") return strings.has(v) || all().some((t) => t.includes(JSON.stringify(v)) || t.includes(`'${v}'`));
      if (typeof v === "number" || typeof v === "boolean") return all().some((t) => new RegExp(`(^|[^\\w.])${esc(String(v))}([^\\w.]|$)`).test(t));
      return false;
    },
  };
}
const sha = (t) => createHash("sha256").update(t).digest("hex");

/** Each part's format word and file name, in the order the stage lists them. */
export const PARTS = [
  { part: "behaviors", format: "as-built-behaviors-v1", file: "behaviors.json" },
  { part: "architecture as built", format: "as-built-architecture-v1", file: "architecture.json" },
  { part: "interfaces", format: "as-built-interfaces-v1", file: "interfaces.json" },
  { part: "dependencies", format: "CycloneDX 1.5", file: "sbom.cdx.json" },
  { part: "existing tests and gaps", format: "as-built-tests-and-gaps-v1", file: "tests-and-gaps.json" },
  // 0.3.0: every string a person reads and every pattern in the scripts.
  { part: "strings", format: "as-built-strings-v1", file: "strings.json" },
];
export const RECORD_FORMAT = "as-built-record-v1";

const ID = /^B(\d+)$/;

/** Behavior ids: on adoption B1, B2, ... in the order drafted; on drift a
 *  changed or removed behavior keeps the id it had (when the last record had
 *  it), and a new one takes the next number after the last record's highest.
 *  Answers {behaviors, idOf: model id -> final id}. */
export function assignIds(behaviors, { previous = [], drift = false } = {}) {
  const had = new Set(previous.map((b) => b.id));
  let next = Math.max(0, ...previous.map((b) => Number(ID.exec(b.id)?.[1] ?? 0))) + 1;
  const idOf = new Map(); const taken = new Set();
  const out = [];
  for (const b of behaviors) {
    const { change: drafted, was: draftedWas, ...rest } = b;
    let change = drift ? (["new", "changed", "removed"].includes(trim(drafted)) ? trim(drafted) : "new") : null;
    const was = trim(draftedWas) || (change && change !== "new" ? trim(b.id) : "");
    let id = null;
    if (change && change !== "new" && had.has(was) && !taken.has(was)) id = was;
    else {
      // A changed behavior the last record did not have is new to the record.
      if (change === "changed") change = "new";
      while (had.has(`B${next}`) || taken.has(`B${next}`)) next += 1;
      id = `B${next}`; next += 1;
    }
    taken.add(id);
    if (trim(b.id)) idOf.set(trim(b.id), id);
    out.push({ ...rest, id, ...(change ? { change } : {}), ...(change && change !== "new" && id === was ? { was } : {}) });
  }
  return { behaviors: out, idOf };
}

const words = (v) => (Array.isArray(v) ? v.map((x) => (typeof x === "string" ? trim(x) : JSON.stringify(x))).filter(Boolean) : trim(v) ? [trim(v)] : []);

/** A behavior in the feature list's shape, with its evidence, marked as built. */
function behaviorOut(b) {
  return {
    id: b.id,
    name: trim(b.name),
    does: trim(b.does),
    ...(trim(b.offering) ? { offering: trim(b.offering) } : {}),
    inputs: words(b.inputs),
    outputs: words(b.outputs),
    refusals: words(b.refusals),
    error_handling: words(b.error_handling),
    ...(b.kind ? { kind: b.kind } : {}),
    ...(b.anchor ? { anchor: b.anchor } : {}),
    quotes: b.quotes ?? [],
    rules: b.rules ?? [],
    constants: b.constants ?? [],
    evidence: b.evidence,
    ...(b.change ? { change: b.change } : {}),
    ...(b.change && b.change !== "new" && trim(b.was) ? { was: trim(b.was) } : {}),
    as_built: true,
  };
}

/** Merge items by name: the first of each name kept, evidence from all. */
function mergeByName(items, key = "name") {
  const out = new Map();
  for (const it of items) {
    const k = trim(it[key]).toLowerCase();
    if (!k) continue;
    if (!out.has(k)) out.set(k, { ...it, evidence: [...it.evidence] });
    else {
      const have = out.get(k);
      for (const e of it.evidence) if (!have.evidence.some((x) => JSON.stringify(x) === JSON.stringify(e))) have.evidence.push(e);
    }
  }
  return [...out.values()];
}

const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined && o[k] !== null && o[k] !== "").map((k) => [k, typeof o[k] === "string" ? trim(o[k]) : o[k]]));

/** The completeness check (0.3.0), by code: what a rebuild needs, read again
 *  from the code here, against what the record holds. Every export (function
 *  and constant) has an interface; every file the code writes has a file
 *  interface; every command has its required flags settled; every
 *  declaration in the agent's own files has a declaration interface;
 *  strings.json holds every string the scanner finds. `inScope(file, line)`
 *  limits it to what the record covers (on drift, the changed lines).
 *  Answers {counts, gaps}: counts by check `{found, covered, missing}`, and a
 *  gap for each thing missing, with what and why. */
export function completeness({ surface, interfaces, files = [], read = () => null, strings = [], inScope = () => true }) {
  const gaps = []; const counts = {};
  const tally = (name, expected, has, what, why) => {
    const missing = expected.filter((x) => !has(x));
    counts[name] = { found: expected.length, covered: expected.length - missing.length, missing: missing.length };
    for (const x of missing) gaps.push({ kind: "incomplete", part: "completeness", about: what(x), why: why(x), ...(x.evidence ? { evidence: x.evidence } : {}) });
  };
  const code = surface?.code ?? [];
  const scanned = surface?.scanned ?? new Map();
  const ifs = (kind) => interfaces.filter((i) => i.kind === kind);

  const exp = [];
  for (const f of code) {
    for (const e of exportsOf(scanned.get(f))) {
      if (!inScope(f, e.line)) continue;
      exp.push({ module: f, name: e.name, star: e.name.startsWith("* from ") ? e.from : null, evidence: [{ file: f, line: e.line }] });
    }
  }
  const exported = [...ifs("function"), ...ifs("constant")];
  tally("exports", exp,
    (x) => (x.star ? exported.some((i) => i.module === x.module && i.from === x.star) || ifs("constant").some((i) => i.module === x.module && i.export === x.name) : exported.some((i) => i.module === x.module && i.export === x.name)),
    (x) => `the export ${x.name} of ${x.module}`, () => "the code exports it and no interface in interfaces.json describes it, so a rebuild would not know to export it");

  const writes = [];
  for (const f of code) for (const w of writesOf(scanned.get(f))) if (inScope(f, w.line)) writes.push({ ...w, file: f, evidence: [{ file: f, line: w.line }] });
  const fileIfs = ifs("file");
  tally("files_written", writes,
    (w) => fileIfs.some((i) => (w.path ? i.path === w.path : i.written_as === w.written_as) && i.evidence.some((e) => e.file === w.file)),
    (w) => `the file ${w.path ?? `named by ${w.written_as}`} written by ${w.file}`, () => "the code writes it and no file interface in interfaces.json describes it");

  const cmdIfs = ifs("command");
  tally("commands_required_flags", (surface?.entries ?? []).map((e) => ({ file: e.file, evidence: e.evidence })),
    (c) => cmdIfs.some((i) => i.command === c.file && Array.isArray(i.required_flags) && !i.flags_unsettled),
    (c) => `the required flags of the command ${c.file}`,
    (c) => {
      const i = cmdIfs.find((x) => x.command === c.file);
      if (!i) return "the code starts it as a command and no command interface describes it";
      return `which flags it cannot run without is not settled for ${i.flags_unsettled.map((x) => `${x.flag} (${x.why})`).join("; ")}, and the draft did not settle them with evidence that checks`;
    });

  const decls = readDeclarations(files, read).filter((d) => d.evidence.some((e) => inScope(e.file, e.line)));
  const declIfs = new Set(ifs("declaration").map((i) => i.declared_in));
  tally("declarations", decls, (d) => declIfs.has(d.declared_in), (d) => `${d.name} (${d.declared_in})`, () => "the agent declares it in its own files and no declaration interface in interfaces.json holds it");

  const key = (x) => `${x.file}\n${x.line}\n${x.kind}\n${x.text}`;
  const have = new Set(strings.map(key));
  const found = [];
  for (const f of code) for (const t of stringsOf(scanned.get(f))) if (inScope(f, t.line)) found.push({ file: f, ...t, evidence: [{ file: f, line: t.line }] });
  tally("strings", found, (x) => have.has(key(x)), (x) => `the ${x.kind === "pattern" ? "pattern" : "string"} ${JSON.stringify(x.text.slice(0, 60))} at ${x.file}:${x.line}`, () => "the scanner finds it in the code and strings.json does not hold it");

  counts.missing = Object.values(counts).reduce((n, c) => n + c.missing, 0);
  return { counts, gaps };
}

/** The whole record. `draft` is null when no model drafted. */
export function buildRecord({ source, facts, draft, draftProblem = "", sbom, baseline, notSent = [], seen = null, ctx, read = () => null, drift = null, previous = null, tool, carried = null }) {
  const gaps = [];
  const add = (g) => gaps.push(g);
  const d = draft ?? { behaviors: [], architecture: { kind: null, parts: [], entry_points: [], data_stores: [], systems: [], networks: [], settings: [], starts_and_runs: [], dependencies: [], formats: [] }, interfaces: [], tests: [], gaps: [] };
  const surface = facts.surface ?? null;

  if (!draft) {
    for (const part of ["behaviors", "architecture as built", "interfaces", "what each test covers"]) {
      add({ kind: "not-drafted", part, about: `the ${part}`, why: `no model drafted from the code (${draftProblem || "no model was reached"}), so only what is read by rule is in the record` });
    }
  }
  for (const m of draft?.missing ?? []) add({ kind: "not-drafted", part: m.part, about: m.about, why: `the pass that drafts it did not answer (${m.why || "no answer"}), so only what is read by rule is in the record` });
  const notRead = new Map();
  for (const n of notSent) { if (!notRead.has(n.file)) notRead.set(n.file, []); notRead.get(n.file).push(n); }
  for (const [file, list] of notRead) {
    const why = list.map((n) => (n.pass ? `the ${n.pass} pass was not shown it: ${n.why}` : `the model was not shown this file: ${n.why}`)).join("; ");
    add({ kind: "not-read", part: "all", about: file, why: seen?.has(file) ? `${why}; another pass was shown it` : `${why}; nothing in the record describes what is in it` });
  }

  // Behaviors: the evidence, then the kind, the anchor, the quotes and the rules.
  const checkedB = checkClaims(d.behaviors, ctx, { part: "behaviors", label: labelOf, fields: ["name", "does", "inputs", "outputs", "refusals", "error_handling"], drift });
  checkedB.gaps.forEach(add);
  const detail = checkBehaviors(checkedB.kept, ctx, { read, surface, drift });
  detail.gaps.forEach(add);
  for (const g of checkedB.gaps) {
    const b = d.behaviors.find((x) => labelOf(x) === g.about);
    if (trim(b?.anchor)) detail.anchorsHeld.add(trim(b.anchor).replace(/^\.\//, ""));
  }
  if (draft && !drift) anchorsWithout(surface, detail.kept, detail.anchorsHeld, draft.behavior_files ?? null).forEach(add);
  const { behaviors, idOf } = assignIds(detail.kept, { previous: previous?.behaviors ?? [], drift: Boolean(drift) });
  const behaviorsDoc = { format: "as-built-behaviors-v1", as_built: true, repository: source.repository, commit: source.commit, ...(drift ? { since: drift.since } : {}), behaviors: behaviors.map(behaviorOut) };

  // Architecture as built, in the architecture record's shape.
  const a = d.architecture;
  const arch = (list, part, label, fields = ["name", "does", "how", "why", "step"]) => {
    const r = checkClaims(list, ctx, { part: `architecture as built: ${part}`, label, fields, drift });
    r.gaps.forEach(add);
    return r.kept;
  };
  const keepSetting = (s) => ({ name: trim(s.name), credential: s.credential === true, evidence: s.evidence });
  const settingsFromModel = arch(a.settings.map((s) => ({ name: s.name, credential: /(^|_)(KEY|TOKEN|SECRET|PASSWORD|PASS|PWD|CREDENTIALS?|AUTH|PRIVATE|CERT)(_|$)/i.test(trim(s.name)) || s.credential === true, evidence: s.evidence })), "settings", (c) => trim(c.name), ["name"]);
  const settings = mergeByName([...facts.settings, ...settingsFromModel].map(keepSetting)).sort((x, y) => x.name.localeCompare(y.name));
  const entry = mergeByName([...facts.entry_points, ...arch(a.entry_points, "entry points", (c) => trim(c.name))].map((e) => ({ ...pick(e, ["name", "how"]), evidence: e.evidence })));
  const starts = mergeByName([...facts.starts_and_runs, ...arch(a.starts_and_runs, "how it starts and runs", (c) => trim(c.step), ["step"])].map((s) => ({ step: trim(s.step), evidence: s.evidence })), "step");
  let kind = null;
  if (a.kind && trim(a.kind.kind)) {
    const k = arch([a.kind], "kind", (c) => trim(c.kind), ["why"]);
    if (k.length) kind = { ...pick(k[0], ["kind", "why"]), evidence: k[0].evidence };
  }
  const systems = arch(a.systems, "systems", (c) => trim(c.name), ["name", "why"]).map((s) => ({ ...pick(s, ["name", "product", "access", "why"]), evidence: s.evidence }));
  const parts = arch(a.parts, "parts", (c) => trim(c.name)).map((p) => ({ ...pick(p, ["name", "does"]), evidence: p.evidence }));
  const stores = arch(a.data_stores, "data stores", (c) => trim(c.name)).map((p) => ({ ...pick(p, ["name", "how"]), evidence: p.evidence }));
  const networks = arch(a.networks, "networks reached", (c) => trim(c.destination), ["destination", "why"]).map((p) => ({ ...pick(p, ["destination", "why"]), evidence: p.evidence }));
  const deps = arch(a.dependencies, "dependencies", (c) => trim(c.name), ["name", "why"]).map((p) => ({ ...pick(p, ["name", "what", "why"]), evidence: p.evidence }));
  const formats = arch(a.formats, "formats", (c) => trim(c.piece), ["piece"]).map((p) => ({ ...pick(p, ["direction", "piece", "kind"]), evidence: p.evidence }));
  const archGaps = gaps.filter((g) => String(g.part).startsWith("architecture"));
  const architectureDoc = {
    format: "as-built-architecture-v1",
    record: "architecture-record-v1",
    as_built: true,
    repository: source.repository,
    commit: source.commit,
    ...(drift ? { since: drift.since } : {}),
    statement: null,
    environments: [],
    kind,
    done: false,
    questions: [],
    systems,
    bindings: {},
    dependencies: deps,
    limits: {},
    egress: networks,
    formats,
    standing_assets: null,
    settings,
    decisions: [],
    parts,
    entry_points: entry,
    data_stores: stores,
    starts_and_runs: starts,
    not_in_the_code: [
      "statement: an as-built record answers no statement of the job; Requirements writes one",
      "environments and bindings: the code does not say which product each environment binds; the solution architect records that",
      "limits: what the agent may spend, how fast it must answer and which parties it trusts are commitments, not code",
      "decisions: the reasons behind the code are not in the code; only what it does is",
    ],
    ...(archGaps.length ? { gaps_in_this_part: archGaps.length } : {}),
  };
  if (!kind && draft && !drift) add({ kind: "unclear", part: "architecture as built: kind", about: "what the code is made of, in the architecture standard's words", why: "the draft named no kind with evidence that checks" });

  // Interfaces, with the schemas found and derived.
  const checkedI = checkClaims(d.interfaces, ctx, { part: "interfaces", label: (c) => `${trim(c.kind)} ${trim(c.name)}`.trim(), fields: ["name", "does", "returns"], drift });
  checkedI.gaps.forEach(add);
  const built = buildInterfaces({ surface, checked: checkedI.kept, settingsRead: settings.filter((x) => facts.settings.some((f) => f.name === x.name)), declared: facts.declared_settings ?? [], declarations: facts.declarations ?? [], requiredFlags: facts.required_flags ?? new Map(), checkEv: (list) => checkEvidence(list, ctx).kept, known: knownIn(ctx.files, read, surface), gap: add });
  const { interfaces } = built;
  const schemaFiles = [...built.schemaFiles];
  const found = [];
  for (const f of facts.schemas) {
    const entry = { file: f.file, format: f.format, sha256: f.sha256, evidence: [{ file: f.file, line: 1 }] };
    if (f.doc && f.encoding === "json") {
      const name = `schemas/found/${f.file.replace(/\//g, "__")}`;
      schemaFiles.push({ file: name, format: f.format, text: `${JSON.stringify(f.doc, null, 2)}\n`, derived: false, from: f.file });
      entry.copied_to = name;
    }
    found.push(entry);
  }
  const interfacesDoc = {
    format: "as-built-interfaces-v1", as_built: true, repository: source.repository, commit: source.commit, ...(drift ? { since: drift.since } : {}),
    interfaces, constants: built.constants, flags: built.flags, environment: built.environment, settings: built.settings,
    schemas_found: found, schemas_derived: schemaFiles.filter((s) => s.derived).map((s) => ({ file: s.file, format: s.format, interface: s.interface, ...(s.read_by_rule ? { read_by_rule: true } : {}), ...(s.drafted ? { drafted: true } : {}) })),
  };

  // Imports that reach outside the codebase's folder.
  for (const o of surface?.outside ?? []) add({ kind: "outside-the-codebase", part: "dependencies", about: `${o.file} imports ${o.spec}`, why: `the code depends on a file outside the codebase's folder (${o.resolved}, from the folder's top), which this record does not describe and a copy of the folder alone does not carry; what imports it fails to load without it`, evidence: [{ file: o.file, line: o.line }] });

  // Tests: the files found by rule, what each covers as checked, the run.
  const coverage = new Map();
  for (const t of d.tests) {
    const { kept } = checkEvidence(t.evidence, ctx);
    const file = trim(t.file);
    // An id of the last record's still names that behavior on drift.
    const covers = words(t.covers).map((id) => idOf.get(id) ?? ((previous?.behaviors ?? []).some((b) => b.id === id) ? id : null)).filter(Boolean);
    if (!kept.length || !file) { add({ kind: "claim-without-evidence", part: "existing tests and gaps", about: `what ${file || "a test"} covers`, why: "the draft said what it covers with no evidence that checks" }); continue; }
    if (words(t.covers).length && !covers.length) { add({ kind: "unclear", part: "existing tests and gaps", about: `what ${file} covers`, why: `it was drafted as covering ${words(t.covers).join(", ")}, and none of those is a behavior in this record` }); continue; }
    const have = coverage.get(file) ?? { covers: new Set(), evidence: [] };
    covers.forEach((c) => have.covers.add(c));
    have.evidence.push(...kept);
    coverage.set(file, have);
  }
  const inScope = (f) => !drift || drift.byNewFile.has(f);
  const tests = facts.tests.filter((t) => inScope(t.file)).map((t) => ({
    file: t.file,
    cases: t.cases.map((c) => ({ name: c.name, evidence: [{ file: t.file, line: c.line }] })),
    covers: [...(coverage.get(t.file)?.covers ?? [])].sort((x, y) => Number(x.slice(1)) - Number(y.slice(1))),
    ...(coverage.get(t.file) ? { covers_evidence: coverage.get(t.file).evidence } : {}),
  }));
  const covered = new Set(tests.flatMap((t) => t.covers));
  const withoutTests = behaviors.filter((b) => b.change !== "removed" && !covered.has(b.id)).map((b) => b.id);

  // The model's own gaps: kept as gaps, with only the evidence that checks.
  for (const g of d.gaps) {
    const { kept } = checkEvidence(g.evidence, ctx);
    add({ kind: ["unreachable", "run-time-only", "unclear"].includes(trim(g.kind)) ? trim(g.kind) : "unclear", part: "drafted", about: trim(g.about) || "(not said)", ...(trim(g.why) ? { why: trim(g.why) } : {}), ...(kept.length ? { evidence: kept } : {}) });
  }
  for (const g of sbom?.gaps ?? []) add({ ...g, part: "dependencies" });
  if (!source.commit_checked) add({ kind: "not-checked", part: "record", about: `that the code read is commit ${source.commit}`, why: "the folder is not a git checkout, so the commit was taken as given and not checked against the files" });
  if (baseline && !baseline.ran) add({ kind: "run-time-only", part: "existing tests and gaps", about: "what the code does when it runs, and what its tests report", why: baseline.why });
  if (baseline?.ran && baseline.passed === undefined) add({ kind: "unclear", part: "existing tests and gaps", about: "how many tests passed and failed in the baseline run", why: "what the run printed has no summary this agent reads; its exit code stands" });

  // 0.3.0: the original tests carried, and what they import from outside.
  for (const g of carried?.gaps ?? []) add(g);

  // 0.3.0: every string a person reads and every pattern, as written.
  const stringsDoc = {
    format: "as-built-strings-v1", as_built: true, repository: source.repository, commit: source.commit, ...(drift ? { since: drift.since } : {}),
    strings: (surface?.texts ?? []).map((x) => ({ file: x.file, line: x.line, ...(x.end_line ? { end_line: x.end_line } : {}), kind: x.kind, text: x.text })),
  };

  // 0.3.0: the completeness check, by code.
  const scope = drift ? (file, line) => touchesChange([{ file, line }], "new", drift) : () => true;
  const complete = completeness({ surface, interfaces, files: ctx.files ? [...ctx.files] : [], read, strings: stringsDoc.strings, inScope: scope });
  complete.gaps.forEach(add);

  const numbered = gaps.map((g, i) => ({ id: `G${i + 1}`, ...g }));
  const testsDoc = {
    format: "as-built-tests-and-gaps-v1",
    as_built: true,
    repository: source.repository,
    commit: source.commit,
    ...(drift ? { since: drift.since } : {}),
    tests,
    test_command: facts.test_command.command ? { command: facts.test_command.command, evidence: facts.test_command.evidence, ...(facts.test_command.found_by ? { found_by: facts.test_command.found_by } : {}), ...(facts.test_command.not_run ? { not_run: facts.test_command.not_run } : {}) } : { none: facts.test_command.none, ...(facts.test_command.evidence ? { evidence: facts.test_command.evidence } : {}) },
    baseline: baseline ?? { ran: false, why: "not asked" },
    ...(drift ? { in_scope: "only the test files that changed since the last record; what the unchanged tests cover is in the last record" } : { behaviors_without_tests: withoutTests }),
    carried: carried?.carried ?? [],
    support: carried?.support ?? [],
    gaps: numbered,
  };

  const docs = [
    { ...PARTS[0], doc: behaviorsDoc },
    { ...PARTS[1], doc: architectureDoc },
    { ...PARTS[2], doc: interfacesDoc },
    ...(sbom?.bom ? [{ ...PARTS[3], doc: sbom.bom }] : []),
    { ...PARTS[4], doc: testsDoc },
    { ...PARTS[5], doc: stringsDoc },
  ].map((p) => ({ ...p, text: `${JSON.stringify(p.doc, null, 2)}\n` }));
  const carriedFiles = (carried?.pieces ?? []).map((c) => ({ file: c.at, bytes: c.bytes, sha256: sha(c.bytes), support: c.at.startsWith("support/") }));

  const record = {
    format: RECORD_FORMAT,
    as_built: true,
    repository: source.repository,
    commit: source.commit,
    commit_checked: source.commit_checked,
    ...(source.folder ? { folder: source.folder } : {}),
    read_mode: baseline?.ran ? "read and run" : "read",
    trigger: drift ? "drift" : "adoption",
    ...(drift ? { since: { commit: drift.since, ...(previous?.digest ? { record_sha256: previous.digest } : {}) }, changed_files: drift.changed.map((c) => ({ file: c.file, status: c.status, ...(c.was ? { was: c.was } : {}) })) } : {}),
    drafted: Boolean(draft),
    parts: docs.map((p) => ({ part: p.part, file: p.file, format: p.format, sha256: sha(p.text) })),
    ...(drift && !sbom?.bom ? { dependencies: { unchanged_since: drift.since } } : {}),
    ...(drift && sbom?.changes ? { dependencies_changed: sbom.changes } : {}),
    schemas: schemaFiles.map((s) => ({ file: s.file, format: s.format, sha256: sha(s.text) })),
    carried_files: carriedFiles.map((c) => ({ file: c.file, sha256: c.sha256 })),
    behaviors_index: behaviorsDoc.behaviors.map((b) => ({ id: b.id, name: b.name, files: [...new Set(b.evidence.filter((e) => e.file && !e.at).map((e) => e.file))].sort(), ...(b.change ? { change: b.change } : {}) })),
    counts: {
      behaviors: behaviors.length,
      interfaces: interfaces.length,
      settings: settings.length,
      components: sbom?.bom?.components?.length ?? 0,
      tests: tests.length,
      gaps: numbered.length,
      held_back: numbered.filter((g) => ["claim-without-evidence", "held-back", "outside-the-change"].includes(g.kind)).length,
      behavior_kinds: Object.fromEntries(KIND_NAMES.map((k) => [k, behaviors.filter((b) => b.kind === k).length]).filter(([, n]) => n)),
      strings: stringsDoc.strings.length,
      carried: carriedFiles.length,
      completeness: complete.counts,
    },
    done: true,
    done_means: "every claim delivered names evidence that was checked against the code at this commit (or the observed run), every gap is listed in tests-and-gaps.json, and claims that went beyond the evidence were held back as gaps",
    made_by: { agent: tool.name, version: tool.version },
  };
  return { record, docs, schemaFiles, carriedFiles, gaps: numbered, behaviors: behaviorsDoc.behaviors, withoutTests };
}
