#!/usr/bin/env node
// Checks a running service against the lifecycle API (lifecycle-api.schema.json,
// version 0.1): every answer against the schema, and the rules a schema cannot
// say. It only reads. It asks who the key belongs to, lists the builds, reads
// each one, reads its tries, and opens the first file each build handed back
// (every file with --all-files).
//
// The rules beyond the schema:
//   - a build lists every stage of stages.json, once each, and no other;
//   - an action acts at a stage the build lists and offers (not not_offered);
//   - a stage's rounds are newest first (each round's n below the one before);
//   - a build in the list is at a stage of stages.json;
//   - reading a build by its id answers with that build;
//   - every time is ISO 8601 with a zone, and a real date.
//
//   node standards/lifecycle-api-check.mjs <base> [--key-file <path>] [--stages <path>] [--limit <n>] [--all-files]
//
//   <base>        the service's lifecycle address, e.g. https://example.com/v1/lifecycle/
//   --key-file    a file holding the key; otherwise the key is read from ADLC_API_KEY.
//                 The key is never taken from the command line and never printed.
//   --stages      stages.json; by default the one beside this file
//   --limit       read at most this many builds (default 50)
//   --all-files   open every file each build handed back, not only its first
//
//   exits 0 when nothing is wrong, 1 on any problem, 2 when it could not start
//   needs: node >= 22
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const SCHEMA = JSON.parse(readFileSync(join(HERE, "lifecycle-api.schema.json"), "utf8"));
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const typeOf = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : Number.isInteger(v) ? "integer" : typeof v);
const isType = (v, t) => t === typeOf(v) || (t === "number" && typeof v === "number");
export const isTime = (v) => typeof v === "string" && TIME.test(v) && !Number.isNaN(Date.parse(v));

