// No model named in an agent's code, its skills, its runtime requirements or
// its Descriptor (but a run config's allowed models, which are configuration).
//
// Copied from AgentMesh tools/ci/check-no-model-literals.mjs, the gate that
// reads every package in the AgentMesh repository: its identifier rule
// (modelIn), its literal reader (literalsOf) and its per-file rule
// (findingsIn), unchanged, so a package this file passes is one that gate
// passes. Only string and template literals are read in code; a comment is
// history, not a model choice. In a skill, the runtime requirements and the
// Descriptor, every word is read. test/models.test.mjs checks this copy
// against cases handed in from the test's own environment, so no model is
// named in this package either.
//
//   needs: node >= 22
//   import { findingsIn, modelFindings } from "./models.mjs"

const CODE = /\.(mjs|js|cjs|ts|mts|cts|tsx|jsx)$/;
const SKIP_DIRS = new Set(["node_modules", "test", "tests", "records", "sample", "samples", "fixtures", "chain", ".git"]);

const MODEL_ID = new RegExp([
  // (one provider family and its version)
  String.raw`\b(?:gemini|gemma|imagen|veo)-\d`,
  // (one provider family and its version)
  String.raw`\bclaude-(?:[a-z]+-)*\d`,
  // (one provider family and its version)
  String.raw`\bgpt-\d`,
  // (one provider family and its version)
  String.raw`\bo[1-9]-(?:mini|pro)\b`,
  // (one provider family and its version)
  String.raw`\bchirp[_-]\d`,
  // (one provider family and its version)
  String.raw`\b(?:sonnet|haiku|opus)[- ]\d`,
].join("|"), "i");

export function modelIn(text) {
  const m = MODEL_ID.exec(String(text ?? ""));
  return m ? m[0] : null;
}

/** The string and template literals of a piece of JavaScript or TypeScript,
 *  each with the line it starts on. Comments and regular expressions are
 *  skipped. A small lexer, enough for the code in this repository: a slash
 *  starts a regular expression where an operand is expected, and the code
 *  inside a template's ${...} is read as code, nested templates, strings and
 *  braces included. */
export function literalsOf(source) {
  const s = String(source ?? "");
  const out = [];
  let i = 0;
  let line = 1;
  const KEYWORD_BEFORE = /\b(?:return|typeof|case|of|in|yield|await|void|delete|throw|else|do)$/;

  // Read code from i until the end, or until the } that closes an
  // interpolation when `inner` is set; returns the index after it.
  function code(inner) {
    let prev = "";
    let depth = 0;
    const operandNext = () => prev === "" || /[(,=:[!&|?{};+\-*%<>~^]/.test(prev) || KEYWORD_BEFORE.test(s.slice(Math.max(0, i - 8), i).trimEnd());
    while (i < s.length) {
      const c = s[i];
      const n = s[i + 1];
      if (c === "\n") { line += 1; i += 1; continue; }
      if (c === "/" && n === "/") { while (i < s.length && s[i] !== "\n") i += 1; continue; }
      if (c === "/" && n === "*") {
        i += 2;
        while (i < s.length && !(s[i] === "*" && s[i + 1] === "/")) { if (s[i] === "\n") line += 1; i += 1; }
        i += 2;
        continue;
      }
      if (c === "'" || c === '"') {
        const start = line;
        let j = i + 1;
        let text = "";
        while (j < s.length && s[j] !== c && s[j] !== "\n") { if (s[j] === "\\") { text += s[j + 1] ?? ""; j += 2; continue; } text += s[j]; j += 1; }
        out.push({ line: start, text });
        i = j + 1; prev = c; continue;
      }
      if (c === "`") { i += 1; template(); prev = "`"; continue; }
      if (c === "/" && operandNext()) {
        // A regular expression literal: skipped whole, classes included.
        let j = i + 1; let inClass = false;
        while (j < s.length && s[j] !== "\n") {
          if (s[j] === "\\") { j += 2; continue; }
          if (s[j] === "[") inClass = true;
          else if (s[j] === "]") inClass = false;
          else if (s[j] === "/" && !inClass) break;
          j += 1;
        }
        j += 1;
        while (j < s.length && /[a-z]/i.test(s[j])) j += 1;
        i = j; prev = "x"; continue;
      }
      if (inner && c === "{") depth += 1;
      if (inner && c === "}") {
        if (depth === 0) { i += 1; return; }
        depth -= 1;
      }
      if (!/\s/.test(c)) prev = c;
      i += 1;
    }
  }

  // Read a template from just after its opening backtick; its literal text is
  // one literal, and each ${...} is read as code.
  function template() {
    const start = line;
    let text = "";
    while (i < s.length) {
      const d = s[i];
      if (d === "\\") { text += s[i + 1] ?? ""; i += 2; continue; }
      if (d === "`") { i += 1; break; }
      if (d === "$" && s[i + 1] === "{") { i += 2; text += " "; code(true); continue; }
      if (d === "\n") line += 1;
      text += d;
      i += 1;
    }
    out.push({ line: start, text });
  }

  code(false);
  return out;
}

/** The findings in one file's text: { line, model, where }. */
export function findingsIn(path, text) {
  const found = [];
  if (CODE.test(path)) {
    for (const lit of literalsOf(text)) {
      const model = modelIn(lit.text);
      if (model) found.push({ line: lit.line, model, where: "a string in code" });
    }
    return found;
  }
  if (/agent-descriptor\.json$/.test(path)) {
    let doc;
    try { doc = JSON.parse(text); } catch { return [{ line: 1, model: "", where: "a descriptor that is not JSON" }]; }
    const walk = (v, at) => {
      if (typeof v === "string") { const model = modelIn(v); if (model) found.push({ line: 0, model, where: at }); return; }
      if (Array.isArray(v)) { v.forEach((x, k) => walk(x, `${at}[${k}]`)); return; }
      if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) if (!(at === "" && k === "run_config")) walk(x, at ? `${at}.${k}` : k);
    };
    walk(doc, "");
    return found;
  }
  String(text).split("\n").forEach((l, k) => {
    const model = modelIn(l);
    if (model) found.push({ line: k + 1, model, where: "the text" });
  });
  return found;
}

/** Every file of a package this rule reads: code outside test folders, each
 *  SKILL.md, the runtime requirements and the Descriptor. */
export function readsFile(path) {
  const parts = path.split("/");
  if (parts.slice(0, -1).some((p) => SKIP_DIRS.has(p))) return false;
  const name = parts[parts.length - 1];
  return (CODE.test(name) && !/\.test\.[a-z]+$/.test(name)) || name === "SKILL.md" || name === "agent-runtime-requirements.json" || name === "agent-descriptor.json";
}

/** Every finding in a package's files (Map path -> bytes): {file, line, model, where}. */
export function modelFindings(files) {
  const out = [];
  for (const [path, bytes] of files) {
    if (!readsFile(path)) continue;
    for (const f of findingsIn(path, bytes.toString("utf8"))) out.push({ file: path, ...f });
  }
  return out;
}
