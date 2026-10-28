// One line per lifecycle stage: is the stage's record present, signed, and
// bound to the audited package digest?
//
// The stages and their assets are the lifecycle's (https://agenticdevelopment.ai/assets.html).
// Where each record is found:
//   requirements, architecture, design, impact, test, code, review, security
//       a signed delivery manifest (job-manifest-v1), attached to the audit:
//       one the stage's usual holder signed, or one the message names for the
//       stage (`<stage>: <file name>`), whoever signed it. The platform keeps
//       no store of these by package, so a record not attached is missing.
//   build-record        the deploy queue (the request that filed the package)
//                       or attached: agent-build-record-v1
//   descriptor          the registry's stored Descriptor, signed by the agent's
//                       own key (descriptor-statement-v1), and its registration
//   deployment-record   the deploy queue (a request's record, or one filed
//                       after its result) or attached: agent-deployment-record-v1,
//                       for a deploy, update, alongside, reconfigure or attest
//   conformance         the registry's newest verdict (agent-eval-record-v1)
//   usability           a usability report attached (its header names the
//                       package digest), delivered under a verified job
//                       manifest, attached too, that lists the report's bytes
//                       and is not the tested agent's own
//   docs                the AgentDoc the platform assembles for the agent
//
// Bound means the record names this package's digest, or holds bytes that are
// in this package, or is named by this package's signed build record. A record
// bound to another digest is stale. Signed means a signature verifies, by
// whoever made the record: no check requires a particular holder's key
// (lifecycle plan TERMS, 2026-10-28). Where the signer is the stage's usual
// holder (references/stage-holders.json, resolved on the platform), the line
// says so.
//
//   needs: node >= 22
//   import { stageLines, STAGE_ORDER } from "./stages.mjs"
import { canonical, sha256, verifyDoc, verifyManifest } from "./keys.mjs";

const trim = (s) => String(s ?? "").trim();
const hexOf = (d) => trim(d).toLowerCase().replace(/^sha256:/, "");
const short = (d) => (d ? `sha256:${hexOf(d).slice(0, 12)}` : "none"); // cut-ok: a digest's prefix for reading; the whole digest is in the evidence

export const STAGE_ORDER = ["requirements", "architecture", "design", "impact", "test", "code", "review", "security", "build-record", "descriptor", "deployment-record", "conformance", "usability", "docs"];
/** The acts whose signed record says a package runs: a deploy, an update, a
 *  version kept alongside, a reconfigure (model, jobs at once, a Descriptor
 *  bound again from the package; the package named from the inventory), and
 *  an attest (the deployment manager re-hashed the running install against
 *  its ledger and attests the package runs, without redeploying it). */
export const DEPLOYMENT_ACTS = ["deploy", "update", "alongside", "reconfigure", "attest"];
export const MANIFEST_STAGES = ["requirements", "architecture", "design", "impact", "test", "code", "review", "security"];

/** Whose key is this, among the stage holders: [stage, handle] or null. */
function holderOf(facts, key) {
  for (const [stage, keys] of Object.entries(facts.holderKeys)) {
    const k = keys.find((x) => x.key === key);
    if (k) return { stage, handle: k.handle };
  }
  return null;
}

const holderWords = (facts, stage) => {
  const keys = facts.holderKeys[stage] ?? [];
  const handles = facts.holders[stage]?.holders ?? [];
  return keys.length ? keys.map((k) => k.handle).filter((h, i, a) => a.indexOf(h) === i).join(" or ") : handles.length ? `${handles.join(" or ")} (no key found for it on the platform)` : "its holder";
};

/** A signed record judged: {verifies, by, holder}. */
function signedBy(facts, doc, tag, stage) {
  const sigs = verifyDoc(doc).filter((s) => !tag || s.tag === tag);
  const good = sigs.find((s) => s.verifies);
  const by = good?.by ?? sigs[0]?.by ?? trim(doc?.by) ?? null;
  const holderKeys = (facts.holderKeys[stage] ?? []).map((k) => k.key);
  return { signatures: sigs.length, verifies: Boolean(good), by, holder: Boolean(good && holderKeys.includes(good.by)), holdersKnown: holderKeys.length > 0 };
}

