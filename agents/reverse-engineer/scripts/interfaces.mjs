// The interfaces part: what is read by rule first, then what the model drafted
// laid onto it.
//
// Read by rule (surface.mjs), each with its evidence and `read_by_rule: true`:
//   - each file the code writes, as an interface of kind file, with the JSON
//     Schema its value shows (field names, types, which fields are always
//     there, constant values such as a format id) and, 0.3.0, `values`: the
//     allowed values of each field the code only writes from fixed literals;
//   - each exported function or class of every module of the code, as an
//     interface of kind function: its name and parameters, async or not, and
//     what its own body throws or rejects with;
//   - each file that starts as a command, as an interface of kind command,
//     with the flags it and the files it imports read and, 0.3.0, the flags
//     it cannot run without (flags.mjs; the draft settles what the rule
//     cannot, evidence-checked);
//   - 0.3.0: each exported constant, as an interface of kind constant, with
//     its value as JSON where the literal can be read (else null and a gap);
//   - 0.3.0: each name and value the agent declares in its own files
//     (declarations.mjs), as an interface of kind declaration;
//   - beside them, the exported constants and values (with a literal's value),
//     every flag, the environment variables read and the run-config settings
//     declared.
// The model's interfaces, already evidence-checked, describe these (what a
// function returns, what a file is for, the parts of a schema the code builds
// elsewhere) or stand on their own (routes, messages). A drafted schema is
// checked before it is used: each field it names must be written in the code,
// and each constant must be in the code as a literal, byte for byte. What
// fails is taken out and listed as a gap.
//
//   needs: node >= 22. Nothing here reads or writes a file.
//   import { buildInterfaces } from "./interfaces.mjs"
import { slash } from "./codebase.mjs";
import { literalValue } from "./js-source.mjs";

const trim = (s) => String(s ?? "").trim();
const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const SCHEMA_ID = "https://json-schema.org/draft/2020-12/schema";

/** A schema that claims nothing but what the value is made from. */
export const isUnknown = (s) => !isObj(s) || Object.keys(s).every((k) => k === "$comment") || (Array.isArray(s.anyOf) && s.anyOf.some(isUnknown));

/** A drafted schema with what the code does not show taken out: {doc,
 *  dropped: [words]}. `inCode(name)` says a field name is written in the
 *  code; `literalInCode(value)` says a constant is a literal there. */
export function checkSchema(doc, { inCode, literalInCode }) {
  const dropped = [];
  const walk = (s, at) => {
    if (!isObj(s)) return s;
    const out = { ...s };
    if (out.const !== undefined && !literalInCode(out.const)) { dropped.push(`the constant ${JSON.stringify(out.const)} at ${at || "the top"} is not a literal in the code`); delete out.const; }
    if (Array.isArray(out.enum)) {
      const bad = out.enum.filter((v) => v !== null && !literalInCode(v));
      if (bad.length) { dropped.push(`the values ${bad.map((v) => JSON.stringify(v)).join(", ")} at ${at || "the top"} are not literals in the code`); out.enum = out.enum.filter((v) => !bad.includes(v)); if (!out.enum.length) delete out.enum; }
    }
    if (isObj(out.properties)) {
      const props = {};
      for (const [k, v] of Object.entries(out.properties)) {
        if (!inCode(k)) { dropped.push(`the field ${at ? `${at}.` : ""}${k} is not written in the code`); continue; }
        props[k] = walk(v, at ? `${at}.${k}` : k);
      }
      out.properties = props;
      if (Array.isArray(out.required)) out.required = out.required.filter((k) => Object.hasOwn(props, k));
    }
    if (isObj(out.items)) out.items = walk(out.items, `${at || ""}[]`);
    for (const key of ["anyOf", "oneOf", "allOf"]) if (Array.isArray(out[key])) out[key] = out[key].map((x) => walk(x, at));
    return out;
  };
  return { doc: walk(doc, ""), dropped };
}

