// Read what was given: the one step that looks at the files, and it judges
// none of them.
//
// A job is handed files and, at most, a few words. Each file is one of five
// things, and which one is read off the file itself, never off its name or the
// media type it travelled under, because the mesh hands a descriptor over as
// plain JSON as often as not:
//
//   - the agent descriptor        {"format": "agent-descriptor-v1", ...}
//   - the runtime requirements    {"format": "agent-runtime-requirements-v1", ...}
//   - the AgentDoc                {"agentdoc": "v1", ...}, or signed, {"format": "agentdoc-signed-v1", "doc": {...}}
//   - a verdict                   {"record": "v1", "act": "evaluate", ...}
//                                 (the conformance checker's agent-eval-record-v1)
//   - a record: anything else the package or the platform left, JSON or text
//
// Every file is given a source number (S1, S2, ...) in a fixed order, its
// digest is taken over its bytes, and the inventory is written to the job's
// records. A file that cannot be read is noted and left out; it never stops
// the job, because the documentation then says what it could not read.
//
//   needs: node >= 22
//   import { gather, sortGiven, resolve } from "./given.mjs"
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { basename } from "node:path";

export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const trim = (s) => String(s ?? "").trim();

/** The kinds a given file can be, in the order sources are numbered. */
export const KINDS = ["descriptor", "runtime", "agentdoc", "verdict", "record"];

export const KIND_WORDS = {
  descriptor: "the agent descriptor",
  runtime: "the runtime requirements",
  agentdoc: "the AgentDoc",
  verdict: "a verdict",
  record: "a record",
};

/** What a file is, from its bytes. Pure. */
export function kindOf(text) {
  let json;
  // A file saved with a byte-order mark is the same JSON without it.
  try { json = JSON.parse(String(text).replace(/^\uFEFF/, "")); } catch { return { kind: "record", json: undefined }; }
  if (json && typeof json === "object" && !Array.isArray(json)) {
    if (json.format === "agent-descriptor-v1") return { kind: "descriptor", json };
    if (json.format === "agent-runtime-requirements-v1") return { kind: "runtime", json };
    if (json.agentdoc === "v1") return { kind: "agentdoc", json };
    // The signed AgentDoc (agentdoc-signed-v1) wraps the document in `doc`; the
    // document inside is the source, and the digest is the whole file's.
    if (json.format === "agentdoc-signed-v1" && json.doc && typeof json.doc === "object" && json.doc.agentdoc === "v1") return { kind: "agentdoc", json: json.doc };
    if (json.record === "v1" && json.act === "evaluate") return { kind: "verdict", json };
  }
  return { kind: "record", json };
}

/** Sort read files into sources, numbered S1.. in KINDS order and, inside a
 *  kind, in the order they were given. Only one descriptor, one set of
 *  runtime requirements and one AgentDoc are sources; a second of any of them
 *  is left out and said, because two declarations of one agent cannot both be
 *  what it declares. Pure. */
export function sortGiven(files = []) {
  const read = files.map((f) => ({ ...f, ...kindOf(f.text) }));
  const sources = [];
  const leftOut = [];
  for (const kind of KINDS) {
    const ofKind = read.filter((f) => f.kind === kind);
    const single = kind === "descriptor" || kind === "runtime" || kind === "agentdoc";
    ofKind.forEach((f, i) => {
      if (single && i > 0) {
        leftOut.push({ file: f.name, why: `it is a second ${KIND_WORDS[kind].replace(/^the /, "")}, and only the first one given is documented` });
        return;
      }
      sources.push(f);
    });
  }
  sources.forEach((s, i) => { s.id = `S${i + 1}`; });
  return { sources, leftOut };
}

/** Read the files a job was handed. Returns what was read and what could not
 *  be. Names are made unique so a line can name its file without doubt. */