function line(stage, facts, parts) {
  const h = facts.holders[stage] ?? {};
  const { present, signed, bound, state, source = null, record_digest = null, by = null, evidence } = parts;
  return { stage, asset: h.asset ?? stage, made_at: h.made_at ?? stage, present, signed, bound, state, source, record_digest, by, evidence, ...(parts.extra ?? {}) };
}

function signedWords(s, facts, stage) {
  if (!s.signatures) return "carries no signature";
  if (!s.verifies) return "its signature does not verify";
  if (s.holder) return `signed by ${holderWords(facts, stage)} (${s.by})`;
  return `signed by ${s.by}, whose signature verifies (it is not ${holderWords(facts, stage)}, and any signer counts)`;
}

function stateOf({ present, signed, bound }) {
  if (!present) return "missing";
  if (bound === false) return "stale";
  if (!signed) return "unsigned";
  return "present";
}

/** Records of a kind from the queue and the attachments, each with where it came from.
 *  A request's records filed after its result (`later_records`: a backfilled
 *  attest record, a reconfigure) are read as deployment records too. */
function recordsFrom(facts, member, attachedList) {
  const out = [];
  for (const r of facts.queue.requests) {
    if (r[member] && typeof r[member] === "object") out.push({ doc: r[member], source: `deploy request ${r.id} (${r.status}${r.decided_at ? `, ${r.decided_at}` : ""})`, request: r });
    if (member === "deploy_record" && Array.isArray(r.later_records)) {
      for (const doc of r.later_records) if (doc && typeof doc === "object") out.push({ doc, source: `deploy request ${r.id} (later record)`, request: r });
    }
  }
  for (const a of attachedList) out.push({ doc: a.doc, source: `attached (${a.name})`, request: null });
  return out;
}

function buildRecordLine(facts) {
  const want = hexOf(facts.target.digest);
  const all = recordsFrom(facts, "build_record", facts.attached.buildRecords);
  const mine = all.filter((x) => want && hexOf(x.doc?.package?.sha256) === want);
  if (!want) return line("build-record", facts, { present: false, signed: false, bound: false, state: "missing", evidence: `no package digest is on record for this version, so no build record can name it${all.length ? `; ${all.length} build record(s) name other packages` : ""}` });
  if (!mine.length) {
    const other = all.map((x) => `${trim(x.doc?.package?.version) || "?"} ${short(x.doc?.package?.sha256)}`);
    return line("build-record", facts, other.length
      ? { present: true, signed: false, bound: false, state: "stale", evidence: `no build record names ${short(facts.target.digest)}; the ones on record name ${other.join(", ")}` }
      : { present: false, signed: false, bound: false, state: "missing", evidence: `no build record names ${short(facts.target.digest)}, in the deploy queue${facts.queue.read ? "" : " (not read)"} or attached` });
  }
  const best = mine.map((x) => ({ ...x, s: signedBy(facts, x.doc, "agent-build-record-v1", "build-record") })).sort((a, b) => Number(b.s.verifies) - Number(a.s.verifies) || Number(b.s.holder) - Number(a.s.holder))[0];
  const signed = best.s.verifies;
  const parts = { present: true, signed, bound: true, source: best.source, by: best.s.by, record_digest: sha256(Buffer.from(canonical(best.doc), "utf8")) };
  const fr = best.doc?.format_rules;
  const sr = best.doc?.standing_rules;
  return line("build-record", facts, {
    ...parts, state: stateOf(parts),
    evidence: `${best.source}: names ${short(facts.target.digest)}, ${signedWords(best.s, facts, "build-record")}, produced ${trim(best.doc?.produced_at) || "at an unstated time"}${fr ? `; format_rules ${fr.mode ?? "?"} with ${(fr.findings ?? []).length} finding(s)` : "; no format_rules"}${sr ? `; standing_rules ${sr.mode ?? "?"} with ${(sr.findings ?? []).length} finding(s)` : "; no standing_rules"}`,
    extra: { record: best.doc },
  });
}

