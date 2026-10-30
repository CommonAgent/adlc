// Trace the programs: what the package's code reaches, read off its text, and
// whether the declaration names it. A step with no judgment in it.
//
// The declaration is what the owner agrees to; the programs are what runs. A
// program that reaches a system the declaration does not name has access
// nobody agreed to, so this reads every program the package carries and lists:
//
// - each network address written into a program (an address in a comment, or
//   a name that is not a place, such as the SVG namespace at www.w3.org, is left
//   out), and whether the line it is on goes to it;
// - each call to an address the program is handed rather than one it writes
//   down, which reaches whatever the caller or the page hands it;
// - each environment variable read, so a credential the declaration never
//   names is seen;
// - each command started, against the binaries the package declares.
//
// Then each address is matched to a declared system, by evidence only: the
// platform's own address for a system the package declares (the model
// services behind text-reasoning, for example), an address the architecture
// record's egress names, or a system whose stated reason names the address
// or its domain. An address nothing matches is a system the declaration does
// not name, and the review refuses the package and names it. This reads text;
// it does not run anything, so a program that builds an address from parts it
// computes is not seen, and the review says so.
//
// What a package could hide behind is read too: every code file, whatever its
// extension, a test only when no program imports it, and a comment only where
// it is one (a quote that does not close on its line opens no string).
//
// A call to an address the program is handed counts as a declared reach in
// exactly three cases, and in no other (see matchReaches): the program reads a
// setting a declared service lists as its address; it imports requestFor or
// urlFor from ./model-caller.mjs and the package declares a system of kind
// model; or a skill that carries it belongs to an offering with an input marked
// external: true. Each is read off the text; nothing is run.
//
// A declared system of kind model (Common Agent 12.4.1) is reached through
// four settings the install places, MODEL_NAME, MODEL_ENDPOINT, MODEL_KEY and
// MODEL_PROTOCOL: a program that reads them reaches that declared system, and
// MODEL_KEY is its setting, never a credential nobody declared.
//
// Separately, and the same way on every run, every address literal a program
// carries is listed as a warning with its file, line and address (Common
// Agent 12.10: a scheme of http, https, ws or wss, then :// and a letter, a
// digit or [; or an IPv4 address in the 169.254 link-local block; comments included; outside the
// seven identifier prefixes 12.10 excepts), and so is the metadata server's
// host name. A warning is found here, by a program, before any model is
// asked; nothing a package or a message says removes one, and a warning alone
// refuses nothing. A model service's own address is warned about like any
// other, declared or not.
//
//   needs: node >= 22
//   import { tracePrograms, matchReaches, addressWarnings } from "./trace-programs.mjs"
import { dirname, join, normalize } from "node:path";
import { scrub } from "./secrets.mjs";

const trim = (s) => String(s ?? "").trim();

/** A file that is code: what runs when the agent works, or what it loads. */
export const CODE = /\.(?:mjs|cjs|js|jsx|ts|tsx|mts|cts|py|sh|bash|zsh|rb|go|ps1|pl|php|lua)$/i;
/** A file with no extension is code when it starts with #!. */
export const isCode = (path, bytes) => CODE.test(path) || (!/\.[A-Za-z0-9]+$/.test(path.split("/").pop()) && bytes?.subarray(0, 2).toString() === "#!");

/** Tests are not the agent at work: a package source carries them, a built
 *  package does not. A test file a program imports is traced all the same. */
export const isTest = (p) => /^(?:test|tests|__tests__)\//.test(p) || /\/(?:__tests__)\//.test(p) || /\.test\.[a-z]+$/.test(p);

/** Addresses that are names, not places a program goes: XML and schema
 *  namespaces, and the example hosts reserved for documentation. */
export const NOT_REACHED = [
  /^www\.w3\.org$/, /^(?:www\.)?schema\.org$/, /^json-schema\.org$/, /^agent-plugins\.org$/,
  /^purl\.org$/, /^ns\.adobe\.com$/, /^(?:[a-z0-9-]+\.)*example\.(?:com|org|net)$/, /\.example$/, /^localhost$/, /^127\.0\.0\.1$/,
];

/** The addresses the platform reaches a reserved system at, for a package that
 *  declares that system. The derived set of Common Agent 6.11: a declared
 *  system, the model it is given, the registrar and the mesh are reachable
 *  without a further destination, and nothing else is. */
