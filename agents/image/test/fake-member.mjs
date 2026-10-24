// Stands in for a member agent's job inside a single-container edition: files
// one piece under its job folder, keeps a record under the records directory
// its own deploy binds, and answers in one JSON object.
//
//   node fake-member.mjs --job <dir> --records <dir> --from <handle>
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const argv = process.argv.slice(2);
const value = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : null; };
const job = value("--job");
const records = value("--records");
const who = process.env.AGENT_NAME ?? "member";
mkdirSync(join(job, "out"), { recursive: true });
writeFileSync(join(job, "out", "draft.txt"), `the draft ${who} wrote\n`);
writeFileSync(join(job, "pieces.json"), JSON.stringify([{ name: "draft.txt", step: "write", path: "out/draft.txt", media_type: "text/plain" }]) + "\n");
mkdirSync(records, { recursive: true });
const log = join(records, "jobs.json");
const seen = existsSync(log) ? JSON.parse(readFileSync(log, "utf8")) : [];
seen.push({ from: value("--from"), secret_seen: process.env.WRITER_KEY ?? null, runner_token_seen: process.env.MESH_API_TOKEN ?? null });
writeFileSync(log, JSON.stringify(seen, null, 2) + "\n");
process.stdout.write(JSON.stringify({ reply: `${who} did the work` }));