function deploymentRecordLine(facts) {
  const want = hexOf(facts.target.digest);
  const all = recordsFrom(facts, "deploy_record", facts.attached.deployRecords).filter((x) => DEPLOYMENT_ACTS.includes(trim(x.doc?.act)));
  const mine = all.filter((x) => want && hexOf(x.doc?.package?.sha256) === want);
  if (!mine.length) {
    const other = all.map((x) => `${trim(x.doc?.package?.version) || "?"} ${short(x.doc?.package?.sha256)}`);
    return line("deployment-record", facts, other.length && want
      ? { present: true, signed: false, bound: false, state: "stale", evidence: `no deployment record names ${short(facts.target.digest)}; the ones on record name ${other.join(", ")}` }
      : { present: false, signed: false, bound: false, state: "missing", evidence: `no deployment record ${want ? `names ${short(facts.target.digest)}` : "can name a package nobody has a digest for"}, in the deploy queue${facts.queue.read ? "" : " (not read)"} or attached` });
  }
  const best = mine.map((x) => ({ ...x, s: signedBy(facts, x.doc, "agent-deployment-record-v1", "deployment-record") })).sort((a, b) => Number(b.s.verifies) - Number(a.s.verifies) || Number(b.s.holder) - Number(a.s.holder) || String(b.doc?.produced_at).localeCompare(String(a.doc?.produced_at)))[0];
  const parts = { present: true, signed: best.s.verifies, bound: true, source: best.source, by: best.s.by, record_digest: sha256(Buffer.from(canonical(best.doc), "utf8")) };
  return line("deployment-record", facts, {
    ...parts, state: stateOf(parts),
    evidence: `${best.source}: ${trim(best.doc?.act)} of ${short(facts.target.digest)} on ${facts.dev.origin}${best.doc?.environment ? ` (environment ${best.doc.environment})` : ""}, ${signedWords(best.s, facts, "deployment-record")}, produced ${trim(best.doc?.produced_at) || "at an unstated time"}`,
    extra: { record: best.doc },
  });
}

function descriptorLine(facts, deployLine) {
  const d = facts.dev.descriptor;
  if (!facts.dev.storefront?.ok) return line("descriptor", facts, { present: false, signed: false, bound: false, state: "missing", evidence: `the agent is not registered on ${facts.dev.origin} under ${facts.handle} (${facts.dev.storefront?.error ?? "no answer"})` });
  if (!d?.ok) return line("descriptor", facts, { present: false, signed: false, bound: false, state: "missing", evidence: `the registry stores no Descriptor for ${facts.dev.key} (${d?.error ?? "not read"})` });
  const sigs = verifyDoc(d.doc).filter((s) => s.tag === "descriptor-statement-v1");
  const subject = trim(d.doc?.subject?.id);
  const signed = sigs.some((s) => s.verifies && s.by === subject) && subject === facts.dev.key;
  const named = trim(deployLine.record?.descriptor?.sha256);
  const served = hexOf(d.door_digest || d.bytes_digest);
  let bound;
  let how;
  if (named) { bound = hexOf(named) === served; how = bound ? `the deployment record for this package names its digest, ${short(served)}` : `the deployment record for this package names Descriptor ${short(named)}, and the registry serves ${short(served)}`; }
  else if (facts.target.version) { bound = trim(d.doc?.agent_version) === facts.target.version; how = bound ? `it states version ${facts.target.version}; no deployment record names a Descriptor digest, so the version alone binds it` : `it states version ${trim(d.doc?.agent_version)}, not the audited ${facts.target.version}`; }
  else { bound = false; how = "nothing names the audited package's Descriptor"; }
  const parts = { present: true, signed, bound, source: d.url, by: subject || null, record_digest: `sha256:${served}` };
  return line("descriptor", facts, {
    ...parts, state: stateOf(parts),
    evidence: `the registry's Descriptor ${short(served)}, version ${trim(d.doc?.agent_version)}: ${!sigs.length ? "carries no descriptor-statement-v1 signature" : signed ? `signed by the agent's own key ${subject}` : `its signature does not verify under the subject key, or the subject (${subject}) is not the registered key (${facts.dev.key})`}; registered as ${facts.dev.key}; ${how}`,
    extra: { doc: d.doc },
  });
}

