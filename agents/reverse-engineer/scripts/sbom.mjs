// The dependencies part: a CycloneDX 1.5 bill of materials, made from the
// lockfiles and manifests the codebase carries, by these rules and never by
// the model. The same files always give the same bytes: nothing in it reads
// the clock, and its serial number is made from the repository, the commit and
// the files it was read from.
//
// What it reads, at any depth outside the folders codebase.mjs skips:
//   - package-lock.json or npm-shrinkwrap.json (lockfile versions 1, 2 and 3):
//     every installed package with its exact version, its integrity as a hash,
//     whether it is a development dependency or optional, and what each one
//     depends on, resolved the way node resolves it (the nearest
//     node_modules folder up the tree);
//   - package.json, only where no lockfile sits beside it: the direct
//     dependencies, with the version ranges written there, each marked as a
//     range, because nothing says which version was installed;
//   - requirements.txt: `name==version` lines exactly, anything else as a range;
//   - go.mod: each required module and its version;
//   - Cargo.lock: each package and its version.
// Anything it cannot read is a gap, said in words, never a guess.
//
//   needs: node >= 22. Nothing here writes a file.
//   import { makeSbom } from "./sbom.mjs"
import { createHash } from "node:crypto";
import { basename, dirname } from "node:path";
import { linesOf, readInside, slash } from "./codebase.mjs";

const trim = (s) => String(s ?? "").trim();
const posixDir = (p) => { const d = slash(dirname(p)); return d === "." ? "" : d; };
const within = (dir, name) => (dir ? `${dir}/${name}` : name);

/** The manifests this file reads, by file name. */
export const READS = ["package-lock.json", "npm-shrinkwrap.json", "package.json", "requirements.txt", "go.mod", "Cargo.lock"];

/** A package URL (purl) for an npm package: the scope's @ written %40. */
export function npmPurl(name, version) {
  const n = trim(name);
  const enc = n.startsWith("@") ? `%40${n.slice(1).split("/").map(encodeURIComponent).join("/")}` : encodeURIComponent(n);
  return `pkg:npm/${enc}${version ? `@${encodeURIComponent(version)}` : ""}`;
}

/** An npm integrity string (sha512-<base64>) as CycloneDX hashes. */
export function hashesOf(integrity) {
  const out = [];
  for (const part of trim(integrity).split(/\s+/).filter(Boolean)) {
    const m = /^(sha1|sha256|sha384|sha512)-(.+)$/.exec(part);
    if (!m) continue;
    const alg = { sha1: "SHA-1", sha256: "SHA-256", sha384: "SHA-384", sha512: "SHA-512" }[m[1]];
    try {
      const hex = Buffer.from(m[2], "base64").toString("hex");
      if (hex) out.push({ alg, content: hex });
    } catch { /* not base64: no hash */ }
  }
  return out;
}

const nameFromPath = (p) => {
  const at = p.lastIndexOf("node_modules/");
  return at < 0 ? "" : p.slice(at + "node_modules/".length);
};

/** Resolve `name` as node does from the package at `from` (a lockfile path
 *  such as node_modules/a): its own node_modules, then each one up the tree. */
function resolveFrom(packages, from, name) {
  let base = from;
  for (;;) {
    const candidate = base ? `${base}/node_modules/${name}` : `node_modules/${name}`;
    if (packages[candidate]) return candidate;
    if (!base) return null;
    const at = base.lastIndexOf("/node_modules/");
    base = at < 0 ? "" : base.slice(0, at);
    if (base === "node_modules") base = "";
  }
}

