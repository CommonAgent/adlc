// What the suites share: a tar.gz writer, so a package can be made the way the
// package maker hands one over, a small package to review, a host laid out
// the way the builder lays a package out, and a job run exactly as the
// runtime requirements start it.
//   needs: node >= 22
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

export const AGENT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const json = (p) => JSON.parse(readFileSync(p, "utf8"));
export const RUN = json(join(AGENT, "agent-runtime-requirements.json")).run["review-a-package"];
export const PLUGIN = json(join(AGENT, "plugin.json"));

/** One ustar header block. */
function header(name, size, type = "0") {
  const h = Buffer.alloc(512);
  const put = (s, at, len) => Buffer.from(s).copy(h, at, 0, len);
  let prefix = "";
  let base = name;
  if (Buffer.byteLength(name) > 100) { const cut = name.lastIndexOf("/", 154); prefix = name.slice(0, cut); base = name.slice(cut + 1); }
  put(base, 0, 100);
  put("0000644\0", 100, 8); put("0000000\0", 108, 8); put("0000000\0", 116, 8);
  put(size.toString(8).padStart(11, "0") + "\0", 124, 12);
  put("00000000000\0", 136, 12);
  h.fill(0x20, 148, 156);
  h[156] = type.charCodeAt(0);
  put("ustar\0", 257, 6); put("00", 263, 2);
  put(prefix, 345, 155);
  let sum = 0; for (const b of h) sum += b;
  put(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8);
  return h;
}

