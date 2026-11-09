// JavaScript source, read by rule: no model and no parser package, only a
// small lexer that knows where strings, template literals, regular
// expressions and comments start and end.
//
// scan(text) answers the text as written, a masked copy of the same length in
// which every comment and the inside of every string, template and regular
// expression is blanked (to spaces, line breaks kept; a regular expression to
// zeros, so it still reads as one operand), and the literals found,
// each with where it starts and ends. Structure (braces, keywords, names) is
// then read off the masked copy, so a brace or a keyword inside a string is
// never taken for code, and values are read off the text as written, so a
// quoted pattern or a format id comes back byte for byte.
//
// The rest are small readers on top of a scan: the matching bracket, a list
// split at its top-level commas, the declaration a name has, an object
// literal's fields, and the JSON Schema type an expression shows when it shows
// one (a literal, a template, String(...), a ternary, a const it names).
// Where the code does not show a type, the schema says what the value is made
// from, in a $comment, and claims nothing more.
//
//   needs: node >= 22. Nothing here reads or writes a file.
//   import { scan, typeOfExpr } from "./js-source.mjs"

const WORD = /[A-Za-z0-9_$]/;
const BEFORE_REGEX = new Set(["return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw", "case", "do", "else", "yield", "await"]);
const REGEX_AFTER = "(,=:[!&|?{};+-*%<>~^";

/** A string literal's value, from its text between the quotes. */
export function unescape(raw) {
  return String(raw).replace(/\\(u\{([0-9a-fA-F]+)\}|u([0-9a-fA-F]{4})|x([0-9a-fA-F]{2})|\r?\n|.)/g, (all, e, cp, u, x) => {
    if (cp) return String.fromCodePoint(parseInt(cp, 16));
    if (u) return String.fromCharCode(parseInt(u, 16));
    if (x) return String.fromCharCode(parseInt(x, 16));
    if (e === "\n" || e === "\r\n") return "";
    return { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", v: "\v", 0: "\0" }[e] ?? e;
  });
}

/** One file, scanned: {text, masked, tokens, lineOf(offset)}. Each token is
 *  {kind: string|template|regex, start, end, line, value?, subst?}: start and
 *  end take in the quotes or slashes; a string's value is decoded, a
 *  template's only when it has no ${...}, a regular expression's is its text
 *  as written, slashes and flags included. */
export function scan(text) {
  const src = String(text ?? "");
  const n = src.length;
  const out = src.split("");
  const tokens = [];
  const starts = [0];
  for (let k = 0; k < n; k++) if (src[k] === "\n") starts.push(k + 1);
  const lineOf = (off) => {
    let lo = 0; let hi = starts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= off) lo = mid; else hi = mid - 1; }
    return lo + 1;
  };
  const blank = (a, b) => { for (let k = a; k < b; k++) if (src[k] !== "\n" && src[k] !== "\r") out[k] = " "; };
  const stack = []; // open template substitutions: {depth, token}
  let depth = 0;
  let last = ""; // the last significant character of code, or "w" after a word, ")" after an operand
  let lastWord = "";
  let i = 0;

  // Read a template from `from` (just past a backtick or a closing brace of a
  // substitution) to its closing backtick or its next ${. Answers where it
  // stopped and how.
  const template = (from, token) => {
    let k = from;
    while (k < n) {
      if (src[k] === "\\") { k += 2; continue; }
      if (src[k] === "`") { blank(from, k); token.end = k + 1; return k + 1; }
      if (src[k] === "$" && src[k + 1] === "{") {
        blank(from, k);
        token.subst = true;
        stack.push({ depth, token });
        depth += 1;
        return k + 2;
      }
      k += 1;
    }
    blank(from, n); token.end = n; return n;
  };

  while (i < n) {
    const c = src[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") { i += 1; continue; }
    if (c === "/" && src[i + 1] === "/") { const e = src.indexOf("\n", i); const end = e === -1 ? n : e; blank(i, end); i = end; continue; }
    if (c === "/" && src[i + 1] === "*") { const e = src.indexOf("*/", i + 2); const end = e === -1 ? n : e + 2; blank(i, end); i = end; continue; }
    if (c === "#" && i === 0 && src[1] === "!") { const e = src.indexOf("\n"); i = e === -1 ? n : e; continue; }
    if (c === "'" || c === "\"") {
      let k = i + 1;
      while (k < n && src[k] !== c && src[k] !== "\n") k += src[k] === "\\" ? 2 : 1;
      const end = Math.min(n, k + 1);
      tokens.push({ kind: "string", start: i, end, line: lineOf(i), value: unescape(src.slice(i + 1, k)) });
      blank(i + 1, k);
      i = end; last = ")"; lastWord = "";
      continue;
    }
    if (c === "`") {
      const token = { kind: "template", start: i, end: n, line: lineOf(i), subst: false };
      tokens.push(token);
      i = template(i + 1, token);
      if (!token.subst) token.value = unescape(src.slice(token.start + 1, token.end - 1));
      last = ")"; lastWord = "";
      continue;
    }
    if (c === "/") {
      const allowed = last === "" || REGEX_AFTER.includes(last) || (last === "w" && BEFORE_REGEX.has(lastWord));
      if (allowed) {
        let k = i + 1; let inClass = false; let ok = false;
        while (k < n && src[k] !== "\n") {
          if (src[k] === "\\") { k += 2; continue; }
          if (src[k] === "[") inClass = true;
          else if (src[k] === "]") inClass = false;
          else if (src[k] === "/" && !inClass) { ok = true; break; }
          k += 1;
        }
        if (ok) {
          let end = k + 1;
          while (end < n && /[a-z]/i.test(src[end])) end += 1;
          tokens.push({ kind: "regex", start: i, end, line: lineOf(i), value: src.slice(i, end) });
          // Masked as an operand of zeros, so its slashes never read as division.
          for (let z = i; z < end; z++) out[z] = "0";
          i = end; last = ")"; lastWord = "";
          continue;
        }
      }
      last = "/"; lastWord = ""; i += 1;
      continue;
    }
    if (WORD.test(c)) {
      let k = i;
      while (k < n && WORD.test(src[k])) k += 1;
      const word = src.slice(i, k);
      if (/^\d/.test(word)) { last = ")"; lastWord = ""; } else { last = "w"; lastWord = word; }
      i = k;
      continue;
    }
    if (c === "{") { depth += 1; last = "{"; lastWord = ""; i += 1; continue; }
    if (c === "}") {
      depth -= 1;
      const top = stack[stack.length - 1];
      if (top && top.depth === depth) {
        stack.pop();
        i = template(i + 1, top.token);
        if (!stack.length || stack[stack.length - 1].token !== top.token) {
          last = ")"; lastWord = "";
        }
        continue;
      }
      last = "}"; lastWord = ""; i += 1;
      continue;
    }
    if (c === ")" || c === "]") { last = ")"; lastWord = ""; i += 1; continue; }
    last = c; lastWord = ""; i += 1;
  }
  tokens.sort((a, b) => a.start - b.start);
  return { text: src, masked: out.join(""), tokens, lineOf };
}