/** The schema read by rule, with the drafted one filling only what the rule
 *  left unknown. Where the code's object literal is closed (no spread), a
 *  drafted field it does not have is not added: answers {schema, extra}. */
export function mergeSchema(rule, drafted) {
  const extra = [];
  const merge = (r, d, at) => {
    if (!isObj(d)) return r;
    if (!isObj(r) || isUnknown(r)) return { ...d, ...(isObj(r) && r.$comment && !d.$comment ? { $comment: r.$comment } : {}) };
    const out = { ...r };
    if (r.type === "object" && isObj(r.properties) && isObj(d.properties)) {
      const props = { ...r.properties };
      for (const [k, v] of Object.entries(d.properties)) {
        if (Object.hasOwn(props, k)) props[k] = merge(props[k], v, at ? `${at}.${k}` : k);
        else if (r.$comment) props[k] = v;
        else extra.push(`${at ? `${at}.` : ""}${k}`);
      }
      out.properties = props;
    }
    if (r.type === "array") {
      if (!r.items && isObj(d.items)) out.items = d.items;
      else if (isObj(r.items) && isObj(d.items)) out.items = merge(r.items, d.items, `${at}[]`);
    }
    return out;
  };
  return { schema: merge(rule, drafted, ""), extra };
}

/** A schema's top level, in words: "an object with format (always "x"), a, b". */
function schemaWords(s) {
  if (!isObj(s) || s.type !== "object" || !isObj(s.properties)) return "";
  const fields = Object.entries(s.properties).map(([k, v]) => (v?.const !== undefined ? `${k} (always ${JSON.stringify(v.const)})` : k));
  return fields.length ? `an object with ${fields.join(", ")}` : "an object";
}

const fileWords = (w) => {
  const by = [...new Set(w.evidence.map((e) => e.file))].join(", ");
  const shape = w.schema ? schemaWords(w.schema) : "";
  return `Written by ${by}${w.append ? " (appended to)" : ""} as ${w.content === "json" ? "JSON" : "text"}${shape ? `: ${shape}` : ""}.`;
};

const fnWords = (e) => {
  const errs = (e.throws ?? []).filter((t) => t.error).map((t) => t.error);
  const how = e.kind === "class" ? "A class" : e.async ? "An async function" : "A function";
  return [`${how} exported by ${e.module}`,
    e.imported_by?.length ? `, imported by ${e.imported_by.join(", ")}` : e.main ? ", the package's main module" : "",
    errs.length ? `; ${e.async ? "it rejects with" : "it throws"} ${[...new Set(errs)].join(", ")}` : "", "."].join("");
};

