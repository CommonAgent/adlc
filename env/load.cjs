"use strict";
// The environment loader: the one place a program learns which AgentMesh
// environment it belongs to (prod or dev) and that environment's project,
// hosts, addresses, buckets and pinned keys.
//
// WHICH ENVIRONMENT. AGENTMESH_ENV names it and defaults to "prod", so a
// process started exactly as it was before this file existed reads exactly the
// values it used to have written into it. AGENTMESH_ENV_FILE names a file
// directly and wins over the name (a test, or a one-off rehearsal).
//
// WHERE THE FILE IS. Beside this loader first (env/<name>.json in the
// repository, /opt/agentmesh/env on the mesh host, where deploy.sh ships this
// folder), then /opt/agentmesh/env and /opt/fleet/env for copies of the loader
// that were placed somewhere else. A missing file is an error that names every
// place it looked. There is no built-in fallback on purpose: a fallback would
// be a second copy of the prod values, and the point of this folder is that
// there is one.
//
// A NULL IS NOT A VALUE. env/dev.json carries null for what Terraform or a
// phase 1 step has not produced yet (an address, a pinned key). get() refuses
// a null the same way it refuses a missing key, so code that needs the value
// stops at the read instead of dialling somewhere wrong.
//
// From a shell:  node env/load.cjs get gcp.project
//                node env/load.cjs name
// From node:     require("./env/load.cjs").get("urls.app")
// From ESM/TS:   import { get } from "<relative>/env/load.mjs"

const fs = require("fs");
const path = require("path");

const NAME_RE = /^[a-z][a-z0-9-]{0,31}$/;

function envName(env = process.env) {
  const n = String(env.AGENTMESH_ENV || "prod").trim();
  if (!NAME_RE.test(n)) throw new Error(`AGENTMESH_ENV="${n}" is not an environment name`);
  return n;
}

function candidates(name, env = process.env) {
  if (env.AGENTMESH_ENV_FILE) return [env.AGENTMESH_ENV_FILE];
  const list = [path.join(__dirname, `${name}.json`)];
  if (env.AGENTMESH_ENV_DIR) list.unshift(path.join(env.AGENTMESH_ENV_DIR, `${name}.json`));
  list.push(`/opt/agentmesh/env/${name}.json`, `/opt/fleet/env/${name}.json`);
  return [...new Set(list)];
}

function deepFreeze(o) {
  if (o && typeof o === "object" && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

const cache = new Map();

function load(name = envName()) {
  const doc = find(name);
  if (doc) return doc;
  throw new Error(`AgentMesh environment "${name}" not found; looked in ${candidates(name).join(", ")}`);
}

// Like load(), but answers null when no file is found in any of the places
// load() looks, instead of throwing. A file that is there and broken (not
// JSON, or naming another environment) still throws. For the core server
// (the Agent Messaging Server), which runs with defaults when a deployment ships
// no environment file; every other reader keeps load() and its error.
function find(name = envName()) {
  const key = `${name}|${process.env.AGENTMESH_ENV_FILE || ""}|${process.env.AGENTMESH_ENV_DIR || ""}`;
  if (cache.has(key)) return cache.get(key);
  const tried = candidates(name);
  for (const file of tried) {
    let text;
    try { text = fs.readFileSync(file, "utf8"); } catch { continue; }
    let doc;
    try { doc = JSON.parse(text); } catch (e) { throw new Error(`${file} is not valid JSON: ${e.message}`); }
    if (!process.env.AGENTMESH_ENV_FILE && doc.name !== name) {
      throw new Error(`${file} says it is environment "${doc.name}", not "${name}"`);
    }
    deepFreeze(doc);
    cache.set(key, doc);
    return doc;
  }
  return null;
}

function lookup(doc, dotted) {
  let v = doc;
  for (const part of String(dotted).split(".")) {
    if (v === null || typeof v !== "object" || !(part in v)) return undefined;
    v = v[part];
  }
  return v;
}

// The value at a dotted path, e.g. get("urls.app"). Throws when the path is
// missing or null in the environment's file.
function get(dotted, name) {
  const doc = load(name);
  const v = lookup(doc, dotted);
  if (v === undefined) throw new Error(`env/${doc.name}.json has no ${dotted}`);
  if (v === null) throw new Error(`${dotted} is not set for environment "${doc.name}" (null in env/${doc.name}.json)`);
  return v;
}

// Like get(), but answers `fallback` when the environment leaves the value
// null. For values an environment may genuinely not have (dev has no
// Model Armor alert channel); never for a value prod depends on.
function getOptional(dotted, fallback = undefined, name) {
  const doc = load(name);
  const v = lookup(doc, dotted);
  if (v === undefined) throw new Error(`env/${doc.name}.json has no ${dotted}`);
  return v === null ? fallback : v;
}

module.exports = { envName, load, find, get, getOptional };

if (require.main === module) {
  const [cmd, arg] = process.argv.slice(2);
  try {
    if (cmd === "name") {
      process.stdout.write(`${load().name}\n`);
    } else if (cmd === "get" && arg) {
      const v = get(arg);
      process.stdout.write(`${Array.isArray(v) ? v.join(" ") : typeof v === "object" ? JSON.stringify(v) : String(v)}\n`);
    } else if (cmd === "json" && arg) {
      process.stdout.write(`${JSON.stringify(get(arg))}\n`);
    } else if (cmd === "file") {
      process.stdout.write(`${candidates(envName()).find((f) => fs.existsSync(f)) || ""}\n`);
    } else {
      process.stderr.write("usage: node env/load.cjs name | get <dotted.path> | json <dotted.path> | file\n");
      process.exit(2);
    }
  } catch (e) {
    process.stderr.write(`env: ${e.message}\n`);
    process.exit(1);
  }
}
