// The audit checklist, read: its header, its digest, and each check.
//
// The checklist is a standing asset (CommonAgent/adlc standards/README.md):
// one Markdown file whose version is the sha256 digest of its bytes. Its
// front matter names its schema, owner, layer and who approved it. Each check
// is a fenced YAML block (`id`, `says`, `why`, `kind`, `check`, `fixed-by`,
// `level`, `applies`, `evidence`) followed by a plain explanation, which is
// kept with the check.
//
// The first fenced block of the file, the one under "How a check is written",
// is the template and holds placeholders (`<kebab-id>`); a block whose id is
// not a kebab id is the template and is not a check.
//
//   needs: node >= 22
//   import { readChecklist, appliesTo } from "./checklist.mjs"
import { sha256 } from "./keys.mjs";

const trim = (s) => String(s ?? "").trim();
export const KINDS = ["design-time", "run-time", "stage-record"];
export const STAGES = ["requirements", "architecture", "design", "test", "code", "package", "deploy", "docs"];
export const LEVELS = ["warn", "refuse"];

const unquote = (v) => {
  const t = trim(v);
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return t.slice(1, -1);
  return t;
};

/** `key: value` lines, one level, as a plain object. */
export function yamlLines(text) {
  const out = {};
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^([A-Za-z_][\w-]*):\s?(.*)$/.exec(line);
    if (m) out[m[1]] = unquote(m[2]);
  }
  return out;
}

/** The front matter, as an object, or null. */
export function frontMatterOf(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(String(text));
  return m ? yamlLines(m[1]) : null;
}

/** The checklist, or what is wrong with it. */
export function readChecklist(bytes) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(String(bytes), "utf8");
  const text = buf.toString("utf8");
  const header = frontMatterOf(text);
  const digest = sha256(buf);
  const checks = [];
  const problems = [];
  const fence = /^```ya?ml\r?\n([\s\S]*?)^```\s*$/gm;
  let m;
  const blocks = [];
  while ((m = fence.exec(text))) blocks.push({ yaml: m[1], start: m.index, end: fence.lastIndex });
  blocks.forEach((b, i) => {
    const c = yamlLines(b.yaml);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(trim(c.id))) return;
    // The explanation runs to the next check or the next heading, whichever comes first.
    const after = text.slice(b.end, blocks[i + 1]?.start ?? text.length).split(/^#{1,6} /m)[0].trim();
    const entry = {
      id: c.id, says: trim(c.says), why: trim(c.why), kind: trim(c.kind), check: trim(c.check),
      fixed_by: trim(c["fixed-by"]), level: trim(c.level), applies: trim(c.applies), evidence: trim(c.evidence),
      explanation: after,
    };
    const bad = [];
    if (!KINDS.includes(entry.kind)) bad.push(`kind ${entry.kind || "(none)"}`);
    if (!STAGES.includes(entry.fixed_by)) bad.push(`fixed-by ${entry.fixed_by || "(none)"}`);
    if (!LEVELS.includes(entry.level)) bad.push(`level ${entry.level || "(none)"}`);
    if (!entry.check) bad.push("no check");
    if (bad.length) problems.push(`${entry.id}: ${bad.join(", ")}`);
    if (checks.some((x) => x.id === entry.id)) problems.push(`${entry.id} is written twice`);
    checks.push(entry);
  });
  return {
    text, digest,
    schema: trim(header?.schema) || "https://schemas.agentmesh.ai/audit-checklist/v1",
    name: trim(header?.name) || "audit checklist",
    owner: trim(header?.owner) || null,
    layer: trim(header?.layer) || null,
    approved_by: header && trim(header.approved_by) && trim(header.approved_by) !== "null" ? trim(header.approved_by) : null,
    approved_at: header && trim(header.approved_at) && trim(header.approved_at) !== "null" ? trim(header.approved_at) : null,
    checks, problems,
  };
}

/** The two dates of `applies`: {newFrom, existingFrom}, each an ISO date or null ("not set"). */
export function appliesDates(applies) {
  const date = (re) => {
    const m = re.exec(String(applies ?? ""));
    return m && /^\d{4}-\d{2}-\d{2}$/.test(m[1]) ? m[1] : null;
  };
  return { newFrom: date(/new agents from\s+(\S+?)[;,.]?(?:\s|$)/i), existingFrom: date(/existing agents from\s+(\S+?)[;,.]?(?:\s|$)/i) };
}

/**
 * The level a finding has for this agent, by the check's `applies`.
 * A new agent is one first released on or after the first date; its
 * findings have the check's level. An existing agent's findings are warnings
 * until the second date, and then have the check's level. A check that does
 * not apply yet to this agent at all (a new agent before the first date) is
 * a warning too, so it is still seen.
 *   firstReleased: ISO time of the agent's first release, or null when not known
 *   (read as existing, the reading that never refuses on a date nobody saw).
 */
export function levelFor(check, { firstReleased = null, now = new Date() } = {}) {
  if (check.level !== "refuse") return { level: "warn", why: "" };
  const { newFrom, existingFrom } = appliesDates(check.applies);
  const day = (iso) => String(iso).slice(0, 10);
  const today = day(now.toISOString());
  const isNew = Boolean(firstReleased && newFrom && day(firstReleased) >= newFrom);
  if (isNew) return { level: "refuse", why: `a new agent: first released ${day(firstReleased)}, on or after ${newFrom}` };
  if (existingFrom && today >= existingFrom) return { level: "refuse", why: `an existing agent, and refusals hold for existing agents from ${existingFrom}` };
  const since = firstReleased ? `first released ${day(firstReleased)}` : "its first release is not on record";
  return {
    level: "warn",
    why: `an existing agent (${since}${newFrom ? `, before ${newFrom}` : ""}): a warning until the date for existing agents, which is ${existingFrom ?? "not set"}`,
  };
}
