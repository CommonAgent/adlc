// The form, filled from an example the way a page fills it, and the message
// a page sends when the person presses Run.
//
// A page draws one control per input a person gives, from the Descriptor
// alone, and turns what was given into one message to the agent: the one
// input of words as the message itself, every other value on a line of its
// own (`<input name>: <value>`), and each file attached under its input's
// name. The App's run view does it so (AgentMesh app-next
// src/run-view.ts messageOf); the tester sends exactly that, so what it
// finds is what a person would meet.
//
// An example value is a string, as a person types it, or a file: one the
// agent's package carries, `{file, digest, media_type, name}`, or one at a
// public address, `{url, media_type, digest, name}` (Common Agent 6.13.8,
// proposed). A file in the package is taken from what the job was given (an
// attached package or any attached file with the same digest); a file at an
// address is fetched with no credentials. Either is used only when its
// SHA-256 equals the digest, where one is stated.
//
//   needs: node >= 22
//   import { fillForm } from "./form.mjs"
import { createHash } from "node:crypto";
import { personInputs, isStructured, RUN_CONTEXT } from "./descriptor-checks.mjs";

const trim = (s) => String(s ?? "").trim();
const base = (k) => trim(k).split(";")[0].trim().toLowerCase();
const sha = (b) => `sha256:${createHash("sha256").update(b).digest("hex")}`;
export const MAX_FILE_BYTES = 20 * 1024 * 1024;

const EXT = {
  "application/json": ".json", "text/markdown": ".md", "text/plain": ".txt", "text/html": ".html", "text/vtt": ".vtt",
  "text/csv": ".csv", "application/pdf": ".pdf", "application/zip": ".zip", "application/gzip": ".tar.gz",
};
/** A file's name as the receiving agent reads it: with its kind's extension. */
export function fileNameFor(name, mediaType) {
  if (/\.[a-z0-9]{1,5}$/i.test(name)) return name;
  const t = base(mediaType);
  return name + (EXT[t] ?? (/json$/.test(t) ? ".json" : t === "application/x-subrip" ? ".srt" : t.startsWith("audio/mpeg") ? ".mp3" : ""));
}
/** A file sent under its input's name, keeping its own extension. */
function namedFile(input, file) {
  const ext = /\.[a-z0-9]{1,5}$/i.exec(file.name)?.[0] ?? "";
  return { ...file, name: ext ? `${input}${ext.toLowerCase()}` : fileNameFor(input, file.media_type) };
}

/** Whether a file of `type` can be given to an input of `kind`. */
export function takes(input, type) {
  const k = base(input.kind);
  const t = base(type);
  if (!t) return true;
  if (k === "document") return !Array.isArray(input.accepts) || input.accepts.map(base).includes(t);
  if (k === "text" || k === "identifier") return t.startsWith("text/");
  if (k === "url") return false;
  if (k === t) return true;
  // An old bare JSON kind still takes a specific JSON kind, and the other way.
  if (/json$/.test(k) && /json$/.test(t)) return true;
  return false;
}

/**
 * The form filled from `example` for offering `o`, and the message it sends.
 *   fetchFile(url) -> {ok, bytes, type, error}   a fetch with no credentials
 *   attached: [{name, bytes}]                     files the job was given
 * Answers {ok, problems[], message: {text, files[{name, media_type, data_b64}]}, shown[]}.
 */