/** Components and edges from one npm lockfile's text. */
export function fromNpmLock(text, location) {
  const doc = JSON.parse(text);
  const components = []; const edges = new Map(); const gaps = [];
  const rootRefs = [];
  if (doc.packages && typeof doc.packages === "object") {
    const packages = doc.packages;
    const refOf = new Map();
    for (const [p, info] of Object.entries(packages)) {
      if (!p || !info || typeof info !== "object") continue;
      if (info.link) { gaps.push({ kind: "unclear", about: `${location}: ${p} is a link to ${trim(info.resolved) || "another folder"}`, why: "a linked workspace package is not an installed component, so it is not listed" }); continue; }
      const name = trim(info.name) || nameFromPath(p);
      const version = trim(info.version);
      if (!name || !version) continue;
      const ref = npmPurl(name, version);
      refOf.set(p, ref);
      if (components.some((c) => c["bom-ref"] === ref)) continue;
      const props = [];
      if (info.dev) props.push({ name: "cdx:npm:package:development", value: "true" });
      const c = { type: "library", "bom-ref": ref, name, version, purl: ref };
      if (info.optional || info.devOptional) c.scope = "optional";
      const h = hashesOf(info.integrity);
      if (h.length) c.hashes = h;
      if (trim(info.license)) c.licenses = [{ license: { id: trim(info.license) } }];
      if (props.length) c.properties = props;
      c.evidence = { occurrences: [{ location }] };
      components.push(c);
    }
    for (const [p, info] of Object.entries(packages)) {
      if (!info || typeof info !== "object" || info.link) continue;
      const deps = { ...(info.dependencies ?? {}), ...(info.optionalDependencies ?? {}), ...(p === "" ? info.devDependencies ?? {} : {}) };
      const from = p === "" ? "" : p;
      const to = [];
      for (const name of Object.keys(deps).sort()) {
        const at = resolveFrom(packages, from, name);
        if (at && refOf.has(at)) to.push(refOf.get(at));
      }
      if (p === "") rootRefs.push(...to);
      else if (refOf.has(p)) {
        const ref = refOf.get(p);
        edges.set(ref, [...new Set([...(edges.get(ref) ?? []), ...to])].sort());
      }
    }
  } else if (doc.dependencies && typeof doc.dependencies === "object") {
    // Lockfile version 1: a tree of dependencies, each with its own nested ones.
    const visit = (deps, chain) => {
      for (const [name, info] of Object.entries(deps).sort(([a], [b]) => a.localeCompare(b))) {
        if (!info || typeof info !== "object" || !trim(info.version)) continue;
        const version = trim(info.version);
        const ref = npmPurl(name, version);
        if (!components.some((c) => c["bom-ref"] === ref)) {
          const c = { type: "library", "bom-ref": ref, name, version, purl: ref };
          if (info.optional) c.scope = "optional";
          const h = hashesOf(info.integrity);
          if (h.length) c.hashes = h;
          if (info.dev) c.properties = [{ name: "cdx:npm:package:development", value: "true" }];
          c.evidence = { occurrences: [{ location }] };
          components.push(c);
        }
        if (!chain.length) rootRefs.push(ref);
        if (info.requires && typeof info.requires === "object") {
          const to = [];
          for (const req of Object.keys(info.requires)) {
            const scopes = [info.dependencies ?? {}, ...chain.map((c) => c.deps).reverse(), doc.dependencies];
            const hit = scopes.find((s) => s[req]);
            if (hit && trim(hit[req].version)) to.push(npmPurl(req, trim(hit[req].version)));
          }
          edges.set(ref, [...new Set([...(edges.get(ref) ?? []), ...to])].sort());
        }
        if (info.dependencies) visit(info.dependencies, [...chain, { deps: info.dependencies }]);
      }
    };
    visit(doc.dependencies, []);
  } else {
    gaps.push({ kind: "unclear", about: `${location} names no packages`, why: "it has neither a packages nor a dependencies section, so nothing in it was listed" });
  }
  return { components, edges, rootRefs: [...new Set(rootRefs)].sort(), gaps };
}

/** Components from a package.json with no lockfile beside it: ranges only. */
export function fromPackageJson(text, location) {
  const doc = JSON.parse(text);
  const components = []; const rootRefs = [];
  const add = (deps, dev) => {
    for (const [name, range] of Object.entries(deps ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
      const version = trim(range);
      const ref = npmPurl(name, version);
      if (components.some((c) => c["bom-ref"] === ref)) continue;
      const props = [{ name: "as-built:version-is-a-range", value: "true" }];
      if (dev) props.push({ name: "cdx:npm:package:development", value: "true" });
      components.push({ type: "library", "bom-ref": ref, name, version, purl: npmPurl(name, ""), properties: props, evidence: { occurrences: [{ location }] } });
      rootRefs.push(ref);
    }
  };
  add(doc.dependencies, false);
  add(doc.optionalDependencies, false);
  add(doc.devDependencies, true);
  const gaps = components.length ? [{ kind: "unclear", about: `the versions installed for ${location}`, why: "no lockfile sits beside it, so each version is the range it asks for, not a version known to be installed", evidence: [{ file: location, line: 1 }] }] : [];
  return { components, edges: new Map(), rootRefs, gaps };
}

/** Components from requirements.txt: exact pins, and ranges marked. */
export function fromRequirements(text, location) {
  const components = []; const gaps = []; const rootRefs = [];
  linesOf(text).forEach((raw, i) => {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line || line.startsWith("-")) {
      if (line.startsWith("-")) gaps.push({ kind: "unclear", about: `${location} line ${i + 1}: ${line}`, why: "an option line in a requirements file is not a package, and what it brings in was not read", evidence: [{ file: location, line: i + 1 }] });
      return;
    }
    const m = /^([A-Za-z0-9][A-Za-z0-9._-]*)(\[[^\]]*\])?\s*(==|===|>=|<=|~=|!=|>|<)?\s*([^;\s]*)?/.exec(line);
    if (!m) return;
    const name = m[1].toLowerCase().replace(/_/g, "-");
    const exact = m[3] === "==" || m[3] === "===";
    const version = exact ? m[4] : trim(`${m[3] ?? ""}${m[4] ?? ""}`);
    const purl = `pkg:pypi/${encodeURIComponent(name)}${exact && version ? `@${encodeURIComponent(version)}` : ""}`;
    const ref = exact ? purl : `${purl}#${version || "any"}`;
    const c = { type: "library", "bom-ref": ref, name, ...(version ? { version } : {}), purl, evidence: { occurrences: [{ location }] } };
    if (!exact) c.properties = [{ name: "as-built:version-is-a-range", value: "true" }];
    components.push(c);
    rootRefs.push(ref);
  });
  return { components, edges: new Map(), rootRefs, gaps };
}

