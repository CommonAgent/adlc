// The Design: the agent's own files, made from the approved spec.
//
// stages.json 1.6.0 moved the agent's own files (descriptor, runtime
// requirements, plugin manifest and a SKILL.md per skill) from Requirements
// to the Design part of Architecture and Design: they are made from the
// spec, never from the raw request. draft.mjs drafts them with the same code
// as before; this file gives it what it now starts from and the fits the
// spec makes possible:
//
//   - designView: what the drafting step is handed. The spec, as one
//     attachment of kind "the spec", in place of the as-built record's parts
//     and schemas (the spec carries everything the Design needs of them),
//     with the architecture record and any earlier files kept;
//   - DESIGN_RULE: what the draft owes the spec, said to the model;
//   - addressProblems and fitNoAddress: the draft carries no address outside
//     an address setting's default. The package maker refuses a descriptor
//     that carries one, and on 2026-11-09 the round trip stopped at Package
//     because an output's about wrote out the source's address in full
//     (news.ycombinator.com, with its scheme). An address lives in the spec's
//     systems and in a setting's default, and nowhere else;
//   - fitToSpec: the name, the version and the price are the spec's (the
//     person's), with no name while the spec asks it; each address setting
//     the spec lists is on the service that reaches it, with its default; and
//     each host the spec says is only written down is named in a service's
//     needs, so the security reviewer can match it ("writes down ..., which
//     it never calls").
//
//   needs: node >= 22. Nothing here reads or writes a file.
//   import { designView, DESIGN_RULE, fitToSpec, addressProblems } from "./design.mjs"
import { ADDRESS_SETTING, addressSettingsOf, hostOf, sameAddress } from "./reaches.mjs";
import { priceNamed } from "./given.mjs";
import { STAND_IN_NAME } from "./seed.mjs";

