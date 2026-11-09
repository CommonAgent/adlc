// Reads the pages a job is handed and writes out/pages.json.
//   node scripts/read-pages.mjs --job <folder> [--count <n>]
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const VERSION = "page-reader-v1";
export const LIMITS = { most: 5, wait_ms: 1000, words: ["title", "body"] };
const DONE = /^\s*done\s*:\s*(\d+)\s*$/i;

export function parseArgs(argv) {
  const out = { job: "", count: 3 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--job") out.job = argv[++i];
    else if (argv[i] === "--count") out.count = Number(argv[++i]);
  }
  return out;
}

export function readPages(texts, count) {
  const pages = [];
  for (const text of texts.slice(0, Math.min(count, LIMITS.most))) {
    let from = "none";
    if (text.startsWith("#")) from = "heading";
    else if (text.trim()) from = "body";
    pages.push({ text, from, done: DONE.test(text) });
  }
  return pages;
}

export function run(argv, texts = []) {
  const args = parseArgs(argv);
  if (!args.job) {
    console.error("Name the job folder with --job.");
    process.exit(2);
  }
  const pages = readPages(texts, args.count);
  const doc = { format: VERSION, status: pages.length ? "read" : "empty", pages };
  mkdirSync(join(args.job, "out"), { recursive: true });
  writeFileSync(join(args.job, "out", "pages.json"), `${JSON.stringify(doc, null, 2)}\n`);
  return { reply: `Read ${pages.length} pages for ${args.job}.` };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\/]/).pop())) {
  console.log(JSON.stringify(run(process.argv.slice(2))));
}
