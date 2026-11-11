// JSON written the way the checker's records have always been written: as
// Python's json.dumps writes it (ASCII only, ", " and ": " between items, two
// spaces of indent when asked), so a record, a spec or a reply made by these
// scripts is byte for byte the one the Python scripts made before them. And the
// canonical form a signature is taken over: keys sorted, no spaces, non-ASCII
// kept as it is (json.dumps(sort_keys=True, separators=(",", ":"),
// ensure_ascii=False)).
//
//   needs: node >= 22

const ESC = { '"': '\\"', "\\": "\\\\", "\n": "\\n", "\r": "\\r", "\t": "\\t", "\b": "\\b", "\f": "\\f" };

/** A string as Python writes it: every unit outside printable ASCII as \uXXXX
 *  when `ascii`, the control characters always. */
export function pyString(s, ascii = true) {
  let out = '"';
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    const c = s.charCodeAt(i);
    if (ESC[ch]) out += ESC[ch];
    // ensure_ascii escapes everything outside " " to "~"; without it, only
    // the control characters.
    else if (c < 0x20 || (ascii && c > 0x7e)) out += `\\u${c.toString(16).padStart(4, "0")}`;
    else out += ch;
  }
  return `${out}"`;
}

const pyNumber = (n) => {
  if (!Number.isFinite(n)) return n > 0 ? "Infinity" : n < 0 ? "-Infinity" : "NaN";
  if (Number.isInteger(n)) return Object.is(n, -0) ? "-0.0" : String(n);
  return String(n);
};

/** json.dumps(v) or json.dumps(v, indent=n). */
export function pyDumps(v, { indent = null } = {}, level = 0) {
  if (v === null || v === undefined) return "null";
  if (v === true) return "true";
  if (v === false) return "false";
  if (typeof v === "number") return pyNumber(v);
  if (typeof v === "string") return pyString(v);
  const pad = indent == null ? "" : " ".repeat(indent * (level + 1));
  const end = indent == null ? "" : " ".repeat(indent * level);
  const nl = indent == null ? "" : "\n";
  const sep = indent == null ? ", " : ",\n";
  if (Array.isArray(v)) {
    if (!v.length) return "[]";
    return `[${nl}${v.map((x) => pad + pyDumps(x, { indent }, level + 1)).join(sep)}${nl}${end}]`;
  }
  const keys = Object.keys(v).filter((k) => v[k] !== undefined);
  if (!keys.length) return "{}";
  return `{${nl}${keys.map((k) => `${pad}${pyString(k)}: ${pyDumps(v[k], { indent }, level + 1)}`).join(sep)}${nl}${end}}`;
}

/** The canonical bytes a signature is taken over. */
export function canonical(v) {
  if (v === null || v === undefined) return "null";
  if (typeof v === "boolean") return String(v);
  if (typeof v === "number") return pyNumber(v);
  if (typeof v === "string") return pyString(v, false);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${keys.map((k) => `${pyString(k, false)}:${canonical(v[k])}`).join(",")}}`;
}
