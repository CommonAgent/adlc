// Check the house rules: the five architecture rules agents keep breaking,
// each checked by reading the package's own files, with no model.
//
// These are the rules the reference names (references/the-house-rules.md),
// and every finding here names a file, a line, a claim and a consequence:
//
//   model-in-code       a model's name or version written into a script, a
//                       skill or a declaration, or a script that calls a
//                       model without reading the configured one;
//   hard-coded-address  an address written into a script where a bound
//                       system belongs;
//   kind-mismatch       a delivered piece whose media type is not its
//                       declared kind, or a kind that says nothing (a bare
//                       application/json);
//   undeclared-output   a piece delivered under a name no output declares;
//   claims-match-code   a record, a credential or a `how` the declarations
//                       state and the code does not do, or the other way
//                       round.
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
  "model-in-code": "no model name or version in code; scripts read the configured model through the shared caller",
  "hard-coded-address": "no address hard-coded where a bound system belongs",
  "kind-mismatch": "every delivered piece matches its declared kind",
  "undeclared-output": "no undeclared outputs",
  "claims-match-code": "refusals and records match what the code really does",
  "declaration-change": "a package's declarations are part of the change",
  "credential-in-package": "a credential is named, never carried",
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
// model. They are the binding's wire, inside the shared caller, and not an
// address a bound system should hold.
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
const PROVIDER_KEYS = new Set(["GOOGLE_GENERATIVE_AI_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"]);
const CALLS_A_MODEL = /\b(callModel|askModel|askJson|lookJson)\s*\(|from\s+["']\.\/(caller|model|look|vertex)\.m?js["']/;

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
            : `This script runs ${name} whatever the install configured, so changing the model is a new version rather than a setting, and the day ${name} is retired the job fails (Brand reader answered 404 that way). Read the model from TEXT_MODEL or AGENT_MODEL through the shared caller.`));
      }
    }
    if (isScript(f) && MODEL_HOSTS.test(text) && !/\b(TEXT_MODEL|AGENT_MODEL|[A-Z]+_MODEL)\b/.test(text)) {
      const n = lineOf(text, MODEL_HOSTS);
      out.push(finding("model-in-code", f.path, n,
        `${f.path} calls a model's endpoint and never reads the configured model.`,
        "Whatever model this call reaches was chosen here and not by the install, so a run config or an owner who changes the model changes nothing for this step. The call belongs in the shared caller, which reads TEXT_MODEL or AGENT_MODEL."));
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
  for (const f of scripts) {
    const text = texts[f.path];
    const names = new Map();
    const add = (n, idx) => { if (!names.has(n)) names.set(n, text.slice(0, idx).split("\n").length); };
    for (const m of text.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) add(m[1], m.index);
    for (const m of text.matchAll(/process\.env\[\s*["']([A-Z][A-Z0-9_]*)["']\s*\]/g)) add(m[1], m.index);
    for (const m of text.matchAll(/\benv\.([A-Z][A-Z0-9_]*)/g)) add(m[1], m.index);
    for (const m of text.matchAll(/(?:const|let|var)\s*\{([^}]*)\}\s*=\s*process\.env/g)) for (const n of m[1].split(",")) { const k = trim(n.split(":")[0].split("=")[0]); if (/^[A-Z][A-Z0-9_]*$/.test(k)) add(k, m.index); }
    for (const [n, line] of names) {
      if (!CREDENTIAL_ENV.test(n) || bound.has(n) || PROVIDER_KEYS.has(n) || /^(MESH|AGENT)_/.test(n)) continue;
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
    ...addressFindings(files, texts),
    ...pieceFindings(files, texts, descriptor),
    ...claimFindings(files, texts, descriptor, runtime, manifest),
    ...declarationChangeFindings(read, texts),
  ];
  const inside = [], outside = [];
  for (const f of all) (inChange(f, read) ? inside : outside).push(f);
  return { house_rules: "v1", rules: RULES, findings: inside, outside_the_change: outside };
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
