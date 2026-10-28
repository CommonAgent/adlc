// Whether a delivered piece is what its declared kind says, and whether a
// person can read it as it comes.
//
// A piece a person reads as it is (Markdown, text, a page, an address, a
// picture, a sound or a film) is readable when its bytes are what its kind
// says and they hold something to read. A piece of structured data is
// readable to a person only when its output declares a presentation a page
// knows how to draw (quiz, facts, table, document) and its bytes fit it;
// without one, a person is shown the data as it is, and that is a finding.
// No model reads anything here: the same pieces give the same answers.
//
//   needs: node >= 22
//   import { judgePiece } from "./readable.mjs"
import { isStructured, readsAsItIs, PRESENTATIONS } from "./descriptor-checks.mjs";

const trim = (s) => String(s ?? "").trim();
const base = (k) => trim(k).split(";")[0].trim().toLowerCase();

const MAGIC = [
  [/^image\/png$/, (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))],
  [/^image\/jpe?g$/, (b) => b[0] === 0xff && b[1] === 0xd8],
  [/^image\/gif$/, (b) => b.subarray(0, 3).toString("latin1") === "GIF"],
  [/^image\/webp$/, (b) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP"],
  [/^image\/svg\+xml$/, (b) => /<svg[\s>]/i.test(b.subarray(0, 4096).toString("utf8"))],
  [/^video\/mp4$|^audio\/mp4$|^video\/quicktime$/, (b) => b.subarray(4, 8).toString("latin1") === "ftyp"],
  [/^video\/webm$|^audio\/webm$/, (b) => b.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))],
  [/^audio\/mpeg$/, (b) => b.subarray(0, 3).toString("latin1") === "ID3" || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)],
  [/^audio\/(wav|x-wav|wave)$/, (b) => b.subarray(0, 4).toString("latin1") === "RIFF"],
  [/^audio\/ogg$|^video\/ogg$/, (b) => b.subarray(0, 4).toString("latin1") === "OggS"],
  [/^application\/pdf$/, (b) => b.subarray(0, 5).toString("latin1") === "%PDF-"],
  [/^application\/(gzip|x-gzip)$/, (b) => b[0] === 0x1f && b[1] === 0x8b],
  [/^application\/zip$/, (b) => b.subarray(0, 2).toString("latin1") === "PK"],
];

/** Text that is not words for a person: leftovers of code. */
const LEFTOVER = /(?:^|:\s*|\|\s*)(?:undefined|NaN)\s*(?:\||$)|\[object Object\]|\{\{\s*[\w.]+\s*\}\}|Traceback \(most recent call last\)|^\s*at [\w.<>]+ \(.*:\d+:\d+\)$/m;

function asJson(text) { try { return { ok: true, doc: JSON.parse(text) }; } catch (e) { return { ok: false, why: trim(e.message) }; } }

/** Whether structured data fits the presentation a page draws it as. */
function fitsPresentation(p, doc) {
  const list = Array.isArray(doc) ? doc : Object.values(doc ?? {}).find((v) => Array.isArray(v));
  if (p === "quiz") {
    const qs = Array.isArray(doc?.questions) ? doc.questions : Array.isArray(doc) ? doc : null;
    return qs && qs.length ? "" : "it holds no list of questions";
  }
  if (p === "facts" || p === "table") return list && list.length ? "" : `it holds no list of ${p === "facts" ? "statements" : "rows"}`;
  if (p === "document") return typeof doc === "string" || (doc && typeof doc === "object") ? "" : "it holds no text";
  return "";
}

/**
 * One delivered piece judged against its declared output.
 *   output: the Descriptor's output ({name, kind, presentation}) or null
 *   piece:  the manifest's piece ({name, media_type, size})
 *   bytes:  the piece's bytes, or null when they could not be read
 * Answers {name, kind, matches, readable, for_a_person, problems[], words}.
 */
