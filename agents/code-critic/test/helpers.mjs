// What the tests share: a tar writer, so a package can be handed in the way
// a person sends one, and a folder reader, so a package on disk can be
// checked without going through an archive. Nothing here is a test.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { gzipSync } from "node:zlib";
import { roleOf } from "../scripts/read-change.mjs";

/** A ustar archive of {path: text|Buffer|{type, body}}, gzipped when asked. */
export function tarOf(files, { gzip = true } = {}) {
  const blocks = [];
  for (const [path, value] of Object.entries(files)) {
    const typed = value && typeof value === "object" && !Buffer.isBuffer(value);
    const body = typed ? value.body : value;
    const data = Buffer.isBuffer(body) ? body : Buffer.from(String(body), "utf8");
    const h = Buffer.alloc(512);
    h.write(path.slice(-100), 0, "utf8");
    h.write("0000644\0", 100);
    h.write("0000000\0", 108);
    h.write("0000000\0", 116);
    h.write(data.length.toString(8).padStart(11, "0") + "\0", 124);
    h.write("00000000000\0", 136);
    h.write("        ", 148);
    h.write(typed ? value.type : "0", 156);
    h.write("ustar\0", 257);
    h.write("00", 263);
    let sum = 0;
    for (const b of h) sum += b;
    h.write(sum.toString(8).padStart(6, "0") + "\0 ", 148);
    blocks.push(h, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  const tar = Buffer.concat(blocks);
  return gzip ? gzipSync(tar) : tar;
}

/** Every file under dir: {path: text}. */
export function filesOf(dir, skip = /(^|\/)(node_modules|\.git|out)(\/|$)/) {
  const out = {};
  const walk = (d) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      const rel = relative(dir, p).split(sep).join("/");
      if (skip.test(rel)) continue;
      if (statSync(p).isDirectory()) walk(p);
      else out[rel] = readFileSync(p, "utf8");
    }
  };
  walk(dir);
  return out;
}

/** A read record and texts for a package held as {path: text}, as read-change.mjs would make them. */
export function readOf(files, change = { scope: "package", files: [] }) {
  return {
    read: { read: "v1", package: {}, files: Object.entries(files).map(([path, t]) => ({ path, role: roleOf(path), lines: t.split("\n").length })), change, notes: [] },
    texts: { ...files },
  };
}

/** A small package that breaks every house rule once. */
export function badPackage() {
  const descriptor = {
    format: "agent-descriptor-v1", agent_version: "0.1.0", does: "Makes a thing.",
    offerings: [{
      id: "make", name: "Make", does: "Makes it.",
      inputs: [{ name: "the ask", kind: "text", required: true }],
      outputs: [{ name: "the thing", kind: "text/markdown", when: "per_task" }, { name: "the data", kind: "application/json", when: "per_task" }],
      how: { control: "script", intelligence: "called", cost: "metered", contract: "full" },
      steps: [
        { id: "read", name: "Read", does: "Reads.", how: { control: "script", intelligence: "none", cost: "none", contract: "full" } },
        { id: "think", name: "Think", does: "Thinks.", how: { control: "model", intelligence: "open", cost: "metered", contract: "full" } },
      ],
    }],
    refusals: "Guessing.",
    records: [{ name: "what was read", when: "per_task", file: "*/read.json" }, { name: "the rounds", when: "per_task", file: "*/round-*.json" }],
    systems: [{ name: "text-reasoning", access: "trigger", needs: "to think" }],
  };
  const runtime = { format: "agent-runtime-requirements-v1", systems: [{ name: "text-reasoning", kind: "service", credential: "k", env: "TEXT_API_KEY" }] };
  const manifest = { name: "bad", version: "0.1.0", extensions: { "net.agentdoc.package": { build: { skills: { make: { scripts: ["scripts/make.mjs", "scripts/pieces.mjs"] }, read: { scripts: ["scripts/read.mjs"] }, think: { scripts: ["scripts/think.mjs"] } } } } } };
  return {
    "agent-descriptor.json": JSON.stringify(descriptor, null, 2) + "\n",
    "agent-runtime-requirements.json": JSON.stringify(runtime, null, 2) + "\n",
    "plugin.json": JSON.stringify(manifest, null, 2) + "\n",
    "skills/make/SKILL.md": "---\nname: make\ndescription: make\n---\n\n# Make\n",
    "scripts/make.mjs": [
      "// makes the thing",
      "import { writeFileSync } from \"node:fs\";",
      "import { join } from \"node:path\";",
      "export const MODEL = \"gemini-2.5-flash\";",
      "const API = process.env.MESH_API_BASE || \"https://app.dev.agentmesh.ai\";",
      "const KEY = process.env.STORE_TOKEN;",
      "writeFileSync(join(RECORDS, \"secret-notes.json\"), \"{}\");",
      "writeFileSync(join(RECORDS, \"read.json\"), \"{}\");",
      "",
    ].join("\n"),
    "scripts/read.mjs": "// reads\nimport { callModel } from \"./caller.mjs\";\nexport const read = () => callModel(\"x\");\n",
    "scripts/think.mjs": "// thinks\nexport const think = () => 1;\n",
    "scripts/pieces.mjs": [
      "// files the pieces",
      "export const entries = [",
      "  { name: \"the thing\", step: \"make\", path: \"out/thing.md\", media_type: \"application/json\" },",
      "  { name: \"a surprise\", step: \"make\", path: \"out/surprise.txt\", media_type: \"text/plain\" },",
      "];",
      "",
    ].join("\n"),
  };
}
