// The JSON object in a model's answer, out of whatever wrapping it arrived in.
//
// A model asked for JSON returns JSON in a code fence about as often as it
// returns it bare, and an agent that treats a fenced answer as a failure
// throws away work it already paid for. A sentence before or after the
// object, or a fence in the middle of prose, is the same answer: the object
// is taken out of it. Both drafting steps read their answers here (the spec
// in spec.mjs, the agent's own files in draft.mjs).
//
//   needs: node >= 22. Nothing here reads or writes a file.
//   import { jsonIn, jsonCandidates } from "./json-in.mjs"

/** The places a JSON value may sit in an answer, most likely first: the
 *  whole answer, each fenced block, and each balanced {...} in the prose
 *  (read with strings and escapes respected, so a brace inside a string does
 *  not end it). Pure. */
export function jsonCandidates(raw) {
  const out = [raw];
  for (const m of raw.matchAll(/```[a-zA-Z]*[ \t]*\r?\n?([\s\S]*?)```/g)) out.push(m[1].trim());
  for (let i = raw.indexOf("{"); i !== -1; i = raw.indexOf("{", i + 1)) {
    const end = objectEnd(raw, i);
    if (end !== -1) {
      out.push(raw.slice(i, end + 1));
      i = end; // the next candidate starts after this object, not inside it
    }
  }
  return [...new Set(out.filter(Boolean))];
}

/** Where the object opened at `start` closes, or -1 when it never does. */
function objectEnd(s, start) {
  let depth = 0, inString = false, escaped = false;
  for (let i = start; i < s.length; i += 1) {
    const c = s[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === "\"") inString = false;
      continue;
    }
    if (c === "\"") inString = true;
    else if (c === "{" || c === "[") depth += 1;
    else if (c === "}" || c === "]") {
      depth -= 1;
      if (depth === 0) return c === "}" ? i : -1;
      if (depth < 0) return -1;
    }
  }
  return -1;
}

/** The first candidate that parses: an object when there is one, else the
 *  first value of any other kind, else undefined. */
export function jsonIn(raw) {
  let other;
  for (const c of jsonCandidates(raw)) {
    let v;
    try { v = JSON.parse(c); } catch { continue; }
    if (v && typeof v === "object" && !Array.isArray(v)) return v;
    if (other === undefined) other = v;
  }
  return other;
}
