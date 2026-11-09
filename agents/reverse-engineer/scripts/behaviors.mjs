// The checks a behavior goes through after its evidence checked
// (evidence.mjs): its kind is one of the fixed kinds, its anchor is one the
// granularity rule counts and no other behavior has it, every quote is in
// the code byte for byte, and every rule names its kind and its evidence.
// What fails is listed as a gap with the reason; the behavior itself is held
// back only for a kind or an anchor, never for one quote or one rule.
//
// Then, by rule, each behavior gets the regular expressions written in the
// lines its evidence names, and those it uses by name from the top of its
// file, quoted as written; and the literal constants it uses by name, with
// their values. A model that left one out does not take it out.
//
//   needs: node >= 22. Nothing here reads or writes a file: `read` does.
//   import { checkBehaviors } from "./behaviors.mjs"
import { linesOf, slash } from "./codebase.mjs";
import { INFERRING, JUDGING, checkEvidence, unquoted } from "./evidence.mjs";
import { KIND_NAMES, RULE_NAMES } from "./kinds.mjs";
import { namesUsed } from "./surface.mjs";

const trim = (s) => String(s ?? "").trim();
const range = (e) => [e.line, e.end_line ?? e.line];

/** Where `text` is in the code, byte for byte: first inside the cited
 *  ranges, then anywhere in the cited files. [{file, line, end_line?}] at
 *  the lines it spans, or null. */
export function findQuote(text, read, evidence) {
  const t = String(text ?? "");
  if (!t.trim()) return null;
  const files = [...new Set(evidence.filter((e) => e.file && !e.at).map((e) => e.file))];
  const at = (file, from, offset) => {
    const before = file.slice(0, offset).split("\n").length - 1;
    const span = t.split("\n").length - 1;
    const line = from + before;
    return span ? { line, end_line: line + span } : { line };
  };
  for (const e of evidence.filter((x) => x.file && !x.at)) {
    const src = read(e.file);
    if (src === null || src === undefined) continue;
    const [a, b] = range(e);
    const lines = linesOf(src);
    const part = lines.slice(a - 1, b).join("\n");
    const k = part.indexOf(t);
    if (k !== -1) return [{ file: e.file, ...at(part, a, k) }];
  }
  for (const f of files) {
    const src = read(f);
    if (src === null || src === undefined) continue;
    const whole = linesOf(src).join("\n");
    const k = whole.indexOf(t);
    if (k !== -1) return [{ file: f, ...at(whole, 1, k) }];
  }
  return null;
}

/** The words a gap uses for a behavior. */
export const labelOf = (b) => `${trim(b.name)}${trim(b.does) ? `: ${trim(b.does)}` : ""}`;

/** Each behavior checked: {kept, gaps, anchorsHeld}. `kept` are behaviors
 *  that passed checkClaims. `surface` is facts.surface. */