export async function fillForm(o, example, { nameJob = false, fetchFile, attached = [] } = {}) {
  const problems = [];
  const shown = [];
  const files = [];
  const lines = [];
  let body = "";
  const all = Array.isArray(o.inputs) ? o.inputs : [];
  const given = example?.inputs && typeof example.inputs === "object" ? example.inputs : {};
  const words = personInputs(o).filter((i) => base(i.kind) === "text" && !i.one_of);
  for (const k of Object.keys(given)) if (!all.some((i) => i.name === k)) problems.push(`the example gives "${k}", and the offering has no input of that name, so a page has no field to put it in`);
  for (const i of all) {
    if (RUN_CONTEXT.test(trim(i.kind))) continue;
    const v = given[i.name];
    // A person who runs the offering gives every input it needs, those
    // other agents usually hand over included, as pieces of their kinds
    // (Common Agent 6.13.2), so the example names every required one.
    if (v === undefined) {
      if (i.required && !i.one_of) problems.push(`the example gives nothing for the required input "${i.name}"`);
      continue;
    }
    if (typeof v === "string") {
      const typed = v.replace(/^\s*\n/, "").replace(/\s+$/, "");
      if (!typed.trim()) { if (i.required && !i.one_of) problems.push(`the example leaves the required input "${i.name}" empty`); continue; }
      const k = base(i.kind);
      if (k === "url") {
        if (!/^https?:\/\/\S+$/.test(typed.trim())) problems.push(`"${i.name}" takes an address, and the example gives "${typed.trim().slice(0, 80)}"`);
        lines.push(`${i.name}: ${typed.trim()}`);
      } else if (k === "text" || k === "identifier" || k.startsWith("text/")) {
        // Words: the one input of words is the message itself; any other
        // goes on a line of its own, so a line the agent reads stays at the
        // start of a line.
        if (k === "text" && words.length === 1 && words[0] === i && !body && (!nameJob || i.name === "text")) body = typed;
        else if (k.startsWith("text/") && !i.one_of && !body && !nameJob) body = typed;
        else if (typed.includes("\n")) lines.push(`${i.name}:\n${typed}`);
        else lines.push(`${i.name}: ${typed.trim()}`);
      } else if (isStructured(k)) {
        // Pasted data goes as a file named for its input, of its kind.
        files.push({ name: fileNameFor(i.name, k), media_type: k, data_b64: Buffer.from(typed, "utf8").toString("base64") });
      } else {
        problems.push(`"${i.name}" takes a file (${i.kind}), and the example gives words`);
        continue;
      }
      shown.push({ input: i.name, value: typed.length > 160 ? `${typed.slice(0, 157)}...` : typed });
      continue;
    }
    if (!v || typeof v !== "object" || (!v.file && !v.url)) { problems.push(`the example's value for "${i.name}" is neither words nor a file`); continue; }
    const type = trim(v.media_type);
    if (type && !takes(i, type)) problems.push(`"${i.name}" takes ${i.kind}${Array.isArray(i.accepts) ? ` (${i.accepts.join(", ")})` : ""}, and the example's file is ${type}`);
    let bytes = null;
    let from = "";
    if (v.file) {
      const want = trim(v.digest);
      const hit = attached.find((a) => (want && sha(a.bytes) === want) || a.name === trim(v.file) || a.name === trim(v.file).split("/").pop());
      if (hit) { bytes = hit.bytes; from = `the attached ${hit.name}`; }
      else { problems.push(`the example's file ${v.file} is in the agent's package, and no package or file with its digest came with this job`); continue; }
    } else {
      const got = fetchFile ? await fetchFile(trim(v.url)) : { ok: false, error: "nothing here fetches addresses" };
      if (!got.ok) { problems.push(`the example's file at ${v.url} could not be fetched: ${got.error}`); continue; }
      bytes = got.bytes;
      from = trim(v.url);
    }
    if (bytes.length > MAX_FILE_BYTES) { problems.push(`the example's file for "${i.name}" is ${bytes.length} bytes, more than a page sends`); continue; }
    if (trim(v.digest) && sha(bytes) !== trim(v.digest)) { problems.push(`the example's file for "${i.name}" (${from}) hashes to ${sha(bytes)}, not the ${trim(v.digest)} the example states`); continue; }
    const name = trim(v.name) || trim(v.file || v.url).split("/").pop().split("?")[0] || i.name;
    const out = namedFile(i.name, { name, media_type: type || (base(i.kind).includes("/") ? base(i.kind) : "application/octet-stream"), data_b64: bytes.toString("base64") });
    files.push(out);
    shown.push({ input: i.name, value: `${out.name} (${bytes.length} bytes, from ${from})` });
  }
  const groups = [...new Set(all.filter((i) => !RUN_CONTEXT.test(trim(i.kind))).map((i) => i.one_of).filter(Boolean))];
  for (const g of groups) if (!all.some((i) => i.one_of === g && given[i.name] !== undefined)) problems.push(`the example gives none of the "${g}" inputs, and the form needs one`);
  const said = [body, lines.join("\n")].filter(Boolean).join("\n\n");
  const text = nameJob ? [`${trim(o.name) || o.id}.`, said].filter(Boolean).join("\n\n") : said || `${trim(o.name) || o.id}.`;
  return { ok: !problems.length, problems, message: { text, files }, shown };
}