// The part of JSON Schema 2020-12 the lifecycle API's schema uses, and no more.
function walk(schema, v, at, out) {
  if (schema.$ref) {
    const name = schema.$ref.replace(/^#\/\$defs\//, "");
    const def = SCHEMA.$defs[name];
    if (!def) throw new Error(`the schema has no definition ${schema.$ref}`);
    walk(def, v, at, out);
  }
  if (schema.anyOf) {
    const fits = schema.anyOf.some((s) => { const o = []; walk(s, v, at, o); return o.length === 0; });
    if (!fits) {
      const tried = []; walk(schema.anyOf[schema.anyOf.length - 1], v, at, tried);
      out.push(...(tried.length ? tried : [`${at}: is none of the shapes it may be`]));
    }
  }
  if (schema.type !== undefined) {
    const types = [].concat(schema.type);
    if (!types.some((t) => isType(v, t))) { out.push(`${at}: is ${typeOf(v)}, not ${types.join(" or ")}`); return; }
  }
  if (schema.enum && !schema.enum.includes(v)) out.push(`${at}: is ${JSON.stringify(v)}, not one of ${schema.enum.join(", ")}`);
  if ("const" in schema && v !== schema.const) out.push(`${at}: is ${JSON.stringify(v)}, not ${JSON.stringify(schema.const)}`);
  if (typeof v === "string") {
    if (schema.minLength !== undefined && v.length < schema.minLength) out.push(`${at}: is empty`);
    if (schema.format === "date-time" && !isTime(v)) out.push(`${at}: is ${JSON.stringify(v)}, not an ISO 8601 time with a zone`);
  }
  if (typeof v === "number" && schema.minimum !== undefined && v < schema.minimum) out.push(`${at}: is below ${schema.minimum}`);
  if (isObj(v)) {
    for (const k of schema.required ?? []) if (!(k in v)) out.push(`${at}: has no ${k}`);
    for (const [k, s] of Object.entries(schema.properties ?? {})) if (k in v) walk(s, v[k], `${at}.${k}`, out);
    if (isObj(schema.additionalProperties)) {
      for (const [k, x] of Object.entries(v)) if (!(k in (schema.properties ?? {}))) walk(schema.additionalProperties, x, `${at}.${k}`, out);
    }
  }
  if (Array.isArray(v) && schema.items) v.forEach((x, i) => walk(schema.items, x, `${at}[${i}]`, out));
}

/** The problems with value as the named definition; empty when it fits. */
export function validate(def, value, at = "body") {
  const out = [];
  walk({ $ref: `#/$defs/${def}` }, value, at, out);
  return out;
}

/** The stage ids of a stages.json, in order. */
export function stageIds(path = join(HERE, "stages.json")) {
  return JSON.parse(readFileSync(path, "utf8")).stages.map((s) => s.id);
}

export function checkMe(body) {
  return validate("MeAnswer", body);
}

export function checkBuildList(body, ids) {
  const p = validate("BuildListAnswer", body);
  if (isObj(body) && Array.isArray(body.builds)) {
    body.builds.forEach((b, i) => {
      if (isObj(b?.at) && typeof b.at.stage === "string" && !ids.includes(b.at.stage)) p.push(`body.builds[${i}].at.stage: "${b.at.stage}" is not a stage in stages.json`);
    });
  }
  return p;
}

export function checkBuild(body, ids, id) {
  const p = validate("BuildAnswer", body);
  const b = isObj(body) ? body.build : null;
  if (!isObj(b)) return p;
  if (id !== undefined && b.id !== id) p.push(`body.build.id: is ${JSON.stringify(b.id)}, not the build asked for (${id})`);
  const stages = Array.isArray(b.stages) ? b.stages.filter(isObj) : [];
  const listed = stages.map((s) => s.stage);
  for (const s of new Set(listed)) {
    if (!ids.includes(s)) p.push(`body.build.stages: "${s}" is not a stage in stages.json`);
    if (listed.filter((x) => x === s).length > 1) p.push(`body.build.stages: "${s}" appears more than once`);
  }
  const missing = ids.filter((s) => !listed.includes(s));
  if (missing.length) p.push(`body.build.stages: does not list ${missing.join(", ")} (a stage the service does not run is listed as not_offered)`);
  stages.forEach((s, i) => {
    if (!Array.isArray(s.rounds)) return;
    s.rounds.forEach((r, j) => {
      if (j > 0 && Number.isInteger(r?.n) && Number.isInteger(s.rounds[j - 1]?.n) && !(r.n < s.rounds[j - 1].n)) p.push(`body.build.stages[${i}].rounds[${j}]: rounds are newest first, and n ${r.n} follows n ${s.rounds[j - 1].n}`);
    });
  });
  // The timeline (added in 0.1): bars ordered by start, each ending no earlier than it began.
  (Array.isArray(b.timeline) ? b.timeline : []).forEach((t, i, all) => {
    if (!isObj(t)) return;
    const start = Date.parse(t.start), end = t.end ? Date.parse(t.end) : NaN;
    if (i > 0 && isObj(all[i - 1]) && Date.parse(all[i - 1].start) > start) p.push(`body.build.timeline[${i}]: bars are ordered by start, and this one starts before the bar above it`);
    if (Number.isFinite(end) && end < start) p.push(`body.build.timeline[${i}]: ends before it starts`);
  });
  const offered = new Set(stages.filter((s) => s.state !== "not_offered").map((s) => s.stage));
  (Array.isArray(b.actions) ? b.actions : []).forEach((a, i) => {
    if (isObj(a) && typeof a.stage === "string" && !offered.has(a.stage)) p.push(`body.build.actions[${i}]: "${a.name}" acts at ${a.stage}, a stage the build does not offer`);
  });
  return p;
}

export function checkTries(body) {
  return validate("TriesAnswer", body);
}

export function checkError(body) {
  return validate("ErrorAnswer", body);
}

/**
 * Reads the service and checks every answer. Returns { calls, problems }, each
 * problem in words with the call it came from. `say` hears one line per call.
 */
export async function run({ base, key, ids, limit = 50, allFiles = false, fetch: get = globalThis.fetch, say = () => {} }) {
  const root = new URL(base.endsWith("/") ? base : `${base}/`);
  const problems = [];
  let calls = 0;
  const hide = (s) => (key ? String(s).split(key).join("[key]") : String(s));
  const note = (what, list) => {
    for (const x of list) problems.push(hide(`${what}: ${x}`));
    say(hide(`${list.length ? "FAIL" : "ok  "} ${what}${list.length ? ` (${list.length} problem${list.length === 1 ? "" : "s"})` : ""}`));
  };
  const call = async (path, json = true) => {
    calls++;
    const url = new URL(path, root);
    let r;
    try {
      r = await get(url, { headers: { authorization: `Bearer ${key}`, accept: json ? "application/json" : "*/*" }, signal: AbortSignal.timeout(120_000) });
    } catch (e) {
      return { failed: `could not be reached: ${e?.message ?? e}` };
    }
    const text = await r.text();
    if (!json) return { status: r.status, text };
    let body;
    try { body = JSON.parse(text); } catch { return { status: r.status, failed: `answered ${r.status} with something that is not JSON` }; }
    return { status: r.status, body };
  };
  const answered = async (what, path, check) => {
    const got = await call(path);
    if (got.failed) { note(what, [got.failed]); return null; }
    if (got.status !== 200) {
      const shape = checkError(got.body);
      note(what, [`answered ${got.status}${typeof got.body?.error === "string" ? `: ${got.body.error}` : ""}`, ...shape]);
      return null;
    }
    note(what, check(got.body));
    return got.body;
  };

  await answered("GET me", "me", checkMe);
  const list = await answered("GET builds", "builds", (b) => checkBuildList(b, ids));
  const builds = Array.isArray(list?.builds) ? list.builds.filter((b) => isObj(b) && typeof b.id === "string") : [];
  if (builds.length > limit) say(`reading the first ${limit} of ${builds.length} builds`);
  for (const item of builds.slice(0, limit)) {
    const id = encodeURIComponent(item.id);
    const one = await answered(`GET builds/${item.id}`, `builds/${id}`, (b) => checkBuild(b, ids, item.id));
    await answered(`GET builds/${item.id}/tries`, `builds/${id}/tries`, checkTries);
    const files = (one?.build?.stages ?? []).flatMap((s) => (isObj(s?.handed_back) && Array.isArray(s.handed_back.files) ? s.handed_back.files : []));
    const links = [...new Set(files.filter((f) => typeof f?.link === "string" && f.link).map((f) => f.link))].slice(0, allFiles ? undefined : 1);
    for (const link of links) {
      let url;
      try { url = new URL(link, root); } catch { note(`file ${link}`, ["the link is not an address or a path"]); continue; }
      if (url.origin !== root.origin) { say(`skip ${link} (another site, not sent the key)`); continue; }
      const got = await call(url, false);
      note(`GET ${url.pathname}${url.search}`, got.failed ? [got.failed] : got.status === 200 ? [] : [`answered ${got.status}`]);
    }
  }
  return { calls, problems };
}

function args(argv) {
  const out = { base: undefined, keyFile: undefined, stages: undefined, limit: 50, allFiles: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--key-file") out.keyFile = argv[++i];
    else if (a === "--stages") out.stages = argv[++i];
    else if (a === "--limit") out.limit = Number(argv[++i]);
    else if (a === "--all-files") out.allFiles = true;
    else if (a === "--key" || a.startsWith("--key=")) throw new Error("Give the key in a file (--key-file) or in ADLC_API_KEY, never on the command line.");
    else if (a.startsWith("--")) throw new Error(`There is no option ${a}.`);
    else if (out.base === undefined) out.base = a;
    else throw new Error("Give one address. The key goes in a file (--key-file) or in ADLC_API_KEY.");
  }
  if (!out.base) throw new Error("Give the service's lifecycle address, e.g. https://example.com/v1/lifecycle/");
  if (!/^https?:\/\//.test(out.base)) throw new Error("The address starts with https:// (or http:// for a service on this machine).");
  if (!Number.isInteger(out.limit) || out.limit < 1) throw new Error("--limit is a whole number above 0.");
  return out;
}

async function main() {
  let o, key, ids;
  try {
    o = args(process.argv.slice(2));
    key = (o.keyFile ? readFileSync(resolve(o.keyFile), "utf8") : process.env.ADLC_API_KEY ?? "").trim();
    if (!key) throw new Error("No key: put it in a file and give --key-file, or set ADLC_API_KEY.");
    ids = stageIds(o.stages ? resolve(o.stages) : undefined);
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
  const { calls, problems } = await run({ base: o.base, key, ids, limit: o.limit, allFiles: o.allFiles, say: (s) => console.log(s) });
  if (problems.length) {
    console.log("");
    for (const p of problems) console.log(`- ${p}`);
  }
  console.log(`\n${calls} call${calls === 1 ? "" : "s"}, ${problems.length} problem${problems.length === 1 ? "" : "s"}, against lifecycle API ${SCHEMA.version}.`);
  process.exit(problems.length ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
