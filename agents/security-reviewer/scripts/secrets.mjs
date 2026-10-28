// What looks like a credential in a package's files.
//
// The list is the publisher's own, the one it refuses to publish
// (agents/publisher/scripts/inspect.mjs SECRETS, explained in
// agents/publisher/references/what-it-will-not-publish.md), copied here
// because a package carries its own files. test/secrets.test.mjs fails when
// the two drift. Every entry is a thing that is only ever a live credential:
// a longer list would flag a page about authentication for saying "secret",
// and a finding nobody can predict is a finding people learn to ignore.
//
// A match is reported by file and line, and the matched bytes never go into
// the review, a record or the reply: a review that repeats a key has published
// it.
//
//   needs: node >= 22
//   import { credentialsIn } from "./secrets.mjs"

export const SECRETS = [
  { what: "a private key", find: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { what: "a service-account key", find: /"type"\s*:\s*"service_account"/ },
  { what: "a service-account key", find: /"private_key"\s*:\s*"-----BEGIN/ },
  { what: "an AWS access key", find: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { what: "an AWS secret key", find: /aws_secret_access_key\s*[=:]\s*\S{20,}/i },
  // A NATS seed is 58 characters: the S, the kind, and 56 of base32.
  { what: "an NKey seed", find: /\bS[UOAN][A-Z2-7]{56}\b/ },
  // The closing dashes are counted, not written, so this file does not carry
  // the very line it looks for.
  { what: "a PKCS#12 keystore", find: /-----BEGIN ENCRYPTED PRIVATE KEY-{5}/ },
];

const LEFT_OUT = "[left out: it looks like a credential]";
/** Tokens of the common services' own shapes, left out of what is written
 *  down even though they do not refuse a package on their own. */
const TOKENS = /\b(?:sk|pk|rk|ghp|gho|ghu|ghs|xox[abpr])[-_][A-Za-z0-9_-]{16,}\b|\bAIza[0-9A-Za-z_-]{35}\b/g;

/** Text with anything that looks like a credential taken out. */
export function scrub(text) {
  let t = String(text ?? "");
  for (const s of SECRETS) t = t.replace(new RegExp(s.find.source, s.find.flags.includes("g") ? s.find.flags : `${s.find.flags}g`), LEFT_OUT);
  return t.replace(TOKENS, LEFT_OUT);
}

/** A copy of a value read from a package, every string in it scrubbed, so
 *  nothing the package carries reaches a review, a record, a reply or the
 *  model as a credential. */
export function deepScrub(v) {
  if (typeof v === "string") return scrub(v);
  if (Array.isArray(v)) return v.map(deepScrub);
  if (v && typeof v === "object" && !Buffer.isBuffer(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deepScrub(x)]));
  return v;
}

/** Text, as the publisher reads it: no NUL in the first 8 KB. */
export function looksLikeText(bytes) {
  const head = bytes.subarray(0, 8192);
  return !head.includes(0);
}

/** Each credential-shaped thing in these files: { file, line, what }. Never the bytes. */
export function credentialsIn(files) {
  const found = [];
  for (const [path, bytes] of files) {
    if (!looksLikeText(bytes)) continue;
    const lines = bytes.toString("utf8").split("\n");
    for (const s of SECRETS) {
      const at = lines.findIndex((l) => s.find.test(l));
      if (at !== -1 && !found.some((f) => f.file === path && f.what === s.what)) found.push({ file: path, line: at + 1, what: s.what });
    }
  }
  return found;
}
