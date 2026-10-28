// The registered checks: one function per `check` name a checklist entry may
// give. Each answers one entry: pass or fail with its evidence, or "not
// checked" with the reason it could not run. A `check` name that is not here
// is reported as not checked, never skipped.
//
// Where a test already holds the rule, the check runs it:
//   package-maker-format-rules, can-use-declared   the package maker's own
//       build.py over the package (format_rules, standing_rules), or the
//       format_rules its signed build record carries for this digest
//   no-model-literals    AgentMesh's check-no-model-literals rule (models.mjs)
//   delivered-formats    the test writer's checkDelivered rule (formats.mjs)
//   descriptor-signed    the family's signature rule over the registry's bytes
//   descriptor-floor     the minimal Descriptor's members (Common Agent 4.9, 6.2)
//   stage-record:<asset> the stage's line (stages.mjs)
//
//   needs: node >= 22
//   import { REGISTERED, runCheck } from "./checks.mjs"
import { canonical } from "./keys.mjs";
import { modelFindings } from "./models.mjs";
import { declaredOutputs, formatProblems, outputFor } from "./formats.mjs";
import { versionOrder } from "./gather.mjs";

const trim = (s) => String(s ?? "").trim();
const base = (k) => trim(k).split(";")[0].trim().toLowerCase();
const PASS = (evidence, extra = {}) => ({ result: "pass", evidence, ...extra });
const FAIL = (evidence, place, extra = {}) => ({ result: "fail", evidence, place, ...extra });
const NOT = (why) => ({ result: "not checked", evidence: why, why });

/** The Descriptor the design-time checks read: the package's own, or the served one. */
function designDescriptor(ctx) {
  if (ctx.facts.pkg?.descriptor) return { doc: ctx.facts.pkg.descriptor, from: "the package's agent-descriptor.json" };
  if (ctx.facts.dev.descriptor?.doc) return { doc: ctx.facts.dev.descriptor.doc, from: "the Descriptor the registry serves (the package's bytes were not read)" };
  return null;
}

const offeringsOf = (d) => (Array.isArray(d?.offerings) ? d.offerings : []);
const jobsOf = (d) => offeringsOf(d).flatMap((o) => [o, ...(Array.isArray(o.steps) ? o.steps : [])]);

/** The floor of Common Agent 4.9 and the minimal Descriptor of 6.2 (the
 *  platform's frozen verifier, client-rig/frozen/lib/verify.mjs floorProblem). */
export function floorProblems(d) {
  const out = [];
  if (!d || typeof d !== "object" || Array.isArray(d)) return ["it is not a document"];
  if (d.format !== "agent-descriptor-v1") out.push("format is not agent-descriptor-v1");
  if (typeof d.agent_version !== "string" || !d.agent_version) out.push("agent_version");
  if (typeof d.does !== "string" || !d.does) out.push("does");
  if (!d.subject || typeof d.subject.id !== "string") out.push("subject");
  if (!["person", "organization", "anyone"].includes(d.acts_for)) out.push("acts_for");
  if (!Array.isArray(d.offerings)) out.push("offerings");
  for (const o of offeringsOf(d)) for (const k of ["id", "name", "inputs", "outputs"]) if (o?.[k] === undefined) out.push(`offering ${o?.id ?? "?"} has no ${k}`);
  if (!Array.isArray(d.signatures) || !d.signatures.length) out.push("signatures");
  return out;
}

const PERSON_FACING = (k) => /^(text\/markdown|text\/html|text\/plain|text)$/.test(base(k)) || /^(image|video|audio)\//.test(base(k));
const WORDS_NOT_MARKDOWN = (k) => /^(text\/plain|text|text\/x-[\w.+-]+)$/.test(base(k));

function stageCheck(stage) {
  return (entry, ctx) => {
    const l = ctx.lines.find((x) => x.stage === stage);
    if (!l) return NOT(`the auditor keeps no line for the stage ${stage}`);
    const ok = stage === "docs" ? l.present && l.bound : l.state === "present";
    return ok ? PASS(l.evidence) : FAIL(`${l.state}: ${l.evidence}`, `${l.asset} (${l.made_at})`);
  };
}