const trim = (s) => String(s ?? "").trim();
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const list = (v) => (Array.isArray(v) ? v : []);
const HAS_SCHEME = /\b[a-z][a-z0-9+.-]*:\/\//i;
const AN_ADDRESS = /\b([a-z][a-z0-9+.-]*):\/\/([^\s"'`)<>]+)/gi;

/** The kind the spec is handed to the Design as. */
export const THE_SPEC = "the spec";

/** Is this attachment part of an as-built record, or a schema beside it? */
function isRecordPart(a) {
  if (typeof a?.text !== "string" || !/^\s*[[{]/.test(a.text)) return false;
  try {
    const d = JSON.parse(a.text);
    return isObj(d) && (/^as-built-/.test(trim(d.format)) || d.as_built === true || /json-schema/i.test(String(d.$schema ?? "")) || (d.type !== undefined && isObj(d.properties)));
  } catch { return false; }
}

/** What the Design's drafting step is handed: the gathering record with the
 *  spec in place of the as-built record. A revision stays one only when the
 *  agent's own files came back with it; otherwise the files are made fresh
 *  from the spec. */
export function designView(asked = null, specText = "") {
  const kept = list(asked?.attached).filter((a) => !isRecordPart(a) && a?.kind !== THE_SPEC);
  const attached = [{ name: "spec.json", path: "spec.json", media_type: "application/vnd.agentmesh.spec+json", kind: THE_SPEC, text: specText, text_chars: specText.length }, ...kept];
  const files = kept.some((a) => (a.kind === "an agent's own file" || a.kind === "a spec") && typeof a.text === "string");
  const view = { ...(asked ?? {}), attached, missing_files: list(asked?.missing_files) };
  if (!files) delete view.revision;
  return view;
}

export const DESIGN_RULE = `This is the spec Requirements hands back, the person's to approve: the
analysis of what the agent must do. Make the agent's own files from it, and
from nothing else that contradicts it.
- The name, the version and the price are the spec's. Where the spec asks the
  name or the price in open, leave it out of the draft and put it in blanks.
- Every feature belongs to a job: the offering a caller orders, or a step of
  it. The jobs' instructions say how the scripts do what the features
  require, and name the spec (spec.json) as where the exact words, patterns,
  numbers and schemas are; do not copy every exact value into them.
- Every setting the spec lists is declared: a run-config setting in the
  spec's own run_config, an address setting as the setting of the system that
  reaches it, with the address as its default.
- Every system the spec reaches is a system of the draft with that access. A
  system of reach none is written down and never reached: give it no system
  and no setting, and name its host in the needs of the service that writes
  it down ("writes down links to news.example.com, which it never calls").
- An address goes only in an address setting's default: never in an about,
  a does, a needs, an instruction or anywhere else, because the package
  maker refuses a descriptor that carries one.
- Every interface the spec keeps is kept exactly: each function a script
  exports under its name, each command with its flags, each file with its
  schema, its members named in the output's about.
- The spec's refusals, its outputs and their schemas say what each job
  refuses and hands back.`;

/** The spec, handed over on its own, with what the Design owes it. */
export function specPart(text) {
  return `--- THE SPEC (spec-v1), APPROVED AT REQUIREMENTS ---\n${trim(text)}\n${DESIGN_RULE}`;
}

/** Where an address may sit in a draft: an address setting's default, the
 *  package's homepage and repository, a container block and a lineage entry's
 *  repository. */
const MAY_CARRY = [/^systems\[\d+\]\.settings\[\d+\]\.default$/, /^(?:homepage|repository)$/, /^container(?:\.|$)/, /^from\[\d+\]\.repository$/];

function stringsIn(v, at, out = []) {
  if (typeof v === "string") out.push([at, v]);
  else if (Array.isArray(v)) v.forEach((x, i) => stringsIn(x, `${at}[${i}]`, out));
  else if (isObj(v)) for (const [k, x] of Object.entries(v)) stringsIn(x, at ? `${at}.${k}` : k, out);
  return out;
}

/** Each place the draft carries an address it may not, as sentences. */
export function addressProblems(draft) {
  const out = [];
  for (const [where, text] of stringsIn(draft, "")) {
    if (MAY_CARRY.some((re) => re.test(where)) || !HAS_SCHEME.test(text)) continue;
    out.push(`${where} carries an address (${(text.match(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'`)<>]*/i) ?? [""])[0]}); the package maker refuses a descriptor that carries one, so name the host in words, or the setting that holds the address, and keep the address in the setting's default and the spec`);
  }
  return out;
}

/** The draft with each address it may not carry written as its host and
 *  path, without the scheme. Returns { spec, note }. */
export function fitNoAddress(draft) {
  let n = 0;
  const walk = (v, at) => {
    if (typeof v === "string") {
      if (MAY_CARRY.some((re) => re.test(at))) return v;
      return v.replace(AN_ADDRESS, (_, scheme, rest) => {
        n += 1;
        // Punctuation after an address ends the sentence, not the address.
        const [, body, tail] = /^(.*?)([.,;:!?]*)$/s.exec(rest);
        return body.replace(/\/$/, "") + tail;
      });
    }
    if (Array.isArray(v)) return v.map((x, i) => walk(x, `${at}[${i}]`));
    if (isObj(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, at ? `${at}.${k}` : k)]));
    return v;
  };
  const spec = walk(draft, "");
  return { spec, note: n ? `${n === 1 ? "An address was" : `${n} addresses were`} written in the draft outside a setting's default and ${n === 1 ? "is" : "are"} now written as ${n === 1 ? "its host" : "their hosts"}; the package maker refuses a descriptor that carries an address, and the spec's systems keep ${n === 1 ? "it" : "them"}.` : "" };
}

const services = (draft) => list(draft?.systems).filter((s) => isObj(s) && trim(s.kind) === "service" && trim(s.name) !== "draft-host");
const saysHost = (s, host) => `${s?.needs ?? ""} ${s?.purpose ?? ""}`.toLowerCase().includes(host);

/** The draft held to the spec where code can do it without guessing: the
 *  name, the version and the price are the spec's; each address setting the
 *  spec lists sits on the service that names its host, with its default; and
 *  each host the spec says is only written down is named in a service's
 *  needs. Returns { spec, notes, blanks }. */