function conformanceLine(facts, deployLine) {
  const e = facts.dev.evalRecord;
  const doc = e?.ok ? e.doc : facts.attached.evalRecords.find((x) => trim(x.doc?.subject?.agent_key) === facts.dev.key)?.doc ?? null;
  if (!doc) return line("conformance", facts, { present: false, signed: false, bound: false, state: "missing", evidence: `the registry holds no conformance verdict for ${facts.dev.key ?? facts.handle} (${e?.error ?? "not read"})` });
  const s = signedBy(facts, doc, "agent-eval-record-v1", "conformance");
  const text = canonical(doc);
  const img = trim(deployLine.record?.image_digest);
  const bound = Boolean((facts.target.digest && text.includes(hexOf(facts.target.digest))) || (img && text.includes(hexOf(img))));
  const parts = { present: true, signed: s.verifies, bound, source: e?.ok ? e.url : "attached", by: s.by, record_digest: sha256(Buffer.from(text, "utf8")) };
  return line("conformance", facts, {
    ...parts, state: stateOf(parts),
    evidence: `verdict ${trim(doc.verdict) || (typeof doc.conforms === "boolean" ? (doc.conforms ? "conforms" : "does not conform") : "?")}${doc.summary && typeof doc.summary === "object" ? ` (${["pass", "fail", "inconclusive", "flagged_for_review"].filter((k) => typeof doc.summary[k] === "number").map((k) => `${doc.summary[k]} ${k.replace(/_/g, " ")}`).join(", ")})` : ""}, ${signedWords(s, facts, "conformance")}; ${bound ? "names this package's digest or the image its deployment record started" : "names neither this package's digest nor the image its deployment record started"}`,
    extra: { record: doc },
  });
}

/** The Usability stage's line: a usability report for this agent, attached,
 *  whose header names this package digest, delivered under a verified job
 *  manifest that lists the report's bytes and is not the tested agent's own. */
function usabilityLine(facts) {
  const want = hexOf(facts.target.digest);
  const mine = (facts.attached.usabilityReports ?? []).filter((r) => trim(r.header?.agent).toLowerCase() === facts.handle);
  if (!mine.length) return line("usability", facts, { present: false, signed: false, bound: false, state: "missing", evidence: `no usability report for ${facts.handle} was given to the audit; the usability tester (agents/usability-tester) writes one, and the platform keeps no store of them` });
  const judged = mine.map((r) => {
    const digest = sha256(r.bytes);
    const under = (facts.attached.manifests ?? []).filter((m) => (Array.isArray(m.doc?.pieces) ? m.doc.pieces : []).some((p) => trim(p?.digest) === digest));
    const verified = under.filter((m) => verifyManifest(m.doc) && trim(m.doc.agent) !== trim(facts.dev.key));
    const named = hexOf(r.header.package_digest);
    // Bound by the package that made its runs; a report whose runs named no
    // package (none delivered) is bound by the audited version and the
    // Descriptor dev serves, which is what it read.
    const served = hexOf(facts.dev.descriptor?.door_digest || facts.dev.descriptor?.bytes_digest);
    const byDescriptor = !named && Boolean(facts.target.version) && trim(r.header.version) === facts.target.version && Boolean(served) && hexOf(r.header.descriptor_digest) === served;
    return { r, digest, under, m: verified[0] ?? null, own: under.some((m) => trim(m.doc.agent) === trim(facts.dev.key)), bound: Boolean(want && named && named === want) || byDescriptor, byDescriptor, named };
  }).sort((a, b) => Number(b.bound) - Number(a.bound) || Number(Boolean(b.m)) - Number(Boolean(a.m)) || String(b.r.header.tested_at).localeCompare(String(a.r.header.tested_at)));
  const best = judged[0];
  const holderKeys = (facts.holderKeys.usability ?? []).map((k) => k.key);
  const by = best.m ? trim(best.m.doc.agent) : null;
  const parts = { present: true, signed: Boolean(best.m), bound: best.bound, source: best.r.name, by, record_digest: best.digest };
  const signedHow = best.m ? `delivered under ${best.m.name}, a manifest signed by ${by}${holderKeys.includes(by) ? ` (${holderWords(facts, "usability")})` : ", whose signature verifies (any tester counts)"}` : best.own ? "the only manifest listing it is the tested agent's own, and an agent does not test itself" : best.under.length ? "the manifest listing it does not verify" : "no signed delivery manifest given to the audit lists its digest";
  const boundHow = best.byDescriptor ? `names no package (no run delivered), and it tested version ${facts.target.version} through the Descriptor dev serves` : best.bound ? `names this package, ${short(facts.target.digest)}` : best.named ? `names package ${short(best.r.header.package_digest)}, not the audited ${short(facts.target.digest)}` : "names no package digest";
  return line("usability", facts, {
    ...parts, state: stateOf(parts),
    evidence: `${best.r.name}: verdict ${trim(best.r.header.verdict) || "?"} for version ${trim(best.r.header.version) || "?"}, tested ${trim(best.r.header.tested_at) || "at an unstated time"} by ${trim(best.r.header.tested_by) || "an unnamed tester"}; ${signedHow}; it ${boundHow}`,
    extra: { report: best.r.header },
  });
}

