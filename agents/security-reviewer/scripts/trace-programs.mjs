// Trace the programs: what the package's code reaches, read off its text, and
// whether the declaration names it. A step with no judgment in it.
//
// The declaration is what the owner agrees to; the programs are what runs. A
// program that reaches a system the declaration does not name has access
// nobody agreed to, so this reads every program the package carries and lists:
//
// - each network address written into a program where it is fetched or
//   called (an address in a comment, or a namespace such as
//   http://www.w3.org/2000/svg, is not a reach and is left out);
// - each fetch whose address is not written down, which reaches whatever the
//   caller or the page hands it;
// - each environment variable read, so a credential the declaration never
//   names is seen;
// - each command started, against the binaries the package declares.
//
// Then each address is matched to a declared system, by evidence only: the
// platform's own address for a system the package declares (the model
// services behind text-reasoning, for example), an address the architecture
// record's egress names, or a system whose stated reason names the address.
// An address nothing matches is a system the declaration does not name, and
// the review refuses the package and names it. This reads text; it does not
// run anything, so a program that builds an address from parts it computes
// is not seen, and the review says so.
//
//   needs: node >= 22
//   import { tracePrograms, matchReaches } from "./trace-programs.mjs"

const trim = (s) => String(s ?? "").trim();

/** Tests are not the agent at work: a package source carries them, a built package does not. */
export const isTest = (p) => /(?:^|\/)(?:test|tests|__tests__)\//.test(p) || /\.test\.[a-z]+$/.test(p);

/** Addresses that are names, not places a program goes: XML and schema
 *  namespaces, and example hosts a program prints in a message. */
