// Which flags a command cannot run without, read by rule (0.3.0).
//
// A flag is read into a field where the code compares an argument with it:
// `if (a === "--job") args.job = argv[++i]` or `case "--job": ...`, the field
// being the first `<name>.<field> = ...` or `<name>.<field>.push(...)` in the
// branch. Then:
//   - required: an `if` whose condition has `!<name>.<field>` (or the field
//     compared with undefined, null or "") as one of its `||` parts, and whose
//     branch refuses: it throws, exits, sets an exit code, or returns
//     `ok: false` or a `code` that is not 0;
//   - optional: the field starts with a value that is not empty, is a list
//     the flag adds to, falls back (`<field> || x`, `?? x`, `? :`, `&& x`), is
//     tested by an `if` that does not refuse, or the flag is read and passed
//     over; or the code never reads the flag from its arguments at all (it is
//     only a word it passes on, such as to git);
//   - otherwise it is not settled, and the draft is asked (evidence-checked);
//     a command with a flag still not settled is a gap.
// Each answer names the file and line it was read from.
//
//   needs: node >= 22. Nothing here reads or writes a file.
//   import { flagsOf } from "./flags.mjs"
import { matching, splitTop, statementEnd } from "./js-source.mjs";

const REFUSES = /\bthrow\b|\bprocess\s*\.\s*exit\s*\(|\bprocess\s*\.\s*exitCode\s*=|\bcode\s*:\s*[1-9]|\bok\s*:\s*false\b|\b(die|fail|usage|bail)\s*\(/;

/** The branch that follows a condition closing at `close` (masked text): [a, b). */
function branchAfter(m, close) {
  let a = close + 1;
  while (a < m.length && /\s/.test(m[a])) a += 1;
  if (m[a] === "{") return [a, matching(m, a) + 1];
  return [a, statementEnd(m, a)];
}

/** Where each flag string is compared and the field its branch sets:
 *  [{flag, field, ignored, line}]. */
function readsOf(s, flagSet) {
  const m = s.masked;
  const out = [];
  for (const t of s.tokens) {
    if (t.kind !== "string" || !flagSet.has(t.value)) continue;
    const pre = m.slice(Math.max(0, t.start - 40), t.start);
    let branch = null;
    if (/\bcase\s*$/.test(pre)) {
      const colon = m.indexOf(":", t.end);
      const rest = m.slice(colon + 1);
      const stop = rest.search(/\bbreak\b|\bcase\b|\bdefault\s*:|\breturn\b/);
      branch = [colon + 1, colon + 1 + (stop === -1 ? rest.length : stop)];
    } else if (/(===|==)\s*$/.test(pre) || /^\s*(===|==)/.test(m.slice(t.end, t.end + 4))) {
      // The condition the comparison is in: the ( that opens before it.
      let k = t.start; let d = 0;
      for (; k >= 0; k--) { if (m[k] === ")") d += 1; else if (m[k] === "(") { if (d === 0) break; d -= 1; } else if (m[k] === ";" || m[k] === "{" || m[k] === "}") { k = -1; break; } }
      if (k < 0 || !/\b(if|while)\s*$/.test(m.slice(Math.max(0, k - 10), k))) { out.push({ flag: t.value, field: null, compared: true, line: t.line }); continue; }
      branch = branchAfter(m, matching(m, k));
    } else {
      // Not compared in a branch: looked up some other way, or only a word
      // the code passes on (to another program, or in its text).
      const lookedUp = /(!==|!=)\s*$/.test(pre) || /\b(indexOf|lastIndexOf|includes|startsWith|has|get|findIndex|find|some)\s*\(\s*$/.test(pre) || /^\s*(!==|!=)/.test(m.slice(t.end, t.end + 4));
      out.push({ flag: t.value, field: null, compared: lookedUp, line: t.line });
      continue;
    }
    const body = m.slice(branch[0], branch[1]);
    const set = /([A-Za-z_$][\w$]*)\s*\.\s*([A-Za-z_$][\w$]*)\s*(?:=(?![=>])|\.\s*push\s*\()/.exec(body);
    const ignored = !set && /^\s*(\{\s*)?(\w+\s*(\+\+|\+=\s*1)|continue|break)\s*;?\s*\}?\s*$/.test(body.replace(/,\s*/g, ";"));
    out.push({ flag: t.value, field: set ? set[2] : null, holder: set ? set[1] : null, ignored, compared: true, line: t.line, at: branch[0] + (set ? set.index : 0) });
  }
  return out;
}

/** What the code says about one field: {required?, optional?} each with a
 *  line and words. */
function usesOf(s, field, holder, setAt) {
  const m = s.masked;
  const f = field.replace(/\$/g, "\\$");
  const prop = `[A-Za-z_$][\\w$]*\\s*\\.\\s*${f}(?![\\w$])`;
  const found = {};
  // Each condition is split at its top-level ||, read off a copy where each
  // || is a comma and a mark (the same length, so the offsets hold).
  s.or ??= m.replaceAll("||", ",\u0000");
  const or = s.or;
  for (const h of m.matchAll(/\bif\s*\(/g)) {
    const open = h.index + h[0].length - 1;
    const close = matching(m, open);
    if (close === -1) continue;
    const parts = splitTop(or, open + 1, close).map(([x, y]) => or.slice(x, y).replace(/^\u0000/, "").trim());
    const negated = parts.some((p) => new RegExp(`^!\\s*${prop}$`).test(p) || new RegExp(`^${prop}\\s*(===?|==)\\s*(undefined|null|""|''|0)$`).test(p));
    const plain = parts.some((p) => new RegExp(`^${prop}$`).test(p) || new RegExp(`^!\\s*${prop}$`).test(p));
    if (!negated && !plain) continue;
    const [a, b] = branchAfter(m, close);
    const refuses = REFUSES.test(m.slice(a, b));
    const line = s.lineOf(h.index);
    if (negated && refuses) found.required ??= { line, why: "the code refuses to go on without it" };
    else found.optional ??= { line, why: "the code tests it and goes on without it" };
  }
  const fallback = new RegExp(`${prop}\\s*(\\|\\||\\?\\?|&&|\\?(?![.?]))`).exec(m);
  if (fallback) found.optional ??= { line: s.lineOf(fallback.index), why: "the code falls back to another value when it is not given" };
  // The value it starts with, in the object literal the holder is made from.
  if (holder) {
    const decl = new RegExp(`\\b(?:const|let|var)\\s+${holder.replace(/\$/g, "\\$")}\\s*=\\s*\\{`, "g");
    let best = null;
    for (const d of m.matchAll(decl)) if (d.index < setAt) best = d;
    if (best) {
      const open = best.index + best[0].length - 1;
      const close = matching(m, open);
      for (const [x, y] of splitTop(m, open + 1, close)) {
        const kv = new RegExp(`^${f}\\s*:\\s*`).exec(m.slice(x, y));
        if (!kv) continue;
        const val = s.text.slice(x + kv[0].length, y).trim();
        if (/^\[/.test(val)) found.optional ??= { line: s.lineOf(x), why: "it is a list the flag adds to, and it starts empty" };
        else if (!/^(""|''|``|null|undefined|false)$/.test(val)) found.optional ??= { line: s.lineOf(x), why: `it starts as ${val.slice(0, 40)} when the flag is not given` };
      }
    }
  }
  return found;
}

/** The required and optional flags of each command: Map(file -> {required:
 *  [{flag, evidence}], optional: [{flag, why, evidence}], unsettled: [{flag,
 *  why}]}). `entries` are the surface's commands, each with its flags. */
export function flagsOf(surface) {
  const out = new Map();
  for (const e of surface?.entries ?? []) {
    const flags = e.flags ?? [];
    const files = [...surface.closureOf(e.file)].filter((f) => surface.scanned.has(f));
    const flagSet = new Set(flags);
    const reads = files.flatMap((f) => readsOf(surface.scanned.get(f), flagSet).map((r) => ({ ...r, file: f })));
    const result = { required: [], optional: [], unsettled: [] };
    for (const flag of flags) {
      const mine = reads.filter((r) => r.flag === flag);
      const ignored = mine.find((r) => r.ignored);
      const withField = mine.filter((r) => r.field);
      if (!withField.length) {
        if (ignored) result.optional.push({ flag, why: "it is read and passed over", evidence: [{ file: ignored.file, line: ignored.line }] });
        else if (mine.length && mine.every((r) => !r.compared)) result.optional.push({ flag, why: "the code never reads it from its arguments: it is only a word the code passes on (to another program, or in its text)", evidence: [{ file: mine[0].file, line: mine[0].line }] });
        else result.unsettled.push({ flag, why: mine.length ? "the field it is read into is not one this reader follows" : "the code does not compare an argument with it in a way this reader follows" });
        continue;
      }
      let req = null; let opt = null;
      for (const r of withField) {
        for (const f of files) {
          const u = usesOf(surface.scanned.get(f), r.field, f === r.file ? r.holder : null, f === r.file ? r.at : 0);
          if (u.required && !req) req = { file: f, ...u.required };
          if (u.optional && !opt) opt = { file: f, ...u.optional };
        }
      }
      if (req) result.required.push({ flag, field: withField[0].field, evidence: [{ file: req.file, line: req.line }] });
      else if (opt) result.optional.push({ flag, field: withField[0].field, why: opt.why, evidence: [{ file: opt.file, line: opt.line }] });
      else result.unsettled.push({ flag, why: `it is read into ${withField[0].field}, and the code neither refuses without it nor falls back where this reader can see` });
    }
    out.set(e.file, result);
  }
  return out;
}