/** Components from go.mod's require lines and blocks. */
export function fromGoMod(text, location) {
  const components = []; const rootRefs = [];
  let inBlock = false;
  for (const raw of linesOf(text)) {
    const line = raw.replace(/\/\/.*$/, "").trim();
    if (/^require\s*\($/.test(line)) { inBlock = true; continue; }
    if (inBlock && line === ")") { inBlock = false; continue; }
    const m = inBlock ? /^(\S+)\s+(\S+)/.exec(line) : /^require\s+(\S+)\s+(\S+)/.exec(line);
    if (!m) continue;
    const purl = `pkg:golang/${m[1].split("/").map(encodeURIComponent).join("/")}@${encodeURIComponent(m[2])}`;
    if (components.some((c) => c["bom-ref"] === purl)) continue;
    components.push({ type: "library", "bom-ref": purl, name: m[1], version: m[2], purl, evidence: { occurrences: [{ location }] } });
    rootRefs.push(purl);
  }
  return { components, edges: new Map(), rootRefs, gaps: [] };
}

/** Components from Cargo.lock's [[package]] tables. */
export function fromCargoLock(text, location) {
  const components = [];
  for (const block of String(text).split(/^\[\[package\]\]\s*$/m).slice(1)) {
    const name = /^name\s*=\s*"([^"]+)"/m.exec(block)?.[1];
    const version = /^version\s*=\s*"([^"]+)"/m.exec(block)?.[1];
    if (!name || !version) continue;
    const purl = `pkg:cargo/${encodeURIComponent(name)}@${encodeURIComponent(version)}`;
    const c = { type: "library", "bom-ref": purl, name, version, purl, evidence: { occurrences: [{ location }] } };
    const sum = /^checksum\s*=\s*"([0-9a-f]{64})"/m.exec(block)?.[1];
    if (sum) c.hashes = [{ alg: "SHA-256", content: sum }];
    if (!components.some((x) => x["bom-ref"] === purl)) components.push(c);
  }
  return { components, edges: new Map(), rootRefs: [], gaps: [] };
}

/** The manifests among the files, each with the reader for it. A package.json
 *  with a lockfile beside it is read through the lockfile. */
export function manifestsIn(files) {
  const set = new Set(files);
  const out = [];
  for (const f of files) {
    const name = basename(f); const dir = posixDir(f);
    if (name === "package-lock.json") out.push({ file: f, read: fromNpmLock });
    else if (name === "npm-shrinkwrap.json" && !set.has(within(dir, "package-lock.json"))) out.push({ file: f, read: fromNpmLock });
    else if (name === "package.json" && !set.has(within(dir, "package-lock.json")) && !set.has(within(dir, "npm-shrinkwrap.json"))) out.push({ file: f, read: fromPackageJson });
    else if (name === "requirements.txt") out.push({ file: f, read: fromRequirements });
    else if (name === "go.mod") out.push({ file: f, read: fromGoMod });
    else if (name === "Cargo.lock") out.push({ file: f, read: fromCargoLock });
  }
  return out;
}

/** The lockfiles found that this file does not read, each a gap. */
export function unreadLockfiles(files) {
  return files.filter((f) => ["yarn.lock", "pnpm-lock.yaml", "poetry.lock", "uv.lock", "Pipfile.lock", "composer.lock", "Gemfile.lock"].includes(basename(f)))
    .map((f) => ({ kind: "unclear", about: `the packages in ${f}`, why: `this agent reads no ${basename(f)}, so the packages it pins are not in the bill of materials`, evidence: [{ file: f, line: 1 }] }));
}