export function checkBehaviors(kept, ctx, { read, surface = null, drift = null } = {}) {
  const anchors = new Map((surface?.anchors ?? []).map((a) => [a.id, a]));
  const files = ctx.files;
  const gaps = []; const out = []; const anchorsHeld = new Set(); const seen = new Map();
  const hold = (b, why, kind = "held-back") => gaps.push({ kind, part: "behaviors", about: labelOf(b), why });
  for (const b of kept) {
    const kind = trim(b.kind).toLowerCase();
    const anchor = slash(trim(b.anchor));
    const removed = b.change === "removed";
    if (anchor) anchorsHeld.add(anchor);
    if (!KIND_NAMES.includes(kind)) {
      hold(b, `its kind (${kind ? `"${kind}"` : "none"}) is not one of the behavior kinds (${KIND_NAMES.join(", ")}); the kinds are fixed so two runs on the same code give the same kinds`);
      continue;
    }
    if (anchor && !removed) {
      const [file, name] = anchor.split("#");
      if (name !== undefined && anchors.size && files.has(file) && !anchors.has(anchor)) {
        hold(b, `its anchor ${anchor} is not one the granularity rule counts (an exported function or class another file imports, an export of the main module, or a command); what it does belongs to the behavior of the anchor that calls it`);
        continue;
      }
      if (seen.has(anchor)) {
        hold(b, `${seen.get(anchor)} already describes ${anchor}, and the granularity rule counts one behavior per anchor; its words belong in that behavior's fields`);
        continue;
      }
      seen.set(anchor, trim(b.name) || anchor);
    }

    // Quotes: byte for byte, or dropped with a gap.
    const quotes = [];
    for (const q of Array.isArray(b.quotes) ? b.quotes : []) {
      if (!q || typeof q !== "object" || typeof q.text !== "string" || !q.text.trim()) continue;
      const own = checkEvidence(q.evidence, ctx).kept;
      const found = findQuote(q.text, read, own.length ? [...own, ...b.evidence] : b.evidence);
      if (!found) { gaps.push({ kind: "held-back", part: "behaviors", about: `${labelOf(b)}: the quote ${trim(q.what) || JSON.stringify(q.text.slice(0, 60))}`, why: `the quoted text is not in ${[...new Set([...own, ...b.evidence].map((e) => e.file))].join(", ")} byte for byte, so it was not kept` }); continue; }
      if (quotes.some((x) => x.text === q.text)) continue;
      quotes.push({ what: trim(q.what), text: q.text, evidence: found });
    }

    // Rules: a kind from the list, words that neither judge nor infer, and evidence.
    const rules = [];
    for (const r of Array.isArray(b.rules) ? b.rules : []) {
      if (!r || typeof r !== "object") continue;
      const about = `${labelOf(b)}: the rule ${trim(r.rule) || "(no words)"}`;
      const rk = trim(r.kind).toLowerCase();
      if (!RULE_NAMES.includes(rk)) { gaps.push({ kind: "held-back", part: "behaviors", about, why: `its kind (${rk ? `"${rk}"` : "none"}) is not one of the rule kinds (${RULE_NAMES.join(", ")})` }); continue; }
      const words = unquoted(trim(r.rule));
      const j = JUDGING.exec(words) ?? INFERRING.exec(words);
      if (j) { gaps.push({ kind: "held-back", part: "behaviors", about, why: `it was drafted with a judgment or an inference ("${j[0]}")` }); continue; }
      let ev = checkEvidence(r.evidence, ctx).kept;
      let quote = null;
      if (typeof r.quote === "string" && r.quote.trim()) {
        const found = findQuote(r.quote, read, [...ev, ...b.evidence]);
        if (!found) { gaps.push({ kind: "held-back", part: "behaviors", about, why: "the code it quotes is not in the cited lines byte for byte, so the rule was not kept" }); continue; }
        quote = r.quote;
        if (!ev.length) ev = found;
      }
      if (!ev.length) { gaps.push({ kind: "claim-without-evidence", part: "behaviors", about, why: "the rule names no evidence that checks" }); continue; }
      rules.push({ kind: rk, rule: trim(r.rule), ...(quote ? { quote } : {}), evidence: ev });
    }

    // By rule: the patterns in its lines and the patterns and constants it names.
    const constants = [];
    if (surface?.scanned) {
      for (const e of b.evidence.filter((x) => x.file && !x.at)) {
        const s = surface.scanned.get(e.file);
        if (!s) continue;
        const [a, z] = range(e);
        const used = namesUsed(s, a, z);
        for (const p of surface.patterns.filter((x) => x.file === e.file)) {
          const inLines = p.line >= a && p.line <= z;
          if (!inLines && !(p.top && p.name && used(p.name))) continue;
          if (quotes.some((q) => q.text === p.text || q.text.includes(p.text) || p.text.includes(q.text))) continue;
          quotes.push({ what: p.name ? `the pattern ${p.name}` : "a pattern", text: p.text, evidence: [{ file: e.file, line: p.line }], by_rule: true });
        }
        for (const c of surface.constants.filter((x) => x.file === e.file)) {
          if (!used(c.name) || constants.some((x) => x.name === c.name && x.evidence[0].file === e.file)) continue;
          constants.push({ name: c.name, ...(c.value !== undefined ? { value: c.value } : { withheld: c.withheld }), evidence: [{ file: e.file, line: c.line }] });
        }
      }
    }
    out.push({ ...b, kind, ...(anchor ? { anchor } : {}), quotes, rules, constants });
  }
  return { kept: out, gaps, anchorsHeld };
}

/** The anchors no behavior describes, as gaps (adoption only): each anchor in
 *  the files the behavior passes drafted that neither a kept behavior nor a
 *  held-back one names. */
export function anchorsWithout(surface, behaviors, held, draftedFiles) {
  const named = new Set([...behaviors.map((b) => b.anchor).filter(Boolean), ...held]);
  const drafted = draftedFiles ? new Set(draftedFiles) : null;
  return (surface?.anchors ?? [])
    .filter((a) => !named.has(a.id) && (!drafted || drafted.has(a.module)))
    .map((a) => ({ kind: "unclear", part: "behaviors", about: `${a.id} (${a.why})`, why: "the granularity rule counts one behavior for it, and the draft gave none whose evidence checks", evidence: [{ file: a.module, line: a.line }] }));
}