export function judgePiece(output, piece, bytes) {
  const problems = [];
  const declared = base(output?.kind);
  const sent = base(piece?.media_type);
  const kind = declared || sent;
  const out = { name: trim(piece?.name), kind: sent || declared, declared: declared || null, matches: true, readable: false, for_a_person: true, problems, words: "" };
  if (!output) problems.push("no output of this name is declared, so a page cannot tell what it is");
  if (declared && sent && declared !== sent && !(/json$/.test(declared) && /json$/.test(sent))) { out.matches = false; problems.push(`it is declared ${declared} and was delivered as ${sent}`); }
  if (!bytes) { problems.push("its bytes could not be read"); return out; }
  if (!bytes.length) { problems.push("it is empty"); return out; }
  const p = trim(output?.presentation);
  const text = () => bytes.toString("utf8");

  if (kind === "text/markdown" || kind === "text" || kind === "text/plain") {
    const t = text().trim();
    if (/^[[{]/.test(t) && asJson(t).ok) { out.matches = false; problems.push("it is JSON, not words a person reads"); return out; }
    if (/^<!doctype html|^<html[\s>]/i.test(t)) { out.matches = false; problems.push("it is an HTML page, not Markdown"); return out; }
    if (t.replace(/\s+/g, " ").length < 20) { problems.push(`it holds almost nothing to read ("${t.slice(0, 40)}")`); return out; }
    if (LEFTOVER.test(t)) problems.push(`it carries leftovers of code a person should never see ("${(LEFTOVER.exec(t)?.[0] ?? "").trim().slice(0, 60)}")`);
    out.readable = !problems.length || problems.every((x) => /no output of this name/.test(x));
    out.words = `${t.split(/\s+/).length} words${kind === "text/markdown" && /^#{1,6} |^\s*[-*] |\n#{1,6} /m.test(t) ? ", with headings or lists" : ""}`;
    return out;
  }
  if (kind === "text/html") {
    const t = text();
    if (!/<(html|body|p|h1|h2|div|main|article|section)[\s>]/i.test(t)) { out.matches = false; problems.push("it is not an HTML page"); return out; }
    const visible = t.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (visible.length < 20) problems.push("the page shows almost nothing to read");
    if (LEFTOVER.test(visible)) problems.push(`the page shows leftovers of code ("${(LEFTOVER.exec(visible)?.[0] ?? "").trim().slice(0, 60)}")`);
    out.readable = !problems.filter((x) => !/no output of this name/.test(x)).length;
    out.words = `a page of ${visible.split(/\s+/).length} words`;
    return out;
  }
  if (kind === "url") {
    const first = text().trim().split(/\r?\n/)[0];
    if (!/^https?:\/\/\S+$/.test(first)) { out.matches = false; problems.push(`it is not an address ("${first.slice(0, 60)}")`); return out; }
    out.readable = !problems.filter((x) => !/no output of this name/.test(x)).length;
    out.words = first;
    return out;
  }
  if (kind === "text/vtt" || kind === "text/csv") {
    const t = text();
    if (kind === "text/vtt" && !t.replace(/^\s+/, "").replace(String.fromCharCode(0xfeff), "").startsWith("WEBVTT")) { out.matches = false; problems.push("it does not start WEBVTT"); return out; }
    out.readable = !problems.filter((x) => !/no output of this name/.test(x)).length;
    out.words = `${t.split(/\r?\n/).length} lines`;
    return out;
  }
  const magic = MAGIC.find(([re]) => re.test(kind));
  if (magic) {
    if (!magic[1](bytes)) { out.matches = false; problems.push(`its bytes are not ${kind}`); return out; }
    out.readable = !problems.filter((x) => !/no output of this name/.test(x)).length;
    out.words = `${kind}, ${bytes.length} bytes`;
    return out;
  }
  if (isStructured(kind)) {
    const j = asJson(text());
    if (!j.ok) { out.matches = false; problems.push(`it is declared ${kind} and is not JSON (${j.why})`); return out; }
    if (!p) { out.for_a_person = false; problems.push("it is structured data with no presentation, so a person is shown the data as it is"); out.words = "structured data"; return out; }
    if (!PRESENTATIONS.includes(p)) { out.for_a_person = false; problems.push(`its presentation "${p}" is not one a page knows`); return out; }
    const misfit = fitsPresentation(p, j.doc);
    if (misfit) problems.push(`it is presented as ${p} and ${misfit}`);
    out.readable = !problems.filter((x) => !/no output of this name/.test(x)).length;
    out.words = `${p}, drawn from structured data`;
    return out;
  }
  out.for_a_person = readsAsItIs(kind);
  if (!out.for_a_person) problems.push(`a page has no way to show ${kind} to a person`);
  out.readable = out.for_a_person && !problems.filter((x) => !/no output of this name/.test(x)).length;
  out.words = `${kind}, ${bytes.length} bytes`;
  return out;
}
