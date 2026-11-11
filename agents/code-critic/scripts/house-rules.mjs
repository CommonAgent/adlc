// Check the house rules: the six architecture rules agents keep breaking,
// each checked by reading the package's own files, with no model.
//
// These are the rules the reference names (references/the-house-rules.md),
// and every finding here names a file, a line, a claim and a consequence:
//
//   model-in-code       a model's name or version written into a script, a
//                       skill or a declaration; a script that reaches a model
//                       except through the four model settings (MODEL_NAME,
//                       MODEL_ENDPOINT, MODEL_KEY, MODEL_PROTOCOL) and the
//                       shared caller, model-caller.mjs; or a model system
//                       that names a credential, a variable or settings of
//                       its own (Common Agent 12.4.1);
//   hard-coded-address  an address written into a script where a bound
//                       system belongs;
//   kind-mismatch       a delivered piece whose media type is not its
//                       declared kind, or a kind that says nothing (a bare
//                       application/json);
//   undeclared-output   a piece delivered under a name no output declares;
//   claims-match-code   a record, a credential or a `how` the declarations
//                       state and the code does not do, or the other way
//                       round;
//   undeclared-setting  an environment variable a script reads that the
//                       agent's own files do not declare and the host does
//                       not place, so once deployed nothing sets it.
//
// Besides the findings, every address literal (Common Agent 12.10: http,
// https, ws or wss, then :// and a letter, a digit or [, or an IPv4 address in
// the link-local 169.254 block; comments included; outside the seven identifier prefixes
// 12.10 excepts) and the metadata server's host name, in every file under a
// skill's scripts/ folder, every file a run command names and every script a
// skill's build entry in plugin.json lists, is listed as a
// warning with its file, its line and the literal. A model service's own
// address is no exception. The warnings are the same on every run, in an order
// of their own; they are a section apart, a reason does not close one, and
// they are not counted among the open findings.
//
// What is checked is what can be seen in the text: a name built at run time
// is not seen, and nothing here runs the package. A finding is a claim for a
// person to answer, by a change or a reason; nothing here decides it.
//
//   needs: node >= 22
//   RECORDS=<this job's records folder, holding read.json and package/> node house-rules.mjs
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const trim = (s) => String(s ?? "").trim();
const base = (kind) => trim(kind).split(";")[0].trim().toLowerCase();

export const RULES = {
  "model-in-code": "no model name or version in code; a model is reached only through the four model settings and the shared caller",
  "hard-coded-address": "no address hard-coded where a bound system belongs",
  "kind-mismatch": "every delivered piece matches its declared kind",
  "undeclared-output": "no undeclared outputs",
  "claims-match-code": "refusals and records match what the code really does",
  "declaration-change": "a package's declarations are part of the change",
  "credential-in-package": "a credential is named, never carried",
  "undeclared-setting": "every environment variable a script reads is declared, or placed by the host",
};

// The families of models agents here have named, with a version or size
// after the family; a provider prefix is read with it. The same pattern the
// package maker refuses a new agent for.
export const MODEL_NAME_RE = new RegExp(
  "(?<![\\w.-])(?:[a-z][a-z0-9-]*/)?("
  + "gemini-(?:\\d[\\w.-]*|pro\\b[\\w.-]*|flash\\b[\\w.-]*|ultra\\b[\\w.-]*)"
  + "|gpt-(?:\\d[\\w.-]*|4o[\\w.-]*)"
  + "|claude-(?:opus|sonnet|haiku|instant|\\d)[\\w.-]*"
  + "|o[134]-(?:mini|preview|pro)[\\w.-]*"
  + "|llama-?\\d[\\w.-]*"
  + "|mistral-(?:large|medium|small|tiny)[\\w.-]*"
  + "|command-[r][\\w.-]*"
  + ")", "gi");
