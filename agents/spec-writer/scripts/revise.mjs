// A revision of the spec, as edits code applies and can check.
//
// On Ask for changes, or Send back to Requirements, the person's words name
// what changes, and everything else in the spec stays as it was, byte for
// byte. In the round trip on hn-reader on 2026-11-09 the model was told
// "change nothing else" eight times and ignored the words that did name a
// change five times, because each round it drafted the whole thing again. So
// a revision is never a fresh draft. The words are read for what they name
// (scripts/revise.mjs, namedTargets): an id (F3, F3.R2, F3.A1, C2, I4, a
// behavior B3 by the feature it became), the name, the version, the price,
// the purpose, a setting, a system or an interface by its name, an open
// question by its key, or a part of the spec to add to. The model answers
// with edits, each addressed to one of those by id, code applies the edits
// that touch what the words name and drops the rest (saying so), and the
// check holds every other part of the spec to the one before, byte for byte.
// The name, the version and the price the words key ("price: free") are set
// by code and need no model at all.
//
//   needs: node >= 22. Nothing here reads or writes a file.
//   import { personWords, namedTargets, applyEdits, unchangedProblems } from "./revise.mjs"
import { personSettled } from "./seed.mjs";

const trim = (s) => String(s ?? "").trim();
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const list = (v) => (Array.isArray(v) ? v : []);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The person's own words in a revision, without the lines the runner adds
 *  around them: the material aimed at a phase ("[write-the-suite] ..."), the
 *  approved features it repeats, the as-built frame and its behavior list. */
