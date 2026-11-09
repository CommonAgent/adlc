// The surface of a JavaScript codebase, read by rule before any model sees
// it: what each module exports and who imports it, which files start as
// commands and the flags they read, the files the code writes and the shape
// of each JSON one, the regular expressions and the literal constants the
// code holds, and every import that reaches outside the codebase's folder.
// 0.3.0 adds every string a person reads and every pattern, exactly as
// written (`texts`, for strings.json), the exports of every module of the
// code, and the literal values a field is written with in the object
// literals shaped like the one it is in (`fieldValues`).
// Each item names the file and line it was read from.
//
// These are the parts of the record a rebuild needs word for word: the
// functions its tests import, the output file and its format id, the exact
// pattern another component matches. A model is shown them and may describe
// them, but the list itself, the names, the parameters, the values and the
// patterns are read here, from the text as written, so two runs on the same
// code give the same surface.
//
// It reads .js, .mjs, .cjs, .jsx and the TypeScript extensions; other
// languages have no surface read by rule, and the model's draft stands alone.
//
//   needs: node >= 22. Nothing here reads or writes a file: `read` does.
//   import { readSurface } from "./surface.mjs"
import { posix } from "node:path";
import { assignedRanges, constBefore, declarationBefore, either, matching, objectFields, scan, splitTop, statementEnd, tokenAt, typeOfExpr } from "./js-source.mjs";

const trim = (s) => String(s ?? "").trim();
const collapse = (t) => String(t ?? "").replace(/\s+/g, " ").trim();

/** The files whose surface is read. */
export const JS_EXT = /\.(m?js|cjs|jsx|m?ts|cts|tsx)$/i;
/** Names that say a value is a credential: such a constant is named, never given. */
export const CREDENTIAL_NAME = /(^|_)(KEY|APIKEY|TOKEN|SECRET|PASSWORD|PASSWD|PASS|PWD|CREDENTIALS?|AUTH|PRIVATE|CERT)(_|$)/i;
/** A string that is a command-line flag on its own. */
export const FLAG = /^--[A-Za-z][A-Za-z0-9-]*$/;
const RESOLVE_EXT = ["", ".js", ".mjs", ".cjs", ".ts", ".mts", ".cts", ".jsx", ".tsx", ".json", "/index.js", "/index.mjs", "/index.cjs", "/index.ts"];

const ev = (file, line) => ({ file, line });

/** The parameters, body and async-ness of the function whose name ends at
 *  `from` (or whose ( is the next one): {params, body: [a, b], async}. */
