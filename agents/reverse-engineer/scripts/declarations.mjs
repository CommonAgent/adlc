// What an agent declares to the platform in its own files, read by rule
// (0.3.0): every name and value in agent-descriptor.json,
// agent-runtime-requirements.json and plugin.json at the codebase's top, and
// the front matter of each skills/<name>/SKILL.md. Offering ids, step ids,
// each input's and output's name and kind, labels and the other words a
// person reads, run-config settings, run commands, message files, records:
// a rebuild has to declare them the same, so each is kept with its value,
// where it is declared and the line it is on.
//
// The walk is the same for every file. A list of objects that each have an
// id, a name without spaces, or a file is a list of things (offerings,
// inputs, steps, settings): each thing is one declaration, named by what it
// is ("offering read-the-top-stories", "output stories of
// read-the-top-stories"), and each of its fields is one more ("label of
// setting count"). An object whose values are all objects is read the same,
// keyed by name (the run commands). A field whose value holds no object
// within an object is one declaration with that value whole (a list of
// words, `how`, a range); anything deeper is walked.
//
//   needs: node >= 22. Nothing here reads or writes a file: `read` does.
//   import { readDeclarations, DECLARING_FILES } from "./declarations.mjs"
import { linesOf } from "./codebase.mjs";

/** The files an Agent Package declares itself in, at the codebase's top. */
export const DECLARING_FILES = ["agent-descriptor.json", "agent-runtime-requirements.json", "plugin.json"];
const WHAT = { "agent-descriptor.json": "the descriptor", "agent-runtime-requirements.json": "the runtime requirements", "plugin.json": "the plugin manifest" };

/** A path step as the record writes it: .key, ["key"] for one with other
 *  characters, [n] for a place in a list. */
const step = (path, key) => (typeof key === "number" ? `${path}[${key}]` : /^[A-Za-z_$][\w$-]*$/.test(key) ? (path ? `${path}.${key}` : key) : `${path}[${JSON.stringify(key)}]`);

/** The line each value of a JSON text starts on, by path: Map(path -> line).
 *  A small reader of JSON that keeps offsets; null when the text is not JSON. */
export function jsonLines(text) {
  const t = String(text ?? "");
  const starts = [0];
  for (let k = 0; k < t.length; k++) if (t[k] === "\n") starts.push(k + 1);
  const lineOf = (off) => { let lo = 0; let hi = starts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= off) lo = mid; else hi = mid - 1; } return lo + 1; };
  const out = new Map();
  let i = 0;
  const ws = () => { while (i < t.length && /\s/.test(t[i])) i += 1; };
  const str = () => { const a = i; i += 1; while (i < t.length && t[i] !== "\"") i += t[i] === "\\" ? 2 : 1; i += 1; return JSON.parse(t.slice(a, i)); };
  const value = (path) => {
    ws();
    out.set(path, lineOf(i));
    if (t[i] === "{") {
      i += 1; ws();
      if (t[i] === "}") { i += 1; return; }
      for (;;) {
        ws(); const key = str(); ws(); i += 1; // the colon
        value(step(path, key)); ws();
        if (t[i] === ",") { i += 1; continue; }
        i += 1; return;
      }
    }
    if (t[i] === "[") {
      i += 1; ws();
      if (t[i] === "]") { i += 1; return; }
      for (let n = 0; ; n++) {
        value(step(path, n)); ws();
        if (t[i] === ",") { i += 1; continue; }
        i += 1; return;
      }
    }
    if (t[i] === "\"") { str(); return; }
    while (i < t.length && !/[,}\]\s]/.test(t[i])) i += 1;
  };
  try { JSON.parse(t); value(""); } catch { return null; }
  return out;
}

const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const flat = (v) => !(Array.isArray(v) ? v : isObj(v) ? Object.values(v) : []).some((x) => (Array.isArray(x) ? x.some((y) => y && typeof y === "object") : isObj(x)));
const singular = (key) => String(key).replace(/_/g, " ").replace(/ies$/, "y").replace(/([^s])s$/, "$1");
const identOf = (o) => (typeof o?.id === "string" && o.id.trim() ? ["id", o.id] : typeof o?.name === "string" && o.name.trim() && !/\s/.test(o.name.trim()) ? ["name", o.name] : typeof o?.file === "string" && o.file.trim() ? ["file", o.file] : null);
/** An object keyed by names (run commands, skills): every value an object,
 *  and every key a name with a dash or a dot in it, not a field's word. */