export function personWords(text = "") {
  const out = [];
  let skipping = false;
  for (const raw of String(text).replace(/\r/g, "").split("\n")) {
    const l = raw.trim();
    if (/^\[write-the-[a-z-]+\]/.test(l)) continue;
    if (/^features: the owner approved these/i.test(l) || /^as built(?: elsewhere)?:/i.test(l)) { skipping = true; continue; }
    if (skipping && (/^-\s*[BF][1-9]\d*\b/.test(l) || !l)) { if (!l) skipping = false; continue; }
    skipping = false;
    if (/^run r-[a-z0-9-]+ phase [a-z0-9-]+: here is your answer$/i.test(l) || /^\(answered (?:by|from) /i.test(l) || /^Continue the work and reply/i.test(l)) continue;
    out.push(raw);
  }
  return out.join("\n").trim();
}

/** The paths of the spec a revision may touch: what the words name. Each
 *  path is "purpose", "price", "product.name", "product.version", a
 *  feature, requirement, scenario, constraint or interface id,
 *  "system:<name>", "setting:<name>", "open:<key>", or a part added to
 *  ("add:features", "add:constraints", "add:interfaces", "add:systems",
 *  "add:settings", "add:open"). A feature's id opens all of it. */
export function namedTargets(words = "", spec = null) {
  const t = String(words);
  const low = t.toLowerCase();
  const out = new Set();
  const features = list(spec?.features);
  for (const m of t.matchAll(/\b(F[1-9]\d*)(?:\.(R|A)([1-9]\d*))?\b/g)) out.add(m[2] ? `${m[1]}.${m[2]}${m[3]}` : m[1]);
  for (const m of t.matchAll(/\b(C[1-9]\d*|I[1-9]\d*)\b/g)) out.add(m[1]);
  for (const m of t.matchAll(/\b(B[1-9]\d*)\b/g)) { const f = features.find((x) => trim(x?.as_built) === m[1]); if (f) out.add(trim(f.id)); }
  for (const f of features) if (trim(f?.name).length > 3 && low.includes(trim(f.name).toLowerCase())) out.add(trim(f.id));
  const settled = personSettled([t]);
  // The agent's own name: "the name" (not "the name of" a piece), "call it",
  // or "rename it" or the agent. "Rename the output stories" names an output.
  if (settled.name || /\b(?:the|its|a) name\b(?!\s+of\b)|\bcall(?:ed)? it\b|\brename (?:it|the agent|this agent)\b/i.test(t)) out.add("product.name");
  // A name or value the agent declares (spec-v1 1.1.0, kind declaration or
  // constant), named by its value in a sentence that renames it ("rename the
  // output stories to top-stories", "call the step fetch instead of read"),
  // and the pieces (inputs and outputs) of each feature that carries that
  // name, and nothing else of the feature: not its offering, its name or its
  // requirements (on the round trip a rename of one output renamed the
  // offering too). The value is a whole word: stories is not named by
  // read-the-stories.
  const sentences = t.split(/(?<=[.!?])\s+|\n+/);
  const renaming = sentences.filter((x) => /\brenam\w*\b|\binstead of\b|\b(?:be )?called\b|\bcall (?:it|the|this)\b/i.test(x));
  const wordIn = (v, text) => new RegExp(`(?<![\\w$-])${escRe(v)}(?![\\w$-])`).test(text);
  for (const i of list(spec?.interfaces)) {
    if (!["declaration", "constant"].includes(trim(i?.kind)) || typeof i.value !== "string" || trim(i.value).length < 2) continue;
    if (renaming.some((x) => wordIn(trim(i.value), x))) out.add(trim(i.id));
  }
  for (const f of features) {
    // A piece that is a file is named by its file's name too: the files call
    // out/stories.json "stories".
    const pieces = [...list(f?.inputs), ...list(f?.outputs)].map((d) => trim(d?.name)).filter((n) => n.length > 1)
      .flatMap((n) => [n, n.replace(/\\/g, "/").split("/").pop().replace(/\.[a-z0-9]+$/i, "")]).filter((n) => n.length > 1);
    if (pieces.some((n) => renaming.some((x) => wordIn(n, x)))) out.add(`${trim(f.id)}.pieces`);
  }
  if (settled.version || /\bversion\b/i.test(t)) out.add("product.version");
  if (settled.price || /\bprice\b|\bcosts?\b|\bfree\b/i.test(t)) out.add("price");
  if (/\bpurpose\b/i.test(t)) out.add("purpose");
  // An interface by its name: a file or command by its path or file name, a
  // function only where the words write it as one (`run`, run(), the
  // function run), so "runs" or "run.command" names no function run.
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const i of list(spec?.interfaces)) {
    const name = trim(i?.name);
    if (!name) continue;
    const named = trim(i.kind) === "function"
      ? new RegExp(`\`${esc(name)}\`|(?<![\\w$.])${esc(name)}\\s*\\(|\\b(?:function|export(?:s|ed)?)\\s+\`?${esc(name)}(?![\\w$])`).test(t)
      : [name, name.split("/").pop()].filter((n) => n.length > 2 && /[./]/.test(n)).some((n) => new RegExp(`(?<![\\w$-])${esc(n)}(?![\\w$-])`).test(t));
    if (named) out.add(trim(i.id));
  }
  for (const s of list(spec?.systems)) if (trim(s?.name).length > 2 && low.includes(trim(s.name).toLowerCase())) out.add(`system:${trim(s.name)}`);
  for (const s of list(spec?.settings)) if (trim(s?.name) && new RegExp(`(?<![\\w-])${trim(s.name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`).test(t)) out.add(`setting:${trim(s.name)}`);
  for (const o of list(spec?.open)) if (trim(o?.key) && low.includes(trim(o.key).toLowerCase())) out.add(`open:${trim(o.key)}`);
  if (/\b(?:add|new|another)\b[^.\n]{0,40}\bfeatures?\b|\bfeatures?\b[^.\n]{0,20}\b(?:to add|missing)\b/i.test(t)) out.add("add:features");
  if (/\bconstraints?\b/i.test(t)) out.add("add:constraints");
  if (/\b(?:add|new|another)\b[^.\n]{0,40}\binterfaces?\b/i.test(t)) out.add("add:interfaces");
  if (/\b(?:add|new|another)\b[^.\n]{0,40}\bsystems?\b/i.test(t)) out.add("add:systems");
  if (/\b(?:add|new|another)\b[^.\n]{0,40}\bsettings?\b/i.test(t)) out.add("add:settings");
  if (/\bopen questions?\b|\bask\b/i.test(t)) out.add("add:open");
  return out;
}

/** Whether a path is one the targets let a revision touch: the path itself,
 *  or the feature it is under. */
export function mayTouch(path, targets) {
  const p = trim(path);
  if (targets.has(p)) return true;
  const f = /^(F[1-9]\d*)\./.exec(p)?.[1];
  return Boolean(f && targets.has(f));
}

/** Where a path is in the spec: { get, set, remove } on the one item it
 *  names, or null when the spec has none there. */
function locate(spec, path) {
  const p = trim(path);
  const at = (arr, i) => ({ get: () => arr[i], set: (v) => { arr[i] = v; }, remove: () => { arr.splice(i, 1); } });
  if (p === "purpose" || p === "price") return { get: () => spec[p], set: (v) => { spec[p] = v; }, remove: () => { delete spec[p]; } };
  if (p === "product.name" || p === "product.version") { const k = p.split(".")[1]; return { get: () => spec.product?.[k], set: (v) => { spec.product[k] = v; }, remove: () => {} }; }
  let m;
  if ((m = /^(F[1-9]\d*)$/.exec(p))) { const i = list(spec.features).findIndex((f) => f.id === p); return i < 0 ? null : at(spec.features, i); }
  if ((m = /^(F[1-9]\d*)\.(R|A)[1-9]\d*$/.exec(p))) {
    const f = list(spec.features).find((x) => x.id === m[1]);
    const arr = f ? (m[2] === "R" ? f.requirements : f.acceptance) : null;
    const i = list(arr).findIndex((x) => x.id === p);
    return i < 0 ? null : at(arr, i);
  }
  if ((m = /^C[1-9]\d*$/.exec(p))) { const i = list(spec.constraints).findIndex((x) => x.id === p); return i < 0 ? null : at(spec.constraints, i); }
  if ((m = /^I[1-9]\d*$/.exec(p))) { const i = list(spec.interfaces).findIndex((x) => x.id === p); return i < 0 ? null : at(spec.interfaces, i); }
  if ((m = /^(system|setting|open):(.+)$/.exec(p))) {
    const key = { system: "systems", setting: "settings", open: "open" }[m[1]];
    const field = m[1] === "open" ? "key" : "name";
    const i = list(spec[key]).findIndex((x) => trim(x?.[field]) === trim(m[2]));
    return i < 0 ? null : at(spec[key], i);
  }
  return null;
}