function functionFrom(s, from) {
  const m = s.masked;
  const open = m.indexOf("(", from);
  if (open === -1) return null;
  const close = matching(m, open);
  if (close === -1) return null;
  const brace = m.indexOf("{", close);
  const body = brace !== -1 && /^\s*(:[^{]*)?$/.test(m.slice(close + 1, brace)) ? [brace, matching(m, brace) + 1] : [close + 1, close + 1];
  return { params: collapse(s.text.slice(open + 1, close)), body };
}

/** What a value [a, b) is: a function (with its params, body and whether it
 *  is async), a class, a constant (with its value), a pattern, or a value. */
export function valueAt(s, a, b) {
  const m = s.masked;
  let at = a;
  while (at < b && /\s/.test(m[at])) at += 1;
  let isAsync = false;
  const asyncHit = /^async\b\s*/.exec(m.slice(at, b));
  if (asyncHit) { isAsync = true; at += asyncHit[0].length; }
  const rest = m.slice(at, b);
  if (/^function\b/.test(rest)) {
    const f = functionFrom(s, at);
    return f ? { kind: "function", async: isAsync, ...f } : { kind: "value" };
  }
  if (/^class\b/.test(rest)) return { kind: "class", body: [at, b] };
  if (m[at] === "(") {
    const close = matching(m, at);
    const arrow = close !== -1 ? /^\s*(:[^=]*)?=>\s*/.exec(m.slice(close + 1, b)) : null;
    if (arrow) {
      const start = close + 1 + arrow[0].length;
      const body = m[start] === "{" ? [start, matching(m, start) + 1] : [start, b];
      return { kind: "function", async: isAsync, params: collapse(s.text.slice(at + 1, close)), body };
    }
  }
  const single = /^([A-Za-z_$][\w$]*)\s*=>\s*/.exec(rest);
  if (single) {
    const start = at + single[0].length;
    const body = m[start] === "{" ? [start, matching(m, start) + 1] : [start, b];
    return { kind: "function", async: isAsync, params: single[1], body };
  }
  let x = a; let y = b;
  while (x < y && /\s/.test(m[x])) x += 1;
  while (y > x && /\s/.test(m[y - 1])) y -= 1;
  const tok = tokenAt(s, x, y);
  if (tok?.kind === "string" || (tok?.kind === "template" && !tok.subst)) return { kind: "constant", value: tok.value };
  if (tok?.kind === "regex") return { kind: "pattern", value: tok.value };
  const src = s.text.slice(x, y);
  if (/^-?\d[\d_]*(\.\d+)?([eE][+-]?\d+)?$/.test(src)) return { kind: "constant", value: Number(src.replace(/_/g, "")) };
  if (src === "true" || src === "false") return { kind: "constant", value: src === "true" };
  return { kind: "value" };
}

/** What each `throw new X` and `reject(new X)` in [a, b) throws, by line.
 *  Only throws written in that body are read, not those of what it calls. */
export function throwsIn(s, [a, b]) {
  const m = s.masked.slice(a, b);
  const out = [];
  const at = (k) => s.lineOf(a + k);
  for (const h of m.matchAll(/\bthrow\s+new\s+([A-Za-z_$][\w$.]*)/g)) out.push({ error: h[1], line: at(h.index) });
  for (const h of m.matchAll(/\b(?:Promise\s*\.\s*)?reject\s*\(\s*new\s+([A-Za-z_$][\w$.]*)/g)) out.push({ error: h[1], line: at(h.index), rejects: true });
  for (const h of m.matchAll(/\bthrow\s+(?!new\b)([A-Za-z_$][\w$]*)\s*[;\n}]/g)) out.push({ rethrows: h[1], line: at(h.index) });
  return out.sort((x, y) => x.line - y.line);
}

/** A name declared in the file, as a function, a class or a const: what
 *  valueAt says, with its line, or null. */
function localValue(s, name) {
  const esc = name.replace(/\$/g, "\\$");
  const fn = new RegExp(`(^|[^.\\w$])(async\\s+)?function\\s*\\*?\\s*${esc}\\s*\\(`).exec(s.masked);
  if (fn) {
    const start = fn.index + fn[1].length;
    const f = functionFrom(s, start + fn[0].length - fn[1].length - 1);
    if (f) return { kind: "function", async: Boolean(fn[2]), ...f, line: s.lineOf(start) };
  }
  const cls = new RegExp(`(^|[^.\\w$])class\\s+${esc}\\b`).exec(s.masked);
  if (cls) return { kind: "class", line: s.lineOf(cls.index + cls[1].length) };
  const d = declarationBefore(s, name);
  if (d) return { ...valueAt(s, d.start, d.end), line: d.line, range: [d.start, d.end] };
  return null;
}

/** Every export of one scanned module: [{name, kind, async?, params?, value?,
 *  throws?, line, from?}]. */
export function exportsOf(s) {
  const m = s.masked;
  const out = [];
  const add = (name, info, line) => {
    if (!name || out.some((e) => e.name === name)) return;
    const e = { name, kind: info?.kind ?? "value", line: info?.line ?? line };
    if (e.kind === "function") { e.async = Boolean(info.async); e.params = info.params ?? ""; e.throws = info.body ? throwsIn(s, info.body) : []; }
    if (e.kind === "constant") {
      if (CREDENTIAL_NAME.test(name)) e.withheld = "its name says it is a credential, so its value is not written";
      else e.value = info.value;
    }
    if (e.kind === "pattern") e.value = info.value;
    if (info?.from) e.from = info.from;
    // 0.3.0: where a value is written, so it can be read as JSON.
    if (info?.range && e.kind !== "function" && e.kind !== "class") e.range = info.range;
    out.push(e);
  };
  for (const h of m.matchAll(/(^|[^.\w$])export\s+(default\s+)?(async\s+)?(function\b\s*\*?|class\b|const\b|let\b|var\b)\s*([A-Za-z_$][\w$]*)?/g)) {
    const at = h.index + h[1].length;
    const line = s.lineOf(at);
    const kw = h[4].replace(/[\s*]/g, "");
    const name = h[5] ?? (h[2] ? "default" : "");
    if (kw === "function") {
      const f = functionFrom(s, at + h[0].length - h[1].length);
      add(h[2] ? (h[5] ?? "default") : name, f ? { kind: "function", async: Boolean(h[3]), ...f, line } : null, line);
    } else if (kw === "class") add(name, { kind: "class", line }, line);
    else {
      const eq = m.indexOf("=", at + h[0].length - h[1].length);
      if (eq === -1) continue;
      let a = eq + 1;
      while (a < m.length && /\s/.test(m[a])) a += 1;
      const end = m[a] === "{" || m[a] === "[" ? matching(m, a) + 1 : statementEnd(m, a);
      add(name, { ...valueAt(s, a, end), line, range: [a, end] }, line);
    }
  }
  for (const h of m.matchAll(/(^|[^.\w$])export\s+default\s+(?!async\b|function\b|class\b)/g)) {
    const at = h.index + h[0].length;
    add("default", { ...valueAt(s, at, statementEnd(m, at)), line: s.lineOf(at), range: [at, statementEnd(m, at)] }, s.lineOf(at));
  }
  for (const h of m.matchAll(/(^|[^.\w$])export\s*(\*\s*(?:as\s+([A-Za-z_$][\w$]*)\s*)?|\{([^}]*)\})\s*(from\b)?/g)) {
    const line = s.lineOf(h.index + h[1].length);
    const spec = h[5] ? s.tokens.find((t) => t.start >= h.index + h[0].length - 1 && t.kind === "string")?.value : null;
    if (h[2].startsWith("*")) { add(h[3] ?? `* from ${spec}`, { kind: "re-export", from: spec, line }, line); continue; }
    for (const part of h[4].split(",").map(trim).filter(Boolean)) {
      const [local, as] = part.split(/\s+as\s+/).map(trim);
      if (spec) add(as ?? local, { kind: "re-export", from: spec, line }, line);
      else add(as ?? local, localValue(s, local) ?? { kind: "value", line }, line);
    }
  }
  // CommonJS: module.exports = { a, b: c }, module.exports = name, exports.x = ...
  for (const h of m.matchAll(/(^|[^.\w$])module\s*\.\s*exports\s*=\s*/g)) {
    const at = h.index + h[0].length;
    const line = s.lineOf(at);
    if (m[at] === "{") {
      const end = matching(m, at) + 1;
      for (const f of objectFields(s, at, end).fields) {
        const expr = s.text.slice(f.start, f.end).trim();
        if (f.shorthand || /^[A-Za-z_$][\w$]*$/.test(expr)) add(f.key, localValue(s, f.shorthand ? f.key : expr) ?? { kind: "value", line: s.lineOf(f.start) }, s.lineOf(f.start));
        else add(f.key, { ...valueAt(s, f.start, f.end), line: s.lineOf(f.start), range: [f.start, f.end] }, s.lineOf(f.start));
      }
    } else {
      const end = statementEnd(m, at);
      const expr = s.text.slice(at, end).trim();
      add("default", /^[A-Za-z_$][\w$]*$/.test(expr) ? localValue(s, expr) ?? { kind: "value", line } : { ...valueAt(s, at, end), line }, line);
    }
  }
  for (const h of m.matchAll(/(^|[^.\w$])(?:module\s*\.\s*)?exports\s*\.\s*([A-Za-z_$][\w$]*)\s*=(?!=)\s*/g)) {
    const at = h.index + h[0].length;
    const line = s.lineOf(at);
    const end = statementEnd(m, at);
    const expr = s.text.slice(at, end).trim();
    add(h[2], /^[A-Za-z_$][\w$]*$/.test(expr) ? localValue(s, expr) ?? { kind: "value", line } : { ...valueAt(s, at, end), line, range: [at, end] }, line);
  }
  return out.sort((x, y) => x.line - y.line || x.name.localeCompare(y.name));
}