/** A JSON pointer step: ~ and / escaped. */
const ptr = (k) => String(k).replace(/~/g, "~0").replace(/\//g, "~1");

/** The allowed values of each field of a file's schema (0.3.0): the schema
 *  with an enum (or const) on each field the code only ever writes from a
 *  fixed set of literals, and {values, evidence} by JSON pointer, `*` for the
 *  items of a list. A field's values are read by rule from the object
 *  literals of the files that write it and what they import, the ones shaped
 *  like the object it is in (surface.mjs fieldValuesIn); a drafted enum the
 *  rule cannot read stands, already checked as literals in the code. Where
 *  the rule reads other values than the draft, the rule's stand and `gap`
 *  says which drafted ones were taken out. */
export function allowedValues(schema, { surface, writers = [], about = "", gap = () => {} }) {
  const values = {}; const evidence = {};
  const where = (v) => {
    const out = [];
    for (const w of writers) {
      for (const f of surface?.closureOf ? surface.closureOf(w) : [w]) {
        const s = surface?.scanned?.get(f);
        const t = s?.tokens.find((x) => (x.kind === "string" || (x.kind === "template" && !x.subst)) && x.value === v);
        if (t && !out.some((e) => e.file === f && e.line === t.line)) { out.push({ file: f, line: t.line }); break; }
      }
    }
    return out;
  };
  const walk = (node, at) => {
    if (!isObj(node)) return node;
    const out = { ...node };
    if (isObj(out.properties)) {
      const siblings = Object.keys(out.properties);
      const props = {};
      for (const [k, v] of Object.entries(out.properties)) {
        const p = `${at}/${ptr(k)}`;
        if (isObj(v) && (v.type === "object" || v.type === "array" || v.properties || v.items)) { props[k] = walk(v, p); continue; }
        let field = isObj(v) ? { ...v } : {};
        const read = surface?.fieldValues && writers.length ? surface.fieldValues(writers, k, siblings) : null;
        if (read && read.values.length) {
          const had = Array.isArray(field.enum) ? field.enum : field.const !== undefined ? [field.const] : null;
          const extra = had ? had.filter((x) => !read.values.some((y) => y === x)) : [];
          if (extra.length) gap({ kind: "held-back", part: "interfaces", about: `the values drafted for ${p} of ${about}`, why: `the code writes ${read.values.map((x) => JSON.stringify(x)).join(", ")} there, not ${extra.map((x) => JSON.stringify(x)).join(", ")}, so those were taken out` });
          const types = [...new Set(read.values.map((x) => (x === null ? "null" : Number.isInteger(x) ? "integer" : typeof x)))];
          const { enum: _e, const: _c, $comment: _m, ...rest } = field;
          field = { ...rest, type: types.length === 1 ? types[0] : types };
          if (read.values.length === 1 && read.values[0] !== null) field.const = read.values[0];
          else if (read.values.length > 1) field.enum = read.values;
          evidence[p] = read.evidence;
        }
        const list = Array.isArray(field.enum) ? field.enum : field.const !== undefined ? [field.const] : null;
        if (list) {
          values[p] = list;
          if (!evidence[p]) evidence[p] = list.filter((x) => x !== null).flatMap(where);
        }
        props[k] = field;
      }
      out.properties = props;
    }
    if (isObj(out.items)) out.items = walk(out.items, `${at}/*`);
    return out;
  };
  return { schema: walk(schema, ""), values, evidence };
}

/** The interfaces part. `checked` are the model's interfaces after
 *  checkClaims; `gap(g)` lists a gap; `known` = {inCode, literalInCode}.
 *  0.3.0: `declarations` are what the agent declares in its own files,
 *  `requiredFlags` each command's required and optional flags read by rule,
 *  and `checkEv(list)` answers the evidence of a list that checks. */
export function buildInterfaces({ surface, checked, settingsRead = [], declared = [], declarations = [], requiredFlags = new Map(), checkEv = () => [], known, gap }) {
  const s = surface ?? { writes: [], exports: [], entries: [], flags: [] };
  const items = [];

  for (const w of s.writes) {
    items.push({
      rule: true, match: { kind: "file", path: w.path, files: w.evidence.map((e) => e.file) },
      out: { kind: "file", name: w.path ?? `a file named by ${w.written_as}`, does: fileWords(w), direction: "out", ...(w.path ? { path: w.path } : {}), content: w.content, written_as: w.written_as, ...(w.append ? { appended: true } : {}), evidence: w.evidence, read_by_rule: true },
      schema: w.schema ?? null,
    });
  }
  for (const e of s.exports.filter((x) => x.kind === "function" || x.kind === "class")) {
    const errs = (e.throws ?? []).map((t) => ({ ...(t.error ? { error: t.error } : { rethrows: t.rethrows }), evidence: [{ file: e.module, line: t.line }] }));
    items.push({
      rule: true, match: { kind: "function", key: `${e.module}#${e.name}`, name: e.name, file: e.module },
      out: {
        kind: "function", name: e.kind === "class" ? e.name : `${e.name}(${e.params ?? ""})`, does: fnWords(e),
        module: e.module, export: e.name, ...(e.kind === "class" ? { class: true } : { params: e.params ?? "", async: Boolean(e.async) }),
        ...(e.kind === "function" ? (e.async ? { rejects: errs.filter((x) => !x.rethrows) } : { throws: errs.filter((x) => !x.rethrows) }) : {}),
        ...(errs.some((x) => x.rethrows) ? { rethrows: errs.filter((x) => x.rethrows) } : {}),
        ...(e.from ? { from: e.from } : {}),
        imported_by: e.imported_by ?? [], evidence: [{ file: e.module, line: e.line }], read_by_rule: true,
      },
    });
  }
  for (const c of s.entries) {
    // 0.3.0: the flags it cannot run without, and those it can.
    const rf = requiredFlags.get(c.file) ?? { required: [], optional: [], unsettled: (c.flags ?? []).map((flag) => ({ flag, why: "its flags were not read" })) };
    items.push({
      rule: true, match: { kind: "command", file: c.file },
      out: {
        kind: "command", name: c.file, does: `Starts as a command: ${c.why}${c.flags?.length ? `; it reads the flags ${c.flags.join(", ")}` : ""}.`, command: c.file, flags: c.flags ?? [],
        required_flags: rf.required.map((x) => x.flag),
        required_flags_by: "rule",
        required_flags_evidence: rf.required.map((x) => ({ flag: x.flag, evidence: x.evidence })),
        optional_flags: rf.optional.map((x) => ({ flag: x.flag, why: x.why, evidence: x.evidence })),
        ...(rf.unsettled.length ? { flags_unsettled: rf.unsettled.map((x) => ({ flag: x.flag, why: x.why })) } : {}),
        evidence: c.evidence, read_by_rule: true,
      },
    });
  }
  // 0.3.0: each exported constant, with its value as JSON where the literal can be read.
  for (const e of s.exports.filter((x) => x.kind !== "function" && x.kind !== "class")) {
    let value = null; let withheld = null; let pattern = false;
    if (e.withheld) withheld = e.withheld;
    else if (e.kind === "constant") value = e.value;
    else if (e.kind === "pattern") { value = e.value; pattern = true; } else {
      const home = e.value_in ?? e.module;
      const sc = s.scanned?.get(home);
      const r = sc && e.range ? literalValue(sc, e.range[0], e.range[1]) : { ok: false, why: e.kind === "re-export" ? `it is re-exported from ${e.from ?? "a module"}, which is not a module of the codebase read here` : "where its value is written could not be read" };
      if (r.ok) value = r.value;
      else gap({ kind: "unclear", part: "interfaces", about: `the value of the constant ${e.name} (${e.module})`, why: `${r.why}, so its value is not known from the code as written`, evidence: [{ file: e.module, line: e.line }] });
    }
    items.push({
      rule: true, match: { kind: "constant", key: `${e.module}#${e.name}`, name: e.name, file: e.module },
      out: {
        kind: "constant", name: e.name, does: `A constant exported by ${e.module}${e.imported_by?.length ? `, imported by ${e.imported_by.join(", ")}` : ""}.`,
        module: e.module, export: e.name, value, ...(withheld ? { withheld } : {}), ...(pattern ? { pattern: true } : {}), ...(e.from ? { from: e.from } : {}),
        imported_by: e.imported_by ?? [], evidence: [{ file: e.module, line: e.line }], read_by_rule: true,
      },
    });
  }
  // 0.3.0: each name and value the agent declares to the platform in its own files.
  for (const d of declarations) {
    items.push({ rule: true, match: { kind: "declaration" }, out: { kind: "declaration", name: d.name, does: `Declared in ${d.declared_in}.`, declared_in: d.declared_in, value: d.value, evidence: d.evidence, read_by_rule: true } });
  }

  // The flags the rule left unsettled, settled by the draft: the drafted
  // required flags, with evidence that checks, each one the command reads;
  // the other unsettled flags are then optional. The rule wins where both say.
  const settleFlags = (out, drafted) => {
    const list = Array.isArray(drafted) ? drafted : Array.isArray(drafted?.flags) ? drafted.flags : [];
    const ev = checkEv(Array.isArray(drafted) ? [] : drafted?.evidence);
    const about = `the required flags drafted for ${out.command}`;
    if (!ev.length) { gap({ kind: "claim-without-evidence", part: "interfaces", about, why: "the draft named them with no evidence that checks" }); return; }
    const flags = list.map(trim).filter(Boolean);
    const unknown = flags.filter((f) => !out.flags.includes(f));
    if (unknown.length) gap({ kind: "held-back", part: "interfaces", about, why: `the command reads no flag ${unknown.join(", ")}, so they were taken out` });
    const optional = new Set(out.optional_flags.map((x) => x.flag));
    const against = flags.filter((f) => optional.has(f));
    if (against.length) gap({ kind: "held-back", part: "interfaces", about, why: `the code goes on without ${against.join(", ")} (read by rule), so they stay optional` });
    for (const { flag } of out.flags_unsettled) {
      if (flags.includes(flag)) { out.required_flags.push(flag); out.required_flags_evidence.push({ flag, evidence: ev, drafted: true }); } else out.optional_flags.push({ flag, why: "the draft does not name it as required", evidence: ev, drafted: true });
    }
    out.required_flags.sort();
    out.required_flags_by = out.required_flags_evidence.every((x) => x.drafted) && out.optional_flags.every((x) => x.drafted) ? "draft" : "rule and draft";
    delete out.flags_unsettled;
  };

  // The model's interfaces, laid onto the ones read by rule where they match.
  const leftovers = [];
  for (const mi of checked) {
    const kind = trim(mi.kind);
    const evFiles = (mi.evidence ?? []).map((e) => e.file);
    let hit = null;
    if (kind === "function") {
      const key = slash(trim(mi.export));
      const lead = /^[A-Za-z_$][\w$]*/.exec(trim(mi.name))?.[0];
      hit = items.find((it) => it.match.kind === "function" && (it.match.key === key || (lead && it.match.name === lead && evFiles.includes(it.match.file))));
    } else if (kind === "file") {
      const p = slash(trim(mi.path));
      hit = items.find((it) => it.match.kind === "file" && it.match.path && (it.match.path === p || trim(mi.name).includes(it.match.path) || (p && it.match.path.endsWith(`/${p}`))));
    } else if (kind === "command") {
      const c = slash(trim(mi.command));
      hit = items.find((it) => it.match.kind === "command" && (it.match.file === c || evFiles.includes(it.match.file) || trim(mi.name).includes(it.match.file)));
    } else if (kind === "constant") {
      const key = slash(trim(mi.export));
      hit = items.find((it) => it.match.kind === "constant" && (it.match.key === key || (it.match.name === trim(mi.name) && evFiles.includes(it.match.file))));
    }
    if (!hit) { leftovers.push(mi); continue; }
    if (kind === "command" && mi.required_flags && hit.out.flags_unsettled) settleFlags(hit.out, mi.required_flags);
    if (trim(mi.does)) hit.out.does = `${trim(mi.does).replace(/\.$/, "")}. ${hit.out.does}`;
    if (trim(mi.returns)) hit.out.returns = trim(mi.returns);
    for (const e of mi.evidence ?? []) if (!hit.out.evidence.some((x) => x.file === e.file && x.line === e.line && x.end_line === e.end_line)) hit.out.evidence.push(e);
    hit.out.described = true;
    if (mi.schema) hit.drafted = mi.schema;
  }
  for (const mi of leftovers) items.push({ rule: false, out: { kind: trim(mi.kind), name: trim(mi.name), does: trim(mi.does), ...(trim(mi.returns) ? { returns: trim(mi.returns) } : {}), evidence: mi.evidence }, drafted: mi.schema ?? null });

  // Ids, and each schema checked and written.
  const schemaFiles = [];
  const interfaces = items.map((it, i) => {
    const id = `I${i + 1}`;
    const out = { id, ...it.out };
    let schema = it.schema ? { ...it.schema } : null;
    const d = it.drafted;
    if (d && isObj(d) && isObj(d.document)) {
      const isOpenapi = d.format === "openapi" && typeof d.document.openapi === "string" && /^3\./.test(d.document.openapi) && isObj(d.document.paths);
      const isSchema = d.format === "json-schema" && (d.document.type || d.document.properties || d.document.$schema || d.document.oneOf || d.document.anyOf);
      if (isOpenapi && !schema) {
        const file = `schemas/${id}.openapi.json`;
        schemaFiles.push({ file, format: "openapi", text: `${JSON.stringify(d.document, null, 2)}\n`, derived: true, interface: id });
        out.schema = file;
        return out;
      }
      if (isSchema) {
        const c = checkSchema(d.document, known);
        if (c.dropped.length) gap({ kind: "held-back", part: "interfaces", about: `parts of the schema drafted for ${id} (${out.name})`, why: `${c.dropped.join("; ")}, so they were taken out` });
        if (schema) {
          const m = mergeSchema(schema, c.doc);
          if (m.extra.length) gap({ kind: "held-back", part: "interfaces", about: `fields drafted for ${id} (${out.name})`, why: `the object the code writes has no field ${m.extra.join(", ")}, so they were not added` });
          schema = m.schema;
        } else schema = c.doc;
      } else if (!isOpenapi) {
        gap({ kind: "unclear", part: "interfaces", about: `the schema drafted for ${id} (${out.name})`, why: `it is not a ${d.format === "openapi" ? "OpenAPI 3 document with paths" : "JSON Schema"}, so it was not delivered` });
      }
    }
    // 0.3.0: the allowed values of each field of a file the code writes.
    if (schema && out.kind === "file" && it.rule) {
      const av = allowedValues(schema, { surface: s, writers: [...new Set(out.evidence.map((e) => e.file))].filter((f) => s.scanned?.has(f)), about: `${id} (${out.name})`, gap });
      schema = av.schema;
      if (Object.keys(av.values).length) { out.values = av.values; out.values_evidence = av.evidence; }
    }
    if (schema) {
      const doc = { $schema: SCHEMA_ID, ...schema };
      const file = `schemas/${id}.schema.json`;
      schemaFiles.push({ file, format: "json-schema", text: `${JSON.stringify(doc, null, 2)}\n`, derived: true, interface: id, ...(it.schema ? { read_by_rule: true } : {}), ...(d ? { drafted: true } : {}) });
      out.schema = file;
    } else if (out.kind === "file" && out.content === "json") {
      gap({ kind: "unclear", part: "interfaces", about: `the shape of ${out.name} (${id})`, why: "the code writes it as JSON, and neither the code read by rule nor the draft shows its fields" });
    }
    return out;
  });

  const constants = s.exports.filter((e) => !["function", "class"].includes(e.kind)).map((e) => ({
    module: e.module, name: e.name, kind: e.kind,
    ...(e.value !== undefined ? { value: e.value } : {}), ...(e.withheld ? { withheld: e.withheld } : {}), ...(e.from ? { from: e.from } : {}),
    imported_by: e.imported_by ?? [], evidence: [{ file: e.module, line: e.line }],
  }));
  return {
    interfaces, schemaFiles, constants,
    flags: s.flags.map((f) => ({ name: f.name, evidence: f.evidence })),
    environment: settingsRead.map((x) => ({ name: x.name, credential: x.credential, evidence: x.evidence })),
    settings: declared.map((x) => ({ name: x.name, declared_in: x.declared_in, evidence: x.evidence })),
  };
}