/** A .tar.gz of these files ({ path: text | Buffer }), with an optional top folder. */
export function tarGz(files, { top = "", extra = [] } = {}) {
  const blocks = [];
  for (const [p, body] of Object.entries(files)) {
    const bytes = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
    blocks.push(header(top ? `${top}/${p}` : p, bytes.length));
    blocks.push(bytes, Buffer.alloc((512 - (bytes.length % 512)) % 512));
  }
  for (const e of extra) blocks.push(header(e.name, 0, e.type));
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

/** A small package: one system at read access, a reason for it, one program
 *  that reaches only that system. `change` edits the parts before they are packed. */
export function smallPackage(change = (p) => p) {
  const p = {
    descriptor: {
      format: "agent-descriptor-v1", agent_version: "1.0.0",
      does: "Reads the weather for a city and says whether to take an umbrella.",
      offerings: [{ id: "read-the-weather", name: "Read the weather", does: "Reads the forecast.", inputs: [{ name: "city", kind: "text", required: true }], outputs: [{ name: "forecast", kind: "text/markdown", when: "per_task" }], how: { control: "script", intelligence: "none", cost: "none", contract: "full" } }],
      refusals: "Reading anything but the forecast. It was asked about the weather and nothing else.\nKeeping a city it was asked about.",
      records: [{ name: "the forecast as read", when: "per_task", file: "*/forecast.json" }],
      systems: [{ name: "weather-service", access: "read", needs: "to read the forecast for the city the caller names from api.weather.example-forecasts.net" }],
    },
    requirements: {
      format: "agent-runtime-requirements-v1", runtimes: [{ name: "node", version: ">=22" }], binaries: [], dependencies: [],
      systems: [{ name: "weather-service", kind: "service" }], ceilings: [],
      directories: [{ name: "records", purpose: "one folder per job holding the forecast as it was read" }],
      job_seconds: 120, price: { sku: "default", price: { model: "free" } },
    },
    plugin: { name: "weather-reader", version: "1.0.0", description: "Reads the weather." },
    programs: {
      "skills/read-the-weather/scripts/read.mjs": [
        "// Read the forecast.",
        "const BASE = \"https://api.weather.example-forecasts.net/v2\";",
        "export async function read(city) {",
        "  const r = await fetch(`${BASE}/forecast?city=${encodeURIComponent(city)}`);",
        "  return r.json();",
        "}",
      ].join("\n"),
    },
    other: {},
  };
  return change(p);
}

/** The package's files, as a map of path to text. */
export function filesOf(p) {
  return {
    "agent-descriptor.json": JSON.stringify(p.descriptor, null, 2),
    "agent-runtime-requirements.json": JSON.stringify(p.requirements, null, 2),
    "plugin.json": JSON.stringify(p.plugin, null, 2),
    "skills/read-the-weather/SKILL.md": "---\nname: read-the-weather\n---\n# Read the weather\n",
    ...p.programs,
    ...p.other,
  };
}

/** A host: home with this agent laid out the way the builder lays it out. */
export function host() {
  const root = mkdtempSync(join(tmpdir(), "security-reviewer-"));
  const pkg = "security-reviewer";
  const skills = PLUGIN.extensions["net.agentdoc.package"].build.skills;
  for (const [slug, { scripts, references = [] }] of Object.entries(skills)) {
    for (const s of scripts) {
      const to = join(root, "home", pkg, "skills", slug, s);
      mkdirSync(dirname(to), { recursive: true });
      writeFileSync(to, readFileSync(join(AGENT, s)));
    }
    for (const r of references) {
      const to = join(root, "home", pkg, "skills", slug, "references", r.split("/").pop());
      mkdirSync(dirname(to), { recursive: true });
      writeFileSync(to, readFileSync(join(AGENT, r)));
    }
  }
  const records = join(root, "records");
  const work = join(root, "work");
  mkdirSync(records, { recursive: true });
  mkdirSync(work, { recursive: true });
  return { root, home: join(root, "home"), pkg, records, work };
}

/** Run one job: write message.txt, attach files, start the run command. */
export function run(h, { id = "job-1", message = "", files = [], env = {} } = {}) {
  const jobDir = join(h.root, "jobs", id);
  mkdirSync(jobDir, { recursive: true });
  writeFileSync(join(jobDir, "message.txt"), message);
  const fill = (s, more = {}) => s
    .replaceAll("{home}", h.home).replaceAll("{package}", h.pkg)
    .replaceAll("{job_dir}", jobDir).replaceAll("{records}", h.records).replaceAll("{work}", h.work)
    .replaceAll("{file_path}", more.path ?? "").replaceAll("{file_media_type}", more.type ?? "");
  const argv = RUN.command.map((s) => fill(s));
  for (const f of files) {
    const at = join(h.root, "attached", id, f.name);
    mkdirSync(dirname(at), { recursive: true });
    writeFileSync(at, f.bytes);
    for (const s of RUN.per_file) argv.push(fill(s, { path: at, type: f.type ?? "application/gzip" }));
  }
  const [cmd, ...args] = argv;
  if (cmd !== "node") throw new Error(`the run command starts ${cmd}, not node`);
  const clean = { ...process.env };
  delete clean.AGENT_MODEL;
  const r = spawnSync(process.execPath, args, { encoding: "utf8", env: { ...clean, ...env } });
  const out = r.stdout.trim();
  let doc;
  try { doc = JSON.parse(out); } catch { throw new Error(`stdout is not one JSON object: ${out}\n${r.stderr}`); }
  const reviewPath = join(h.records, id, "security-review.md");
  let review = "";
  try { review = readFileSync(reviewPath, "utf8"); } catch { /* none written */ }
  return { status: r.status, doc, jobDir, recordsDir: join(h.records, id), review, stderr: r.stderr };
}

/** The review's front matter, read back: the top-level fields and each list of
 *  items, as YAML would read the subset the review writes. */
export function frontMatter(md) {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(md);
  if (!m) throw new Error("the review has no front matter");
  const out = {};
  let list = null;
  let item = null;
  for (const line of m[1].split("\n")) {
    let g;
    if ((g = /^([a-z_]+): \[\]$/.exec(line))) { out[g[1]] = []; list = null; continue; }
    if ((g = /^([a-z_]+):$/.exec(line))) { out[g[1]] = []; list = out[g[1]]; continue; }
    if ((g = /^([a-z_]+): (.+)$/.exec(line))) { out[g[1]] = JSON.parse(g[2]); list = null; continue; }
    if ((g = /^ {2}- ([a-z_]+): (.+)$/.exec(line))) { item = { [g[1]]: JSON.parse(g[2]) }; list.push(item); continue; }
    if ((g = /^ {2}- (".*")$/.exec(line))) { list.push(JSON.parse(g[1])); continue; }
    if ((g = /^ {4}([a-z_]+): (.+)$/.exec(line))) { item[g[1]] = JSON.parse(g[2]); continue; }
    throw new Error(`a front matter line this reader does not know: ${line}`);
  }
  return out;
}
