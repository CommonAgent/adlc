import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const FILE = "went-without.json";

export function fileIn(dir) {
  return join(dir, FILE);
}

export function read(dir) {
  const p = fileIn(dir);
  if (!existsSync(p)) return [];
  return JSON.parse(readFileSync(p, "utf8"));
}

export function note(dir, entry) {
  const entries = read(dir);
  entries.push(entry);
  writeFileSync(fileIn(dir), JSON.stringify(entries, null, 2));
}

export function sentence(entries) {
  if (entries.length === 0) return "";
  return entries.map(e => `went without ${e.wanted} because ${e.why}; ${e.did}.`).join(" ");
}

export function paragraph(dir) {
  return sentence(read(dir));
}

if (process.argv[1] === import.meta.url || process.argv[1] === new URL(import.meta.url).pathname) {
  if (process.argv.length < 3) {
    console.error("dir required");
    process.exit(2);
  }
}