const OPEN = { "(": ")", "[": "]", "{": "}" };
const CLOSE = { ")": "(", "]": "[", "}": "{" };

/** The index of the bracket that closes the one at `at`, in masked text, or -1. */
export function matching(masked, at) {
  const open = masked[at]; const close = OPEN[open];
  if (!close) return -1;
  let d = 0;
  for (let k = at; k < masked.length; k++) {
    if (masked[k] === open) d += 1;
    else if (masked[k] === close) { d -= 1; if (d === 0) return k; }
  }
  return -1;
}

/** The index of the bracket that opens the one at `at` (a closing one), or -1. */
export function matchingBack(masked, at) {
  const close = masked[at]; const open = CLOSE[close];
  if (!open) return -1;
  let d = 0;
  for (let k = at; k >= 0; k--) {
    if (masked[k] === close) d += 1;
    else if (masked[k] === open) { d -= 1; if (d === 0) return k; }
  }
  return -1;
}

/** [from, to) split at the commas outside any bracket: [[a, b], ...], each
 *  trimmed, empty pieces left out. */
export function splitTop(masked, from, to, sep = ",") {
  const out = []; let d = 0; let at = from;
  const push = (a, b) => {
    while (a < b && /\s/.test(masked[a])) a += 1;
    while (b > a && /\s/.test(masked[b - 1])) b -= 1;
    if (b > a) out.push([a, b]);
  };
  for (let k = from; k < to; k++) {
    const ch = masked[k];
    if (OPEN[ch]) d += 1;
    else if (CLOSE[ch]) d -= 1;
    else if (ch === sep && d === 0) { push(at, k); at = k + 1; }
  }
  push(at, to);
  return out;
}

/** Brace depth at each offset of masked text, counting { and } only. */
export function braceDepths(masked) {
  const d = new Int32Array(masked.length + 1);
  let cur = 0;
  for (let k = 0; k < masked.length; k++) {
    d[k] = cur;
    if (masked[k] === "{") cur += 1;
    else if (masked[k] === "}") cur -= 1;
  }
  d[masked.length] = cur;
  return d;
}