export function fitToSpec(draft, spec) {
  if (!isObj(draft) || !isObj(spec)) return { spec: draft, notes: [], blanks: [] };
  let d = structuredClone(draft);
  const notes = [];
  const open = new Set(list(spec.open).map((o) => trim(o?.key)));
  const name = trim(spec.product?.name);
  if (open.has("name") || name === STAND_IN_NAME) { if (d.name) { delete d.name; notes.push("The draft named the agent, and the spec still asks its name, so the name was taken out."); } }
  else if (name && d.name !== name) { d.name = name; notes.push(`The agent is named ${name}, as the spec says.`); }
  const version = trim(spec.product?.version);
  if (/^\d+\.\d+\.\d+$/.test(version) && d.version !== version) { d.version = version; notes.push(`The version is ${version}, as the spec says.`); }
  const price = trim(spec.price) ? priceNamed([{ from: "the spec", text: `price: ${trim(spec.price)}` }]) : null;
  if (price) { const { from, ...p } = price; if (JSON.stringify(d.price) !== JSON.stringify(p) && !(isObj(d.price) && d.price.model === p.model && d.price.amount_micro === p.amount_micro)) { d.price = p; notes.push(`The price is the spec's: ${trim(spec.price)}.`); } }
  else if (!trim(spec.price) && d.price !== undefined) { delete d.price; notes.push("The draft set a price, and the spec still asks it, so the price was taken out."); }

  // Each address setting the spec lists, on the service that reaches it.
  for (const st of list(spec.settings)) {
    if (trim(st?.kind) !== "address" || typeof st.default !== "string" || !ADDRESS_SETTING.test(trim(st.name))) continue;
    const have = addressSettingsOf(d);
    const same = have.find((a) => typeof a.default === "string" && sameAddress(a.default) === sameAddress(st.default));
    if (same && same.env === trim(st.name)) continue;
    if (same) {
      // The address is there under a name of the draft's own: it takes the
      // spec's, wherever the draft says it, because Code reads the spec.
      const was = same.env;
      d = JSON.parse(JSON.stringify(d).replace(new RegExp(`(?<![A-Za-z0-9_])${was}(?![A-Za-z0-9_])`, "g"), trim(st.name)));
      notes.push(`The address setting ${was} is named ${trim(st.name)}, as the spec's settings name it.`);
      continue;
    }
    const host = hostOf(st.default);
    const byEnv = services(d).find((s) => list(s.settings).some((x) => trim(x?.env) === trim(st.name)));
    const byHost = services(d).find((s) => host && saysHost(s, host));
    const target = byEnv ?? byHost;
    if (!target) continue;
    target.settings = list(target.settings);
    const at = target.settings.find((x) => trim(x?.env) === trim(st.name));
    if (at) at.default = st.default;
    else target.settings.push({ env: trim(st.name), purpose: trim(st.about) || `where ${trim(target.name)} answers, its base address`, default: st.default });
    notes.push(`${trim(target.name)} reads its address from ${trim(st.name)}, ${st.default} by default, as the spec's settings say.`);
  }
  // Each host only written down, named where the security reviewer reads.
  for (const s of list(spec.systems)) {
    if (trim(s?.reach) !== "none" || !trim(s.address)) continue;
    const host = hostOf(s.address);
    if (!host || services(d).some((x) => saysHost(x, host))) continue;
    const target = services(d).find((x) => !trim(x.credential)) ?? services(d)[0];
    if (!target) continue;
    target.needs = `${trim(target.needs)}${trim(target.needs) && !/[.!?]$/.test(trim(target.needs)) ? "." : ""} It writes down links to ${host}, which it never calls.`.trim();
    notes.push(`${trim(target.name)}'s needs now names ${host}, which the spec says the agent writes down and never calls.`);
  }
  const fitted = fitNoAddress(d);
  if (fitted.note) notes.push(fitted.note);
  d = fitted.spec;
  return { spec: d, notes, blanks: [] };
}