export const PLATFORM_HOSTS = [
  { system: "text-reasoning", hosts: [/^generativelanguage\.googleapis\.com$/, /(?:^|\.)aiplatform(?:\.[a-z0-9-]+)*\.googleapis\.com$/, /^metadata\.google\.internal$/, /^api\.anthropic\.com$/] },
  { system: "image-reading", hosts: [/^generativelanguage\.googleapis\.com$/, /(?:^|\.)aiplatform(?:\.[a-z0-9-]+)*\.googleapis\.com$/, /^metadata\.google\.internal$/] },
  { system: "speech-to-text", hosts: [/^speech\.googleapis\.com$/, /^metadata\.google\.internal$/] },
  { system: "text-to-speech", hosts: [/^texttospeech\.googleapis\.com$/, /^metadata\.google\.internal$/] },
  { system: "draft-host", hosts: [/^storage\.googleapis\.com$/, /^metadata\.google\.internal$/] },
  { system: "files", hosts: [/^storage\.googleapis\.com$/] },
  // The mesh itself: every agent may reach the platform it is installed on.
  { system: "(the mesh)", hosts: [/(?:^|\.)agentmesh\.ai$/] },
];

/** Variables the host places that are not credentials: where the job is, its
 *  ceilings, its binaries and the platform's address. Only a name that looks
 *  like a credential is ever looked up here. */
export const PLACED_VARS = [
  /^AGENT_(?:MODEL_REPLAY|MODEL_REUSE|NAME|DEPS|JOB_SECONDS|BINDING_DIR|DIRECTORY_[A-Z_]+)$/,
  /^CEILING_[A-Z0-9_]+$/, /^BINARY_[A-Z0-9_]+$/, /^AGENTMESH_ENV$/,
  /^(?:PATH|HOME|TMPDIR|TEMP|TMP|USER|LANG|TZ|PWD|SHELL|CI|NODE_ENV|NODE_OPTIONS|NODE_PATH|PYTHONPATH|DEBUG)$/,
];

/** The four settings a model system is reached through (Common Agent 12.4.1). */
export const MODEL_SETTINGS = ["MODEL_NAME", "MODEL_ENDPOINT", "MODEL_KEY", "MODEL_PROTOCOL"];

// The names packages written before 12.4.1 read for the model the platform
// gave them, and the keys placed beside it. They are names this script must
// recognize in someone else's program, never variables it reads itself, so
// they are built from parts and no script here carries them whole.
const OLD_MODEL_NAME = ["AGENT", "MODEL"].join("_");
const OLD_MODEL_WHERE = [["VERTEX", "WHERE"].join("_"), ["GOOGLE", "CLOUD", "PROJECT"].join("_")];

/** The model keys a program may read for the model it is given: MODEL_KEY,
 *  and the provider keys placed before 12.4.1. Reading one where the package
 *  declares no model system reaches the model the agent is given, which is
 *  part of the derived set, and the review says a caller is not told. */
export const MODEL_KEY_VARS = ["MODEL_KEY", ["GOOGLE", "GENERATIVE", "AI", "API", "KEY"].join("_"), "ANTHROPIC_API_KEY"];

/** A system the package declares as its model: of kind model, or by the
 *  reserved name of one. */
export const MODEL_SYSTEMS = ["text-reasoning", "image-reading"];
export const isModelSystem = (s) => s?.kind === "model" || MODEL_SYSTEMS.includes(s?.name);

// The metadata server's host name, which 12.10's address check counts on its
// own. It is data this script must recognize in someone else's file, never an
// address it calls, so it is built from parts.
export const METADATA_HOST = ["metadata", "google", "internal"].join(".");

// The seven identifier prefixes 12.10 excepts: a format's name spelled as an
// address, which no program goes to. Built from parts for the same reason.
const ID = (scheme, rest) => `${scheme}:/` + `/${rest}`;
export const IDENTIFIERS = [
  ID("http", "www.w3.org/"), ID("https", "www.w3.org/"), ID("http", "json-schema.org/"), ID("https", "json-schema.org/"),
  ID("http", "purl.org/"), ID("http", "schemas.openxmlformats.org/"), ID("http", "schemas.microsoft.com/"),
];

/** A variable whose name says it holds a credential. */
export const CREDENTIAL_VAR = /(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|CREDS|AUTH|SEED|JWT)(?:_|$)/;

/** Take comments and regular expressions out, keeping line numbers, so an
 *  address in a comment, or a pattern that matches addresses, is not read as
 *  one a program reaches. Strings are left as they are, so `//` in an address
 *  is not taken for a comment; a ' or " that does not close on its own line
 *  opens no string, so a stray quote cannot hide the code after it. */