function docsLine(facts) {
  const a = facts.dev.agentdoc;
  if (!a?.ok || !a.doc) return line("docs", facts, { present: false, signed: false, bound: false, state: "missing", evidence: `no AgentDoc is served at ${facts.dev.origin}/a/${facts.handle}/agentdoc.json (${a?.error ?? "not read"})` });
  const src = (a.doc.sources ?? []).find((s) => s?.kind === "agent-descriptor" || s?.id === "descriptor");
  const named = trim(src?.agent_version);
  const bound = Boolean(facts.target.version && named === facts.target.version);
  const sigs = verifyDoc(a.doc);
  const signed = sigs.some((s) => s.verifies);
  const parts = { present: true, signed, bound, source: a.url, by: sigs.find((s) => s.verifies)?.by ?? null };
  return line("docs", facts, {
    ...parts, state: !bound ? "stale" : "present",
    evidence: `the AgentDoc at ${a.url}, assembled ${trim(a.doc.assembled_at) || "?"}${trim(a.doc.assembled_by) ? ` by ${trim(a.doc.assembled_by)}` : ""}, read from Descriptor version ${named || "(none stated)"}${facts.target.version ? `; the audited version is ${facts.target.version}` : ""}${signed ? "; its signature verifies" : sigs.length ? "; its signature does not verify" : "; it is unsigned"}`,
  });
}

/** The scripts in a package, by path. */
export const scriptsOf = (pkg) => (pkg ? [...pkg.files.keys()].filter((p) => /(^|\/)scripts\/[^/]+\.(mjs|js|cjs|ts|py|sh)$/.test(p)) : []);