const nextId = (items, prefix) => { let n = 1; const used = new Set(list(items).map((x) => trim(x?.id))); while (used.has(`${prefix}${n}`)) n += 1; return `${prefix}${n}`; };

/** The spec with the edits applied that touch what the words name, and only
 *  those. An edit is {set: path, value}, {remove: path} or {add: where,
 *  value} where is features, constraints, interfaces, systems, settings,
 *  open, or F<n>.requirements and F<n>.acceptance. Code gives every added
 *  item its id. Returns { spec, applied, dropped }, each dropped edit with
 *  why. Pure. */
export function applyEdits(before, edits = [], targets = new Set()) {
  const spec = structuredClone(before);
  const applied = [];
  const dropped = [];
  for (const e of list(edits)) {
    if (!isObj(e)) continue;
    const said = JSON.stringify(e).slice(0, 160);
    // A feature whose pieces the words name, and only its pieces: set
    // F3.pieces to {inputs, outputs}, or set F3 whole, of which only the
    // inputs and outputs are taken.
    const pieceOnly = (p) => /^F[1-9]\d*$/.test(p) && !targets.has(p) && targets.has(`${p}.pieces`);
    const piecesPath = /^(F[1-9]\d*)\.pieces$/.exec(trim(e.set))?.[1];
    if (trim(e.set) && (pieceOnly(trim(e.set)) || (piecesPath && targets.has(`${piecesPath}.pieces`)))) {
      const id = piecesPath ?? trim(e.set);
      const f = list(spec.features).find((x) => x.id === id);
      if (!f || !isObj(e.value)) { dropped.push({ edit: said, why: `the spec has no ${id}` }); continue; }
      const other = Object.keys(e.value).filter((k) => !["inputs", "outputs", "id"].includes(k) && !same(e.value[k], f[k]));
      for (const side of ["inputs", "outputs"]) if (Array.isArray(e.value[side])) f[side] = structuredClone(e.value[side]);
      applied.push(`set ${id}'s pieces`);
      if (other.length) dropped.push({ edit: said, why: `your words name ${id}'s pieces and not its ${other.join(", ")}` });
      continue;
    }
    if (trim(e.set) || trim(e.remove)) {
      const path = trim(e.set || e.remove);
      if (!mayTouch(path, targets)) { dropped.push({ edit: said, why: `${path} is not something your words name` }); continue; }
      const here = locate(spec, path);
      if (trim(e.remove)) {
        if (!here) { dropped.push({ edit: said, why: `the spec has no ${path}` }); continue; }
        here.remove(); applied.push(`removed ${path}`); continue;
      }
      if (!here && !/^(purpose|price|product\.(name|version))$/.test(path)) { dropped.push({ edit: said, why: `the spec has no ${path}; add it instead` }); continue; }
      let value = e.value;
      // An item keeps its id whatever the edit wrote: ids are stable.
      if (isObj(value) && isObj(here?.get?.()) && "id" in here.get()) value = { ...value, id: here.get().id };
      if (isObj(value) && isObj(here?.get?.()) && /^(system|setting):/.test(path)) value = { ...here.get(), ...value };
      if (path === "price" && (value === null || value === "")) { here.remove(); applied.push("removed price"); continue; }
      here.set(value); applied.push(`set ${path}`); continue;
    }
    if (trim(e.add)) {
      const where = trim(e.add);
      const m = /^(F[1-9]\d*)\.(requirements|acceptance)$/.exec(where);
      if (m) {
        if (!targets.has(m[1])) { dropped.push({ edit: said, why: `${m[1]} is not something your words name` }); continue; }
        const f = list(spec.features).find((x) => x.id === m[1]);
        if (!f || !isObj(e.value)) { dropped.push({ edit: said, why: `the spec has no ${m[1]}` }); continue; }
        const arr = m[2] === "requirements" ? (f.requirements ??= []) : (f.acceptance ??= []);
        const id = nextId(arr, `${m[1]}.${m[2] === "requirements" ? "R" : "A"}`);
        arr.push({ ...e.value, id }); applied.push(`added ${id}`); continue;
      }
      if (!["features", "constraints", "interfaces", "systems", "settings", "open"].includes(where)) { dropped.push({ edit: said, why: `${where} is no part of the spec` }); continue; }
      if (!targets.has(`add:${where}`)) { dropped.push({ edit: said, why: `your words do not ask for anything to be added to ${where}` }); continue; }
      if (!isObj(e.value)) { dropped.push({ edit: said, why: "it adds nothing" }); continue; }
      spec[where] ??= [];
      const value = { ...e.value };
      if (where === "features") {
        value.id = nextId(spec.features, "F");
        value.requirements = list(value.requirements).map((r, i) => ({ ...r, id: `${value.id}.R${i + 1}` }));
        value.acceptance = list(value.acceptance).map((a, i) => ({ ...a, id: `${value.id}.A${i + 1}` }));
      }
      if (where === "constraints") value.id = nextId(spec.constraints, "C");
      if (where === "interfaces") value.id = nextId(spec.interfaces, "I");
      spec[where].push(value); applied.push(`added to ${where}${value.id ? ` ${value.id}` : ""}`);
    }
  }
  return { spec, applied, dropped };
}

