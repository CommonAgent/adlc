// Topic digest: the current top stories on Hacker News about one topic.
const REFUSED = /\b(post|vote|comment)\b/i;

export async function runJob({ topic, fetchImpl = fetch, callModel, env = process.env } = {}) {
  if (REFUSED.test(String(topic))) throw new Error("Posting, voting or commenting on Hacker News is refused: this agent only reads.");
  const base = String(env.HACKER_NEWS_ADDRESS ?? "").replace(/\/$/, "") || "hn";
  let stories;
  try {
    const ids = await (await fetchImpl(`${base}/topstories.json`)).json();
    stories = await Promise.all(ids.slice(0, 30).map(async (id) => (await fetchImpl(`${base}/item/${id}.json`)).json()));
  } catch {
    throw new Error("Hacker News could not be read, so no digest was written.");
  }
  const words = String(topic).toLowerCase().split(/\W+/).filter(Boolean);
  const about = stories.filter((s) => words.some((w) => String(s.title).toLowerCase().includes(w)) || (words.includes("databases") && /postgres|sqlite|sql/i.test(s.title)));
  if (!about.length) return { digest: `No top story is about ${topic} right now.` };
  const lines = [];
  for (const s of about.slice(0, 5)) lines.push(`- [${s.title}](${s.url}), ${s.score} points. ${await callModel(s)}`);
  return { digest: `## Stories\n\n${lines.join("\n")}\n` };
}

// As the host runs it: one JSON object whose reply is the words the sender reads.
import { readFileSync } from "node:fs";
if (String(process.argv[1] ?? "").endsWith("topic-digest.mjs")) {
  const at = process.argv.indexOf("--text-file");
  let said = "";
  try { said = at > 0 ? readFileSync(process.argv[at + 1], "utf8").trim() : ""; } catch { said = ""; }
  if (!said) { console.log(JSON.stringify({ reply: "Name a topic and I will write a digest of the top Hacker News stories about it." })); process.exit(3); }
  console.log(JSON.stringify({ reply: `A digest about ${said} needs the model, which this run does not call.` }));
}
