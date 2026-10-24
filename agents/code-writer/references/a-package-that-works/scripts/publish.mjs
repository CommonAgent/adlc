// Publish: one command, three steps, no model.
//   needs: node >= 22
//   --job <job folder> --records <records folder> [--work <folder>]
//   [--file <path>::<media type>]... [--text-file <path>] [NAME=<slug>]
//
// WHY THIS IS A PROGRAM. Every step of publishing is written down in full, and
// a method written down in full and handed to a model to improvise is the
// shape that fails. There is no judgment here at all: what a file is, whether
// it may go, where it goes, and whether the address serves it are each settled
// by looking. So no model is woken and the job costs nothing to run.
//
// It prints one JSON object with a `reply` field. Exit codes: 0 done; 2 usage;
// 3 the job stops and the reply says why, which the harness sends as it
// stands; 1 failed.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { readingOf, BYTES_MAX_DEFAULT } from "./inspect.mjs";
import { folderFor, placeOne, readBack } from "./place.mjs";
import { fill, plan as piecesPlan } from "./pieces.mjs";

export const STEPS = ["read-what-was-given", "place-the-files", "check-what-is-served"];

const trim = (t) => String(t ?? "").trim();
const many = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const listOf = (xs) => (xs.length < 2 ? String(xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const json = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
const sentence = (t) => { const s = trim(t); return !s ? "" : /[.!?]$/.test(s) ? s : `${s}.`; };

export const NOTHING_GIVEN =
  "Nothing was attached, so nothing was published. Send me the files you want at an address and I will place them and give you the address, along with the digest of what is served so you can check it later. I do not fetch a file from a link in order to publish it: what goes up is what you hand over.";

/** The command line, as the host writes it. Files arrive as path::media-type,
 *  because the host knows what it was told a file was and this job wants both
 *  that claim and the bytes, to disagree when they differ. */
export function fromArgv(argv = []) {
  const out = { job: "", records: "", work: "", textFile: "", files: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === "--job") { out.job = value; i += 1; }
    else if (flag === "--records") { out.records = value; i += 1; }
    else if (flag === "--work") { out.work = value; i += 1; }
    else if (flag === "--text-file") { out.textFile = value; i += 1; }
    else if (flag === "--file") {
      const at = String(value ?? "").lastIndexOf("::");
      out.files.push(at === -1
        ? { path: String(value ?? ""), declared: "" }
        : { path: String(value ?? "").slice(0, at), declared: String(value ?? "").slice(at + 2) });
      i += 1;
    }
  }
  return out;
}

/** The name the person asked for, out of the message or the environment. One
 *  word, and only the first file takes it; the rest keep their own names,
 *  because a page and its stylesheet must not both become index.html. */
export const NAME_LINE = /^\s*name\s*:\s*(\S+)\s*$/im;
export function nameGiven({ env = {}, text = "" } = {}) {
  const said = trim(env.NAME);
  if (said) return said;
  const found = NAME_LINE.exec(String(text ?? ""));
  return found ? found[1] : "";
}

/** The record of every name this agent has placed, so that a name it did not
 *  place is not quietly replaced. Kept beside the records rather than in a job
 *  folder, because it outlives any one job. */
export function namesFile(records) { return join(records, "..", "names.json"); }
export function knownNames(path, io = disk) {
  try { const d = JSON.parse(io.read(path)); return new Map(Object.entries(d.taken ?? {})); }
  catch { return new Map(); }
}
export function rememberNames(path, taken, io = disk) {
  const names = Object.fromEntries(taken.entries());
  try { io.write(path, `${JSON.stringify({ names: "v1", at: new Date().toISOString(), taken: names }, null, 2)}\n`); }
  catch { /* a record this agent could not keep is said in the reply, not thrown */ }
}

export const disk = {
  read: (p) => readFileSync(p, "utf8"),
  bytes: (p) => readFileSync(p),
  write: (p, t) => writeFileSync(p, t),
  exists: (p) => existsSync(p),
};

/** The reply. It says what went where, what was refused and why, and it never
 *  names an address this agent has not read back. */
export function replyText({ served = [], refused = [], name = "", notes = 0 } = {}) {
  const lines = [];
  const good = served.filter((s) => s.ok);
  const bad = served.filter((s) => !s.ok);

  if (good.length) {
    lines.push(`${many(good.length, "file")} ${good.length === 1 ? "is" : "are"} published and ${good.length === 1 ? "its address serves" : "their addresses serve"} exactly what you handed over: ${listOf(good.map((s) => s.address))}`);
    lines.push(`I read every address back and compared it with what went up, so the digest beside each file in the record is what is being served, not what I meant to send. ${good.length === 1 ? "It is" : "They are"} cached for a minute, so a republish shows within one.`);
  }
  if (bad.length) {
    lines.push(`${many(bad.length, "file")} went up and ${bad.length === 1 ? "its address is not serving it" : "their addresses are not serving them"} yet, so ${bad.length === 1 ? "it is" : "they are"} not given as done: ${bad.map((s) => `${s.name}, because ${s.why}`).join("; ")}.`);
  }
  for (const r of refused) lines.push(sentence(r));
  if (name && good.length) lines.push(`The name you asked for was used for the first file, and the rest kept their own, so nothing quietly replaced anything.`);
  if (notes) lines.push(`${many(notes, "note")} came with the job. This job takes files and a name; ${notes === 1 ? "it" : "they"} changed nothing about what was published.`);
  if (good.length) lines.push("The record of what was published, with the digest of each file, is filed with the job.");
  return lines.join(" ");
}

export async function publish({ env = {}, argv = [], io = disk, fetchImpl = fetch } = {}) {
  const args = fromArgv(argv);
  const RECORDS = args.records || trim(env.RECORDS);
  const JOB_DIR = args.job || trim(env.JOB_DIR) || trim(env.MESH_JOB_DIR);
  const stop = (reply, extra = {}) => ({ ok: false, code: 3, reply, addresses: [], ...extra });
  if (!RECORDS) return { ok: false, code: 2, reply: "this job needs a records folder: --records <folder>", addresses: [] };
  mkdirSync(RECORDS, { recursive: true });

  const text = args.textFile && io.exists(args.textFile) ? io.read(args.textFile) : "";
  const notes = trim(text) ? 1 : 0;
  const name = nameGiven({ env, text });

  // ── read what was given ──────────────────────────────────────────────────
  const given = [];
  for (const f of args.files) {
    if (!io.exists(f.path)) continue;
    given.push({ name: basename(f.path), bytes: io.bytes(f.path), declared: f.declared, path: f.path });
  }
  if (!given.length) return stop(NOTHING_GIVEN);

  const bytesMax = trim(env.PUBLISH_BYTES_MAX) ? Number(env.PUBLISH_BYTES_MAX) : BYTES_MAX_DEFAULT;
  if (!(Number.isFinite(bytesMax) && bytesMax > 0)) {
    return stop(`PUBLISH_BYTES_MAX is not a number of bytes: ${env.PUBLISH_BYTES_MAX}. That is a setting on this agent, so it is the host's to fix.`);
  }
  const reading = readingOf(given.map(({ name: n, bytes, declared }) => ({ name: n, bytes, declared })), { given: name, bytesMax });
  json(join(RECORDS, "reading.json"), reading);

  const refused = reading.files.filter((f) => f.refused).map((f) => f.refused);
  const going = reading.files.filter((f) => !f.refused);
  if (!going.length) {
    return stop(`Nothing was published. ${refused.map(sentence).join(" ")} Nothing was changed at any address, and I have not altered any of these files to make them publishable: that is yours to decide.`,
      { refused });
  }

  // ── place the files ──────────────────────────────────────────────────────
  const taken = knownNames(namesFile(RECORDS), io);
  const clash = going.find((f) => taken.has(f.name) && taken.get(f.name) !== "this agent");
  if (clash) {
    return stop(`${clash.name} is a name already in use by something this agent did not place, so it was not replaced and nothing was published. Send a different name and I will publish under it.`);
  }

  const folder = folderFor(going[0].name);
  const placed = [];
  for (const f of going) {
    const bytes = given.find((g) => g.name === f.given_name).bytes;
    const object = `${folder}/${f.name}`;
    try {
      placed.push(await placeOne({ env, object, name: f.name, bytes, type: f.type, fetchImpl }));
    } catch (e) {
      json(join(RECORDS, "placed.json"), { placed: "v1", at: new Date().toISOString(), files: placed });
      if (e.stopped) {
        return stop(`This agent is stopped. ${placed.length ? `${many(placed.length, "file")} went up before it stopped and ${placed.length === 1 ? "is" : "are"} at ${listOf(placed.map((p) => p.address))}; nothing has been read back, so I am not giving ${placed.length === 1 ? "it" : "them"} as done.` : "Nothing was published."}`);
      }
      return stop(`${sentence(e.message)} ${placed.length ? `${many(placed.length, "file")} went up before it stopped and ${placed.length === 1 ? "is" : "are"} at ${listOf(placed.map((p) => p.address))}; nothing has been read back, so I am not giving ${placed.length === 1 ? "it" : "them"} as done.` : "Nothing was published."}`);
    }
  }
  json(join(RECORDS, "placed.json"), { placed: "v1", at: new Date().toISOString(), files: placed });

  // ── check what is served ─────────────────────────────────────────────────
  const served = [];
  for (const p of placed) served.push(await readBack({ placed: p, fetchImpl }));
  const servedPath = join(RECORDS, "served.json");
  json(servedPath, { published: "v1", at: new Date().toISOString(), files: served });

  for (const s of served.filter((x) => x.ok)) taken.set(s.name, "this agent");
  rememberNames(namesFile(RECORDS), taken, io);

  const good = served.filter((s) => s.ok);
  if (!good.length) {
    return stop(`${many(placed.length, "file")} went up and no address is serving what went up, so there is nothing I can give you as published: ${served.map((s) => `${s.name}, because ${s.why}`).join("; ")}. The record of what was placed is in the records.`);
  }

  let listed = [];
  if (JOB_DIR && io.exists(JOB_DIR)) {
    try { listed = fill(JOB_DIR, piecesPlan({ served, recordPath: servedPath })).map((e) => e.name); }
    catch (e) { refused.push(`the pieces could not be filed with the job: ${trim(e.message)}`); }
  }

  return {
    ok: true,
    code: 0,
    reply: replyText({ served, refused, name, notes }),
    addresses: good.map((s) => s.address),
    published: good.map((s) => ({ name: s.name, address: s.address, sha256: s.sha256, bytes: s.bytes, type: s.type })),
    refused: reading.files.filter((f) => f.refused).map((f) => ({ file: f.given_name, why: f.refused })),
    listed,
  };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
  const out = await publish({ env: process.env, argv: process.argv.slice(2) }).catch((e) => ({
    ok: false, code: 1, reply: `Nothing was published, and this is what stopped it: ${sentence(e?.message ?? e)}`, addresses: [],
  }));
  console.log(JSON.stringify(out, null, 2));
  // Never process.exit here: a fetch that is still settling is torn down by an
  // immediate exit and the process dies inside libuv instead of reporting.
  process.exitCode = out.code ?? 0;
}