/** Every part of the spec before that the targets do not let the revision
 *  touch, and that is not as it was, byte for byte. Empty when the revision
 *  changed only what the words name. */
export function unchangedProblems(before, after, targets = new Set()) {
  const out = [];
  const check = (path, a, b) => { if (!mayTouch(path, targets) && !same(a, b)) out.push(`${path} changed, and your words do not name it; it stays as it was`); };
  check("purpose", before?.purpose, after?.purpose);
  check("price", before?.price, after?.price);
  check("product.name", before?.product?.name, after?.product?.name);
  check("product.version", before?.product?.version, after?.product?.version);
  for (const f of list(before?.features)) {
    const g = list(after?.features).find((x) => x.id === f.id);
    if (!g) { check(f.id, f, undefined); continue; }
    const { requirements: fr, acceptance: fa, ...frest } = f;
    const { requirements: gr, acceptance: ga, ...grest } = g;
    // Its pieces may change where the words name them, and nothing else of it.
    if (targets.has(`${f.id}.pieces`) && !mayTouch(f.id, targets)) {
      const { inputs: fi, outputs: fo, ...fothers } = frest;
      const { inputs: gi, outputs: go, ...gothers } = grest;
      check(f.id, fothers, gothers);
    } else check(f.id, frest, grest);
    for (const r of list(fr)) check(r.id, r, list(gr).find((x) => x.id === r.id));
    for (const a of list(fa)) check(a.id, a, list(ga).find((x) => x.id === a.id));
  }
  for (const c of list(before?.constraints)) check(c.id, c, list(after?.constraints).find((x) => x.id === c.id));
  for (const i of list(before?.interfaces)) check(i.id, i, list(after?.interfaces).find((x) => x.id === i.id));
  for (const s of list(before?.systems)) check(`system:${trim(s.name)}`, s, list(after?.systems).find((x) => trim(x.name) === trim(s.name)));
  for (const s of list(before?.settings)) check(`setting:${trim(s.name)}`, s, list(after?.settings).find((x) => trim(x.name) === trim(s.name)));
  for (const o of list(before?.open)) {
    const g = list(after?.open).find((x) => trim(x.key) === trim(o.key));
    // An open question the revision answered may go; otherwise it stays.
    if (!g && mayTouch(`open:${trim(o.key)}`, targets)) continue;
    if (!g && ["name", "price"].includes(trim(o.key)) && (mayTouch(trim(o.key) === "name" ? "product.name" : "price", targets))) continue;
    check(`open:${trim(o.key)}`, o, g);
  }
  return out;
}

/** The spec with the name, the version and the price the words key set by
 *  code, and the open question each settles taken out. Returns { spec,
 *  applied }. */
export function keyedEdits(spec, words = "") {
  const s = structuredClone(spec);
  const settled = personSettled([words]);
  const applied = [];
  if (settled.name && s.product?.name !== settled.name) { s.product.name = settled.name; applied.push("set product.name"); }
  if (settled.version && s.product?.version !== settled.version) { s.product.version = settled.version; applied.push("set product.version"); }
  if (settled.price && s.price !== settled.price) { s.price = settled.price; applied.push("set price"); }
  const drop = new Set([settled.name ? "name" : "", settled.price ? "price" : ""].filter(Boolean));
  if (drop.size) s.open = list(s.open).filter((o) => !drop.has(trim(o?.key)));
  return { spec: s, applied };
}