const COMMENT_LINE_RE = /^\s*(\/\/|\/\*|\*|#(?!#|!))/;

// The model providers' own endpoints: a call to one of them is a call to a
// model. The shared caller names none of them (the install places
// MODEL_ENDPOINT), so a script that does reaches a model on its own. These
// are host names this file must recognize in someone else's package, never
// one it calls; the address findings leave them to this rule, and the
// warnings list them like any other address.
const MODEL_HOSTS = /(generativelanguage\.googleapis\.com|aiplatform\.googleapis\.com|aiplatform\.[a-z]+\.rep\.googleapis\.com|api\.anthropic\.com|api\.openai\.com)/;
// Addresses that are not a system anybody binds: this machine, the metadata
// server, documentation and schema hosts, the lifecycle's published pages,
// and names reserved for examples.
const NOT_A_SYSTEM = [
  /^(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|\[::1\])(:\d+)?$/,
  /^metadata\.google\.internal$/,
  /(^|\.)(example\.(com|org|net)|test|invalid|localhost)$/,
  /^(json-schema\.org|www\.w3\.org|schema\.org|agent-plugins\.org|spdx\.org)$/,
  /(^|\.)(agentroles\.ai|agenticdevelopment\.ai|agentprocesses\.ai|commonagent\.net)$/,
];
const URL_RE = /\bhttps?:\/\/([^\s"'`)<>\\]+)/g;
const PLATFORM_HOST_RE = /(?<![@\w.-])((?:[a-z0-9-]+\.)+(?:agentmesh\.ai|run\.app))\b/g;
const CREDENTIAL_ENV = /(_KEY|_TOKEN|_SECRET|_PASSWORD|_CREDS|_CREDENTIALS?)$/;
// A provider's own key, and the variables the retired callers chose a model
// or a place with: a script that reads one reaches a model outside the four
// model settings. Names to recognize in someone else's package, written as
// patterns ([_]) so this package's own scripts never read or carry them.
const PROVIDER_KEY_RE = /^(?:GOOGLE[_]GENERATIVE_AI|ANTHROPIC|OPENAI)[_]API_KEY$/;
const OLD_MODEL_VARS_RE = /\b((?:GOOGLE[_]GENERATIVE_AI|ANTHROPIC|OPENAI)[_]API_KEY|AGENT[_]MODEL|VERTEX[_]WHERE|GOOGLE[_]CLOUD_(?:PROJECT|LOCATION))\b/;
// The four settings a system of kind model is read through (Common Agent
// 0.41.0, Section 12.4.1), and no other name.
const MODEL_SETTINGS = ["MODEL_NAME", "MODEL_ENDPOINT", "MODEL_KEY", "MODEL_PROTOCOL"];
const CALLS_A_MODEL = /\b(callModel|askModel|askJson|lookJson)\s*\(|from\s+["']\.\/(model-caller|caller|model|look|vertex)\.m?js["']/;

const isScript = (f) => f.role === "script";
const lineList = (text) => String(text ?? "").split(/\r?\n/);

function finding(rule, file, line, claim, consequence) {
  return { source: "house rule", rule, place: { file, line }, claim, consequence };
}

/** The line a needle first appears on at or after `from`, 1-based, or null. */
export function lineOf(text, needle, from = 1) {
  const lines = lineList(text);
  for (let i = Math.max(0, from - 1); i < lines.length; i++) {
    if (typeof needle === "string" ? lines[i].includes(needle) : needle.test(lines[i])) return i + 1;
  }
  return null;
}

/** Every line of a script that is code, with its number. */
function codeLines(text, path) {
  const out = [];
  const md = /\.md$/i.test(path) || /\.json$/i.test(path);
  lineList(text).forEach((l, i) => { if (md || !COMMENT_LINE_RE.test(l)) out.push([i + 1, l]); });
  return out;
}

/** Model names written into scripts, skills and declarations, and scripts
 *  that call a model without reading the configured one. */
export function modelFindings(files, texts) {
  const out = [];
  for (const f of files) {
    const text = texts[f.path];
    if (text == null) continue;
    const looked = isScript(f) || (f.role === "declaration" && f.path !== "rules.md");
    if (!looked) continue;
    const told = new Set();
    for (const [n, line] of codeLines(text, f.path)) {
      for (const m of line.matchAll(MODEL_NAME_RE)) {
        const name = m[1].replace(/[.-]+$/, "");
        if (told.has(name.toLowerCase())) continue;
        told.add(name.toLowerCase());
        out.push(finding("model-in-code", f.path, n,
          `${f.path} names the model ${name}.`,
          f.role === "declaration"
            ? `Every install of this package is told to run ${name}, and when that model is retired the package has to be rebuilt to change a setting. A declaration says the capability the job needs (text, vision, long context); the install chooses the model.`
            : `This script runs ${name} whatever the install configured, so changing the model is a new version rather than a setting, and the day ${name} is retired the job fails (Brand reader answered 404 that way). Read the model from the four model settings through the shared caller.`));
      }
    }
    if (!isScript(f)) continue;
    const host = codeLines(text, f.path).find(([, l]) => MODEL_HOSTS.test(l));
    const old = host ? null : codeLines(text, f.path).map(([n, l]) => [n, OLD_MODEL_VARS_RE.exec(l)]).find(([, m]) => m);
    if (host) {
      out.push(finding("model-in-code", f.path, host[0],
        `${f.path} calls a model provider's endpoint itself, not through the shared caller and the four model settings.`,
        "Whatever model and service this call reaches were chosen here and not by the install, so a run config or an owner who changes MODEL_NAME or MODEL_ENDPOINT changes nothing for this step, and a host that offers its model only through a gateway cannot run it. The call belongs in the shared caller, scripts/model-caller.mjs, which reads the four settings on every call."));
    } else if (old) {
      out.push(finding("model-in-code", f.path, old[0],
        `${f.path} reads ${old[1][1]}, so it reaches a model outside the four model settings and the shared caller.`,
        `No install places ${old[1][1]} for this package, so the step works only on a host somebody set it on by hand, and the model or the credential it chooses is not the one the install placed. Read the model through the shared caller, scripts/model-caller.mjs, from MODEL_NAME, MODEL_ENDPOINT, MODEL_KEY and MODEL_PROTOCOL.`));
    }
  }
  return out;
}

/** A system of kind model that names a credential, a variable or settings of
 *  its own: it is read through the four model settings and nothing else. */
export function modelSystemFindings(runtime, rtext = "") {
  const out = [];
  const file = "agent-runtime-requirements.json";
  for (const s of runtime?.systems ?? []) {
    if (s?.kind !== "model") continue;
    const name = trim(s.name) || "the model system";
    const from = lineOf(rtext, `"${trim(s.name)}"`) ?? 1;
    const at = (key) => lineOf(rtext, new RegExp(`"${key}"\\s*:`), from) ?? from;
    const consequence = (what) => `The install places the model through MODEL_NAME, MODEL_ENDPOINT, MODEL_KEY and MODEL_PROTOCOL, the same four in every agent, so ${what} is placed by no install, and the package reads its model or credential from somewhere the install did not put it. A model system declares its kind and the protocols it speaks, and nothing else.`;
    if (s.credential !== undefined) {
      out.push(finding("model-in-code", file, at("credential"),
        `${file} gives the model system ${name} a credential of its own.`,
        consequence("that credential")));
    }
    if (s.env !== undefined) {
      out.push(finding("model-in-code", file, at("env"),
        `${file} gives the model system ${name} an env variable of its own, ${trim(s.env) || "unnamed"}.`,
        consequence(trim(s.env) || "that variable")));
    }
    if (s.settings !== undefined) {
      const envs = (Array.isArray(s.settings) ? s.settings : []).map((x) => trim(x?.env)).filter(Boolean);
      out.push(finding("model-in-code", file, at("settings"),
        `${file} gives the model system ${name} settings of its own${envs.length ? `: ${envs.join(", ")}` : ""}.`,
        consequence(envs.length ? envs.join(", ") : "each of those settings")));
    }
  }
  return out;
}

const hostOf = (rest) => rest.split(/[/?#]/)[0].replace(/^[^@]*@/, "").toLowerCase();
const exempt = (host) => !host || /[${}]/.test(host) || !/^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?$/.test(host)
  || MODEL_HOSTS.test(host) || NOT_A_SYSTEM.some((re) => re.test(host));
// An address that changes with the environment: the platform's own services
// (app., api. and the rest under agentmesh.ai, dev. and test. among them) and
// a deployed service's own host. The public site and the schema ids are not.
const ENVIRONMENT_HOST = /(^|\.)(run\.app|cloudfunctions\.net)$|^(?!www\.|schemas\.)[a-z0-9.-]+\.agentmesh\.ai$/;

/** Addresses written into scripts. */
export function addressFindings(files, texts) {
  const out = [];
  for (const f of files.filter(isScript)) {
    const text = texts[f.path];
    if (text == null) continue;
    const told = new Set();
    for (const [n, line] of codeLines(text, f.path)) {
      const hosts = [];
      for (const m of line.matchAll(URL_RE)) hosts.push(hostOf(m[1]));
      for (const m of line.matchAll(PLATFORM_HOST_RE)) if (!hosts.includes(m[1].toLowerCase())) hosts.push(m[1].toLowerCase());
      for (const host of hosts) {
        if (exempt(host) || told.has(host)) continue;
        // A public address the package exists to read (a keyless public
        // read) stays in the script, as the spec writer's rules say. What is
        // flagged is an address that changes with the environment, and any
        // address used as the fallback for a setting, which is where a bound
        // system belongs.
        const fallback = /(process\.env|\benv\.[A-Z_]+|\benv\[)[^;]*(\?\?|\|\|)/.test(line);
        if (!fallback && !ENVIRONMENT_HOST.test(host)) continue;
        told.add(host);
        out.push(finding("hard-coded-address", f.path, n,
          `${f.path} writes the address ${host} into the code${fallback ? " as the value used when nothing is configured" : ""}.`,
          `Every install reaches ${host}, in dev, in a customer's account and in prod alike${fallback ? " whenever the setting is missing, which is the case nobody notices" : ""}, and moving that system means a new version of the package. A system the package reaches is declared in agent-runtime-requirements.json and its address read from what the install places.`));
      }
    }
  }
  return out;
}

// An address literal as Common Agent 12.10 defines it, and the metadata
// server's host name. These are patterns for finding addresses in someone
// else's file, never an address this script calls, so none is written out
// whole: the host name and the link-local range are escaped patterns.
const ADDRESS_LITERAL_RE = /\b(?:https?|wss?):\/\/[A-Za-z0-9[][^\s"'`<>\\]*/gi;
const METADATA_HOST_RE = /\bmetadata\.google\.internal\b/gi;
const OCTET = "(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)";
const LINK_LOCAL_RE = new RegExp(`(?<![\\w.])169\\.254\\.${OCTET}\\.${OCTET}(?![\\w.])`, "g");
// The seven identifier prefixes 12.10 excepts, a format's name spelled as an
// address. They are data to recognize in someone else's file and never an
// address this script calls, so each is built from its scheme and its host.
const IDENTIFIER_PREFIXES = [
  ["http", "www.w3.org/"], ["https", "www.w3.org/"], ["http", "json-schema.org/"], ["https", "json-schema.org/"],
  ["http", "purl.org/"], ["http", "schemas.openxmlformats.org/"], ["http", "schemas.microsoft.com/"],
].map(([scheme, host]) => `${scheme}:${"//"}${host}`);
const LOCKFILE_RE = /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|poetry\.lock|uv\.lock|Pipfile\.lock)$/;
const SKILL_SCRIPT_RE = /(^|\/)skills\/[^/]+\/scripts\//;

/** Every address literal on one line, in the order they stand: [{at, literal}].
 *  An address inside a URL is counted once, as the URL; an excepted
 *  identifier is not counted; a credential in an address is left out. */
export function addressLiterals(line) {
  const out = [];
  let rest = String(line ?? "");
  for (const m of rest.matchAll(ADDRESS_LITERAL_RE)) {
    const literal = m[0].replace(/[.,;:)]+$/, "");
    if (!IDENTIFIER_PREFIXES.some((p) => literal.toLowerCase().startsWith(p))) out.push({ at: m.index, literal });
  }
  rest = rest.replace(ADDRESS_LITERAL_RE, (m) => " ".repeat(m.length));
  for (const re of [LINK_LOCAL_RE, METADATA_HOST_RE]) for (const m of rest.matchAll(re)) out.push({ at: m.index, literal: m[0] });
  return out
    .sort((a, b) => a.at - b.at)
    .map((x) => ({ at: x.at, literal: x.literal.replace(/^([a-z]+:\/\/)[^/@\s]*@/i, "$1[left out]@") }));
}

/** The files a run command in agent-runtime-requirements.json names, as
 *  paths of the package given: the built path when it came, else the script
 *  plugin.json's build entry copies there. */
export function runCommandFiles(files, runtime, manifest) {
  const have = new Set(files.map((f) => f.path));
  const skills = manifest?.extensions?.["net.agentdoc.package"]?.build?.skills ?? {};
  const out = new Set();
  for (const r of Object.values(runtime?.run ?? {})) {
    for (const part of Array.isArray(r?.command) ? r.command : []) {
      const rel = String(part ?? "").replace(/^(?:\{home\}\/)?\{package\}\//, "");
      if (/[{}\s]/.test(rel) || !/\/[^/]+\.[A-Za-z0-9]+$/.test(rel)) continue;
      if (have.has(rel)) { out.add(rel); continue; }
      const m = /^skills\/([^/]+)\/(.+)$/.exec(rel);
      if (!m) continue;
      const name = m[2].split("/").pop();
      const source = (skills[m[1]]?.scripts ?? []).find((s) => s === m[2] || s.split("/").pop() === name);
      if (source && have.has(source)) out.add(source);
      else if (have.has(m[2])) out.add(m[2]);
    }
  }
  return out;
}

/** Every address literal in the files under a skill's scripts/ folder, the
 *  files a run command names and the scripts any skill's build entry in
 *  plugin.json lists, each a warning with its file, its line and the
 *  literal: the same on every run, in file, line and column order. A comment,
 *  a reason or the message never removes one, and a model service's address
 *  is listed like any other. */
export function addressWarnings(files, texts) {
  const parse = (p) => { try { return texts[p] ? JSON.parse(texts[p]) : null; } catch { return null; } };
  const manifest = parse("plugin.json");
  const named = runCommandFiles(files, parse("agent-runtime-requirements.json") ?? parse("install.json"), manifest);
  // In a package source the builder copies exactly the scripts each skill's
  // build entry lists into skills/<slug>/scripts/, so those are read too.
  for (const s of Object.values(manifest?.extensions?.["net.agentdoc.package"]?.build?.skills ?? {})) {
    for (const p of Array.isArray(s?.scripts) ? s.scripts : []) named.add(String(p));
  }
  const read = files
    .map((f) => f.path)
    .filter((p) => texts[p] != null && !LOCKFILE_RE.test(p) && (SKILL_SCRIPT_RE.test(p) || named.has(p)))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const out = [];
  for (const p of [...new Set(read)]) {
    lineList(texts[p]).forEach((line, i) => {
      const told = new Set();
      for (const { literal } of addressLiterals(line)) {
        if (told.has(literal)) continue;
        told.add(literal);
        const metadata = /metadata\.google\.internal|(^|[/@])169\.254\./i.test(literal);
        out.push({
          source: "house rule", rule: "hard-coded-address", warning: true,
          place: { file: p, line: i + 1 }, literal,
          claim: `${p} carries the address ${literal} on line ${i + 1}.`,
          consequence: metadata
            ? "A script that asks the machine's metadata server takes a credential from around the agent rather than the one the install placed, and runs only on that provider's machines (Common Agent 12.4.1, 12.10)."
            : "Every install reaches this address as written, whatever it placed, so the script has gone around its declaration (Common Agent 12.6, rule 2). A depot publishes the package with a warning that names this file and this address, shown to the publisher and to every reader of the package, and only a version whose scripts carry no address is published without one (Common Agent 12.10). Where a system is, a model included, is the install's to place.",
        });
      }
    });
  }
  return out;
}

/** Every declared output, by name: {kind, where}. */
export function declaredOutputs(descriptor) {
  const out = new Map();
  for (const o of descriptor?.offerings ?? []) {
    for (const p of [o, ...(o.steps ?? [])]) {
      for (const x of p.outputs ?? []) if (trim(x?.name) && !out.has(trim(x.name))) out.set(trim(x.name), { kind: trim(x.kind), job: p.id });
    }
  }
  return out;
}

export function isDeclaredPiece(piece, declared) {
  const p = trim(piece).toLowerCase();
  for (const d of declared) {
    const n = trim(d).toLowerCase();
    if (p === n || p.startsWith(`${n} (`)) return true;
  }
  return false;
}

/** Whether a piece sent as `media` is what `kind` declares. */
export function kindHolds(kind, media) {
  const k = base(kind), m = base(media);
  if (!k || !m) return true;
  if (k === m || k === "document") return true;
  if (k === "text") return m.startsWith("text/");
  if (k === "url") return m === "text/uri-list" || m === "text/plain";
  if (k === "identifier") return m === "text/plain";
  return false;
}

const EXT_KINDS = { ".json": (m) => m === "application/json" || m.endsWith("+json"), ".md": (m) => m === "text/markdown", ".html": (m) => m === "text/html", ".txt": (m) => m.startsWith("text/") };

/** The literal piece entries in the scripts: {file, line, name, media_type, path}. */
export function pieceEntries(files, texts) {
  const out = [];
  for (const f of files.filter(isScript)) {
    const text = texts[f.path];
    if (text == null) continue;
    for (const m of text.matchAll(/\{[^{}]*\}/g)) {
      const obj = m[0];
      const name = /["']?\bname["']?\s*:\s*(["'])([^"'`$\\\n]+?)\1/.exec(obj);
      const media = /["']?\bmedia_type["']?\s*:\s*(["'])([^"'`$\\\n]+?)\1/.exec(obj);
      if (!name || !media || !/\b(step|path|about)\b/.test(obj)) continue;
      const path = /["']?\bpath["']?\s*:\s*(["'`])([^"'`$\\\n]+?)\1/.exec(obj);
      const line = text.slice(0, m.index).split("\n").length + obj.slice(0, name.index).split("\n").length - 1;
      out.push({ file: f.path, line, name: name[2].trim(), media_type: media[2].trim(), path: path ? path[2] : null });
    }
  }
  return out;
}

/** Kinds that say nothing, pieces sent as something other than declared,
 *  and pieces nothing declares. */
export function pieceFindings(files, texts, descriptor) {
  const out = [];
  const dtext = texts["agent-descriptor.json"] ?? "";
  if (descriptor) {
    // One finding for all of them: it is one decision, made once per piece.
    const lines = lineList(dtext);
    let lastName = null;
    const bare = [];
    lines.forEach((l, i) => {
      const nm = /"name"\s*:\s*"([^"]+)"/.exec(l);
      if (nm) lastName = nm[1];
      if (/"kind"\s*:\s*"application\/json"/.test(l)) bare.push({ name: lastName, line: i + 1 });
    });
    if (bare.length) {
      const names = [...new Set(bare.map((b) => b.name).filter(Boolean))].map((n) => `"${n}"`);
      const where = bare.length > 1 ? ` (lines ${bare.map((b) => b.line).join(", ")})` : "";
      out.push(finding("kind-mismatch", "agent-descriptor.json", bare[0].line,
        names.length > 1
          ? `${names.length} pieces are declared as a bare application/json: ${names.join(", ")}${where}.`
          : `${names[0] ?? "A piece"} is declared as a bare application/json${where}.`,
        "The kind says only that the bytes parse, not what is inside, so the next agent, the person reviewing it and the App cannot tell what they hold. Content a person reads, or one agent hands another, is text/markdown with a convention; exact typed data is application/vnd.agentmesh.<name>+json with its shape sketched in the about."));
    }
  }
  const declared = declaredOutputs(descriptor);
  for (const p of pieceEntries(files, texts)) {
    const match = [...declared.entries()].find(([n]) => isDeclaredPiece(p.name, [n]));
    if (!match) {
      if (descriptor) {
        out.push(finding("undeclared-output", p.file, p.line,
          `${p.file} delivers a piece called "${p.name}" that no output in agent-descriptor.json declares.`,
          `Whoever receives the job gets a ${p.media_type} piece nothing told them to expect, the App shows it without a kind it can trust, and a buyer reading the descriptor does not know it is sent. Declare it as an output with its kind, or stop sending it.`));
      }
    } else if (!kindHolds(match[1].kind, p.media_type)) {
      out.push(finding("kind-mismatch", p.file, p.line,
        `${p.file} sends "${p.name}" as ${p.media_type}, and agent-descriptor.json declares it ${match[1].kind}.`,
        `The next agent takes the piece as ${match[1].kind} and reads ${p.media_type}, so the hand-off breaks or, worse, half-works. Send what is declared, or declare what is sent.`));
    }
    const ext = p.path ? (/\.[a-z]+$/i.exec(p.path)?.[0] ?? "").toLowerCase() : "";
    if (EXT_KINDS[ext] && !EXT_KINDS[ext](base(p.media_type))) {
      out.push(finding("kind-mismatch", p.file, p.line,
        `${p.file} files "${p.name}" at ${p.path} as ${p.media_type}.`,
        `A ${ext} file listed as ${p.media_type} is opened as one and read as the other; whichever is right, one of them is wrong.`));
    }
  }
  return out;
}

const globRe = (g) => new RegExp(`^${String(g).replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);

/** Records declared that nothing writes, records written that nothing
 *  declares, credentials read that no system binds, and `how` claims the
 *  scripts do not bear out. */
export function claimFindings(files, texts, descriptor, runtime, manifest) {
  const out = [];
  if (!descriptor) return out;
  const dtext = texts["agent-descriptor.json"] ?? "";
  const scripts = files.filter(isScript).filter((f) => texts[f.path] != null);
  const all = scripts.map((f) => texts[f.path]).join("\n");

  // Records.
  const declaredFiles = (descriptor.records ?? []).map((r) => trim(r?.file)).filter(Boolean);
  const declaredBases = declaredFiles.map((f) => f.split("/").pop());
  for (const file of declaredFiles) {
    const b = file.split("/").pop();
    // A pattern's name is built at run time, so each fixed part of it must
    // be written somewhere, the way a template or a concatenation writes it.
    const parts = b.split("*").filter((p) => p.length >= 2 && !/^\.[a-z]+$/.test(p));
    if (b.includes("*") ? !parts.every((p) => all.includes(p)) : !all.includes(b)) {
      out.push(finding("claims-match-code", "agent-descriptor.json", lineOf(dtext, `"${file}"`),
        `agent-descriptor.json declares the record ${file}, and no script writes a file called ${b}.`,
        "An owner auditing a job looks for a record the package promised and finds nothing, and cannot tell a job that never wrote it from one that lost it. Write it, or take it out of the records."));
    }
  }
  if (scripts.length && (descriptor.records ?? []).length) {
    const told = new Set();
    for (const f of scripts) {
      const text = texts[f.path];
      const res = [
        /join\(\s*(?:RECORDS|records|recordsDir|RECORDS_DIR|recordDir)\b[^()\n]*?,\s*["'`]([\w.-]+\.(?:json|jsonl|md|txt|html|png))["'`]\s*\)/g,
        /\$\{\s*(?:RECORDS|records|recordsDir)\s*\}\/([\w.-]+\.(?:json|jsonl|md|txt|html|png))/g,
      ];
      for (const re of res) for (const m of text.matchAll(re)) {
        const b = m[1];
        if (told.has(b) || declaredBases.some((d) => globRe(d).test(b))) continue;
        told.add(b);
        out.push(finding("claims-match-code", f.path, text.slice(0, m.index).split("\n").length,
          `${f.path} writes ${b} into the job's records, and agent-descriptor.json declares no such record.`,
          "The records an owner is told about are not the records kept, so an audit reads a list that is short of what is on disk, and nothing promises the file will still be written next version. Declare it in records, or stop writing it."));
      }
    }
  }

  // Credentials read that no system binds.
  const bound = new Set();
  for (const s of runtime?.systems ?? []) {
    if (s?.env) bound.add(s.env);
    for (const st of s?.settings ?? []) if (st?.env) bound.add(st.env);
  }
  for (const st of runtime?.settings ?? []) if (st?.env) bound.add(st.env);
  // A system of kind model is read through the four model settings, which
  // every install places for it.
  if ((runtime?.systems ?? []).some((s) => s?.kind === "model")) for (const n of MODEL_SETTINGS) bound.add(n);
  for (const f of scripts) {
    const text = texts[f.path];
    const names = new Map();
    const add = (n, idx) => { if (!names.has(n)) names.set(n, text.slice(0, idx).split("\n").length); };
    for (const m of text.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) add(m[1], m.index);
    for (const m of text.matchAll(/process\.env\[\s*["']([A-Z][A-Z0-9_]*)["']\s*\]/g)) add(m[1], m.index);
    for (const m of text.matchAll(/\benv\.([A-Z][A-Z0-9_]*)/g)) add(m[1], m.index);
    for (const m of text.matchAll(/(?:const|let|var)\s*\{([^}]*)\}\s*=\s*process\.env/g)) for (const n of m[1].split(",")) { const k = trim(n.split(":")[0].split("=")[0]); if (/^[A-Z][A-Z0-9_]*$/.test(k)) add(k, m.index); }
    for (const [n, line] of names) {
      if (!CREDENTIAL_ENV.test(n) || bound.has(n) || PROVIDER_KEY_RE.test(n) || /^(MESH|AGENT)_/.test(n)) continue;
      out.push(finding("claims-match-code", f.path, line,
        `${f.path} reads the credential ${n}, and no system in agent-runtime-requirements.json binds it.`,
        `No install places ${n}, so the step fails on every host but the one somebody set it on by hand, and the package's declarations do not say it reaches whatever that credential opens. Bind it as a system's credential, or stop reading it.`));
    }
  }

  // The how of each offering and step, against the scripts each one runs.
  const skills = manifest?.extensions?.["net.agentdoc.package"]?.build?.skills ?? {};
  const callsAModel = (rel) => {
    const f = files.find((x) => x.path === rel || x.path.endsWith(`/${rel}`));
    const t = f ? texts[f.path] : null;
    return t != null && (MODEL_HOSTS.test(t) || CALLS_A_MODEL.test(t));
  };
  for (const o of descriptor.offerings ?? []) {
    for (const p of [o, ...(o.steps ?? [])]) {
      const how = p?.how ?? {};
      const at = lineOf(dtext, `"id": "${p.id}"`) ?? lineOf(dtext, `"${p.id}"`);
      if (how.control === "model" && how.contract === "full") {
        out.push(finding("claims-match-code", "agent-descriptor.json", at,
          `${p.id} declares control by a model under a full contract.`,
          "A method written down in full and handed to a model to improvise is the shape that failed three times in the first multi-agent run. Where the method is known, a program runs it and calls the model at named points (control script)."));
      }
      if (how.control === "script" && how.intelligence === "open") {
        out.push(finding("claims-match-code", "agent-descriptor.json", at,
          `${p.id} declares a program that hands the work to a model to find its own way (intelligence open).`,
          "That is a model with a launcher: nothing the program checks bounds what the model does. Name the points where the model is called (intelligence called), or say plainly that the model holds control."));
      }
      const own = skills[p.id]?.scripts ?? [];
      if (p !== o && own.length) {
        const calling = own.filter(callsAModel);
        if (how.intelligence === "none" && calling.length) {
          out.push(finding("claims-match-code", "agent-descriptor.json", at,
            `${p.id} declares no model (intelligence none), and ${calling[0]}, which it runs, calls one.`,
            "A buyer reads this step as deterministic and free and it is neither: it costs money on every job and its answer can change between runs. Declare it as called and metered, or take the call out."));
        }
        if (how.intelligence === "called" && !calling.length && !own.some((s) => /caller|model/.test(s))) {
          out.push(finding("claims-match-code", "agent-descriptor.json", at,
            `${p.id} declares a model call (intelligence called), and none of the scripts it runs calls a model.`,
            "The declaration says this step is a judgment and charges for one, and the code says it is not; whichever is wrong, the buyer is told something untrue."));
        }
      }
    }
  }
  return out;
}

// ── Undeclared settings ──────────────────────────────────────────────────
//
// What the host places in a job's environment besides what the package
// declares, by exact name, each from where it is set:
//   - the job runner (agents/image/one-message.mjs, composite.mjs): the job
//     folder and its out folder, the message and reply files, and the image's
//     own facts;
//   - the deployment manager: AGENT_DEPS where a lockfile was installed
//     (install.py, env_file) and the platform's address, MESH_API_BASE
//     (steps.py, API_BASE);
//   - the job's own mesh credential, MESH_JOB_JWT and MESH_JOB_NKEY_SEED,
//     which the security reviewer takes as placed for every job
//     (trace-programs.mjs, meshKeys);
//   - what the security reviewer's PLACED_VARS takes as placed:
//     AGENTMESH_ENV and the process's own environment (HOME, PATH, TMPDIR
//     and the rest every host sets), but not its two model replay
//     switches, which no install places for a package.
// Three more are per declaration and checked against it: AGENT_DIRECTORY_<NAME>
// for each declared directory, BINARY_<NAME> for each declared binary
// (install.py, binary_var), and CEILING_<SYSTEM>, with _PER and _UNIT, for
// each declared system (install.py, env_file).
export const HOST_PLACED = [
  "MESH_JOB_DIR", "MESH_JOB_OUT", "MESH_MESSAGE_FILE", "MESH_REPLY_FILE", "MESH_JOB_ANSWER", "MESH_SENDS_VIA_HOST", "MESH_SELF_HANDLE",
  "AGENT_NAME", "AGENT_HOME", "AGENT_PACKAGE", "AGENT_HARNESS_BIN", "AGENT_INSTRUCTIONS_FILE", "AGENT_JOB_SECONDS",
  "AGENT_RUN_SPEC", "AGENT_BINDING_DIR", "AGENT_DEPS", "MESH_API_BASE", "MESH_JOB_JWT", "MESH_JOB_NKEY_SEED",
  "AGENTMESH_ENV",
  "PATH", "HOME", "TMPDIR", "TEMP", "TMP", "USER", "LANG", "TZ", "PWD", "SHELL", "CI", "NODE_ENV", "NODE_OPTIONS", "NODE_PATH", "PYTHONPATH", "DEBUG",
];
// The model system's four settings and its optional answer budget: placed
// for a package that declares a system of kind model.
const MODEL_PLACED = [...MODEL_SETTINGS, "MODEL_MAX_OUTPUT_TOKENS"];
const upperName = (s) => trim(s).toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");

/** Every name the agent's own files declare or the host places for it: the
 *  install file's credentials and settings, the model system's settings, the
 *  descriptor's run config settings (by name and in capitals), a spec's
 *  systems and run config when one came, the per-declaration families, every
 *  NAME= a SKILL.md tells whoever runs a step to set, and the names the host
 *  places. */
export function declaredSettings({ runtime = null, descriptor = null, spec = null, skills = [] } = {}) {
  const out = new Set(HOST_PLACED);
  const systems = [...(runtime?.systems ?? []), ...(spec?.systems ?? [])];
  for (const s of systems) {
    if (trim(s?.env)) out.add(trim(s.env));
    for (const st of Array.isArray(s?.settings) ? s.settings : []) if (trim(st?.env)) out.add(trim(st.env));
    const sys = upperName(s?.name ?? s?.role);
    if (sys) for (const k of ["", "_PER", "_UNIT"]) out.add(`CEILING_${sys}${k}`);
  }
  for (const st of Array.isArray(runtime?.settings) ? runtime.settings : []) if (trim(st?.env)) out.add(trim(st.env));
  if (systems.some((s) => s?.kind === "model")) for (const n of MODEL_PLACED) out.add(n);
  for (const d of runtime?.directories ?? []) if (upperName(d?.name)) out.add(`AGENT_DIRECTORY_${upperName(d.name)}`);
  for (const b of runtime?.binaries ?? []) if (upperName(b?.name)) out.add(`BINARY_${upperName(b.name)}`);
  for (const text of skills) for (const m of String(text ?? "").matchAll(/(?<![\w$])([A-Z][A-Z0-9_]*)=/g)) out.add(m[1]);
  return out;
}

/** The run config settings the descriptor (or a spec) declares, by name and
 *  in capitals. A run setting arrives in the job's run-context.json, as the
 *  member run_config (Common Agent 0.41.0, Section 5.8), never as a variable:
 *  a script that reads one from the environment reads what the host happens
 *  to hold, not what the job was started with. */
export function runSettingNames({ descriptor = null, spec = null } = {}) {
  const out = new Set();
  for (const rc of [descriptor?.run_config, spec?.run_config]) {
    for (const st of Array.isArray(rc?.settings) ? rc.settings : []) {
      if (trim(st?.name)) { out.add(trim(st.name)); out.add(upperName(st.name)); }
    }
  }
  return out;
}

/** Where a script's own entry point is, as [first line, last line]: the
 *  block guarded by import.meta.url, import.meta.main, process.argv[1] or
 *  require.main, or Python's __main__, to the brace that closes it (or the
 *  end of the file). Null when the script has none. */
export function mainBlock(text) {
  const lines = lineList(text);
  const at = lines.findIndex((l) => /^\s*if\s*\(.*(?:import\.meta\.(?:url|main)|process\.argv\[1\]|require\.main\s*===\s*module)/.test(l) || /^\s*if\s+__name__\s*==\s*["']__main__["']\s*:/.test(l));
  if (at < 0) return null;
  if (/__main__/.test(lines[at])) return [at + 1, lines.length];
  let depth = 0, opened = false;
  for (let i = at; i < lines.length; i++) {
    for (const c of lines[i].replace(/(["'`])(?:\\.|(?!\1).)*\1/g, "")) {
      if (c === "{") { depth += 1; opened = true; } else if (c === "}") depth -= 1;
    }
    if (opened && depth <= 0) return [at + 1, i + 1];
  }
  return [at + 1, lines.length];
}

/** Every environment variable a script reads, by name, with the line it is
 *  first read on: process.env.X, process.env?.X, process.env["X"], env.X and
 *  env["X"] (env being what a function was handed as process.env), names
 *  taken apart from process.env or env, and Python's os.environ and os.getenv.
 *  Comment lines are not read. A name built at run time is not seen. */
export function envReads(text, path = "") {
  const names = new Map();
  const add = (n, line) => { if (/^[A-Z][A-Z0-9_]*$/.test(n) && !names.has(n)) names.set(n, line); };
  const ONE_LINE = [
    /\benv\??\.([A-Z][A-Z0-9_]*)\b(?!\s*=[^=>])/g,
    /\benv\??\.?\[\s*["'`]([A-Z][A-Z0-9_]*)["'`]\s*\](?!\s*=[^=>])/g,
    /\bos\.environ(?:\.get\(\s*|\[\s*)["']([A-Z][A-Z0-9_]*)["']/g,
    /\bos\.getenv\(\s*["']([A-Z][A-Z0-9_]*)["']/g,
  ];
  for (const [n, l] of codeLines(text, path)) for (const re of ONE_LINE) for (const m of l.matchAll(re)) add(m[1], n);
  const comments = new Set(lineList(text).map((l, i) => (COMMENT_LINE_RE.test(l) ? i + 1 : 0)).filter(Boolean));
  for (const m of String(text ?? "").matchAll(/(?:const|let|var)\s*\{([^}]*)\}\s*=\s*(?:process\.)?env\b/g)) {
    const line = text.slice(0, m.index).split("\n").length;
    if (comments.has(line)) continue;
    for (const part of m[1].split(",")) add(trim(part.split(":")[0].split("=")[0]), line);
  }
  return names;
}

/** Names a script sets for itself or hands a program it starts: process.env.X
 *  assigned; a key of an object that spreads process.env or env; and, in a
 *  script that starts a program (spawn, execFile, fork, exec), every name in
 *  capitals it sets as a key (X: ...) or a member (extra.X = ...), the way a
 *  job hands each step what it reads. */
export function envSets(text) {
  const t = String(text ?? "");
  const out = new Set();
  for (const m of t.matchAll(/\bprocess\.env\.([A-Z][A-Z0-9_]*)\s*=(?!=)/g)) out.add(m[1]);
  for (const m of t.matchAll(/\{[^{}]*\.\.\.\s*(?:process\.)?env\b[^{}]*\}/g)) {
    for (const k of m[0].matchAll(/(?<![\w$.])([A-Z][A-Z0-9_]*)\s*:/g)) out.add(k[1]);
  }
  if (/\b(?:spawn|spawnSync|execFile|execFileSync|fork|exec|execSync)\s*\(/.test(t)) {
    for (const m of t.matchAll(/(?<![\w$.?])([A-Z][A-Z0-9_]*)\s*:(?!:)/g)) out.add(m[1]);
    for (const m of t.matchAll(/[\w$\])]\.([A-Z][A-Z0-9_]*)\s*=(?![=>])/g)) out.add(m[1]);
  }
  return out;
}

/** A spec among the package's files, when one came: spec.json, or a
 *  *.spec.json, holding jobs. */
export function specOf(files, texts) {
  for (const f of files) {
    if (!/(^|\/)(?:[\w.-]+\.)?spec\.json$/.test(f.path) || texts[f.path] == null) continue;
    try { const doc = JSON.parse(texts[f.path]); if (Array.isArray(doc?.jobs)) return { path: f.path, doc }; } catch { /* not a spec */ }
  }
  return null;
}

/** The scripts a job starts: each file a run command names, and each script
 *  a SKILL.md tells whoever runs the step to start (`node <path>/<name>.mjs`),
 *  matched to the package's scripts by name. */
export function entryScripts(files, texts, runtime, manifest) {
  const out = runCommandFiles(files, runtime, manifest);
  const scripts = files.filter(isScript).map((f) => f.path);
  for (const f of files.filter((x) => /^skills\/[^/]+\/SKILL\.md$/.test(x.path))) {
    for (const m of String(texts[f.path] ?? "").matchAll(/\b(?:node|python3?|bash|sh)\s+(\S+\.(?:mjs|cjs|js|py|sh))\b/g)) {
      const name = m[1].split("/").pop();
      for (const p of scripts) if (p.split("/").pop() === name) out.add(p);
    }
  }
  return out;
}

/** Every environment variable a script reads that the agent's own files do
 *  not declare and the host does not place. A script's own entry point runs
 *  only when the script is started itself, so the entry point of a script no
 *  run command and no SKILL.md starts is left out (the shared caller's, say);
 *  every other line is the job at work. A
 *  credential no system binds is claims-match-code's finding, and a provider
 *  key or a retired model variable is model-in-code's, so neither is said
 *  twice. Nothing is said without the declarations to hold it to. */
export function undeclaredSettingFindings(files, texts, { descriptor = null, runtime = null, manifest = null } = {}) {
  if (!descriptor && !runtime) return [];
  const spec = specOf(files, texts);
  const skills = files.filter((f) => /^skills\/[^/]+\/SKILL\.md$/.test(f.path)).map((f) => texts[f.path]);
  const declared = declaredSettings({ runtime, descriptor, spec: spec?.doc ?? null, skills });
  const scripts = files.filter(isScript).filter((f) => texts[f.path] != null);
  for (const f of scripts) for (const n of envSets(texts[f.path])) declared.add(n);
  const run = entryScripts(files, texts, runtime, manifest);
  const said = (n) => (descriptor && CREDENTIAL_ENV.test(n) && !/^(MESH|AGENT)_/.test(n) && !PROVIDER_KEY_RE.test(n))
    || PROVIDER_KEY_RE.test(n) || OLD_MODEL_VARS_RE.test(n);
  const runNames = runSettingNames({ descriptor, spec: spec?.doc ?? null });
  const where = ["a system's credential or setting in agent-runtime-requirements.json"];
  if (spec) where.push(`anything in ${spec.path}`);
  where.push("a name the host places");
  const out = [];
  for (const f of scripts) {
    const text = texts[f.path];
    const main = run.has(f.path) ? null : mainBlock(text);
    for (const [n, line] of envReads(text, f.path)) {
      if (declared.has(n) || said(n)) continue;
      if (main && line >= main[0] && line <= main[1]) continue;
      if (runNames.has(n)) {
        out.push(finding("undeclared-setting", f.path, line,
          `${f.path} reads ${n} from the environment, and ${n} is a run config setting: a run setting arrives in the job's run-context.json, as the member run_config, never as a variable (Common Agent 0.41.0, Section 5.8).`,
          `The value the job was started with never reaches the script: it reads whatever the host's environment holds, or nothing, so a run config the caller or the owner chose changes nothing. Read it from run_config in the job's run-context.json.`));
        continue;
      }
      const address = /(_API|_URL|_URI|_ENDPOINT|_BASE|_HOST|_ADDRESS|_ORIGIN)$/.test(n);
      out.push(finding("undeclared-setting", f.path, line,
        `${f.path} reads ${n}, and nothing declares it: not ${where.slice(0, -1).join(", not ")}, and not ${where.at(-1)}.`,
        `No install places ${n}, so once deployed the script reads nothing there${address ? " and reaches no service at that address" : ""}; the job works only on a host somebody set it on by hand, and the declarations do not tell the owner it is needed. Declare it as a setting of the system it belongs to, or stop reading it.`));
    }
  }
  return out;
}

/** New access in a declaration, read off the diff. */
export function declarationChangeFindings(read, texts) {
  const out = [];
  if (read?.change?.scope !== "diff") return out;
  const scriptsChanged = read.change.files.some((d) => (read.files.find((f) => f.path === d.path)?.role === "script") && (d.lines.length || d.removed));
  for (const d of read.change.files) {
    if (!["agent-descriptor.json", "agent-runtime-requirements.json"].includes(d.path)) continue;
    const text = texts[d.path];
    if (text == null) continue;
    const lines = lineList(text);
    for (const n of d.lines) {
      const m = /"access"\s*:\s*"(write|admin|trigger)"/.exec(lines[n - 1] ?? "");
      if (!m) continue;
      let sys = null;
      for (let i = n - 1; i >= 0 && i >= n - 12 && !sys; i--) { const s = /"name"\s*:\s*"([^"]+)"/.exec(lines[i]); if (s) sys = s[1]; }
      out.push(finding("declaration-change", d.path, n,
        `The change gives the package ${m[1]} access to ${sys ?? "a system"}${scriptsChanged ? "" : ", and no script in the change uses it"}.`,
        `Every install of the next version can ${m[1]} ${sys ?? "that system"}${scriptsChanged ? "" : " although no code was changed to need it"}. Whether it may is the security reviewer's call; this is so the change is not missed.`));
    }
  }
  return out;
}

/** Credential values found in the files, and files that look like
 *  credentials; read-change.mjs left both out of everything it wrote. */
export function credentialFindings(read) {
  const out = [];
  const consequence = "Everyone who receives the package, and every record and log that copies it, holds the credential, and it cannot be rotated without a new version. A package names a credential and the install places it; this review left the value out of its records.";
  for (const f of read.files ?? []) {
    for (const n of f.credential_lines ?? []) {
      out.push(finding("credential-in-package", f.path, n, `${f.path} carries what looks like a credential value on line ${n}.`, consequence));
    }
  }
  for (const p of read.withheld ?? []) {
    out.push(finding("credential-in-package", p, 1, `${p} looks like a credential file, and it came with the package.`, consequence));
  }
  return out;
}

/** Whether a finding falls inside the change. Without a diff the whole
 *  package is the change. A declaration that changed at all is in it. */
export function inChange(f, read) {
  if (read?.change?.scope !== "diff") return true;
  const d = read.change.files.find((x) => x.path === f.place.file);
  if (!d) return false;
  if (f.place.line == null) return true;
  if (read.files.find((x) => x.path === d.path)?.role === "declaration") return true;
  return d.lines.some((n) => Math.abs(n - f.place.line) <= 0);
}

/** Every house rule over the laid-out package. */
export function checkHouseRules(read, texts) {
  const parse = (p) => { try { return texts[p] ? JSON.parse(texts[p]) : null; } catch { return null; } };
  const descriptor = parse("agent-descriptor.json") ?? parse("descriptor.json");
  const runtime = parse("agent-runtime-requirements.json") ?? parse("install.json");
  const manifest = parse("plugin.json");
  const files = read.files;
  const all = [
    ...credentialFindings(read),
    ...modelFindings(files, texts),
    ...modelSystemFindings(runtime, texts["agent-runtime-requirements.json"] ?? ""),
    ...addressFindings(files, texts),
    ...pieceFindings(files, texts, descriptor),
    ...claimFindings(files, texts, descriptor, runtime, manifest),
    ...undeclaredSettingFindings(files, texts, { descriptor, runtime, manifest }),
    ...declarationChangeFindings(read, texts),
  ];
  const inside = [], outside = [];
  for (const f of all) (inChange(f, read) ? inside : outside).push(f);
  return { house_rules: "v1", rules: RULES, findings: inside, outside_the_change: outside, warnings: addressWarnings(files, texts) };
}

/** The laid-out package's texts, by path. */
export function textsOf(dir, read) {
  const out = {};
  for (const f of read.files) {
    const p = join(dir, f.path);
    if (f.lines != null && existsSync(p)) out[f.path] = readFileSync(p, "utf8");
  }
  return out;
}

const thisFile = process.argv[1] ? process.argv[1].replace(/\\/g, "/").split("/").pop() : "";
if (thisFile && import.meta.url.endsWith(thisFile)) {
  const { RECORDS } = process.env;
  if (!RECORDS) { console.error("RECORDS is required"); process.exit(2); }
  const read = JSON.parse(readFileSync(join(RECORDS, "read.json"), "utf8"));
  const result = checkHouseRules(read, textsOf(read.laid_out, read));
  writeFileSync(join(RECORDS, "house-rules.json"), JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify({ ok: true, code: 0, findings: result.findings.length, outside: result.outside_the_change.length }));
}
