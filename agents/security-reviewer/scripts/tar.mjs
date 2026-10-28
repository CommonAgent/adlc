// Read an Agent Package handed over as a .tar.gz (or a plain .tar) into
// memory: each regular file's path inside the package and its bytes.
//
// Nothing is written to disk and nothing is run. A path that climbs out of the
// package (an absolute path, or a .. part) is not read and is reported, since
// a package that carries one is itself a finding. Links are reported and not
// followed: a link can point anywhere on the machine that unpacks it.
//
//   needs: node >= 22
//   import { readTar } from "./tar.mjs"
import { gunzipSync } from "node:zlib";

/** The most a package may unpack to here, and the most files it may hold. A
 *  package past either is not read, and the reply says so, rather than read in
 *  part: a review of part of a package reads exactly like a review of all of it. */
export const MOST_BYTES = 200 * 1024 * 1024;
export const MOST_FILES = 20000;

export const isGzip = (b) => b.length > 2 && b[0] === 0x1f && b[1] === 0x8b;

/** A tar header's text field: up to its first NUL. */
const field = (buf, at, len) => {
  const s = buf.subarray(at, at + len);
  const end = s.indexOf(0);
  return s.subarray(0, end === -1 ? s.length : end).toString("utf8");
};
const octal = (buf, at, len) => {
  const s = field(buf, at, len).trim();
  return s ? parseInt(s, 8) : 0;
};

/** The pax records of an extended header: "len key=value\n" each, the length
 *  counted in bytes. */
function paxRecords(bytes) {
  const out = {};
  let i = 0;
  while (i < bytes.length) {
    const sp = bytes.indexOf(0x20, i);
    if (sp === -1) break;
    const len = Number(bytes.subarray(i, sp).toString("latin1"));
    if (!Number.isInteger(len) || len <= 0 || i + len > bytes.length) break;
    const rec = bytes.subarray(sp + 1, i + len - 1).toString("utf8");
    const eq = rec.indexOf("=");
    if (eq > 0) out[rec.slice(0, eq)] = rec.slice(eq + 1);
    i += len;
  }
  return out;
}

/** A path as the package names it, with a leading ./ and the package's own
 *  top folder kept: the caller decides what the top folder is. */
export function cleanPath(p) {
  const s = String(p ?? "").replace(/\\/g, "/").replace(/^(\.\/)+/, "");
  if (!s || s.startsWith("/") || /^[A-Za-z]:/.test(s)) return { path: s, climbs: Boolean(s) };
  const parts = s.split("/").filter((x) => x && x !== ".");
  return { path: parts.join("/"), climbs: parts.includes("..") };
}

/** Read a tar, gzipped or not. Returns { files: Map(path -> Buffer), links, climbing, error }. */
export function readTar(bytes) {
  let buf;
  try {
    buf = isGzip(bytes) ? gunzipSync(bytes, { maxOutputLength: MOST_BYTES }) : bytes;
  } catch (e) {
    const big = /maxOutputLength|buffer|Cannot create a Buffer/i.test(String(e?.message));
    return { files: new Map(), links: [], climbing: [], error: big ? `it unpacks to more than ${MOST_BYTES / (1024 * 1024)} MB, the most this reviewer reads` : `it is not a gzip file that unpacks (${e?.code ?? e?.message})` };
  }
  const files = new Map();
  const links = [];
  const climbing = [];
  let at = 0;
  let longName = "";
  let pax = {};
  while (at + 512 <= buf.length) {
    const head = buf.subarray(at, at + 512);
    if (head.every((b) => b === 0)) break;
    const size = octal(head, 124, 12);
    // A size that is not a number, or a body that runs past the end, is an
    // archive that cannot be read whole; reading the part before it would be
    // a review of part of a package that reads like one of all of it.
    if (!Number.isInteger(size) || size < 0) return { files: new Map(), links, climbing, error: `an entry at byte ${at} has a size that is not a number, so the archive cannot be read whole` };
    if (at + 512 + size > buf.length) return { files: new Map(), links, climbing, error: `an entry at byte ${at} runs past the end of the archive, so it was cut short` };
    const type = String.fromCharCode(head[156] || 48);
    const magic = field(head, 257, 6);
    let name = field(head, 0, 100);
    const prefix = magic.startsWith("ustar") ? field(head, 345, 155) : "";
    if (prefix) name = `${prefix}/${name}`;
    if (longName) { name = longName; longName = ""; }
    if (pax.path) { name = pax.path; }
    const body = buf.subarray(at + 512, at + 512 + size);
    at += 512 + Math.ceil(size / 512) * 512;
    if (type === "L") { longName = field(body, 0, body.length); continue; }
    if (type === "x") { pax = paxRecords(body); continue; }
    if (type === "g") continue;
    pax = {};
    const { path, climbs } = cleanPath(name);
    if (climbs) { climbing.push(name); continue; }
    if (type === "1" || type === "2") { links.push(path); continue; }
    if (type !== "0" && type !== "\0" && type !== "7") continue; // folders and devices carry no bytes
    if (files.size >= MOST_FILES) return { files: new Map(), links, climbing, error: `it holds more than ${MOST_FILES} files, the most this reviewer reads` };
    files.set(path, Buffer.from(body));
  }
  if (!files.size && !links.length && !climbing.length) return { files, links, climbing, error: "it holds no files" };
  return { files, links, climbing, error: "" };
}

/** The package's own files, with the one top folder a packer puts them in
 *  taken off, so `brand-reader/agent-descriptor.json` reads as
 *  `agent-descriptor.json`. A file outside that folder is kept under its own
 *  path and named in `outside`, never dropped: a review that leaves out part
 *  of what was handed over is not a review of it. Returns { files, top, outside }. */
export function packageRoot(files) {
  const has = (p) => files.has(p);
  if (has("agent-descriptor.json") || has("plugin.json") || has("descriptor.json")) return { files, top: "", outside: [] };
  const tops = new Set([...files.keys()].map((p) => p.split("/")[0]));
  for (const top of tops) {
    if (has(`${top}/agent-descriptor.json`) || has(`${top}/plugin.json`) || has(`${top}/descriptor.json`)) {
      const out = new Map();
      const outside = [];
      for (const [p, b] of files) {
        if (p.startsWith(`${top}/`)) out.set(p.slice(top.length + 1), b);
        else { outside.push(p); out.set(`(outside ${top})/${p}`, b); }
      }
      return { files: out, top, outside };
    }
  }
  return { files, top: "", outside: [] };
}
