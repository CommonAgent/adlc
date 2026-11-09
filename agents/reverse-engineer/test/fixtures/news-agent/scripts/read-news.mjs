// Reads the top items of a news feed and writes them to out/top.json.
//   node scripts/read-news.mjs --job <folder> --text-file <message> [--count <n>]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stopNotice, stoppedReply } from "./stop.mjs";

export const FEED = "https://news.example.com/v0";
export const FORMAT = "news-top-v1";
const MOST = 25;
const WAIT_MS = 8000;
const HEADERS = { "user-agent": "news-agent/1.0", accept: "application/json" };

export class Refusal extends Error {}

export function parseArgs(argv) {
  const out = { job: ".", textFile: "", count: 10 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--job") out.job = argv[++i];
    else if (argv[i] === "--text-file") out.textFile = argv[++i];
    else if (argv[i] === "--count") out.count = Number(argv[++i]);
  }
  return out;
}

async function getJson(url, fetchImpl) {
  const res = await fetchImpl(url, { headers: HEADERS, signal: AbortSignal.timeout(WAIT_MS) });
  if (!res.ok) throw new Error(`answered ${res.status}`);
  return res.json();
}

export async function readTop(count, fetchImpl = fetch) {
  let ids;
  try { ids = await getJson(`${FEED}/top.json`, fetchImpl); } catch {
    throw new Refusal("I cannot read the news feed right now. Nothing was written.");
  }
  const items = [];
  for (const id of ids.slice(0, Math.min(count, MOST))) {
    const item = await getJson(`${FEED}/item/${id}.json`, fetchImpl);
    const text = item.article || item.summary || (item.comments ?? []).join("\n");
    const from = item.article ? "article" : item.summary ? "summary" : "comments";
    items.push({ id: item.id, title: String(item.title ?? ""), text, text_from: from });
  }
  return items;
}

export async function run(argv, fetchImpl = fetch) {
  const args = parseArgs(argv);
  const message = args.textFile ? readFileSync(args.textFile, "utf8") : "";
  const notice = stopNotice(message);
  if (notice) return { reply: stoppedReply(notice) };
  let items;
  try { items = await readTop(args.count, fetchImpl); } catch (e) {
    if (e instanceof Refusal) return { reply: e.message };
    throw e;
  }
  const out = join(args.job, "out");
  mkdirSync(out, { recursive: true });
  const doc = { format: "news-top-v1", fetched_at: new Date().toISOString(), source: FEED, items };
  writeFileSync(join(out, "top.json"), `${JSON.stringify(doc, null, 2)}\n`);
  return { reply: `Read ${items.length} items.` };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  run(process.argv.slice(2)).then((r) => console.log(JSON.stringify(r)));
}