export const REGISTERED = {
  registered: (entry, ctx) => {
    const sf = ctx.facts.dev.storefront;
    if (!sf?.ok) return FAIL(`${ctx.facts.handle} does not resolve on ${ctx.facts.dev.origin}: ${sf?.error ?? "no answer"}`, `the registration of ${ctx.facts.handle}`);
    const card = sf.body?.card?.card ?? {};
    const handle = trim(card.handle ?? sf.body?.card?.listing?.handle).toLowerCase();
    if (handle && handle !== ctx.facts.handle) return FAIL(`${ctx.facts.handle} resolves to an agent registered as ${handle}`, `the registration of ${ctx.facts.handle}`);
    return PASS(`${ctx.facts.handle} resolves on ${ctx.facts.dev.origin} to ${ctx.facts.dev.key}${sf.body?.availability ? `, ${sf.body.availability}` : ""}; the handle on its card is ${handle || "(not stated)"}`);
  },

  "descriptor-signed": (entry, ctx) => {
    const l = ctx.lines.find((x) => x.stage === "descriptor");
    const d = ctx.facts.dev.descriptor;
    if (!l?.present) return FAIL(l?.evidence ?? "no Descriptor was read", "the registry's stored Descriptor");
    const problems = [];
    if (!l.signed) problems.push("its signature does not verify under the agent's own key, or its subject is not the registered key");
    if (d.door_digest && d.bytes_digest && `sha256:${d.door_digest}` !== d.bytes_digest) problems.push(`the door says ${d.door_digest} and the bytes hash to ${d.bytes_digest}`);
    const src = (ctx.facts.dev.agentdoc?.doc?.sources ?? []).find((s) => s?.id === "descriptor");
    const served = trim(src?.digest);
    if (served && d.door_digest && served !== d.door_digest) problems.push(`the agent's page was read from Descriptor ${served}, and the registry stores ${d.door_digest}`);
    const ev = `the registry stores Descriptor sha256:${d.door_digest ?? "?"} (bytes ${d.bytes_digest}); ${served ? `the agent's page reads sha256:${served}` : "the agent's page names no Descriptor digest"}; ${l.signed ? `signed by the subject ${d.doc?.subject?.id}` : "not signed by the subject"}`;
    return problems.length ? FAIL(`${ev}. ${problems.join("; ")}`, "the registry's stored Descriptor") : PASS(ev);
  },

  "descriptor-floor": (entry, ctx) => {
    const d = ctx.facts.dev.descriptor?.doc;
    if (!d) return FAIL("no Descriptor is served, so no member of the floor is", "the served Descriptor");
    const p = floorProblems(d);
    return p.length ? FAIL(`missing or wrong: ${p.join(", ")}`, "the served Descriptor") : PASS("format, agent_version, does, subject, acts_for, offerings (each with id, name, inputs, outputs) and signatures are all present");
  },

  "descriptor-matches-package": (entry, ctx) => {
    const served = ctx.facts.dev.descriptor?.doc;
    if (!ctx.facts.target.digest) return FAIL("no package is on record for this version, so the served Descriptor is in no package", "the package");
    if (!ctx.facts.pkg) return NOT("the package's bytes could not be read, so its Descriptor could not be compared");
    const draft = ctx.facts.pkg.descriptor;
    if (!draft) return FAIL("the package carries no agent-descriptor.json", "the package");
    if (!served) return FAIL("no Descriptor is served to compare with the package's", "the served Descriptor");
    const dep = ctx.lines.find((x) => x.stage === "deployment-record")?.record?.descriptor ?? {};
    const bound = new Set(["subject", "signatures", ...(Array.isArray(dep.added) ? dep.added : []), ...(Array.isArray(dep.changed) ? dep.changed : [])]);
    if (!Array.isArray(dep.added)) for (const k of ["interaction", "samples_ref", "fleet", "acts_for"]) bound.add(k);
    const keys = [...new Set([...Object.keys(draft), ...Object.keys(served)])].filter((k) => !bound.has(k)).sort();
    const differ = keys.filter((k) => canonical(draft[k] ?? null) !== canonical(served[k] ?? null));
    const ev = `members a deploy binds, set aside: ${[...bound].sort().join(", ")}${Array.isArray(dep.added) ? " (as the deployment record names them)" : " (the deployment record names none, so the ones a deploy usually binds)"}`;
    return differ.length ? FAIL(`the served Descriptor differs from the package's in ${differ.join(", ")}; ${ev}`, "the served Descriptor") : PASS(`every other member is the package's, byte for byte in canonical form; ${ev}`);
  },

  "descriptor-person-members": (entry, ctx) => {
    const dd = designDescriptor(ctx);
    if (!dd) return NOT("no Descriptor could be read");
    const d = dd.doc;
    const absent = ["name", "summary", "will_not"].filter((k) => d[k] === undefined || d[k] === null || (typeof d[k] === "string" && !trim(d[k])) || (Array.isArray(d[k]) && !d[k].length));
    const noGiven = [];
    for (const o of offeringsOf(d)) for (const i of Array.isArray(o.inputs) ? o.inputs : []) if (!trim(i?.given_by)) noGiven.push(`${o.id}: ${i?.name ?? "?"}`);
    const ev = `read from ${dd.from}: name ${d.name ? "present" : "absent"}, summary ${d.summary ? "present" : "absent"}, will_not ${d.will_not ? "present" : "absent"}; ${noGiven.length ? `inputs without given_by: ${noGiven.join("; ")}` : "every input has given_by"}`;
    return absent.length || noGiven.length ? FAIL(ev, dd.from) : PASS(ev);
  },

  "package-maker-format-rules": (entry, ctx) => {
    const pm = ctx.packageMaker;
    const rule1 = (f) => /bare application\/json/.test(f);
    if (pm?.ran && pm.format_rules) {
      const found = (pm.format_rules.findings ?? []).filter(rule1);
      return found.length ? FAIL(`the package maker (${pm.how}) finds: ${found.join("; ")}`, "the declared kinds") : PASS(`the package maker (${pm.how}) finds no input or output declared bare application/json`);
    }
    const br = ctx.lines.find((x) => x.stage === "build-record")?.record;
    if (br?.format_rules) {
      const found = (br.format_rules.findings ?? []).filter(rule1);
      return found.length ? FAIL(`the signed build record's format_rules find: ${found.join("; ")}`, "the declared kinds") : PASS(`the signed build record's format_rules (${br.format_rules.mode}, since ${br.format_rules.since}) find no bare application/json`);
    }
    const dd = designDescriptor(ctx);
    if (!dd) return NOT(`the package maker could not run here (${pm?.why ?? "not available"}), no build record carries its format_rules, and no Descriptor could be read`);
    const bare = [];
    for (const j of jobsOf(dd.doc)) for (const side of ["inputs", "outputs"]) for (const e of Array.isArray(j[side]) ? j[side] : []) if (base(e?.kind) === "application/json") bare.push(`${j.id}: ${side.slice(0, -1)} ${e.name}`);
    const ev = `the package maker could not run here (${pm?.why ?? "not available"}) and no build record carries its format_rules, so its rule 1 was read off ${dd.from}`;
    return bare.length ? FAIL(`${ev}: bare application/json in ${bare.join("; ")}`, "the declared kinds") : PASS(`${ev}: none is bare application/json`);
  },

  "no-model-literals": (entry, ctx) => {
    if (!ctx.facts.pkg) return NOT("the package's bytes could not be read, so its code and skills could not be read");
    const found = modelFindings(ctx.facts.pkg.files);
    const read = [...ctx.facts.pkg.files.keys()].length;
    return found.length
      ? FAIL(found.map((f) => `${f.file}${f.line ? `:${f.line}` : ""} ${f.model} (${f.where})`).join("; "), found.map((f) => f.file).filter((x, i, a) => a.indexOf(x) === i).join(", "))
      : PASS(`no model is named in the package's code, skills, runtime requirements or Descriptor (${read} files in the package)`);
  },

  "delivered-formats": (entry, ctx) => {
    const dd = designDescriptor(ctx);
    if (!dd) return NOT("no Descriptor could be read");
    const outputs = declaredOutputs(dd.doc);
    const words = [...outputs].filter(([, o]) => WORDS_NOT_MARKDOWN(o.kind)).map(([n, o]) => `${n} (${o.kind})`);
    const problems = [];
    let read = 0;
    for (const dl of ctx.facts.attached.deliveries ?? []) {
      for (const p of dl.pieces) {
        const o = outputFor(p.name, outputs);
        if (!o) continue;
        const file = ctx.files.get(trim(p.path).split("/").pop());
        if (!file) continue;
        read++;
        if (trim(p.media_type) && base(p.media_type) !== base(o.kind)) problems.push(`the piece ${JSON.stringify(p.name)} is listed as ${base(p.media_type)} and declared ${base(o.kind)}`);
        problems.push(...formatProblems(file, o.kind, o.about, `the piece ${JSON.stringify(p.name)}`));
      }
    }
    const declared = [...outputs].map(([n, o]) => `${n}: ${base(o.kind)}`).join("; ");
    const ev = `${dd.from} declares ${declared || "no outputs"}; ${read ? `${read} delivered piece(s) read against their kinds` : "no delivered piece was given to the audit, so only the declarations were read"}`;
    if (words.length || problems.length) return FAIL(`${ev}. ${words.length ? `Words a person reads declared other than text/markdown: ${words.join(", ")}. ` : ""}${problems.join("; ")}`, "the declared outputs");
    return PASS(ev);
  },

  "revisions-declared": (entry, ctx) => {
    const dd = designDescriptor(ctx);
    if (!dd) return NOT("no Descriptor could be read");
    const offs = offeringsOf(dd.doc);
    const missing = offs.filter((o) => !(o.revisions && typeof o.revisions === "object" && o.revisions.included && (o.revisions.steps || o.revisions.flat)));
    const ev = offs.map((o) => `${o.id}: ${o.revisions ? `included ${o.revisions.included?.count ?? "?"} within ${o.revisions.included?.window_days ?? "?"} days, ${o.revisions.flat ? "a flat price" : o.revisions.steps ? `${o.revisions.steps.length} step price(s)` : "no price"}` : "no revisions policy"}`).join("; ");
    return missing.length ? FAIL(`read from ${dd.from}: ${ev}`, missing.map((o) => `offering ${o.id}`).join(", ")) : PASS(`read from ${dd.from}: ${ev || "no offerings"}`);
  },

  "can-use-declared": (entry, ctx) => {
    const dd = designDescriptor(ctx);
    if (!dd) return NOT("no Descriptor could be read");
    const cu = Array.isArray(dd.doc.can_use) ? dd.doc.can_use : [];
    const pm = ctx.packageMaker;
    const sr = pm?.ran ? pm.standing_rules : null;
    const list = ctx.schemas;
    const listWords = list ? `the known-kinds list ${list.digest}` : "no known-kinds list";
    if (entry.id === "can-use-known-schema") {
      if (sr) { const f = (sr.findings ?? []).filter((x) => /is not a known kind of standing asset/i.test(x)); return f.length ? FAIL(`the package maker's standing rules find: ${f.join("; ")}`, "can_use") : PASS(`the package maker's standing rules find no unknown schema (${sr.schemas_digest ?? listWords})`); }
      if (!list) return NOT("the package maker's standing rules could not run here and no known-kinds list is beside the auditor");
      const unknown = cu.filter((c) => !list.schemas.includes(trim(c?.schema)));
      const ev = `${cu.length ? cu.map((c) => trim(c?.schema)).join(", ") : "no can_use entries"}, against ${listWords}`;
      return unknown.length ? FAIL(`${ev}; not on the list: ${unknown.map((c) => trim(c?.schema) || "(no schema)").join(", ")}`, "can_use") : PASS(ev);
    }
    if (entry.id === "can-use-without") {
      if (sr) { const f = (sr.findings ?? []).filter((x) => /does not say without/i.test(x)); return f.length ? FAIL(`the package maker's standing rules find: ${f.join("; ")}`, "can_use") : PASS("the package maker's standing rules find every can_use entry says what it does without the asset"); }
      const no = cu.filter((c) => !trim(c?.without));
      return no.length ? FAIL(`${no.length} of ${cu.length} can_use entries say nothing under without: ${no.map((c) => trim(c?.schema) || "(no schema)").join(", ")}`, "can_use") : PASS(cu.length ? `all ${cu.length} can_use entries say what the agent does without the asset` : "no can_use entries");
    }
    // person-facing-declares-library, and any other entry that names this check.
    if (sr) { const w = sr.warnings ?? []; return w.length ? FAIL(`the package maker's standing rules warn: ${w.join("; ")}`, "can_use") : PASS("the package maker's standing rules raise no warning on the library"); }
    const outputs = declaredOutputs(dd.doc);
    const facing = [...outputs].filter(([, o]) => PERSON_FACING(o.kind)).map(([n, o]) => `${n} (${base(o.kind)})`);
    if (!facing.length) return PASS("no output a person reads or watches is declared");
    if (cu.length) return PASS(`person-facing outputs ${facing.join(", ")}; can_use declares ${cu.map((c) => trim(c?.schema)).join(", ")}`);
    return FAIL(`person-facing outputs ${facing.join(", ")}, and no can_use entry; no architecture record was given to the audit to say why it reads none`, "can_use");
  },

  "standing-assets-cited": (entry, ctx) => {
    const dd = designDescriptor(ctx);
    if (!dd) return NOT("no Descriptor could be read");
    const cu = Array.isArray(dd.doc.can_use) ? dd.doc.can_use : [];
    if (!cu.length) return PASS("the agent declares no standing asset, so no run has one to cite");
    const runs = ctx.facts.attached.runRecords ?? [];
    if (!runs.length) return NOT(`the agent declares ${cu.length} standing asset kind(s) (${cu.map((c) => trim(c?.schema)).join(", ")}), and no run record of a run given one was given to the audit; the platform serves no run records by agent`);
    const cites = runs.flatMap((r) => (Array.isArray(r.doc.standing_assets) ? r.doc.standing_assets : []));
    const ok = (c) => trim(c?.schema) && /^sha256:[0-9a-f]{64}$/.test(trim(c?.version_digest)) && trim(c?.layer);
    const missing = cu.filter((c) => !cites.some((x) => trim(x?.schema) === trim(c?.schema) && ok(x)));
    const ev = `${runs.length} run record(s) cite ${cites.length} standing asset(s): ${cites.map((c) => `${trim(c?.schema)} ${trim(c?.version_digest).slice(0, 19)} at ${trim(c?.layer) || "?"}`).join("; ") || "none"}`; // cut-ok: a digest's prefix; the run records hold the whole
    return missing.length ? FAIL(`${ev}; never cited with schema, version_digest and layer: ${missing.map((c) => trim(c?.schema)).join(", ")}`, "the run records") : PASS(ev);
  },

  "versions-dev-prod": (entry, ctx) => {
    const f = ctx.facts;
    const want = f.target.version;
    if (!want) return FAIL("no version is on record for the audited package", "the deploys");
    const problems = [];
    if (f.devVersion !== want) problems.push(`dev serves ${f.devVersion ?? "nothing"}, not the audited ${want}`);
    let prodWords = "prod was not read";
    if (f.prod) {
      prodWords = f.prodVersion ? `prod serves ${f.prodVersion}` : `prod does not serve the agent (${f.prod.storefront?.error ?? f.prod.descriptor?.error ?? "no Descriptor"})`;
      if (f.prodVersion && versionOrder(f.prodVersion, want) > 0) problems.push(`prod runs ${f.prodVersion}, newer than the audited ${want}, which was never proved on dev first`);
    }
    const ev = `dev (${f.dev.origin}) serves ${f.devVersion ?? "nothing"}, package ${f.target.digest ?? "unknown"}; ${prodWords}`;
    return problems.length ? FAIL(`${ev}. ${problems.join("; ")}`, "the deploys on dev and prod") : PASS(ev);
  },
};
for (const s of ["requirements", "architecture", "design", "impact", "test", "code", "review", "security", "build-record", "descriptor", "deployment-record", "conformance", "docs"]) {
  REGISTERED[`stage-record:${s}`] = stageCheck(s);
}

/** One entry's answer. */
export function runCheck(entry, ctx) {
  const fn = REGISTERED[entry.check];
  if (!fn) return NOT(`no test named ${entry.check} is registered with the auditor`);
  try { return fn(entry, ctx); } catch (e) { return NOT(`the test ${entry.check} stopped: ${trim(e?.message ?? e)}`); }
}