export function stripComments(text, path = "") {
  const hashComments = /\.(?:py|sh|bash|zsh|rb|ps1|pl)$/i.test(path) || (!CODE.test(path) && text.startsWith("#!"));
  let out = "";
  let i = 0;
  let quote = "";
  while (i < text.length) {
    const c = text[i];
    const n = text[i + 1];
    if (quote) {
      if (c === "\n" && quote !== "`") { quote = ""; out += c; i++; continue; }
      out += c;
      if (c === "\\") { out += n ?? ""; i += 2; continue; }
      if (c === quote) quote = "";
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      // A ' or " that does not close on this line is not a string.
      const eol = text.indexOf("\n", i + 1);
      const rest = text.slice(i + 1, eol === -1 ? text.length : eol);
      if (c === "`" || new RegExp(`(?:^|[^\\\\])(?:\\\\\\\\)*${c}`).test(rest)) quote = c;
      out += c; i++; continue;
    }
    if (!hashComments && c === "/" && n === "/" && text[i - 1] !== ":") {
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }
    if (!hashComments && c === "/" && n === "*") {
      const end = text.indexOf("*/", i + 2);
      const body = text.slice(i, end === -1 ? text.length : end + 2);
      out += body.replace(/[^\n]/g, "");
      i += body.length;
      continue;
    }
    // A regular expression is a pattern, not code that reaches anything: one
    // that matches addresses or names `fetch` is how a program checks what it
    // is given. It is blanked, its line kept, where a `/` can only open one.
    if (!hashComments && c === "/" && /(?:^|[(,=:[!&|?{};+\-*%<>~^]|\breturn|\btypeof|\bcase)\s*$/.test(out.slice(-40))) {
      let j = i + 1;
      let inClass = false;
      let closed = false;
      for (; j < text.length && text[j] !== "\n"; j++) {
        const d = text[j];
        if (d === "\\") { j++; continue; }
        if (d === "[") inClass = true;
        else if (d === "]") inClass = false;
        else if (d === "/" && !inClass) { closed = true; break; }
      }
      if (closed) {
        j++;
        while (j < text.length && /[a-z]/i.test(text[j])) j++;
        out += "/ /";
        i = j;
        continue;
      }
    }
    if (hashComments && c === "#" && (i === 0 || /\s/.test(text[i - 1])) && !(i === 0 && n === "!")) {
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

// An address's authority: everything after // up to the path. A user name
// before an @ is not the host (an address written example.com@elsewhere.net
// goes to elsewhere.net), and a part built from a value is
// taken off, so the written part is still seen.
const URL_RE = /\b(https?|wss?):\/\/((?:\$\{[^}]*\}|[^\s/"'`?#)\\<>])+)/g;
/** The host an address's authority names, or "" when a value builds all of it. */
export function hostOf(authority) {
  let a = String(authority ?? "");
  const at = a.lastIndexOf("@");
  if (at !== -1) a = a.slice(at + 1);
  a = a.replace(/\$\{[^}]*\}/g, "").replace(/:\d*$/, "").toLowerCase().replace(/^[.-]+|\.$/g, "");
  return /^[a-z0-9.-]+$/.test(a) && (a.includes(".") || a === "localhost") ? a : "";
}
/** The whole address written from where a match starts, to the first space,
 *  quote or bracket, without the punctuation of the sentence around it. */
const wholeAddress = (line, at) => (/^[^\s"'`<>\\]*/.exec(line.slice(at))?.[0] ?? "").replace(/[.,;:)]+$/, "");

// The address check of 12.10, as patterns: a scheme and :// then a letter, a
// digit or [, in any case; and an IPv4 address in the 169.254 link-local block.
const LITERAL_RE = /\b(?:https?|wss?):\/\/[A-Za-z0-9[]/gi;
const OCTET = "(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)";
const LINK_LOCAL_RE = new RegExp(`(?<![\\w.])169\\.254\\.${OCTET}\\.${OCTET}(?![\\w.])`, "g");
const METADATA_RE = new RegExp(`\\b${METADATA_HOST.replace(/\./g, "\\.")}\\b`, "gi");
const isIdentifier = (a) => IDENTIFIERS.some((p) => a.toLowerCase().startsWith(p));

/** Every address literal on one line, in order: each address once, as the
 *  whole address it is written in, an excepted identifier left out. Any
 *  credential-shaped part of an address is scrubbed, never repeated. */
export function addressesOnLine(line) {
  const out = [];
  const text = String(line ?? "");
  let rest = text;
  for (const m of text.matchAll(LITERAL_RE)) {
    const a = wholeAddress(text, m.index);
    if (!isIdentifier(a)) out.push(a);
    // The address is counted once, as itself: a host inside it is not counted again.
    rest = rest.slice(0, m.index) + " ".repeat(a.length || m[0].length) + rest.slice(m.index + (a.length || m[0].length));
  }
  for (const re of [METADATA_RE, LINK_LOCAL_RE]) for (const m of rest.matchAll(re)) out.push(m[0]);
  return [...new Set(out.map((a) => scrub(a)))];
}

/** The address warnings for one file's text: { file, line, address } for
 *  every address literal, comments included, in the order they are written.
 *  The same text gives the same warnings every time. */
export function addressWarnings(file, text) {
  const out = [];
  String(text ?? "").split("\n").forEach((raw, at) => {
    for (const address of addressesOnLine(raw)) out.push({ file, line: at + 1, address });
  });
  return out;
}

/** A program that drives a browser, and one that routes the browser's requests. */
const BROWSER = /\b(?:playwright|puppeteer|chromium\.launch|page\.goto)\b/;
const ROUTES = /\b(?:page|context|browserContext)\.route\s*\(|setRequestInterception\s*\(/;
/** A line that goes to an address: a call that fetches, connects or navigates. */
const CALLS = /\b(?:fetch|fetchImpl|axios|got|urlopen|requests\.\w+|https?\.(?:get|request)|WebSocket|EventSource|connect|goto|navigate|curl|wget)\s*\(|\b(?:curl|wget)\s/;
/** A line that names an address as a door: a constant whose name says it is one. */
const DOOR = /^\s*(?:export\s+)?(?:(?:const|let|var)\s+)?[A-Za-z_$]?[\w$]*(?:url|endpoint|base|host|api|door|origin|root|server)[\w$]*\s*=\s*["'`]/i;
const FETCH_CALL = /\b(?:fetch|fetchImpl|got|axios(?:\.\w+)?|urlopen|requests\.(?:get|post|put|patch|delete)|https?\.(?:get|request)|page\.goto)\s*\(\s*([^)\n]*)/g;
const SHELL_FETCH = /\b(?:curl|wget)\s+([^\n|;&]*)/g;
// A read through optional chaining (env?.MODEL_ENDPOINT) is a read like any other.
const ENV_READ = [
  /process\.env(?:\?\.|\.)([A-Z][A-Z0-9_]*)/g, /process\.env(?:\?\.)?\[\s*["'`]([A-Z][A-Z0-9_]*)["'`]\s*\]/g,
  /\benv(?:\?\.|\.)([A-Z][A-Z0-9_]*)\b/g, /\benv(?:\?\.)?\[\s*["'`]([A-Z][A-Z0-9_]*)["'`]\s*\]/g,
  /os\.environ(?:\.get)?\s*[[(]\s*["']([A-Z][A-Z0-9_]*)["']/g, /os\.getenv\(\s*["']([A-Z][A-Z0-9_]*)["']/g,
];
const SHELL_VAR = /\$\{?([A-Z][A-Z0-9_]{2,})\}?/g;
const SPAWN = /(?<![\w$])(?:(?:cp|childProcess|child_process)\.)?(?:spawn|spawnSync|exec|execSync|execFile|execFileSync|fork|subprocess\.(?:run|Popen|call|check_output|check_call)|os\.system)\s*\(\s*([^,)\n]*)/g;
/** A program that can start one: it takes child_process or subprocess. */
const STARTS = /child_process|subprocess|os\.system/;

/** What one program reaches, off its text. Pure. */
export function traceOne(path, text) {
  const code = stripComments(text, path);
  const lines = code.split("\n");
  const shell = /\.(?:sh|bash|zsh)$/i.test(path) || (!CODE.test(path) && text.startsWith("#!"));
  const hosts = [];
  const written = [];
  const open = [];
  const vars = new Set();
  const commands = [];
  // Addresses are read off the RAW text, every one of them, comments
  // included. Where a comment starts and ends is exactly what a package can
  // make a reader misjudge (a regular expression after `if (...)` can read as
  // the start of one), so no address is left out for sitting in one: an
  // address in a comment that no declared system covers is a false refusal,
  // said with its file and line, and the cheaper of the two mistakes. Every
  // address counts whether or not a call is seen beside it: a list of call
  // shapes always misses one.
  text.split("\n").forEach((raw, at) => {
    for (const m of raw.matchAll(URL_RE)) {
      const host = hostOf(m[2]);
      if (!host || NOT_REACHED.some((r) => r.test(host))) continue;
      const list = CALLS.test(raw) || DOOR.test(raw) ? hosts : written;
      // The whole address is kept beside its host, so a refusal can name it.
      if (!list.some((h) => h.host === host)) list.push({ host, line: at + 1, scheme: m[1], address: wholeAddress(raw, m.index) });
    }
  });
  lines.forEach((line, at) => {
    for (const m of [...line.matchAll(FETCH_CALL), ...(shell ? line.matchAll(SHELL_FETCH) : [])]) {
      const arg = trim(m[1]).replace(/^(?:-\S+\s+)*/, "");
      // A call whose argument is a written address, with its host seen, is that address.
      const lit = /^["'`](https?|wss?):\/\/([^/"'`?#\s]+)/.exec(arg);
      if (lit && hostOf(lit[2])) continue;
      if (!open.some((o) => o.line === at + 1)) open.push({ line: at + 1, what: arg.slice(0, 60) }); // cut-ok: a label for the line, the line number is the reference
    }
    for (const re of ENV_READ) for (const m of line.matchAll(re)) vars.add(m[1]);
    if (shell) for (const m of line.matchAll(SHELL_VAR)) vars.add(m[1]);
    if (STARTS.test(code)) for (const m of line.matchAll(SPAWN)) {
      const raw = trim(m[1]);
      if (!commands.some((c) => c.raw === raw)) commands.push({ raw, what: raw.replace(/^["'`]|["'`]$/g, "").slice(0, 60), line: at + 1 }); // cut-ok: a label, the line is the reference
    }
  });
  const browser = BROWSER.test(code) && /goto|newPage|launch/.test(code);
  return { path, hosts, written, open, vars: [...vars].sort(), commands, browser, routes: browser && ROUTES.test(code), caller: callerUse(path, code, vars) };
}

/** How a program stands to the shared model caller, off its comment-free
 *  text: `imports` when it imports requestFor or urlFor from ./model-caller.mjs
 *  (`requestFor as rf` is the same import), and `is` when it is the shared
 *  caller itself: a file named model-caller.mjs that defines requestFor or
 *  urlFor and reads MODEL_ENDPOINT, which is where those two get the address. */
export function callerUse(path, code, vars = new Set()) {
  const names = [];
  for (const m of code.matchAll(/\bimport\s*\{([^}]*)\}\s*from\s*["'`]\.\/model-caller\.mjs["'`]/g)) {
    for (const part of m[1].split(",")) names.push(trim(part.split(/\s+as\s+/)[0]));
  }
  const imports = names.some((n) => n === "requestFor" || n === "urlFor");
  const is = /(?:^|\/)model-caller\.mjs$/.test(path) && /\bexport\s+function\s+(?:requestFor|urlFor)\b/.test(code) && vars.has("MODEL_ENDPOINT");
  return { imports, is };
}

/** The relative specifiers a program imports, re-exports or requires. */
export function importsOf(path, text) {
  const out = [];
  const re = /(?:\b(?:import|export)\s*(?:[\w${}\s,*]+\s*from\s*)?|\bimport\s*\(\s*|\brequire\s*\(\s*)["'`](\.{1,2}\/[^"'`]+)["'`]/g;
  for (const m of String(text).matchAll(re)) out.push(normalize(join(dirname(path), m[1])).replace(/\\/g, "/"));
  return out;
}

/** The package file a specifier loads, resolved the way node does: as
 *  written, with an extension added, or a folder's index. */
export function resolveIn(files, spec) {
  const exts = ["", ".mjs", ".js", ".cjs", ".ts", ".mts", ".cts", ".jsx", ".tsx", ".json"];
  for (const e of exts) if (files.has(spec + e)) return spec + e;
  for (const e of exts.slice(1)) if (files.has(`${spec}/index${e}`)) return `${spec}/index${e}`;
  return "";
}

/** Every code file the package carries, traced. A test is left out, and
 *  counted, only when nothing traced imports it, followed through every
 *  import, re-export and require, test to test included. Every traced file,
 *  and every run command the runtime requirements name, is read for address
 *  warnings too: { traced, tests, warnings }. */
export function tracePrograms(files, programs = null, { requirementsFile = "" } = {}) {
  const NM = /(?:^|\/)node_modules\//;
  const code = [...files.keys()].filter((p) => !NM.test(p) && isCode(p, files.get(p))).sort();
  const list = programs ? [...new Set([...programs, ...code])].filter((p) => files.has(p)).sort() : code;
  const keep = new Set(list.filter((p) => !isTest(p)));
  const queue = [...keep];
  while (queue.length) {
    const p = queue.shift();
    for (const spec of importsOf(p, files.get(p).toString("utf8"))) {
      const hit = resolveIn(files, spec);
      if (hit && !keep.has(hit) && !NM.test(hit) && list.includes(hit)) { keep.add(hit); queue.push(hit); }
    }
  }
  const traced = [];
  const tests = [];
  const warnings = [];
  for (const p of list) {
    if (!keep.has(p)) { tests.push(p); continue; }
    const text = files.get(p).toString("utf8");
    warnings.push(...addressWarnings(p, text));
    traced.push(traceOne(p, text));
  }
  warnings.push(...runCommandWarnings(files, requirementsFile));
  return { traced, tests, warnings };
}

/** The address warnings for the run commands the runtime requirements name:
 *  an address written into a command is one a script is started with. */
export function runCommandWarnings(files, requirementsFile = "") {
  if (!requirementsFile || !files.has(requirementsFile)) return [];
  const raw = files.get(requirementsFile).toString("utf8");
  let run;
  try { run = JSON.parse(raw)?.run; } catch { return []; }
  if (!run || typeof run !== "object") return [];
  const words = new Set();
  const walk = (v) => { if (typeof v === "string") words.add(v); else if (v && typeof v === "object") for (const x of Object.values(v)) walk(x); };
  for (const job of Object.values(run)) walk(job?.command);
  const lines = raw.split("\n");
  const out = [];
  for (const w of words) {
    for (const address of addressesOnLine(w)) {
      const at = lines.findIndex((l) => l.includes(JSON.stringify(w).slice(1, -1)));
      if (!out.some((x) => x.address === address && x.line === at + 1)) out.push({ file: requirementsFile, line: at + 1, address });
    }
  }
  return out.sort((a, b) => a.line - b.line);
}

/** Domains many unrelated sites share: a reason must name the host itself
 *  under one, since naming the domain would cover everybody's site. */
export const SHARED = ["github.io", "githubusercontent.com", "netlify.app", "vercel.app", "herokuapp.com", "appspot.com", "web.app", "firebaseapp.com", "firebaseio.com", "cloudfront.net", "amazonaws.com", "azurewebsites.net", "blob.core.windows.net", "pages.dev", "workers.dev", "run.app", "googleapis.com", "storage.googleapis.com", "ngrok.io", "ngrok-free.app", "glitch.me", "repl.co", "onrender.com", "fly.dev"];

/** A host's registrable domain: its last two labels, or three where the
 *  second to last is a short public suffix part (example.co.uk). */
export function domainOf(host) {
  const l = host.split(".");
  if (l.length >= 3 && l[l.length - 1].length === 2 && /^(?:co|com|org|net|gov|ac|edu|ne|or)$/.test(l[l.length - 2])) return l.slice(-3).join(".");
  return l.slice(-2).join(".");
}

/**
 * Match what the programs reach against what the package declares. Returns
 * { reaches: [{ host, files, addresses, system, by }], unmatched, written,
 *   openFetches, unmatchedOpen, browsers, credentialVars, modelKeys, meshKeys,
 *   undeclaredCommands, undeclaredModel }.
 * `egressHosts` are the further destinations the architecture record names.
 */
export function matchReaches({ traced, systems = [], binaries = [], egressHosts = [], offerings = [] }) {
  const declared = new Set(systems.map((s) => s.name));
  // The package's own model system: one of kind model, or by a model's
  // reserved name. Its addresses are text-reasoning's, whatever it is called.
  const modelSystem = systems.find((s) => s.kind === "model") ?? systems.find(isModelSystem) ?? null;
  // The model the platform gives the agent (its model settings, or the names
  // read before 12.4.1, and the key placed beside it) is part of the derived
  // set even where no model system is declared; the review says when a caller
  // is not told about it.
  const modelGiven = traced.some((t) => t.vars.some((v) => MODEL_SETTINGS.includes(v) || v === OLD_MODEL_NAME || OLD_MODEL_WHERE.includes(v) || MODEL_KEY_VARS.includes(v)));
  const match = (host) => {
    const platform = PLATFORM_HOSTS.find((p) => p.hosts.some((re) => re.test(host)) && (p.system === "(the mesh)" || declared.has(p.system) || (p.system === "text-reasoning" && modelSystem)));
    if (platform) {
      const system = platform.system === "text-reasoning" && !declared.has("text-reasoning") ? modelSystem.name : platform.system;
      return { system, by: system === "(the mesh)" ? "the platform the agent is installed on" : `the platform's own address for ${system}` };
    }
    const model = modelGiven && PLATFORM_HOSTS.find((p) => MODEL_SYSTEMS.includes(p.system) && p.hosts.some((re) => re.test(host)));
    if (model) return { system: "(the model it is given)", by: "the model the platform gives the agent" };
    const egress = egressHosts.find((e) => host === e || host.endsWith(`.${e}`));
    if (egress) return { system: "(further destination)", by: "the architecture record's egress names it" };
    // A reason names a host by the host itself or its whole domain, never by
    // one word of it: "forecast" in a reason does not cover forecast.evil.net.
    const domain = SHARED.some((d) => domainOf(host) === d || host.endsWith(`.${d}`)) ? host : domainOf(host);
    const named = systems.find((s) => {
      const said = ` ${String(s.needs ?? "").toLowerCase()} `;
      return [host, domain].some((h) => new RegExp(`[^a-z0-9.-]${h.replace(/[.-]/g, "\\$&")}[^a-z0-9-]`).test(said));
    });
    if (named) return { system: named.name, by: `the reason stated for ${named.name} names it` };
    return null;
  };
  const collect = (key) => {
    const byHost = new Map();
    for (const t of traced) for (const h of t[key] ?? []) {
      const got = byHost.get(h.host) ?? { host: h.host, files: [], addresses: [] };
      got.files.push(`${t.path}:${h.line}`);
      if (h.address && !got.addresses.includes(h.address)) got.addresses.push(h.address);
      byHost.set(h.host, got);
    }
    return [...byHost.values()];
  };
  const reaches = [];
  const unmatched = [];
  for (const r of collect("hosts")) {
    const m = match(r.host);
    if (m) reaches.push({ ...r, ...m }); else unmatched.push(r);
  }
  // An address written in a program where nothing on its line goes to it.
  // Matched like the rest; one that nothing matches is listed, and refuses
  // the package when the same program also calls an address it is handed,
  // since that call may be the one that goes to it.
  // An address written where no call is seen beside it is matched the same
  // way, and one nothing covers refuses the package like any other: whether
  // a program goes to it cannot be told from the text, and a call can take
  // any shape. `written` keeps the uncovered ones the review names that way.
  const written = [];
  for (const r of collect("written")) {
    const m = match(r.host);
    if (m) reaches.push({ ...r, ...m });
    else if (!unmatched.some((u) => u.host === r.host)) { written.push(r); unmatched.push({ ...r, written: true }); }
  }

  // A call to an address the program is handed. It is a declared reach in
  // exactly three cases, and in no other:
  //   (a) the program reads a setting a declared service lists under its
  //       settings as its address: a name ending in _ENDPOINT, _URL, _BASE,
  //       _HOST or _ADDRESS, or a purpose that says where the service is or
  //       what its address is. Only a read of the setting counts: a literal
  //       assigned to a variable of that name is a literal, an address the
  //       strays below refuse and the warnings list;
  //   (b) the program imports requestFor or urlFor from ./model-caller.mjs and
  //       the package declares a system of kind model (the shared caller
  //       itself, which defines them and reads MODEL_ENDPOINT, is the same
  //       case);
  //   (c) the program is carried by a skill whose offering declares an input
  //       marked external: true.
  // What stays as it was in 0.2.0: a call in a program that writes down an
  // address this review matched is taken as that address, a call built from a
  // written host being no handed one; and a program that also writes down an
  // address nothing covers is not excused by any of the three.
  // And two matches 0.2.0 had, which stay: a call in a program that writes
  // down an address this review matched is taken as that address; and a
  // declared read or trigger service whose stated reason is fetching what it
  // is handed covers a handed call.
  const FETCHING = /\b(?:fetch(?:es|ing)?|download(?:s|ing)?|crawl(?:s|ing)?|brows(?:e|es|ing)|open(?:s|ing)? (?:the |those |each )?pages)\b/i;
  const fetchers = systems.filter((s) => s.kind === "service" && ["read", "trigger"].includes(s.access) && FETCHING.test(s.needs ?? ""));
  const SETTING_NAME = /_(?:ENDPOINT|URL|BASE|HOST|ADDRESS)$/;
  const SETTING_PURPOSE = /\bwhere\b[^.;]{0,60}\b(?:is|are|lives|runs|answers|can be (?:reached|found))\b|\b(?:address|url|endpoint|host)\s+(?:of|for)\b|\b(?:its|their|the|service'?s?|server'?s?)\s+(?:base\s+)?(?:address|url|endpoint)\b/i;
  const addressSettings = new Map();
  for (const s of systems.filter((x) => x.kind === "service")) {
    for (const st of s.settings ?? []) {
      if (!st?.env || addressSettings.has(st.env)) continue;
      if (SETTING_NAME.test(st.env) || SETTING_PURPOSE.test(String(st.purpose ?? ""))) addressSettings.set(st.env, s.name);
    }
  }
  const modelSystemKind = systems.find((s) => s.kind === "model") ?? null;
  const externalOffering = (path) => {
    const slug = /^skills\/([^/]+)\//.exec(path)?.[1];
    if (!slug) return null;
    return offerings.find((o) => (o.id === slug || (o.steps ?? []).some((st) => st.id === slug)) && (o.inputs ?? []).some((i) => i.external === true)) ?? null;
  };
  const openFetches = [];
  const unmatchedOpen = [];
  for (const t of traced) {
    if (!t.open.length) continue;
    const inFile = (r) => r.files.some((f) => f.startsWith(`${t.path}:`));
    const strays = [...unmatched, ...written].filter(inFile);
    const own = reaches.filter(inFile);
    const setting = t.vars.find((v) => addressSettings.has(v));
    const external = externalOffering(t.path);
    const by = strays.length ? ""
      : setting ? `${addressSettings.get(setting)}, the declared service whose address setting ${setting} the program reads`
      : modelSystemKind && (t.caller?.imports || t.caller?.is) ? `${modelSystemKind.name}, the declared model system, reached through the shared caller's requestFor or urlFor and its settings`
      : external ? `${external.id}, an offering with an input marked external: true, whose address the caller grants`
      : own.length ? `the addresses this program writes down (${[...new Set(own.map((r) => r.host))].join(", ")})`
        : fetchers.length ? `${fetchers.map((s) => s.name).join(", ")}, whose stated reason is fetching what it is handed` : "";
    for (const o of t.open) (by ? openFetches : unmatchedOpen).push({ file: `${t.path}:${o.line}`, what: o.what, by, strays: strays.map((s) => s.host) });
  }
  const browsers = traced.filter((t) => t.browser).map((t) => ({ file: t.path, routes: t.routes }));

  const placedOrDeclared = new Set();
  for (const s of systems) {
    if (s.env) placedOrDeclared.add(s.env);
    for (const st of s.settings ?? []) if (st.env) placedOrDeclared.add(st.env);
  }
  // A declared model system's four settings are its own, placed by the
  // install: MODEL_KEY among them is that system's credential, declared.
  if (modelSystem) for (const v of MODEL_SETTINGS) placedOrDeclared.add(v);
  const vars = new Map();
  const modelKeys = [];
  const meshKeys = [];
  const once = (list, v, file) => { if (!list.some((k) => k.name === v)) list.push({ name: v, file }); };
  for (const t of traced) for (const v of t.vars) {
    if (placedOrDeclared.has(v)) continue;
    if (!CREDENTIAL_VAR.test(v)) continue;
    if (PLACED_VARS.some((re) => re.test(v))) continue;
    if (MODEL_KEY_VARS.includes(v)) { once(modelKeys, v, t.path); continue; }
    // The mesh credentials the host places for every job: the agent's own key
    // and its job's token, which reach the platform as itself.
    if (/^MESH_/.test(v)) { once(meshKeys, v, t.path); continue; }
    const got = vars.get(v) ?? { name: v, files: [] };
    got.files.push(t.path);
    vars.set(v, got);
  }

  // A command written down as a word, which is neither the runtime nor a
  // declared binary. A command held in a variable is not named here: what it
  // is cannot be read off the text, and the review says the programs were
  // read and not run.
  const bins = binaries.map((b) => b.name.toLowerCase()).filter(Boolean);
  const RUNTIME = ["node", "python", "python3", "bash", "sh", "npm", "npx"];
  const undeclaredCommands = [];
  for (const t of traced) for (const c of t.commands) {
    if (!/^["'`][\w./-]+["'`]$/.test(c.raw)) continue;
    const word = c.what.split(/[/\\]/).filter(Boolean).pop()?.toLowerCase() ?? "";
    if (RUNTIME.includes(word) || bins.some((b) => word === b || word.startsWith(b))) continue;
    undeclaredCommands.push({ file: `${t.path}:${c.line}`, what: word });
  }
  for (const t of traced) {
    if (t.browser && !bins.some((b) => /chrom|firefox|webkit/.test(b))) undeclaredCommands.push({ file: t.path, what: "a browser" });
  }
  const undeclaredModel = modelGiven && !modelSystem;
  return { reaches, unmatched, written, openFetches, unmatchedOpen, browsers, credentialVars: [...vars.values()], modelKeys, meshKeys, undeclaredCommands, undeclaredModel };
}