const isNamed = (v) => isObj(v) && Object.keys(v).length > 0 && Object.entries(v).every(([k, x]) => isObj(x) && /[-.]/.test(k));
const isThings = (v) => Array.isArray(v) && v.length > 0 && v.every((x) => isObj(x) && identOf(x));

/** The declarations of one JSON file: [{name, declared_in, value, evidence}]. */
export function declarationsIn(file, text) {
  let doc;
  try { doc = JSON.parse(text); } catch { return []; }
  const lines = jsonLines(text) ?? new Map();
  const out = [];
  const add = (name, path, value) => out.push({ name, declared_in: `${file} ${path}`, value, evidence: [{ file, line: lines.get(path) ?? 1 }] });
  // `owner` is the words a field is "of" ("offering x", "example of
  // offering x", or the file's own words); `parent` is the id of the nearest
  // thing it is in, and `direct` says the field sits right in that thing, so
  // a thing inside is named "of <parent>", and otherwise "of <owner>". A
  // thing in no other thing (an offering, a setting) is named alone.
  const fields = (obj, path, owner, ident, parent, direct) => {
    for (const [k, v] of Object.entries(obj)) {
      if (ident && k === ident) continue;
      const p = step(path, k);
      const of = !parent ? "" : direct ? ` of ${parent}` : ` of ${owner}`;
      if (isThings(v)) { things(v, p, k, of); continue; }
      if (isNamed(v)) { keyed(v, p, k, of); continue; }
      if (isObj(v) && !flat(v)) { fields(v, p, `${k} of ${owner}`, null, parent, false); continue; }
      if (Array.isArray(v) && !flat(v)) { v.forEach((x, n) => (isObj(x) ? fields(x, step(p, n), `${k} ${n + 1} of ${owner}`, null, parent, false) : add(`${k} ${n + 1} of ${owner}`, step(p, n), x))); continue; }
      add(`${k} of ${owner}`, p, v);
    }
  };
  const thing = (key, id, of, path, x, ident) => {
    const label = `${singular(key)} ${id}${of}`;
    add(label, path, id);
    fields(x, ident ? path.slice(0, -(`.${ident}`.length)) : path, label, ident, id, true);
  };
  const things = (list, path, key, of) => list.forEach((x, n) => {
    const [field, id] = identOf(x);
    thing(key, id, of, step(step(path, n), field), x, field);
  });
  const keyed = (obj, path, key, of) => {
    for (const [id, x] of Object.entries(obj)) thing(key, id, of, step(path, id), x, null);
  };
  if (isObj(doc)) fields(doc, "", WHAT[file] ?? file, null, null, true);
  return out;
}

/** The front matter of a SKILL.md: [{name, declared_in, value, evidence}]. */
export function skillDeclarations(file, text) {
  const lines = linesOf(text);
  if (lines[0]?.trim() !== "---") return [];
  const end = lines.findIndex((l, k) => k > 0 && l.trim() === "---");
  if (end === -1) return [];
  const pairs = [];
  for (let k = 1; k < end; k++) {
    const m = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(lines[k]);
    if (m) pairs.push({ key: m[1], value: m[2].trim().replace(/^(["'])(.*)\1$/, "$2"), line: k + 1 });
  }
  const name = pairs.find((p) => p.key === "name")?.value || file.split("/").slice(-2, -1)[0];
  return pairs.map((p) => ({
    name: p.key === "name" ? `skill ${name}` : `${p.key} of skill ${name}`,
    declared_in: `${file} front matter ${p.key}`, value: p.value, evidence: [{ file, line: p.line }],
  }));
}

/** Every declaration in the agent's own files, in a fixed order. */
export function readDeclarations(files, read) {
  const out = [];
  for (const f of DECLARING_FILES) {
    if (!files.includes(f)) continue;
    const text = read(f);
    if (typeof text === "string") out.push(...declarationsIn(f, text));
  }
  for (const f of files.filter((x) => /^skills\/[^/]+\/SKILL\.md$/.test(x)).sort()) {
    const text = read(f);
    if (typeof text === "string") out.push(...skillDeclarations(f, text));
  }
  return out;
}