/** The names an import clause takes: "*" for the whole module, "default". */
function clauseNames(clause, exporting = false) {
  const names = [];
  const c = String(clause).replace(/\btype\s+/g, " ");
  const braces = /\{([^}]*)\}/.exec(c);
  if (braces) for (const part of braces[1].split(",").map(trim).filter(Boolean)) names.push(trim(part.split(/\s+as\s+/)[0]));
  if (/\*/.test(c)) names.push("*");
  const before = trim(c.replace(/\{[^}]*\}/, "").replace(/\*\s*(as\s+[A-Za-z_$][\w$]*)?/, "").replace(/,/g, " "));
  if (!exporting && /^[A-Za-z_$][\w$]*$/.test(before)) names.push("default");
  return names;
}

/** Every import of one scanned file: [{spec, line, names}]. */
export function importsOf(s) {
  const m = s.masked;
  const out = [];
  for (const t of s.tokens) {
    if (t.kind !== "string" && !(t.kind === "template" && !t.subst)) continue;
    const pre = m.slice(Math.max(0, t.start - 600), t.start);
    let names = null;
    if (/\bfrom\s*$/.test(pre)) {
      const kw = [...pre.matchAll(/(^|[^.\w$])(import|export)\b/g)].pop();
      if (!kw) continue;
      const clause = pre.slice(kw.index + kw[0].length, pre.search(/\bfrom\s*$/));
      names = clauseNames(clause, kw[2] === "export");
    } else if (/(^|[^.\w$])import\s*$/.test(pre)) names = [];
    else if (/(^|[^.\w$])import\s*\(\s*$/.test(pre)) names = ["*"];
    else if (/(^|[^.\w$])require\s*\(\s*$/.test(pre)) {
      const destructured = /(?:const|let|var)\s*\{([^}]*)\}\s*=\s*require\s*\(\s*$/.exec(pre);
      const member = /^\s*\)\s*\.\s*([A-Za-z_$][\w$]*)/.exec(m.slice(t.end, t.end + 80));
      if (destructured) names = destructured[1].split(",").map((p) => trim(p.split(":")[0])).filter((p) => /^[A-Za-z_$][\w$]*$/.test(p));
      else if (member) names = [member[1]];
      else names = ["*"];
    }
    if (names) out.push({ spec: t.value, line: t.line, names, at: t.start });
  }
  return out;
}

/** Where a relative import lands: {resolved} inside the codebase, {outside}
 *  when it leaves the folder, or {} for a package or a file not found. */
export function resolveImport(from, spec, fileSet) {
  if (!/^\.\.?(\/|$)/.test(spec)) return {};
  const joined = posix.normalize(posix.join(posix.dirname(from), spec));
  if (joined === ".." || joined.startsWith("../")) return { outside: joined };
  for (const ext of RESOLVE_EXT) if (fileSet.has(joined + ext)) return { resolved: joined + ext };
  return { missing: joined };
}

/** Whether a scanned file starts as a command, and the line that says so. */
function startsAsCommand(s) {
  if (/^#!/.test(s.text)) return { why: "it starts with a #! line, so it runs as a command", line: 1 };
  const req = /\brequire\s*\.\s*main\s*===?\s*module\b/.exec(s.masked);
  if (req) return { why: "it checks require.main === module, so it runs as a command when started directly", line: s.lineOf(req.index) };
  const argv1 = /\bprocess\s*\.\s*argv\s*\[\s*1\s*\]/.exec(s.masked);
  if (argv1 && /\bimport\s*\.\s*meta\s*\.\s*url\b/.test(s.masked)) return { why: "it compares itself with process.argv[1], so it runs as a command when started directly", line: s.lineOf(argv1.index) };
  return null;
}

/** The literal text of the parts of a path expression [a, b), following one
 *  level of const names: "out/stories.json", or "" when none is literal. */
function pathOf(s, a, b, before) {
  const parts = [];
  const take = (x, y) => {
    for (const t of s.tokens) {
      if (t.start < x) continue;
      if (t.start >= y) break;
      // A default after || or ?? is used only when the name before it is empty.
      if (/(\|\||\?\?)\s*$/.test(s.masked.slice(Math.max(0, t.start - 6), t.start))) continue;
      if (t.kind === "string" || (t.kind === "template" && !t.subst)) parts.push(t.value);
      else if (t.kind === "template") parts.push(s.text.slice(t.start + 1, t.end - 1).replace(/\$\{[^}]*\}/g, ""));
    }
  };
  const words = s.masked.slice(a, b);
  for (const w of words.matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)\b(?!\s*\()/g)) {
    const d = constBefore(s, w[2], before);
    if (d) take(d.start, d.end);
  }
  take(a, b);
  const joined = parts.map((p) => String(p).replace(/^\.\/?$/, "")).filter((p) => p && !FLAG.test(p)).join("/");
  return posix.normalize(joined.replace(/\/+/g, "/")).replace(/^\.\/?$/, "").replace(/^\.\//, "");
}

/** Each file the code writes, from writeFileSync / writeFile / appendFile
 *  calls: [{path, written_as, content, schema?, line}]. A JSON one's schema
 *  is the shape its value shows (js-source.mjs typeOfExpr). */
export function writesOf(s) {
  const m = s.masked;
  const out = [];
  for (const h of m.matchAll(/\b(writeFileSync|writeFile|appendFileSync|appendFile)\s*\(/g)) {
    if (/\bfunction\s*$/.test(m.slice(Math.max(0, h.index - 20), h.index))) continue;
    const open = h.index + h[0].length - 1;
    const close = matching(m, open);
    if (close === -1) continue;
    const args = splitTop(m, open + 1, close);
    if (args.length < 2) continue;
    const [p0, p1] = args;
    const path = pathOf(s, p0[0], p0[1], h.index);
    const data = m.slice(p1[0], p1[1]);
    const json = /\bJSON\s*\.\s*stringify\s*\(/.exec(data);
    const item = { path: path || null, written_as: collapse(s.text.slice(p0[0], p0[1])), content: json ? "json" : "text", line: s.lineOf(h.index), append: h[1].startsWith("append") };
    if (json) {
      const sOpen = p1[0] + json.index + json[0].length - 1;
      const sClose = matching(m, sOpen);
      const first = sClose === -1 ? null : splitTop(m, sOpen + 1, sClose)[0];
      if (first) item.schema = { $schema: "https://json-schema.org/draft/2020-12/schema", ...typeOfExpr(s, first[0], first[1], { before: first[0] }) };
    }
    out.push(item);
  }
  return out;
}

/** The regular expressions in one scanned file: [{text, line, name?, top}],
 *  each as written, slashes and flags included; a new RegExp(...) as its
 *  call's first argument as written. */
export function patternsOf(s) {
  const m = s.masked;
  const out = [];
  const nameBefore = (k) => /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*$/.exec(m.slice(Math.max(0, k - 80), k))?.[1];
  let depth = 0; let k = 0;
  const depthAt = (to) => { for (; k < to; k++) { if (m[k] === "{") depth += 1; else if (m[k] === "}") depth -= 1; } return depth; };
  const found = [];
  for (const t of s.tokens) if (t.kind === "regex") found.push({ at: t.start, text: t.value, line: t.line });
  for (const h of m.matchAll(/\bnew\s+RegExp\s*\(/g)) {
    const open = h.index + h[0].length - 1;
    const close = matching(m, open);
    const first = close === -1 ? null : splitTop(m, open + 1, close)[0];
    if (first) found.push({ at: h.index, text: s.text.slice(first[0], first[1]), line: s.lineOf(h.index), built: true });
  }
  for (const f of found.sort((a, b) => a.at - b.at)) {
    const name = nameBefore(f.at);
    out.push({ text: f.text, line: f.line, ...(name ? { name } : {}), top: depthAt(f.at) === 0, ...(f.built ? { built: "new RegExp" } : {}) });
  }
  return out;
}

/** The literal constants at the top of one scanned file: [{name, value, line}]. */
export function constantsOf(s) {
  const m = s.masked;
  const out = [];
  let depth = 0; let k = 0;
  for (const h of m.matchAll(/(^|[^.\w$])(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=(?![=>])\s*/g)) {
    for (; k < h.index; k++) { if (m[k] === "{") depth += 1; else if (m[k] === "}") depth -= 1; }
    if (depth !== 0) continue;
    const at = h.index + h[0].length;
    const v = valueAt(s, at, statementEnd(m, at));
    if (v.kind !== "constant") continue;
    const line = s.lineOf(at);
    out.push(CREDENTIAL_NAME.test(h[2]) ? { name: h[2], line, withheld: "its name says it is a credential, so its value is not written" } : { name: h[2], value: v.value, line });
  }
  return out;
}

/** Whether a string's words are ones a person reads: a letter and a space,
 *  or a whole sentence (a capital first, a stop last). */
export const isWords = (text) => (/[A-Za-z]/.test(text) && / /.test(text)) || /^[A-Z][\s\S]*[.!?]$/.test(text.trim());

/** The strings a person reads and the regular expressions of one scanned
 *  file (0.3.0): [{line, end_line?, kind: words | template | pattern, text}],
 *  each `text` exactly as in the source (between the quotes or backticks, as
 *  written; a pattern with its slashes and flags). Import paths are left out. */
export function stringsOf(s) {
  const specs = new Set(importsOf(s).map((i) => i.at));
  const out = [];
  for (const t of s.tokens) {
    let kind; let text;
    if (t.kind === "regex") { kind = "pattern"; text = t.value; } else {
      if (specs.has(t.start)) continue;
      text = s.text.slice(t.start + 1, t.end - 1);
      const plain = t.kind === "template" ? text.replace(/\$\{[\s\S]*?\}/g, "") : t.value;
      if (!isWords(plain)) continue;
      kind = t.kind === "template" ? "template" : "words";
    }
    const end = s.lineOf(Math.max(t.start, t.end - 1));
    out.push({ line: t.line, ...(end > t.line ? { end_line: end } : {}), kind, text });
  }
  return out;
}

/** Two schemas read for the same file, as one: a field in both keeps what
 *  both allow, a field in one is no longer always there. */
export function unionSchema(x, y) {
  if (!x) return y;
  if (!y) return x;
  if (JSON.stringify(x) === JSON.stringify(y)) return x;
  if (x.type === "object" && y.type === "object" && x.properties && y.properties) {
    const properties = {};
    for (const k of new Set([...Object.keys(x.properties), ...Object.keys(y.properties)])) {
      properties[k] = x.properties[k] && y.properties[k] ? unionSchema(x.properties[k], y.properties[k]) : (x.properties[k] ?? y.properties[k]);
    }
    const required = (x.required ?? []).filter((k) => (y.required ?? []).includes(k));
    const comment = [x.$comment, y.$comment].filter(Boolean).join("; ");
    const out = { ...(x.$schema ? { $schema: x.$schema } : {}), type: "object", properties };
    if (required.length) out.required = required;
    if (comment) out.$comment = comment;
    return out;
  }
  return either(x, y);
}

/** The object literals of one scanned file: [{start, end, keys, fields}].
 *  A brace that opens a block is not one. */
export function objectLiteralsOf(s) {
  if (s.objects) return s.objects;
  const m = s.masked;
  const out = [];
  for (let k = 0; k < m.length; k++) {
    if (m[k] !== "{") continue;
    const before = m.slice(Math.max(0, k - 12), k).trimEnd();
    const last = before.slice(-1);
    const isObject = (last && "=(,:[?".includes(last) && !before.endsWith("=>")) || /(\|\||&&|\?\?|\breturn)$/.test(before);
    if (!isObject) continue;
    const end = matching(m, k);
    if (end === -1) continue;
    const { fields } = objectFields(s, k, end + 1);
    out.push({ start: k, end: end + 1, keys: new Set(fields.map((f) => f.key)), fields });
  }
  s.objects = out;
  return out;
}

/** The literal values a field `key` is written with, in the object literals
 *  of `files` shaped like the one it belongs to (they share at least half of
 *  `siblings`, the field names beside it): {values, evidence} when every such
 *  literal gives it a literal (a string, number, boolean or null, or a const,
 *  ternary or let of them), else null. */
export function fieldValuesIn(scanned, files, key, siblings) {
  const want = Math.min(siblings.length, Math.max(2, Math.ceil(siblings.length / 2)));
  const values = []; const evidence = [];
  let seen = 0;
  for (const f of files) {
    const s = scanned.get(f);
    if (!s) continue;
    for (const o of objectLiteralsOf(s)) {
      if (!o.keys.has(key)) continue;
      if (siblings.filter((k) => o.keys.has(k)).length < want) continue;
      const field = o.fields.find((x) => x.key === key);
      const t = typeOfExpr(s, field.start, field.end, { before: field.start });
      const vals = t.const !== undefined ? [t.const] : Array.isArray(t.enum) ? t.enum : t.type === "null" ? [null] : null;
      if (!vals) return null;
      seen += 1;
      for (const v of vals) if (!values.some((w) => w === v)) values.push(v);
      // The line the field is written on, and where a name it is written
      // from is given its values.
      const lines = [s.lineOf(field.start)];
      const name = s.text.slice(field.start, field.end).trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) {
        const c = constBefore(s, name, field.start);
        if (c) lines.push(c.line);
        else for (const [x] of assignedRanges(s, name, field.start) ?? []) lines.push(s.lineOf(x));
      }
      for (const line of lines) if (!evidence.some((e) => e.file === f && e.line === line)) evidence.push({ file: f, line });
    }
  }
  return seen ? { values, evidence } : null;
}

/** The whole surface. `isTest(file)` says which files are tests (their
 *  imports count, their exports, writes and flags do not); `entryHints` are
 *  files the manifests name as commands or main modules, with evidence. */
export function readSurface(files, read, { isTest = () => false, entryHints = [], keep = () => true } = {}) {
  const fileSet = new Set(files);
  const scanned = new Map();
  for (const f of files) {
    if (!JS_EXT.test(f)) continue;
    const text = read(f);
    if (text === null || text === undefined || text.length > 2_000_000) continue;
    try { scanned.set(f, scan(text)); } catch { /* a file the lexer cannot read has no surface */ }
  }
  const code = [...scanned.keys()].filter((f) => !isTest(f));

  const imports = []; const outside = [];
  for (const [f, s] of scanned) {
    for (const im of importsOf(s)) {
      const r = resolveImport(f, im.spec, fileSet);
      const item = { file: f, line: im.line, spec: im.spec, names: im.names, ...r };
      imports.push(item);
      if (r.outside && keep(f, im.line)) outside.push({ file: f, line: im.line, spec: im.spec, resolved: r.outside });
    }
  }
  const byName = new Map(); const whole = new Map();
  for (const im of imports.filter((i) => i.resolved && i.resolved !== i.file)) {
    for (const n of im.names) {
      const key = n === "*" ? im.resolved : `${im.resolved}#${n}`;
      const map = n === "*" ? whole : byName;
      if (!map.has(key)) map.set(key, new Set());
      map.get(key).add(im.file);
    }
  }

  // Entries: files that start as commands, and the manifests' hints.
  const entries = [];
  for (const f of code) {
    const why = startsAsCommand(scanned.get(f));
    if (why) entries.push({ file: f, why: why.why, evidence: [ev(f, why.line)] });
  }
  for (const h of entryHints) {
    if (!h.command || !scanned.has(h.file) || entries.some((e) => e.file === h.file)) continue;
    entries.push({ file: h.file, why: h.why, evidence: h.evidence });
  }
  entries.sort((a, b) => a.file.localeCompare(b.file));
  const mains = new Set(entryHints.filter((h) => h.main).map((h) => h.file));

  // Exports of every module of the code (0.3.0; 0.2.0 listed only the modules
  // something imports, the main module and the commands). A re-export takes
  // what the module it names exports, where that module is in the codebase.
  const own = new Map(code.map((f) => [f, exportsOf(scanned.get(f))]));
  const exportsList = [];
  for (const f of code) {
    const list = [];
    for (const e of own.get(f)) {
      const target = e.kind === "re-export" && e.from ? resolveImport(f, e.from, fileSet).resolved : null;
      const theirs = target ? own.get(target) : null;
      if (theirs && e.name.startsWith("* from ")) {
        for (const t of theirs.filter((x) => x.name !== "default" && x.kind !== "re-export")) if (!list.some((x) => x.name === t.name)) list.push({ ...t, line: e.line, from: e.from, value_in: target });
        continue;
      }
      const t = theirs?.find((x) => x.name === e.name) ?? null;
      list.push(t && t.kind !== "re-export" ? { ...t, name: e.name, line: e.line, from: e.from, value_in: target } : e);
    }
    for (const e of list) {
      const by = new Set([...(byName.get(`${f}#${e.name}`) ?? []), ...(whole.get(f) ?? [])]);
      if (e.name === "default") for (const x of byName.get(`${f}#default`) ?? []) by.add(x);
      exportsList.push({ module: f, ...e, imported_by: [...by].sort(), ...(mains.has(f) ? { main: true } : {}) });
    }
  }

  // Anchors: what the granularity rule counts one behavior for.
  const anchors = [];
  for (const e of exportsList) {
    if (!["function", "class"].includes(e.kind)) continue;
    if (!e.imported_by.length && !e.main) continue;
    anchors.push({ id: `${e.module}#${e.name}`, module: e.module, name: e.name, kind: e.kind, line: e.line, why: e.imported_by.length ? `imported by ${e.imported_by.join(", ")}` : "an export of the package's main module" });
  }
  for (const e of entries) anchors.push({ id: e.file, module: e.file, name: null, kind: "command", line: e.evidence[0].line, why: e.why });
  anchors.sort((a, b) => a.module.localeCompare(b.module) || a.line - b.line);

  // Flags: in the files a command imports, all the way down.
  const closureOf = (start) => {
    const seen = new Set();
    const visit = (f) => {
      if (seen.has(f)) return;
      seen.add(f);
      for (const im of imports) if (im.file === f && im.resolved && !isTest(im.resolved)) visit(im.resolved);
    };
    visit(start);
    return seen;
  };
  const flagsIn = (f) => scanned.get(f).tokens.filter((t) => (t.kind === "string" || (t.kind === "template" && !t.subst)) && FLAG.test(t.value) && keep(f, t.line));
  const all = new Set();
  for (const e of entries) {
    const mine = new Set();
    for (const f of closureOf(e.file)) { all.add(f); flagsIn(f).forEach((t) => mine.add(t.value)); }
    e.flags = [...mine].sort();
  }
  const flagMap = new Map();
  for (const f of entries.length ? code.filter((x) => all.has(x)) : code) {
    for (const t of flagsIn(f)) {
      if (!flagMap.has(t.value)) flagMap.set(t.value, []);
      flagMap.get(t.value).push(ev(f, t.line));
    }
  }
  const flags = [...flagMap.entries()].map(([name, evidence]) => ({ name, evidence })).sort((a, b) => a.name.localeCompare(b.name));

  // Files written, merged by path.
  const writes = [];
  for (const f of code) {
    for (const w of writesOf(scanned.get(f))) {
      const key = w.path ?? `${f}:${w.written_as}`;
      const have = writes.find((x) => (x.path ?? `${x.evidence[0].file}:${x.written_as}`) === key);
      // 0.3.0: two places that write the same file give one schema that allows both.
      if (have) { have.evidence.push(ev(f, w.line)); if (w.schema) have.schema = unionSchema(have.schema, w.schema); continue; }
      const { line, ...rest } = w;
      writes.push({ ...rest, evidence: [ev(f, line)] });
    }
  }

  const patterns = []; const constants = []; const strings = new Set(); const texts = [];
  for (const f of code) {
    const s = scanned.get(f);
    for (const p of patternsOf(s)) patterns.push({ file: f, ...p });
    for (const c of constantsOf(s)) constants.push({ file: f, ...c });
    for (const t of s.tokens) if (t.kind === "string" || (t.kind === "template" && !t.subst)) strings.add(t.value);
    for (const t of stringsOf(s)) if (keep(f, t.line)) texts.push({ file: f, ...t });
  }

  // The files a writer reads its values from: it and what it imports.
  const fieldValues = (writers, key, siblings) => {
    const files = new Set();
    for (const w of writers) for (const f of closureOf(w)) files.add(f);
    return fieldValuesIn(scanned, [...files].sort(), key, siblings);
  };

  return { scanned, imports, outside, entries, exports: exportsList, anchors, flags, writes, patterns, constants, strings, texts, code, closureOf, fieldValues };
}

/** Whether `name` is written as a word in the masked lines [from, to] of a
 *  scanned file (code, not a string or a comment). */
export function namesUsed(s, from, to) {
  const lines = s.masked.split("\n").slice(from - 1, to).join("\n");
  return (name) => new RegExp(`(^|[^.\\w$])${name.replace(/\$/g, "\\$")}(?![\\w$])`).test(lines);
}