/** The bill of materials for the codebase: {bom, gaps, read}. `read(file)`
 *  answers a file's text. `root` names the codebase's own component. */
export function makeSbom({ files, read, repository = "", commit = "", tool = { name: "reverse-engineer", version: "" } }) {
  const all = []; const edges = new Map(); const rootRefs = []; const gaps = []; const readFrom = [];
  for (const m of manifestsIn(files)) {
    const text = read(m.file);
    if (text === null || text === undefined) { gaps.push({ kind: "unclear", about: `the packages in ${m.file}`, why: "the file could not be read as text" }); continue; }
    let got;
    try { got = m.read(text, m.file); } catch (e) {
      gaps.push({ kind: "unclear", about: `the packages in ${m.file}`, why: `it could not be read: ${trim(e.message)}`, evidence: [{ file: m.file, line: 1 }] });
      continue;
    }
    readFrom.push({ file: m.file, sha256: createHash("sha256").update(text).digest("hex") });
    for (const c of got.components) if (!all.some((x) => x["bom-ref"] === c["bom-ref"])) all.push(c);
    for (const [k, v] of got.edges) edges.set(k, [...new Set([...(edges.get(k) ?? []), ...v])].sort());
    rootRefs.push(...got.rootRefs);
    gaps.push(...got.gaps);
  }
  gaps.push(...unreadLockfiles(files));
  const rootPkg = files.includes("package.json") ? (() => { try { return JSON.parse(read("package.json")); } catch { return null; } })() : null;
  const rootName = trim(rootPkg?.name) || trim(repository).replace(/\.git$/, "").split(/[/:]/).filter(Boolean).pop() || "codebase";
  const root = { type: "application", "bom-ref": "codebase", name: rootName, ...(trim(rootPkg?.version) ? { version: trim(rootPkg.version) } : {}) };
  const seed = [repository, commit, ...readFrom.map((r) => `${r.file}:${r.sha256}`)].join("\n");
  const h = createHash("sha256").update(seed).digest("hex");
  // A UUID made from the digest: version 5's layout, so the same inputs give
  // the same serial number.
  const uuid = `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h[16], 16) & 0x3) | 0x8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
  const components = all.sort((a, b) => a["bom-ref"].localeCompare(b["bom-ref"]));
  const known = new Set(components.map((c) => c["bom-ref"]));
  const dependencies = [{ ref: "codebase", dependsOn: [...new Set(rootRefs)].filter((r) => known.has(r)).sort() }];
  for (const c of components) dependencies.push({ ref: c["bom-ref"], dependsOn: (edges.get(c["bom-ref"]) ?? []).filter((r) => known.has(r)) });
  const bom = {
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    serialNumber: `urn:uuid:${uuid}`,
    version: 1,
    metadata: {
      tools: { components: [{ type: "application", name: tool.name, ...(tool.version ? { version: tool.version } : {}) }] },
      component: root,
      properties: [
        { name: "as-built:repository", value: trim(repository) },
        { name: "as-built:commit", value: trim(commit) },
        ...readFrom.map((r) => ({ name: "as-built:read-from", value: r.file })),
      ],
    },
    components,
    dependencies,
  };
  return { bom, gaps, read: readFrom };
}

/** What changed in the components between two bills of materials, by name:
 *  {added, removed, changed}, each sorted. */
export function componentChanges(before, after) {
  const key = (c) => `${c.purl?.split("@")[0] ?? c.name}`;
  const was = new Map((before?.components ?? []).map((c) => [key(c), c]));
  const now = new Map((after?.components ?? []).map((c) => [key(c), c]));
  const added = []; const removed = []; const changed = [];
  for (const [k, c] of now) {
    if (!was.has(k)) added.push({ name: c.name, version: c.version ?? null });
    else if ((was.get(k).version ?? null) !== (c.version ?? null)) changed.push({ name: c.name, from: was.get(k).version ?? null, to: c.version ?? null });
  }
  for (const [k, c] of was) if (!now.has(k)) removed.push({ name: c.name, version: c.version ?? null });
  const byName = (a, b) => a.name.localeCompare(b.name);
  return { added: added.sort(byName), removed: removed.sort(byName), changed: changed.sort(byName) };
}

/** Whether a file is one this part is made from. */
export const isManifest = (f) => READS.includes(basename(f)) || ["yarn.lock", "pnpm-lock.yaml"].includes(basename(f));

/** Read a file from a codebase folder, for makeSbom. */
export const readerFor = (dir) => (f) => readInside(dir, f);
