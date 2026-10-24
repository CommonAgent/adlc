// Read what was handed over, and decide whether it can be published at all.
//
// Publishing is the act that puts something in front of people. It is the one
// step in a lifecycle whose mistakes are public, and the two mistakes that
// matter are publishing something nobody looked at and publishing something
// that should never have left the building. Both are settled here, before a
// single byte goes anywhere.
//
// Everything in this file decides on BYTES. A name is what somebody typed and
// bytes are what will be served, so a file called page.html that is not text
// is refused, and a file called notes.txt that is a private key is refused as
// a private key. Naming a thing does not make it that thing.
import { createHash } from "node:crypto";
import { basename, extname } from "node:path";

const trim = (t) => String(t ?? "").trim();

/** The types this agent will place, by the bytes that begin them. A type not
 *  on this list is not published, because serving bytes whose type nobody has
 *  agreed on is how a browser is asked to guess, and a browser guessing about
 *  content somebody uploaded is the oldest hole there is. */
export const SIGNATURES = [
  { type: "image/png",  test: (b) => b.length > 8 && b[0] === 0x89 && b.toString("latin1", 1, 4) === "PNG" },
  { type: "image/jpeg", test: (b) => b.length > 3 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF },
  { type: "image/gif",  test: (b) => b.toString("latin1", 0, 6) === "GIF87a" || b.toString("latin1", 0, 6) === "GIF89a" },
  { type: "image/webp", test: (b) => b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP" },
  { type: "application/pdf", test: (b) => b.toString("latin1", 0, 5) === "%PDF-" },
  { type: "video/mp4",  test: (b) => b.length > 12 && b.toString("latin1", 4, 8) === "ftyp" },
  { type: "audio/mpeg", test: (b) => b.toString("latin1", 0, 3) === "ID3" || (b[0] === 0xFF && (b[1] & 0xE0) === 0xE0) },
  { type: "font/woff2", test: (b) => b.toString("latin1", 0, 4) === "wOF2" },
];

/** The text types, decided by what the text looks like once we know it is
 *  text. The order matters: an SVG is XML and an XML file is not an SVG. */
export const TEXT_TYPES = [
  { type: "image/svg+xml", test: (t) => /<svg[\s>]/i.test(t.slice(0, 4000)) },
  { type: "text/html", test: (t) => /^\s*(<!doctype html|<html[\s>])/i.test(t.slice(0, 400)) },
  { type: "application/json", test: (t) => { try { JSON.parse(t); return true; } catch { return false; } } },
];

export const EXTENSION_TYPES = {
  ".html": "text/html", ".htm": "text/html", ".css": "text/css", ".js": "text/javascript",
  ".mjs": "text/javascript", ".json": "application/json", ".md": "text/markdown",
  ".txt": "text/plain", ".csv": "text/csv", ".svg": "image/svg+xml", ".xml": "application/xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
  ".webp": "image/webp", ".pdf": "application/pdf", ".mp4": "video/mp4", ".mp3": "audio/mpeg",
  ".woff2": "font/woff2", ".vtt": "text/vtt",
};

/** Text, for this purpose, is bytes that decode as UTF-8 and carry no control
 *  characters a document would not. A stray NUL is the usual sign that a file
 *  called .txt is not text at all. */
export function looksLikeText(bytes) {
  const head = bytes.subarray(0, 8192);
  if (head.includes(0)) return false;
  const text = head.toString("utf8");
  if (text.includes("�")) return false;
  // The C0 controls a document never carries: NUL through backspace,
  // vertical tab, form feed, and the rest of the block below space.
  // eslint-disable-next-line no-control-regex
  return !/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(text);
}

/** What this file actually is. `declared` is what the sender or the extension
 *  claimed, and is only ever used to disagree with. */
export function typeOf(bytes) {
  for (const s of SIGNATURES) { try { if (s.test(bytes)) return s.type; } catch { /* not this one */ } }
  if (!looksLikeText(bytes)) return null;
  const text = bytes.toString("utf8");
  for (const t of TEXT_TYPES) { if (t.test(text)) return t.type; }
  return "text/plain";
}

/** A type is compatible with a claim when they are the same, or when the claim
 *  is a text type and the bytes are text. text/css and text/markdown and
 *  text/csv have no signature and never will, so the bytes can only say "this
 *  is text", and the claim is allowed to be more specific than that. */
export function agrees(found, claimed) {
  const c = trim(claimed).split(";")[0].toLowerCase();
  if (!c || !found) return true;
  if (found === c) return true;
  if (found === "text/plain" && c.startsWith("text/")) return true;
  if (found === "text/plain" && (c === "application/json" || c === "application/xml")) return true;
  if (found === "application/json" && c.startsWith("text/")) return true;
  if (found === "text/html" && c === "text/plain") return true;
  return false;
}

/** What must never be published, found in the bytes rather than in the name.
 *
 *  This list is short on purpose. A long one starts refusing ordinary work: a
 *  page about authentication says the word secret, and a refusal a person
 *  cannot predict is worse than no refusal, because they stop handing things
 *  over. Every entry here is a thing that is only ever a live credential. */
export const SECRETS = [
  { what: "a private key", find: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { what: "a service-account key", find: /"type"\s*:\s*"service_account"/ },
  { what: "a service-account key", find: /"private_key"\s*:\s*"-----BEGIN/ },
  { what: "an AWS access key", find: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { what: "an AWS secret key", find: /aws_secret_access_key\s*[=:]\s*\S{20,}/i },
  // A NATS seed is 58 characters: the S, the kind, and 56 of base32.
  { what: "an NKey seed", find: /\bS[UOAN][A-Z2-7]{56}\b/ },
  { what: "a PKCS#12 keystore", find: /-----BEGIN ENCRYPTED PRIVATE KEY-----/ },
];

export function carriesASecret(bytes) {
  if (!looksLikeText(bytes)) return null;
  const text = bytes.toString("utf8");
  for (const s of SECRETS) { if (s.find.test(text)) return s.what; }
  return null;
}

export const SLUG = /^[a-z0-9][a-z0-9-]{0,80}$/;

/** The name a file is published under. A given name wins for the first file;
 *  after that, and where none was given, the file's own name is reduced to a
 *  slug and keeps its extension. Nothing here can climb out of the folder:
 *  every part that is not a lowercase letter, a digit or a hyphen is a hyphen,
 *  so a dot-dot or a slash cannot survive the trip. */
export function nameFor(fileName, given = "", at = 0) {
  const ext = extname(fileName).toLowerCase();
  const stem = basename(fileName, extname(fileName));
  const wanted = at === 0 && trim(given) ? trim(given) : stem;
  const slug = wanted.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  if (!slug) return null;
  return ext ? `${slug}${ext}` : slug;
}

export const BYTES_MAX_DEFAULT = 25_000_000;

/** One file, read once: what it is, what it weighs, what it hashes to, and the
 *  name it would be published under. `refused` is a sentence or null, and a
 *  file with a sentence never reaches the next step. */
export function inspectOne({ name, bytes, declared = "", given = "", at = 0, bytesMax = BYTES_MAX_DEFAULT }) {
  const one = {
    given_name: name,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    declared: trim(declared) || EXTENSION_TYPES[extname(name).toLowerCase()] || "",
    type: null,
    name: null,
    refused: null,
  };
  if (!bytes.length) { one.refused = `${name} is empty, and an empty file is not a publication`; return one; }
  if (bytes.length > bytesMax) {
    one.refused = `${name} is ${bytes.length} bytes and this agent places nothing over ${bytesMax}`;
    return one;
  }
  const secret = carriesASecret(bytes);
  if (secret) {
    one.refused = `${name} carries ${secret}, and this agent does not publish one whatever it is called or who asks`;
    return one;
  }
  one.type = typeOf(bytes);
  if (!one.type) {
    one.refused = `${name} is bytes of a kind this agent does not place: it is not text and it begins with nothing this agent recognises`;
    return one;
  }
  if (!agrees(one.type, one.declared)) {
    one.refused = `${name} says it is ${one.declared} and its bytes are ${one.type}, so it is refused rather than served as either`;
    return one;
  }
  // The claim may be more specific than the bytes can prove. Where it is
  // compatible, the claim is what gets served, because text/css served as
  // text/plain is a stylesheet a browser will not apply.
  if (one.declared && agrees(one.type, one.declared) && one.declared !== one.type) one.type = one.declared;
  one.name = nameFor(name, given, at);
  if (!one.name) { one.refused = `${name} cannot be reduced to a name this agent can publish under`; return one; }
  if (!SLUG.test(one.name.replace(extname(one.name), "") || one.name)) {
    one.refused = `${name} would be published as ${one.name}, which is not a name this agent will use`;
    return one;
  }
  return one;
}

/** Every file, in the order they were handed over. The reading is the record
 *  of what this agent was given, and it is written whether or not anything is
 *  published, because a refusal is a thing somebody may want to look at. */
export function readingOf(files, { given = "", bytesMax = BYTES_MAX_DEFAULT } = {}) {
  const seen = new Map();
  const one = files.map((f, at) => inspectOne({ ...f, given, at, bytesMax }));
  for (const f of one) {
    if (f.refused || !f.name) continue;
    if (seen.has(f.name)) {
      f.refused = `${f.given_name} and ${seen.get(f.name)} would both be published as ${f.name}, and this agent will not have one quietly replace the other`;
      continue;
    }
    seen.set(f.name, f.given_name);
  }
  return { reading: "v1", at: new Date().toISOString(), files: one };
}
