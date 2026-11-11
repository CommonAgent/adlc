// Lay out a build folder for a new agent.
//
// The folder gets the check and the generators under .adlc/ (this kit, copied
// whole), AGENTS.md with the builder's instructions (the adlc skill's own
// text, so Cursor, Codex or a person can work the folder without the plugin),
// CLAUDE.md pointing to it, and build.lock.json with the kit pinned from the
// start: a check that changed is caught like any other pin.
//
// The person's own words go in request.md, written by the builder from what
// the person said, before anything else.
//
//   needs: node >= 22
//   node <plugin>/kit/start.mjs <folder>
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { LOCK_FILE, digestOf } from "./code-writer/scripts/workspace.mjs";

const KIT = dirname(fileURLToPath(import.meta.url));
const SKILL = join(KIT, "..", "skills", "adlc", "SKILL.md");

/** The skill's text without its front matter: the instructions AGENTS.md holds. */
export function instructionsOf(skillText) {
  const m = /^---\r?\n[\s\S]*?\r?\n---\r?\n+/.exec(skillText);
  return m ? skillText.slice(m[0].length) : skillText;
}

function walk(dir, base = dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const at = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(at, base));
    else out.push(relative(base, at).split(sep).join("/"));
  }
  return out;
}

/** Lay the folder out. Refuses a folder that is already a build folder. */
export function start(folder, { kit = KIT, skill = SKILL } = {}) {
  const dir = resolve(folder);
  if (existsSync(join(dir, ".adlc"))) return { ok: false, said: `${dir} is already a build folder; run \`node .adlc/check.mjs\` there to see where it is.` };
  mkdirSync(dir, { recursive: true });
  cpSync(kit, join(dir, ".adlc"), { recursive: true });
  writeFileSync(join(dir, "AGENTS.md"), instructionsOf(readFileSync(skill, "utf8")));
  if (!existsSync(join(dir, "CLAUDE.md"))) writeFileSync(join(dir, "CLAUDE.md"), "@AGENTS.md\n");
  const digests = Object.fromEntries(walk(join(dir, ".adlc")).sort().map((r) => [`.adlc/${r}`, digestOf(readFileSync(join(dir, ".adlc", r)))]));
  writeFileSync(join(dir, LOCK_FILE), JSON.stringify({ build_lock: "v1", digests, scripts: [], gates: {} }, null, 2) + "\n");
  return { ok: true, dir, said: `The build folder is ${dir}. Write the person's own words to request.md there, then follow AGENTS.md from the start.` };
}

const thisFile = process.argv[1] ? process.argv[1].replace(/\\/g, "/").split("/").pop() : "";
if (thisFile === "start.mjs" && import.meta.url.endsWith("/start.mjs")) {
  const folder = process.argv[2];
  if (!folder) { console.error("usage: node start.mjs <folder>"); process.exit(2); }
  const r = start(folder);
  console.log(r.said);
  process.exitCode = r.ok ? 0 : 1;
}