export function gather(paths = []) {
  const files = [];
  const unreadable = [];
  const taken = new Set();
  for (const p of paths) {
    let bytes;
    try {
      if (!statSync(p).isFile()) throw new Error("it is not a file");
      bytes = readFileSync(p);
    } catch (e) {
      unreadable.push({ file: basename(String(p)) || String(p), why: `it could not be read (${e.code ?? trim(e.message)})` });
      continue;
    }
    let name = basename(p);
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${n}-${basename(p)}`;
    taken.add(name.toLowerCase());
    files.push({ name, path: p, bytes: bytes.length, raw: bytes, sha256: sha256(bytes), text: bytes.toString("utf8") });
  }
  return { files, unreadable };
}

/** The inventory written to the job's records: no text, only what each
 *  source is and its digest. */
export function inventoryOf({ sources, leftOut = [], unreadable = [] }) {
  return {
    given: "v1",
    sources: sources.map((s) => ({ id: s.id, file: s.name, kind: s.kind, bytes: s.bytes, sha256: s.sha256 })),
    left_out: leftOut,
    unreadable,
  };
}

// ── Paths into a source ─────────────────────────────────────────────────────
//
// A line's mark names a place in one source. For JSON it is a path such as
// `offerings[0].inputs[2]`, with `/n` after it for the nth line of a string
// (counted from 0, blank lines skipped). For text it is `L4` or `L4-L9`, and
// for JSON shown as an example it is `json L1-L20`: the lines of the JSON
// laid out with two-space indentation.

const SEGMENT = /^([A-Za-z_][\w-]*)?((?:\[\d+\])*)$/;

/** The lines of a string, trimmed, with blank ones skipped. */
export const linesOf = (s) => String(s).split("\n").map((l) => l.trim()).filter(Boolean);

/** Resolve a JSON path in a value. Returns { found, value }. Pure. */
export function resolvePath(root, path) {
  const p = trim(path);
  if (!p || p === ".") return { found: root !== undefined, value: root };
  let [head, line] = p.split("/");
  let node = root;
  for (const part of head.split(".")) {
    const m = SEGMENT.exec(part);
    if (!m) return { found: false };
    if (m[1]) {
      if (node === null || typeof node !== "object" || Array.isArray(node) || !(m[1] in node)) return { found: false };
      node = node[m[1]];
    }
    for (const ix of m[2].match(/\d+/g) ?? []) {
      if (!Array.isArray(node) || Number(ix) >= node.length) return { found: false };
      node = node[Number(ix)];
    }
  }
  if (line !== undefined) {
    if (typeof node !== "string" || !/^\d+$/.test(line)) return { found: false };
    const lines = linesOf(node);
    if (Number(line) >= lines.length) return { found: false };
    return { found: true, value: lines[Number(line)] };
  }
  return { found: node !== undefined, value: node };
}

/** The lines a range mark names, from a source. Returns null when the range
 *  is not in it. */
export function rangeOf(source, mark) {
  const m = /^(json )?L(\d+)(?:-L(\d+))?$/.exec(trim(mark));
  if (!m) return null;
  if (m[1] && source.json === undefined) return null;
  const lines = m[1] ? JSON.stringify(source.json, null, 2).split("\n") : textLines(source.text);
  const a = Number(m[2]);
  const b = m[3] ? Number(m[3]) : a;
  if (a < 1 || b < a || b > lines.length) return null;
  return { from: a, to: b, of: lines.length, lines: lines.slice(a - 1, b), json: Boolean(m[1]) };
}

/** A text record's lines, without the blank ones after its last line, so a
 *  file that ends in a newline has as many lines as it shows. The writer and
 *  the check both count lines this way. */
export function textLines(text) {
  const lines = String(text).split(/\r?\n/);
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** Is a value empty: absent, null, "", [] or {}. */
export function isEmpty(v) {
  if (v === undefined || v === null) return true;
  if (typeof v === "string") return trim(v) === "";
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.keys(v).length === 0;
  return false;
}