export const NOT_REACHED = [
  /^www\.w3\.org$/, /^(?:www\.)?schema\.org$/, /^json-schema\.org$/, /^agent-plugins\.org$/,
  /^purl\.org$/, /^ns\.adobe\.com$/, /^example\.(?:com|org|net)$/, /\.example(?:\.com|\.org)?$/, /^localhost$/, /^127\.0\.0\.1$/,
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

/** Variables the host places that are not credentials: where the job is,
 *  which model it runs, its ceilings and the platform's address. */
export const PLACED_VARS = [
  /^AGENT_MODEL(?:_REPLAY|_REUSE)?$/, /^GOOGLE_CLOUD_(?:PROJECT|LOCATION)$/, /^VERTEX_WHERE$/, /^GCE_METADATA_HOST$/,
  /^MESH_[A-Z_]+$/, /^AGENT_[A-Z_]+$/, /^CEILING_[A-Z0-9_]+$/, /^AGENTMESH_ENV$/, /^JOB_[A-Z_]+$/,
  /^(?:PATH|HOME|TMPDIR|TEMP|TMP|USER|LANG|TZ|PWD|SHELL|CI|NODE_ENV|NODE_OPTIONS|NODE_PATH|PYTHONPATH|DEBUG)$/,
];

/** The keys the deployment manager places beside AGENT_MODEL for the model it
 *  gives the agent (agents/deployment-manager/steps.py, PROVIDERS): reading
 *  one reaches the model the agent is given, which is part of the derived set. */
export const MODEL_KEY_VARS = ["GOOGLE_GENERATIVE_AI_API_KEY", "ANTHROPIC_API_KEY"];

/** A variable whose name says it holds a credential. */
export const CREDENTIAL_VAR = /(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|CREDS|AUTH)(?:_|$)/;

/** Take comments out, keeping line numbers, so an address in a comment is not
 *  read as one a program reaches. Strings are left as they are, so `//` in an
 *  address is not taken for a comment. */
export function stripComments(text, path = "") {
  const hashComments = /\.(?:py|sh|bash|rb|ps1)$/i.test(path);
  let out = "";
  let i = 0;
  let quote = "";
  while (i < text.length) {
    const c = text[i];
    const n = text[i + 1];
    if (quote) {
      out += c;
      if (c === "\\") { out += n ?? ""; i += 2; continue; }
      if (c === quote) quote = "";
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { quote = c; out += c; i++; continue; }
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

// A host may be built in part from a value, as in `https://${where}-aiplatform.googleapis.com`:
// the written part is kept and the value taken off, so the host is still seen.
const URL_RE = /\b(https?|wss?):\/\/((?:\$\{[^}]*\}|[A-Za-z0-9.-])+)(?::\d+)?([^\s"'`)]*)/g;
/** A program that drives a browser, and one that routes the browser's requests. */
const BROWSER = /\b(?:playwright|puppeteer|chromium\.launch|page\.goto)\b/;
const ROUTES = /\b(?:page|context|browserContext)\.route\s*\(|setRequestInterception\s*\(/;
/** Words on a line that say the address on it is gone to, not just mentioned. */
const REACHING = /\b(?:fetch|request|axios|got|get|post|put|patch|delete|open|connect|WebSocket|EventSource|urlopen|requests\.|curl|wget|http\.|https\.|goto|navigate|ENDPOINT|BASE|HOST|API|URL|DOOR|ORIGIN|ROOT)\b|_URL|_API|_HOST|_BASE|Url\b|url\b/i;
const FETCH_CALL = /\b(?:fetch|fetchImpl|got|axios(?:\.\w+)?|urlopen|requests\.(?:get|post|put|patch|delete)|https?\.(?:get|request)|page\.goto)\s*\(\s*([^)\n]*)/g;
const ENV_READ = [
  /process\.env\.([A-Z][A-Z0-9_]*)/g, /process\.env\[\s*["'`]([A-Z][A-Z0-9_]*)["'`]\s*\]/g,
  /\benv\.([A-Z][A-Z0-9_]*)\b/g, /\benv\[\s*["'`]([A-Z][A-Z0-9_]*)["'`]\s*\]/g,
  /os\.environ(?:\.get)?\s*[[(]\s*["']([A-Z][A-Z0-9_]*)["']/g, /os\.getenv\(\s*["']([A-Z][A-Z0-9_]*)["']/g,
  /\$\{?([A-Z][A-Z0-9_]{2,})\}?/g,
];
const SPAWN = /(?<![\w$.])(?:spawn|spawnSync|exec|execSync|execFile|execFileSync|fork|subprocess\.(?:run|Popen|call|check_output|check_call)|os\.system|chromium\.launch|puppeteer\.launch)\s*\(\s*([^,)\n]*)/g;
/** A program that can start one: it takes child_process, subprocess or a browser launcher. */
const STARTS = /child_process|subprocess|os\.system|chromium\.launch|puppeteer|playwright/;

/** What one program reaches, off its text. Pure. */
export function traceOne(path, text) {
  const code = stripComments(text, path);
  const lines = code.split("\n");
  const hosts = [];
  const open = [];
  const vars = new Set();
  const commands = [];
  lines.forEach((line, at) => {
    for (const m of line.matchAll(URL_RE)) {
      const host = m[2].replace(/\$\{[^}]*\}/g, "").toLowerCase().replace(/^[.-]+|\.$/g, "");
      if (!host.includes(".") && host !== "localhost") continue;
      if (!host || NOT_REACHED.some((r) => r.test(host))) continue;
      if (!REACHING.test(line) && !/^\s*(?:export\s+)?(?:const|let|var)\s+\w+\s*=\s*["'`]https?:/.test(line)) continue;
      if (!hosts.some((h) => h.host === host)) hosts.push({ host, line: at + 1, scheme: m[1] });
    }
    for (const m of line.matchAll(FETCH_CALL)) {
      const arg = trim(m[1]);
      if (/^["'`]https?:\/\//.test(arg)) continue; // a written address, counted above
      if (!open.some((o) => o.line === at + 1)) open.push({ line: at + 1, what: arg.slice(0, 60) }); // cut-ok: a label for the line, the line number is the reference
    }
    if (/\.(?:sh|bash|ps1)$/i.test(path) || !/\$\{/.test(line) || /process\.env|os\.environ|os\.getenv|env\.|env\[/.test(line)) {
      for (const re of ENV_READ) {
        if (re.source.startsWith("\\$") && !/\.(?:sh|bash)$/i.test(path)) continue;
        for (const m of line.matchAll(re)) vars.add(m[1]);
      }
    }
    if (STARTS.test(code)) for (const m of line.matchAll(SPAWN)) {
      const what = trim(m[1]).replace(/^["'`]|["'`]$/g, "");
      if (!commands.some((c) => c.what === what)) commands.push({ what: what.slice(0, 60), line: at + 1 }); // cut-ok: a label, the line is the reference
    }
  });
  const browser = BROWSER.test(code) && /goto|newPage|launch/.test(code);
  return { path, hosts, open, vars: [...vars].sort(), commands, browser, routes: browser && ROUTES.test(code) };
}

/** Every program the package carries, traced. Tests are left out and counted. */
export function tracePrograms(files, programs) {
  const traced = [];
  const tests = [];
  for (const p of programs) {
    if (isTest(p)) { tests.push(p); continue; }
    const b = files.get(p);
    if (!b) continue;
    traced.push(traceOne(p, b.toString("utf8")));
  }
  return { traced, tests };
}

/** Words of a host a stated reason could name it by: the host, and its labels
 *  but the last (example.org gives "example"). */
const labelsOf = (host) => host.split(".").slice(0, -1).filter((l) => l.length > 2 && !["www", "api", "com", "org", "net"].includes(l));

/**
 * Match what the programs reach against what the package declares. Returns
 * { reaches: [{ host, files, system, by }], unmatched: [...], openFetches: [...],
 *   credentialVars: [{ name, files }], undeclaredCommands: [...] }.
 * `egressHosts` are the further destinations the architecture record names.
 */
export function matchReaches({ traced, systems = [], binaries = [], egressHosts = [], urlInputs = [] }) {
  const declared = new Set(systems.map((s) => s.name));
  const byHost = new Map();
  for (const t of traced) for (const h of t.hosts) {
    const got = byHost.get(h.host) ?? { host: h.host, files: [] };
    got.files.push(`${t.path}:${h.line}`);
    byHost.set(h.host, got);
  }
  const reaches = [];
  const unmatched = [];
  for (const r of byHost.values()) {
    const platform = PLATFORM_HOSTS.find((p) => p.hosts.some((re) => re.test(r.host)) && (p.system === "(the mesh)" || declared.has(p.system)));
    const named = systems.find((s) => {
      const said = `${s.needs} ${s.name}`.toLowerCase();
      return said.includes(r.host) || labelsOf(r.host).some((l) => new RegExp(`\\b${l.replace(/[-.]/g, "\\$&")}\\b`).test(said));
    });
    const egress = egressHosts.find((e) => r.host === e || r.host.endsWith(`.${e}`));
    if (platform) reaches.push({ ...r, system: platform.system, by: platform.system === "(the mesh)" ? "the platform the agent is installed on" : `the platform's own address for ${platform.system}` });
    else if (egress) reaches.push({ ...r, system: "(further destination)", by: "the architecture record's egress names it" });
    else if (named) reaches.push({ ...r, system: named.name, by: `the reason stated for ${named.name} names it` });
    else unmatched.push(r);
  }
  // A call to an address the program is handed, not one written down. It is
  // the call of an address this same program writes down (a model's door
  // built from its host), or of a declared system whose reason says it
  // fetches what it is handed (pages at a domain the person names); else it
  // reaches whatever it is handed and nothing the declaration names covers it.
  const FETCHING = /\b(?:fetch(?:es|ing)?|download(?:s|ing)?|crawl(?:s|ing)?|brows(?:e|es|ing)|open(?:s|ing)? (?:the |those |each )?pages)\b/i;
  const fetchers = systems.filter((s) => s.kind === "service" && ["read", "trigger"].includes(s.access) && FETCHING.test(s.needs ?? ""));
  const openFetches = [];
  const unmatchedOpen = [];
  for (const t of traced) {
    if (!t.open.length) continue;
    const own = reaches.filter((r) => r.files.some((f) => f.startsWith(`${t.path}:`)));
    const by = own.length ? `the addresses this program writes down (${[...new Set(own.map((r) => r.host))].join(", ")})`
      : fetchers.length ? `${fetchers.map((s) => s.name).join(", ")}, whose stated reason is fetching what it is handed` : "";
    for (const o of t.open) (by ? openFetches : unmatchedOpen).push({ file: `${t.path}:${o.line}`, what: o.what, by });
  }
  const browsers = traced.filter((t) => t.browser).map((t) => ({ file: t.path, routes: t.routes }));

  const placedOrDeclared = new Set();
  for (const s of systems) {
    if (s.env) placedOrDeclared.add(s.env);
    for (const st of s.settings ?? []) if (st.env) placedOrDeclared.add(st.env);
  }
  const vars = new Map();
  const modelKeys = [];
  for (const t of traced) for (const v of t.vars) {
    if (placedOrDeclared.has(v) || PLACED_VARS.some((re) => re.test(v))) continue;
    if (MODEL_KEY_VARS.includes(v)) { if (!modelKeys.some((k) => k.name === v)) modelKeys.push({ name: v, file: t.path }); continue; }
    if (!CREDENTIAL_VAR.test(v)) continue;
    const got = vars.get(v) ?? { name: v, files: [] };
    got.files.push(t.path);
    vars.set(v, got);
  }

  const bins = binaries.map((b) => b.name.toLowerCase()).filter(Boolean);
  const undeclaredCommands = [];
  // A command written down as a word, which is neither the runtime nor a
  // declared binary. A command held in a variable is not named here: what it
  // is cannot be read off the text, and the review says the programs were
  // read and not run.
  const RUNTIME = ["node", "python", "python3", "bash", "sh", "process.execpath", "npm", "npx"];
  for (const t of traced) for (const c of t.commands) {
    const literal = /^["'`]?[\w./-]+["'`]?$/.test(c.what) && /^["'`]/.test(c.what);
    const browserLaunch = /chromium\.launch|puppeteer\.launch/.test(c.what);
    const word = c.what.replace(/["'`]/g, "").split(/[\s/\\]/).filter(Boolean).pop()?.toLowerCase() ?? "";
    if (browserLaunch) { if (!bins.some((b) => /chrom/.test(b))) undeclaredCommands.push({ file: `${t.path}:${c.line}`, what: "a browser (chromium)" }); continue; }
    if (!literal || RUNTIME.includes(word) || bins.some((b) => word === b || word.startsWith(b))) continue;
    undeclaredCommands.push({ file: `${t.path}:${c.line}`, what: word });
  }
  for (const t of traced) {
    if (t.browser && !bins.some((b) => /chrom|firefox|webkit/.test(b)) && !undeclaredCommands.some((c) => c.file.startsWith(`${t.path}:`))) undeclaredCommands.push({ file: t.path, what: "a browser" });
  }
  return { reaches, unmatched, openFetches, unmatchedOpen, browsers, credentialVars: [...vars.values()], modelKeys, undeclaredCommands, urlInputs };
}