function manifestLine(facts, stage) {
  const pkg = facts.pkg;
  const want = hexOf(facts.target.digest);
  const buildText = facts.buildRecordText ?? "";
  const ms = facts.attached.manifests.map((m) => ({ ...m, verifies: verifyManifest(m.doc), mdigest: sha256(Buffer.from(canonical(m.doc), "utf8")) }));
  const holderKeys = (facts.holderKeys[stage] ?? []).map((k) => k.key);
  const named = namedFor(facts, stage);
  const mine = ms.filter((m) => holderKeys.includes(trim(m.doc.agent)) || named.includes(m.name));
  const notes = facts.attached.notes.map((n) => n.name);
  if (!mine.length) {
    const hint = notes.length ? `; the records-folder notes attached (${notes.join(", ")}) are unsigned and are not a stage's record` : "";
    return line(stage, facts, { present: false, signed: false, bound: false, state: "missing", evidence: `no delivery manifest was given to the audit for this stage, signed by ${holderWords(facts, stage)} or named for it in the message (${stage}: <file name>)${hint}` });
  }
  const whose = (m) => (holderKeys.includes(trim(m.doc.agent)) ? holderWords(facts, stage) : "named for this stage in the message");
  const judged = mine.map((m) => {
    const pieces = Array.isArray(m.doc.pieces) ? m.doc.pieces : [];
    const inPkg = pkg ? pieces.filter((p) => p && pkg.digests.has(trim(p.digest))) : [];
    const names = want && canonical(m.doc).includes(want);
    const cited = buildText.includes(hexOf(m.mdigest)) || (trim(m.doc.sig) && buildText.includes(trim(m.doc.sig)));
    return { m, inPkg, bound: inPkg.length > 0 || names || cited, how: names ? "names this package's digest" : cited ? "is named by this package's build record" : inPkg.length ? `${inPkg.length} of its pieces are files in this package` : "names neither this package's digest nor any file in it" };
  });
  if (stage === "code") {
    const scripts = scriptsOf(pkg);
    const traced = new Map();
    for (const j of judged.filter((x) => x.m.verifies)) for (const p of j.m.doc.pieces ?? []) if (pkg?.digests.has(trim(p?.digest))) traced.set(pkg.digests.get(trim(p.digest)), j.m.name);
    const untraced = scripts.filter((s) => !traced.has(s));
    const signed = judged.some((j) => j.m.verifies);
    const bound = Boolean(pkg) && scripts.length > 0 && untraced.length === 0;
    const parts = { present: true, signed, bound: pkg ? bound : false, source: judged.map((j) => j.m.name).join(", "), by: trim(judged[0].m.doc.agent) };
    return line(stage, facts, {
      ...parts, state: stateOf(parts),
      evidence: !pkg ? "the package's bytes were not read, so no script could be traced"
        : `${scripts.length - untraced.length} of ${scripts.length} scripts traced to a verified delivery manifest given for the code stage (${[...new Set(judged.map((j) => whose(j.m)))].join("; ")})${untraced.length ? `; not traced: ${untraced.join(", ")}` : ""}`,
    });
  }
  const best = judged.sort((a, b) => Number(b.m.verifies) - Number(a.m.verifies) || Number(b.bound) - Number(a.bound))[0];
  const parts = { present: true, signed: best.m.verifies, bound: best.bound, source: best.m.name, by: trim(best.m.doc.agent), record_digest: best.m.mdigest };
  return line(stage, facts, {
    ...parts, state: stateOf(parts),
    evidence: `${best.m.name}: a delivery by ${trim(best.m.doc.agent)} (${whose(best.m)}), ${best.m.verifies ? "its signature verifies" : "its signature does not verify"}; it ${best.how}`,
  });
}

/** Every stage's line, in the lifecycle's order. */
export function stageLines(facts) {
  const lines = {};
  lines["build-record"] = buildRecordLine(facts);
  facts.buildRecordText = lines["build-record"].record ? canonical(lines["build-record"].record) : "";
  lines["deployment-record"] = deploymentRecordLine(facts);
  lines.descriptor = descriptorLine(facts, lines["deployment-record"]);
  lines.conformance = conformanceLine(facts, lines["deployment-record"]);
  lines.usability = usabilityLine(facts);
  lines.docs = docsLine(facts);
  for (const s of MANIFEST_STAGES) lines[s] = manifestLine(facts, s);
  return STAGE_ORDER.map((s) => lines[s]);
}

/** The attached files the message names for a stage (`<stage>: <file name>`). */
function namedFor(facts, stage) {
  return (facts.asked?.stages?.[stage] ?? []).map((n) => trim(n));
}

/** Delivery manifests attached that no stage's holder signed and the message names for no stage. */
export function strayManifests(facts) {
  const named = new Set(MANIFEST_STAGES.flatMap((s) => namedFor(facts, s)));
  // A manifest that lists an attached usability report is the Usability line's.
  const reports = new Set((facts.attached.usabilityReports ?? []).map((r) => sha256(r.bytes)));
  const usability = (m) => (Array.isArray(m.doc?.pieces) ? m.doc.pieces : []).some((p) => reports.has(trim(p?.digest)));
  return facts.attached.manifests.filter((m) => !holderOf(facts, trim(m.doc?.agent)) && !named.has(m.name) && !usability(m)).map((m) => ({ name: m.name, agent: trim(m.doc?.agent) }));
}