/** Where a statement that starts at `from` ends: the first ; at bracket depth
 *  0, or a line break at depth 0 that is not followed by an operator or a
 *  dot carrying the expression on. */
export function statementEnd(masked, from) {
  let d = 0;
  let inTemplate = false; // 0.3.0: a line break inside a template does not end the statement
  for (let k = from; k < masked.length; k++) {
    const ch = masked[k];
    if (d === 0 && ch === "`") { inTemplate = !inTemplate; continue; }
    if (inTemplate && d === 0 && !(ch === "{" && masked[k - 1] === "$")) continue;
    if (OPEN[ch]) d += 1;
    else if (CLOSE[ch]) { if (d === 0) return k; d -= 1; }
    else if (d === 0 && ch === ";") return k;
    else if (d === 0 && ch === "\n") {
      const rest = masked.slice(k + 1).match(/^\s*(\S)/);
      const before = masked.slice(from, k).trimEnd();
      if (!rest || (!/[.?:+\-*/&|,=]/.test(rest[1]) && !/[.?:+\-*/&|,=(]$/.test(before))) return k;
    }
  }
  return masked.length;
}

/** The token that spans exactly [a, b), or null. */
export function tokenAt(s, a, b) {
  for (const t of s.tokens) { if (t.start === a && t.end === b) return t; if (t.start > a) break; }
  return null;
}

/** Whether a name declared at `at` is still in scope at `use`: no block
 *  that holds the declaration closes between the two. */
function inScope(s, at, use) {
  s.depths ??= braceDepths(s.masked);
  const d = s.depths[at];
  for (let k = at; k < use; k++) if (s.depths[k] < d) return false;
  return true;
}

/** The declaration of `name` in scope at `before`, the nearest one: {kind:
 *  const, let or var, start, end, line} with start and end of its value, or
 *  null. A function's parameters are not read. */
export function declarationBefore(s, name, before = s.masked.length) {
  const m = s.masked;
  const esc = name.replace(/\$/g, "\\$");
  let found = null;
  for (const hit of m.matchAll(/\b(const|let|var)\s+/g)) {
    if (hit.index >= before) break;
    if (m[hit.index - 1] === ".") continue;
    const end = statementEnd(m, hit.index + hit[0].length);
    for (const [x, y] of splitTop(m, hit.index + hit[0].length, end)) {
      if (x >= before) break;
      const d = new RegExp(`^${esc}\\s*(=(?![=>])|$)`).exec(m.slice(x, y));
      if (!d || !inScope(s, hit.index, before)) continue;
      let a = x + d[0].length;
      while (a < y && /\s/.test(m[a])) a += 1;
      found = { kind: hit[1], start: a, end: y, line: s.lineOf(x) };
    }
  }
  return found;
}

/** The const `name` is in scope at `before`: {start, end, line} of its value,
 *  or null. Only a const: a let or var may be given another value later, and
 *  a let or var of the same name nearer the use hides an outer const. */
export function constBefore(s, name, before = s.masked.length) {
  const d = declarationBefore(s, name, before);
  return d && d.kind === "const" && d.end > d.start ? d : null;
}

const collapse = (t) => String(t).replace(/\s+/g, " ").trim();

/** Strip whitespace and one pair of wrapping parentheses. */
function trimRange(m, a, b) {
  while (a < b && /\s/.test(m[a])) a += 1;
  while (b > a && /\s/.test(m[b - 1])) b -= 1;
  while (m[a] === "(" && matching(m, a) === b - 1) { a += 1; b -= 1; while (a < b && /\s/.test(m[a])) a += 1; while (b > a && /\s/.test(m[b - 1])) b -= 1; }
  return [a, b];
}

/** The top-level position of a ternary's ? and its :, or null. */
function ternaryOf(m, a, b) {
  let d = 0; let q = -1; let nested = 0;
  for (let k = a; k < b; k++) {
    const ch = m[k];
    if (OPEN[ch]) d += 1;
    else if (CLOSE[ch]) d -= 1;
    else if (d === 0 && ch === "?" && m[k + 1] !== "." && m[k + 1] !== "?" && m[k - 1] !== "?") { if (q === -1) q = k; else nested += 1; }
    else if (d === 0 && ch === ":" && q !== -1) { if (nested === 0) return { q, c: k }; nested -= 1; }
  }
  return null;
}

/** Where an operator `re` matches at the top level of [a, b), or -1. An
 *  arrow's => is never read as a comparison. */
function topOperator(m, a, b, re) {
  let d = 0;
  for (let k = a; k < b; k++) {
    const ch = m[k];
    if (OPEN[ch]) d += 1;
    else if (CLOSE[ch]) d -= 1;
    else if (d === 0) {
      const hit = re.exec(m.slice(k, k + 14));
      if (hit && hit.index === 0 && !(ch === ">" && m[k - 1] === "=") && !(ch === "=" && m[k + 1] === ">")) return k;
    }
  }
  return -1;
}

/** The method called last at the top level when [a, b) ends in a call:
 *  {name, member} or null. */
function lastCall(m, a, b) {
  if (m[b - 1] !== ")") return null;
  const open = matchingBack(m, b - 1);
  if (open <= a) return null;
  let k = open - 1;
  while (k >= a && /\s/.test(m[k])) k -= 1;
  let e = k + 1;
  while (k >= a && WORD.test(m[k])) k -= 1;
  const name = m.slice(k + 1, e);
  let j = k;
  while (j >= a && /\s/.test(m[j])) j -= 1;
  return name ? { name, member: m[j] === "." && m[j - 1] !== "." , whole: k + 1 === a } : null;
}

const STRING_METHODS = new Set(["toISOString", "toJSON", "join", "toLowerCase", "toUpperCase", "trim", "trimStart", "trimEnd", "replace", "replaceAll", "padStart", "padEnd", "repeat", "normalize", "toFixed", "toLocaleString", "toString", "toLocaleDateString", "toLocaleTimeString", "charAt"]);
const BOOLEAN_METHODS = new Set(["test", "includes", "some", "every", "startsWith", "endsWith", "has", "isArray", "isInteger", "isFinite", "isNaN", "hasOwn", "existsSync"]);
const ARRAY_METHODS = new Set(["map", "filter", "flatMap", "split", "keys", "values", "entries", "from", "concat", "sort", "reverse", "flat", "toSorted"]);
const NUMBER_FUNCS = new Set(["Number", "parseInt", "parseFloat"]);

const unknownType = (s, a, b) => ({ $comment: `value: ${collapse(s.text.slice(a, b)).slice(0, 160)}` });

/** Two schemas as one that allows either. */
export function either(x, y) {
  const known = (t) => typeof t.type === "string" || Array.isArray(t.type);
  if (x.type === "null" && !known(y) && y.$comment && Object.keys(y).length === 1) return { $comment: `${y.$comment}, or null` };
  if (y.type === "null" && !known(x) && x.$comment && Object.keys(x).length === 1) return { $comment: `${x.$comment}, or null` };
  if (known(x) && known(y)) {
    const types = [...new Set([].concat(x.type, y.type))];
    const out = { type: types.length === 1 ? types[0] : types };
    const vals = (t) => (t.const !== undefined ? [t.const] : Array.isArray(t.enum) ? t.enum : null);
    const vx = vals(x); const vy = vals(y);
    if (vx && vy) out.enum = [...new Set([...vx, ...vy])];
    else if (vx && y.type === "null") out.enum = [...vx, null];
    else if (vy && x.type === "null") out.enum = [...vy, null];
    if (x.format && x.format === y.format) out.format = x.format;
    return out;
  }
  return { anyOf: [x, y] };
}

/** The JSON Schema an expression shows, read by rule. `before` limits the
 *  consts a name may resolve to (those declared earlier in the file). */
export function typeOfExpr(s, a0, b0, { depth = 0, before = a0 } = {}) {
  const m = s.masked;
  const [a, b] = trimRange(m, a0, b0);
  if (a >= b) return {};
  const src = s.text.slice(a, b);
  const tok = tokenAt(s, a, b);
  if (tok) {
    if (tok.kind === "string") return { type: "string", const: tok.value };
    if (tok.kind === "template") return tok.subst ? { type: "string" } : { type: "string", const: tok.value };
    return unknownType(s, a, b);
  }
  if (/^-?\d[\d_]*$/.test(src)) return { type: "integer", const: Number(src.replace(/_/g, "")) };
  if (/^-?\d[\d_]*\.\d+(?:[eE][+-]?\d+)?$/.test(src)) return { type: "number", const: Number(src.replace(/_/g, "")) };
  if (src === "true" || src === "false") return { type: "boolean", const: src === "true" };
  if (src === "null") return { type: "null" };
  if (m[a] === "{" && matching(m, a) === b - 1) return depth > 4 ? { type: "object" } : objectSchema(s, a, b, { depth: depth + 1, before });
  if (m[a] === "[" && matching(m, a) === b - 1) {
    const items = splitTop(m, a + 1, b - 1).filter(([x]) => !m.startsWith("...", x)).map(([x, y]) => typeOfExpr(s, x, y, { depth: depth + 1, before }));
    if (!items.length) return { type: "array" };
    const one = items.reduce((p, q) => (JSON.stringify(p) === JSON.stringify(q) ? p : either(p, q)));
    return { type: "array", items: one };
  }
  const t = ternaryOf(m, a, b);
  if (t) return either(typeOfExpr(s, t.q + 1, t.c, { depth, before }), typeOfExpr(s, t.c + 1, b, { depth, before }));
  if (topOperator(m, a, b, /^(\?\?|\|\||&&)/) !== -1) return unknownType(s, a, b);
  if (topOperator(m, a, b, /^(===|!==|==|!=|<=|>=)/) !== -1 || topOperator(m, a, b, /^[<>](?![=<>])/) !== -1 || /^!(?!=)/.test(src) || topOperator(m, a, b, /^\s(instanceof|in)\s/) !== -1) return { type: "boolean" };
  if (/^typeof\s/.test(src)) return { type: "string" };
  if (/^`/.test(src)) return { type: "string" };
  if (topOperator(m, a, b, /^\+(?![+=])/) > a) {
    // A sum with a string in it is a string; a sum of numbers is a number.
    const plus = m.slice(0, a) + m.slice(a, b).replace(/\+(?![+=])/g, ",") + m.slice(b);
    const parts = splitTop(plus, a, b).map(([x, y]) => typeOfExpr(s, x, y, { depth: depth + 1, before }));
    if (parts.some((p) => p.type === "string")) return { type: "string" };
    if (parts.length && parts.every((p) => p.type === "integer" || p.type === "number")) return { type: "number" };
    return unknownType(s, a, b);
  }
  if (topOperator(m, a, b, /^[-*/%](?![-=])/) > a) return { type: "number" };
  if (/^new\s+Date\b/.test(src) && lastCall(m, a, b)?.name === "toISOString") return { type: "string", format: "date-time" };
  const call = lastCall(m, a, b);
  if (call) {
    if (!call.member && call.whole) {
      if (call.name === "String") return { type: "string" };
      if (NUMBER_FUNCS.has(call.name)) return { type: "number" };
      if (call.name === "Boolean") return { type: "boolean" };
    }
    if (call.member) {
      if (call.name === "toISOString") return { type: "string", format: "date-time" };
      if (STRING_METHODS.has(call.name)) return { type: "string" };
      if (BOOLEAN_METHODS.has(call.name)) return { type: "boolean" };
      if (ARRAY_METHODS.has(call.name)) return { type: "array" };
      if (/^Math\./.test(src)) return { type: "number" };
    }
    return unknownType(s, a, b);
  }
  if (/\.length$/.test(src)) return { type: "integer" };
  if (/^[A-Za-z_$][\w$]*$/.test(src) && depth < 5) {
    const d = constBefore(s, src, before);
    if (d) return typeOfExpr(s, d.start, d.end, { depth: depth + 1, before: d.start });
    // 0.3.0: a let or var that is only ever given literals has those values.
    const v = letValues(s, src, before, depth);
    if (v) return v;
  }
  return unknownType(s, a, b);
}

/** The schema of a literal one: {type, const} for a string, number or
 *  boolean, {type: "null"} for null, or null when it is not a literal. */
const literalSchema = (t) => (t && (t.const !== undefined || t.type === "null") && !t.enum ? t : null);

/** Where the block that holds offset `at` closes (masked text), or the end. */
function blockEnd(s, at) {
  s.depths ??= braceDepths(s.masked);
  const d = s.depths[at];
  for (let k = at; k < s.masked.length; k++) if (s.depths[k] < d) return k;
  return s.masked.length;
}

/** Each value a let or var `name` (declared in scope at `before`) is given:
 *  its initial value and every assignment to it in its block, as [start,
 *  end) ranges; null when one is given in a way this reader does not follow
 *  (a compound assignment, ++, a loop variable, a destructuring it cannot
 *  match, a name declared again inside). */
export function assignedRanges(s, name, before = s.masked.length) {
  const decl = declarationBefore(s, name, before);
  if (!decl || decl.kind === "const") return null;
  const m = s.masked;
  const esc = name.replace(/\$/g, "\\$");
  const out = decl.end > decl.start ? [[decl.start, decl.end]] : [];
  const end = blockEnd(s, decl.start);
  const re = new RegExp(`(^|[^.\\w$])${esc}(?![\\w$])`, "g");
  re.lastIndex = decl.end;
  for (let h = re.exec(m); h && h.index < end; h = re.exec(m)) {
    const at = h.index + h[1].length;
    const after = m.slice(at + name.length, at + name.length + 6);
    const pre = m.slice(Math.max(0, at - 12), at);
    if (/(\+\+|--)\s*$/.test(pre) || /^\s*(\+\+|--|[-+*/%&|^]=|\*\*=|<<=|>>>?=|\?\?=|\|\|=|&&=)/.test(after)) return null;
    if (/\b(const|let|var)\s+$/.test(pre) || /\bfor\s*\(\s*$/.test(pre)) return null;
    if (/^\s*=(?![=>])/.test(after)) {
      const eq = m.indexOf("=", at + name.length);
      let a = eq + 1;
      while (a < m.length && /\s/.test(m[a])) a += 1;
      out.push([a, statementEnd(m, a)]);
      continue;
    }
    // [x, name] = [a, b]: the value at the same place.
    let k = at - 1; let d = 0;
    for (; k >= 0; k--) {
      const ch = m[k];
      if (ch === "]" || ch === ")" || ch === "}") d += 1;
      else if (ch === "[" || ch === "(" || ch === "{") { if (d === 0) break; d -= 1; } else if (ch === ";" && d === 0) { k = -1; break; }
    }
    if (k < 0 || m[k] !== "[") continue;
    const close = matching(m, k);
    const eq = /^\s*=(?![=>])\s*/.exec(m.slice(close + 1));
    if (!eq) continue;
    // An index (a[i] = x) or a read, not a pattern; after the ) of an if, a
    // while or a for, or after else, it is a statement of its own.
    const head = m.slice(0, k).trimEnd();
    const prev = head.slice(-1);
    if (prev === ")") {
      const open = matchingBack(m, head.length - 1);
      if (!/\b(if|while|for)\s*$/.test(m.slice(Math.max(0, open - 8), open))) continue;
    } else if (/[\w$]/.test(prev) && !/\b(else|do)$/.test(head)) continue;
    else if (prev === "]") continue;
    const slots = splitTop(m, k + 1, close);
    const idx = slots.findIndex(([x, y]) => x <= at && at < y);
    const rhs = close + 1 + eq[0].length;
    if (m[rhs] !== "[") return null;
    const items = splitTop(m, rhs + 1, matching(m, rhs));
    if (idx === -1 || !items[idx]) return null;
    out.push(items[idx]);
  }
  return out;
}

/** The schema of a let or var that is only ever given literals: {type,
 *  enum} in the order the code gives them, or null. */
function letValues(s, name, before, depth) {
  const ranges = assignedRanges(s, name, before);
  if (!ranges || !ranges.length) return null;
  const values = []; const types = [];
  for (const [x, y] of ranges) {
    const t = literalSchema(typeOfExpr(s, x, y, { depth: depth + 1, before: x }));
    if (!t) return null;
    const v = t.type === "null" ? null : t.const;
    if (!values.some((w) => w === v)) values.push(v);
    if (!types.includes(t.type)) types.push(t.type);
  }
  if (values.length === 1) return types[0] === "null" ? { type: "null" } : { type: types[0], const: values[0] };
  return { type: types.length === 1 ? types[0] : types, enum: values };
}

/** The binary operator an expression [a, b) splits at last, of the lowest
 *  precedence it has at the top level (+ and -, then *, / and %, then **):
 *  {at, op} or null. A sign before an operand is not one. */
function binaryAt(m, a, b) {
  for (const ops of [["+", "-"], ["*", "/", "%"], ["**"]]) {
    let d = 0; let found = null;
    for (let k = a; k < b; k++) {
      const ch = m[k];
      if (OPEN[ch]) { d += 1; continue; }
      if (CLOSE[ch]) { d -= 1; continue; }
      if (d !== 0) continue;
      const two = m.slice(k, k + 2);
      let op = null;
      if (ops.includes("**") && two === "**") op = "**";
      else if (two === "**" || two === "++" || two === "--" || two === "=>" || m[k + 1] === "=") { k += 1; continue; }
      else if (ops.includes(ch)) op = ch;
      if (!op) continue;
      const before = m.slice(a, k).trimEnd();
      if (!before || /[+\-*/%(,=:?!&|<>]$/.test(before)) { k += op.length - 1; continue; }
      found = { at: k, op };
      k += op.length - 1;
    }
    if (found) return found;
  }
  return null;
}

/** The JSON value an expression [a, b) writes, when it is literals all the
 *  way down: strings, numbers, true, false, null, arrays and objects of them,
 *  templates whose parts are such constants, and names of consts declared
 *  earlier with such values. Answers {ok: true, value} or {ok: false, why}. */
export function literalValue(s, a0, b0, { depth = 0, before = a0 } = {}) {
  const m = s.masked;
  const [a, b] = trimRange(m, a0, b0);
  const no = (why) => ({ ok: false, why });
  if (a >= b) return no("it has no value written");
  if (depth > 12) return no("it is nested too deep to read");
  const src = s.text.slice(a, b);
  const tok = tokenAt(s, a, b);
  if (tok) {
    if (tok.kind === "string") return { ok: true, value: tok.value };
    if (tok.kind === "regex") return no(`it holds a regular expression (${tok.value}), which is not a JSON value`);
    if (!tok.subst) return { ok: true, value: tok.value };
    // A template whose ${...} parts are each a constant.
    let out = ""; let k = a + 1;
    const raw = s.text;
    while (k < b - 1) {
      if (raw[k] === "\\") { out += unescape(raw.slice(k, k + 2)); k += 2; continue; }
      if (raw[k] === "$" && raw[k + 1] === "{") {
        const close = matching(m, k + 1);
        if (close === -1 || close >= b) return no("its template could not be read");
        const v = literalValue(s, k + 2, close, { depth: depth + 1, before });
        if (!v.ok || (v.value !== null && typeof v.value === "object")) return no(`its template part \${${collapse(raw.slice(k + 2, close))}} is not a constant`);
        out += String(v.value); k = close + 1; continue;
      }
      out += raw[k]; k += 1;
    }
    return { ok: true, value: out };
  }
  if (/^-?\d[\d_]*(\.\d+)?([eE][+-]?\d+)?$/.test(src)) return { ok: true, value: Number(src.replace(/_/g, "")) };
  if (/^-?0[xX][0-9a-fA-F_]+$/.test(src)) return { ok: true, value: Number(src.replace(/_/g, "")) };
  if (src === "true" || src === "false") return { ok: true, value: src === "true" };
  if (src === "null") return { ok: true, value: null };
  if (m[a] === "[" && matching(m, a) === b - 1) {
    const out = [];
    for (const [x, y] of splitTop(m, a + 1, b - 1)) {
      if (m.startsWith("...", x)) return no(`it spreads ${collapse(s.text.slice(x + 3, y))} into a list`);
      const v = literalValue(s, x, y, { depth: depth + 1, before });
      if (!v.ok) return v;
      out.push(v.value);
    }
    return { ok: true, value: out };
  }
  if (m[a] === "{" && matching(m, a) === b - 1) {
    const out = {};
    for (const [x, y] of splitTop(m, a + 1, b - 1)) {
      const piece = m.slice(x, y);
      if (piece.startsWith("...")) return no(`it spreads ${collapse(s.text.slice(x + 3, y))} into an object`);
      if (piece.startsWith("[")) return no("it has a field whose name is worked out");
      if (/^(async\s+)?(get\s+|set\s+)?\*?\s*[A-Za-z_$][\w$]*\s*\(/.test(piece)) return no("it has a method");
      let colon = -1; let d = 0;
      for (let k = x; k < y; k++) {
        if (OPEN[m[k]]) d += 1; else if (CLOSE[m[k]]) d -= 1;
        else if (d === 0 && m[k] === ":") { colon = k; break; }
      }
      let key; let v;
      if (colon === -1) {
        key = s.text.slice(x, y).trim();
        if (!/^[A-Za-z_$][\w$]*$/.test(key)) return no("it has a field this reader does not follow");
        v = literalValue(s, x, y, { depth: depth + 1, before });
      } else {
        const [kx, ky] = trimRange(m, x, colon);
        const kt = tokenAt(s, kx, ky);
        key = kt && kt.kind === "string" ? kt.value : s.text.slice(kx, ky).trim();
        v = literalValue(s, colon + 1, y, { depth: depth + 1, before });
      }
      if (!v.ok) return v;
      out[key] = v.value;
    }
    return { ok: true, value: out };
  }
  const call = /^Object\s*\.\s*freeze\s*\(/.exec(m.slice(a, b));
  if (call && m[b - 1] === ")") return literalValue(s, a + call[0].length, b - 1, { depth: depth + 1, before });
  // new Set([...]): its members, in order, said to be a Set.
  const set = /^new\s+Set\s*\(/.exec(m.slice(a, b));
  if (set && matching(m, a + set[0].length - 1) === b - 1) {
    const v = literalValue(s, a + set[0].length, b - 1, { depth: depth + 1, before });
    return v.ok && Array.isArray(v.value) ? { ok: true, value: v.value, made_as: "new Set" } : (v.ok ? no("it is a Set made from something other than a list") : v);
  }
  // Arithmetic on number constants, and + joining strings: 2 * 1024 * 1024.
  const op = binaryAt(m, a, b);
  if (op) {
    const x = literalValue(s, a, op.at, { depth: depth + 1, before });
    const y = literalValue(s, op.at + op.op.length, b, { depth: depth + 1, before });
    if (!x.ok) return x;
    if (!y.ok) return y;
    const nums = typeof x.value === "number" && typeof y.value === "number";
    if (op.op === "+" && (nums || typeof x.value === "string" || typeof y.value === "string") && [x.value, y.value].every((v) => typeof v === "string" || typeof v === "number")) return { ok: true, value: x.value + y.value };
    if (!nums) return no(`it works out ${collapse(src).slice(0, 80)} from values that are not numbers`);
    const r = { "-": x.value - y.value, "*": x.value * y.value, "/": x.value / y.value, "%": x.value % y.value, "**": x.value ** y.value }[op.op];
    return Number.isFinite(r) ? { ok: true, value: r } : no(`${collapse(src)} is not a finite number`);
  }
  if (/^[A-Za-z_$][\w$]*$/.test(src)) {
    const d = constBefore(s, src, before);
    if (d) return literalValue(s, d.start, d.end, { depth: depth + 1, before: d.start });
    return no(`it names ${src}, which is not a const with a literal value declared before it`);
  }
  return no(`its value is worked out by code (${collapse(src).slice(0, 80)}), not written as a literal`);
}

/** The fields of an object literal [a, b) (a on its {, b just past its }):
 *  [{key, start, end, optional, shorthand}] and {spreads: [text]}. A field
 *  inside `...(cond ? {..} : {})` or `...(cond && {..})` is optional. */
export function objectFields(s, a, b) {
  const m = s.masked;
  const fields = []; const spreads = [];
  for (const [x, y] of splitTop(m, a + 1, b - 1)) {
    const piece = m.slice(x, y);
    if (piece.startsWith("...")) {
      const inner = [];
      for (let k = x + 3; k < y; k++) {
        if (m[k] === "{") { const e = matching(m, k); if (e > 0 && e < y) { inner.push([k, e + 1]); k = e; } }
      }
      const parts = inner.filter(([p, q]) => q - p > 2);
      if (parts.length && /\?|&&/.test(piece)) {
        for (const [p, q] of parts) for (const f of objectFields(s, p, q).fields) fields.push({ ...f, optional: true });
      } else spreads.push(collapse(s.text.slice(x, y)));
      continue;
    }
    if (piece.startsWith("[")) { spreads.push(collapse(s.text.slice(x, y))); continue; }
    if (/^(async\s+)?(get\s+|set\s+)?\*?\s*[A-Za-z_$][\w$]*\s*\(/.test(piece)) continue; // a method is not data
    let colon = -1; let d = 0;
    for (let k = x; k < y; k++) {
      if (OPEN[m[k]]) d += 1; else if (CLOSE[m[k]]) d -= 1;
      else if (d === 0 && m[k] === ":") { colon = k; break; }
    }
    if (colon === -1) {
      const name = s.text.slice(x, y).trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) fields.push({ key: name, start: x, end: y, optional: false, shorthand: true });
      continue;
    }
    const [kx, ky] = trimRange(m, x, colon);
    const tok = tokenAt(s, kx, ky);
    const key = tok && tok.kind === "string" ? tok.value : s.text.slice(kx, ky).trim();
    if (!key || (!tok && !/^[A-Za-z_$][\w$]*$|^\d+$/.test(key))) continue;
    fields.push({ key, start: colon + 1, end: y, optional: false, shorthand: false });
  }
  return { fields, spreads };
}

/** The JSON Schema of an object literal [a, b). */
export function objectSchema(s, a, b, { depth = 0, before = a } = {}) {
  const { fields, spreads } = objectFields(s, a, b);
  const properties = {}; const required = [];
  for (const f of fields) {
    if (Object.hasOwn(properties, f.key)) continue;
    properties[f.key] = typeOfExpr(s, f.start, f.end, { depth, before });
    if (!f.optional) required.push(f.key);
  }
  const out = { type: "object", properties };
  if (required.length) out.required = required;
  if (spreads.length) out.$comment = `also the fields of ${spreads.join(", ")}`;
  return out;
}
