// Assess the package: every permission it asks for, with the reason recorded
// for it or the plain fact that none is, and the verdict. No judgment: each
// rule here is one the security reviewer role states (agentroles.ai,
// section 34), and each is applied the same way every time.
//
// Three lists come out, and one more:
//
// - reaches: each system at its access, each further network destination,
//   each command, each folder it writes, with the reason the package records;
// - spends: each ceiling on what it spends, the owner's limit, the most one
//   job may take, with the reason for each;
// - never-dos: what it must never do, each with its reason: the package's own
//   refusals, and the bounds its grants set (a system granted read is never
//   written, a caller's material goes only where the descriptor says it
//   leaves for), each saying what holds it to that;
// - and every permission with no recorded reason, flagged.
//
// The package is refused, and the refusal names what stopped it, when:
// a program reaches a system the declaration does not name; a program reads
// a credential no system declares; its owner set no spending limit; an access
// has no reason; it carries something that looks like a credential; or its
// two halves do not declare the same systems. Anything it lets through that
// carries a risk is listed as accepted knowingly.
//
//   needs: node >= 22
//   import { assess } from "./assess.mjs"
import { PLATFORM } from "./platform.mjs";

const trim = (s) => String(s ?? "").trim();
export const ACCESS = ["read", "write", "trigger"];

/** A reason somebody can check: a few words that say what the access is for.
 *  An empty string, a dash, or one word is not a reason. */
export const hasReason = (s) => {
  const t = trim(s).replace(/^[-–—.]+$/, "");
  return t.split(/\s+/).filter(Boolean).length >= 3;
};

/** A refusal line, split into the act and the reason after it. The format
 *  writes a refusal as a gerund, then why, then what happens instead, so the
 *  first sentence is the act and the rest is its reason. */
export function splitRefusal(line) {
  const t = trim(line);
  const m = /^(.+?[.;!?])\s+(.+)$/s.exec(t);
  if (!m) return { act: t.replace(/[.]$/, ""), reason: "" };
  return { act: m[1].replace(/[.;]$/, ""), reason: trim(m[2]) };
}

const many = (n, word, plural = /(?:ch|sh|s|x)$/.test(word) ? `${word}es` : `${word}s`) => `${n} ${n === 1 ? word : plural}`;

/** What each authority word asks for, and where its reason is recorded. */
function authorityReason(word, d, arch) {
  const sys = (access) => d.systems.filter((s) => s.access === access && hasReason(s.needs));
  switch (word) {
    case "reads-systems": return sys("read").length ? `the reasons stated for ${sys("read").map((s) => s.name).join(", ")}` : "";
    case "updates-systems": return sys("write").length ? `the reasons stated for ${sys("write").map((s) => s.name).join(", ")}` : "";
    case "triggers-systems": return sys("trigger").length ? `the reasons stated for ${sys("trigger").map((s) => s.name).join(", ")}` : "";
    case "runs-commands": return d.binaries.length && d.binaries.every((b) => hasReason(b.purpose)) ? `the purpose stated for ${d.binaries.map((b) => b.name).join(", ")}` : "";
    case "reads-files": case "writes-files": return d.directories.length && d.directories.every((x) => hasReason(x.purpose)) ? `the purpose stated for ${d.directories.map((x) => x.name).join(", ")}` : "";
    case "spends-money": return d.systems.filter((s) => s.spends && hasReason(s.needs)).length ? `the reasons stated for ${d.systems.filter((s) => s.spends).map((s) => s.name).join(", ")}` : "";
    case "reaches-network": return arch?.given && arch.egress.lines.length ? "the architecture record's egress" : "";
    case "sends-messages": return d.wantsReplies ? "the runtime requirements' wants_replies, which says it sends work to other agents and reads their replies" : "";
    default: return "";
  }
}

/**
 * The assessment. Pure: everything it reads is passed in.
 *  declared   what read-package.mjs read off the package (fromFiles)
 *  traced     what trace-programs.mjs matched (matchReaches), plus { tests }
 *  arch       what architecture.mjs read (readArchitecture)
 *  limit      the owner's spending limit ({ said, from }) or null
 *  found      { credentials, links, climbing, problems }
 */
export function assess({ declared: d, traced, arch, limit, found = {} }) {
  const refusals = [];
  const unreasoned = [];
  const accepted = [];
  const notes = [];

  // ── reaches ──
  const reaches = [];
  for (const s of d.systems) {
    const reason = s.needs;
    const r = {
      system: s.name, access: s.access || "(none stated)", kind: s.kind || "directory", reason,
      credential: s.credential || "", env: s.env || "", leaves: s.leaves, spends: s.spends?.unit ?? "",
      reserved: PLATFORM.reservedSystems.includes(s.name),
    };
    reaches.push(r);
    if (!ACCESS.includes(s.access)) {
      refusals.push(`${s.name} asks for access "${s.access || "(none)"}", which is not one of read, write or trigger, so nobody can say what it is being granted`);
      unreasoned.push({ said: true, permission: `system ${s.name} at ${s.access || "no stated"} access`, asked_in: d.descriptorFile || "the descriptor", why_flagged: "the access is not one of read, write or trigger" });
    } else if (!hasReason(reason)) {
      unreasoned.push({ said: true, permission: `system ${s.name} at ${s.access} access`, asked_in: s.inDescriptor ? d.descriptorFile : d.requirementsFile, why_flagged: reason ? `its stated reason ("${reason}") does not say what the access is for` : "no reason is recorded for it" });
      refusals.push(`${s.name} at ${s.access} access has no recorded reason, and an access with no reason is not passed`);
    }
    if (s.inDescriptor && !s.inRequirements) refusals.push(`${s.name} is in the descriptor and not in the runtime requirements; the two must name the same systems, and the deployment manager refuses a package whose sets differ`);
    if (!s.inDescriptor && s.inRequirements) refusals.push(`${s.name} is in the runtime requirements and not in the descriptor, so a caller is never told the agent reaches it`);
    if (s.credential && !s.env) unreasoned.push({ permission: `the credential ${s.credential} for ${s.name}`, asked_in: d.requirementsFile, why_flagged: "it names a credential and no variable to place it in, which the deployment manager refuses" });
    if (s.leaves) accepted.push(`What a caller hands over is sent to ${s.name} (its descriptor says the caller's material leaves for it): ${reason || "no reason given"}.`);
    if (s.access === "write") accepted.push(`${s.name} is granted write access: whatever it holds can be changed by this agent within what its binding allows.`);
    if (!r.reserved && s.kind !== "directory") notes.push(`${s.name} is not one of the platform's reserved system names, so each deploy binds it by hand.`);
  }
  for (const h of traced.reaches) {
    if (h.system === "(further destination)") reaches.push({ system: h.host, access: "network", kind: "further destination", reason: "named in the architecture record's egress", credential: "", env: "", leaves: false, spends: "", program: h.files });
  }
  for (const b of d.binaries) {
    reaches.push({ system: `command ${b.name}`, access: "run", kind: "binary", reason: b.purpose, credential: "", env: "", leaves: false, spends: "" });
    if (!hasReason(b.purpose)) unreasoned.push({ permission: `running ${b.name}`, asked_in: d.requirementsFile, why_flagged: "no purpose is recorded for it" });
  }
  for (const x of d.directories) {
    reaches.push({ system: `folder ${x.name}`, access: "write", kind: "directory", reason: x.purpose, credential: "", env: "", leaves: false, spends: "" });
    if (!hasReason(x.purpose)) unreasoned.push({ permission: `writing the folder ${x.name}`, asked_in: d.requirementsFile, why_flagged: "no purpose is recorded for it" });
  }

  // What each offering says it is allowed, word by word.
  for (const o of d.offerings) {
    for (const w of o.authority ?? []) {
      if (!PLATFORM.authority.includes(w)) {
        unreasoned.push({ permission: `${o.id} authority "${w}"`, asked_in: d.descriptorFile, why_flagged: "it is not one of the nine authority words, so a reader drops the whole list" });
        continue;
      }
      const why = authorityReason(w, d, arch);
      if (!why) unreasoned.push({ permission: `${o.id} authority ${w}`, asked_in: d.descriptorFile, why_flagged: `nothing in the package records why ${o.id} needs it` });
    }
  }

  // ── what the programs reach that nothing names ──
  for (const u of traced.unmatched) {
    refusals.push(`a program reaches ${u.host} (${u.files.join(", ")}), and no system the declaration names covers it`);
    unreasoned.push({ said: true, permission: `reaching ${u.host}`, asked_in: u.files.join(", "), why_flagged: "the programs reach it and the declaration does not name it" });
  }
  for (const v of traced.credentialVars) {
    refusals.push(`a program reads ${v.name} (${v.files.join(", ")}), a credential no system declares, so it holds access nobody agreed to`);
    unreasoned.push({ said: true, permission: `the credential variable ${v.name}`, asked_in: v.files.join(", "), why_flagged: "the programs read it and no system declares it" });
  }
  for (const c of traced.undeclaredCommands) {
    unreasoned.push({ permission: `starting ${c.what}`, asked_in: c.file, why_flagged: "the programs start it and the runtime requirements declare no such binary" });
  }
  const openFiles = (list) => [...new Set(list.map((f) => f.file.replace(/:\d+$/, "")))];
  if (traced.unmatchedOpen?.length) {
    const files = openFiles(traced.unmatchedOpen);
    const strays = [...new Set(traced.unmatchedOpen.flatMap((f) => f.strays ?? []))];
    refusals.push(strays.length
      ? `${files.join(", ")} ${files.length === 1 ? "calls an address it is" : "call addresses they are"} handed (${traced.unmatchedOpen.map((f) => f.file).join(", ")}) and ${files.length === 1 ? "writes" : "write"} down ${strays.join(", ")}, which no declared system covers, so the call may go there`
      : `${files.join(", ")} ${files.length === 1 ? "fetches" : "fetch"} addresses ${files.length === 1 ? "it is" : "they are"} handed (${traced.unmatchedOpen.map((f) => f.file).join(", ")}), and the declaration names no system for them, so the package reaches whatever it is handed and says it reaches nothing`);
    unreasoned.push({ said: true, permission: "reaching addresses it is handed", asked_in: files.join(", "), why_flagged: "the programs fetch them and no declared system covers them" });
  }
  if (traced.openFetches.length) {
    const files = openFiles(traced.openFetches);
    accepted.push(`${many(traced.openFetches.length, "call")} in ${files.join(", ")} go${traced.openFetches.length === 1 ? "es" : ""} to an address the program is handed rather than one written down. Each is taken as ${[...new Set(traced.openFetches.map((f) => f.by))].join("; ")}, and nothing on the platform checks the address: ${PLATFORM.enforcement.egress}.`);
  }
  if (traced.undeclaredModel) accepted.push("The programs call the model the platform gives the agent (AGENT_MODEL) and the package declares no text-reasoning or image-reading system, so a caller is not told that what it hands over may go to a model. Declaring text-reasoning at trigger access, with leaves and a reason, would tell them.");
  if (traced.meshKeys?.length) accepted.push(`The programs read ${traced.meshKeys.map((k) => k.name).join(", ")}, the mesh credentials the host places for every job, which reach the platform as this agent.`);
  if (traced.modelKeys?.length) accepted.push(`The programs read ${traced.modelKeys.map((k) => k.name).join(" and ")}, the model key the platform places with the model it gives the agent. It is held on the host for as long as the agent is installed, and the kill switch does not revoke it.`);
  for (const b of traced.browsers ?? []) {
    if (!b.routes) accepted.push(`${b.file} ${PLATFORM.browserNote}.`);
  }
  const takesAddress = d.offerings.filter((o) => o.inputs.some((i) => i.kind === "url") && !(o.authority ?? []).includes("reaches-network"));
  if (takesAddress.length) notes.push(`${takesAddress.map((o) => o.id).join(", ")} ${takesAddress.length === 1 ? "takes" : "take"} an address from the caller and ${takesAddress.length === 1 ? "states" : "state"} no authority reaches-network (Common Agent 6.11); nothing on the platform reads that word yet, so this is a gap in what callers are told, not in what is enforced.`);

  // ── spends ──
  const spends = [];
  const spending = d.systems.filter((s) => s.spends);
  for (const s of spending) {
    const cs = d.ceilings.filter((c) => trim(c.system) === s.name);
    if (!cs.length) {
      spends.push({ ceiling: `${s.name}, per job`, limit: "none declared", reason: s.needs, enforced_by: PLATFORM.enforcement.ceilings });
      unreasoned.push({ permission: `spending ${s.spends.unit} on ${s.name}`, asked_in: d.requirementsFile, why_flagged: "it spends and the package declares no ceiling on it" });
      continue;
    }
    for (const c of cs) {
      const said = trim(c.reason ?? c.purpose ?? c.why);
      spends.push({
        ceiling: `${s.name}, per ${trim(c.per) || "job"}`,
        limit: c.suggested != null ? `${c.suggested} ${s.spends.unit} (suggested; the owner sets the number at install)` : `set by the owner at install, in ${s.spends.unit}`,
        reason: said || (hasReason(s.needs) ? `${s.name} is reached ${s.needs.replace(/^to\s+/i, "to ")}` : ""),
        enforced_by: c.enforced_by === "runtime" ? PLATFORM.enforcement.runtimeCeiling : PLATFORM.enforcement.ceilings,
      });
      if (!said && !hasReason(s.needs)) unreasoned.push({ permission: `the ceiling on ${s.name}`, asked_in: d.requirementsFile, why_flagged: "neither the ceiling nor the system records a reason" });
    }
  }
  for (const c of d.ceilings) {
    if (!d.systems.some((s) => s.name === trim(c.system))) unreasoned.push({ permission: `a ceiling on ${trim(c.system) || "an unnamed system"}`, asked_in: d.requirementsFile, why_flagged: "it bounds a system the package does not declare" });
  }
  for (const o of d.offerings) {
    for (const [k, v] of Object.entries(o.ceilings ?? {})) {
      spends.push({ ceiling: `${o.id}: ${k.replace(/_/g, " ")}`, limit: `${v?.most ?? "?"}${v?.decided_by ? ` (decided by ${v.decided_by})` : ""}`, reason: trim(v?.reason) || `declared on the offering ${o.id}`, enforced_by: "stated to callers in the descriptor (Common Agent 6.11)" });
    }
  }
  if (d.trialCeiling) {
    const t = d.trialCeiling;
    spends.push({ ceiling: "trial", limit: `${t.amount_micro != null ? `${t.amount_micro / 1e6} ${t.currency ?? "USD"}` : "?"} per ${t.per ?? "day"}`, reason: "the owner's suggested trial ceiling, written into the allowance at install", enforced_by: PLATFORM.enforcement.trial });
  }
  if (d.jobSeconds) spends.push({ ceiling: "time per job", limit: `${d.jobSeconds} seconds`, reason: "the longest one job may take; the host stops a job at it", enforced_by: PLATFORM.enforcement.jobSeconds });
  if (limit) spends.unshift({ ceiling: "the owner's spending limit", limit: limit.said, reason: `set by the owner (${limit.from})`, enforced_by: PLATFORM.enforcement.ownerLimit });
  else refusals.push("its owner has set no spending limit, and no package passes without one: say it as a line `spending limit: <amount> per <day|month|job>`, or in the architecture record's limits");
  if (d.price?.price?.model && d.price.price.model !== "free") notes.push(`The package charges callers ${d.price.price.amount_micro != null ? `${d.price.price.amount_micro / 1e6} ${d.price.price.currency ?? "USD"}` : "a price"} (${d.price.price.model}); that is what it earns, not what it may spend.`);

  // ── never-dos ──
  const neverDos = [];
  for (const line of d.refusals) {
    const { act, reason } = splitRefusal(line);
    neverDos.push({ act, reason: reason || "(the package gives none)", from: "the package's refusals", held_by: "this package's own programs" });
  }
  for (const s of d.systems) {
    if (s.access === "read") neverDos.push({ act: `Writing to ${s.name}`, reason: `it is granted read access only${hasReason(s.needs) ? `, ${s.needs}` : ""}`, from: "this review", held_by: PLATFORM.enforcement.access });
    if (s.access === "trigger") neverDos.push({ act: `Reading or changing what ${s.name} holds`, reason: "it is granted trigger access: it may start the service and take its answer, and nothing more", from: "this review", held_by: PLATFORM.enforcement.access });
    if (!s.leaves && s.kind !== "directory") neverDos.push({ act: `Sending a caller's material to ${s.name}`, reason: "the descriptor does not say a caller's material leaves for it, and a caller decides what to hand over on what the descriptor says", from: "this review", held_by: `this package's own programs; ${PLATFORM.enforcement.leaves}` });
  }
  neverDos.push({ act: "Reaching an address no declared system covers", reason: "what it may reach is what its systems name, and nothing else was agreed", from: "this review", held_by: PLATFORM.enforcement.egress });
  neverDos.push({ act: "Holding a credential value in its files, its records or a reply", reason: "credentials are placed by name at install and read from the variable the package names, so a value in the package is one nobody can rotate", from: "this review", held_by: PLATFORM.enforcement.credentials });
  if (!d.binaries.length) neverDos.push({ act: "Starting a program other than its own runtime", reason: "it declares no binaries", from: "this review", held_by: "the host lays out only the declared binaries; nothing stops a script starting one already there" });
  neverDos.push({ act: "Working on after it is stopped", reason: "an owner who stops an agent must be able to rely on it stopping", from: "this review", held_by: PLATFORM.enforcement.killSwitch });

  // ── what the files carry ──
  for (const c of found.credentials ?? []) {
    refusals.push(`${c.file} carries what looks like ${c.what} (line ${c.line}); a credential is placed by name, never carried`);
  }
  for (const l of found.links ?? []) refusals.push(`the package carries a link, ${l}, which can point anywhere on the machine that unpacks it`);
  for (const p of found.climbing ?? []) refusals.push(`the package carries a path that climbs out of it, ${p}`);
  if (found.outside?.length) refusals.push(`the archive carries ${many(found.outside.length, "file")} outside the package's own folder (${found.outside.slice(0, 5).join(", ")}${found.outside.length > 5 ? ", and more" : ""}), which an install would not lay out and a reader would not look for`); // cut-ok: a sample named in the sentence, the count is the whole
  for (const b of found.bundled ?? []) refusals.push(`the package ships its own ${b}, so its dependencies are code nobody verified; the installer refuses one, and a lockfile is how a package names what it needs`);

  // ── parts ──
  const parts = { lockfiles: d.lockfiles, dependencies: d.dependencies.map((x) => ({ skill: trim(x.skill), lockfile: trim(x.lockfile), sha256: trim(x.sha256) })) };
  if (d.lockfiles.length) accepted.push(`${many(d.lockfiles.length, "lockfile")} ${d.lockfiles.length === 1 ? "brings" : "bring"} in code this package did not write (${d.lockfiles.join(", ")}); it runs with everything the agent is granted, and is pinned by the lockfile's digest.`);

  // ── the architecture record ──
  if (arch?.given) {
    const named = new Set(arch.systems);
    for (const s of d.systems) if (named.size && !named.has(s.name)) refusals.push(`${s.name} is declared by the package and not named in the architecture record, so nobody designed the agent to reach it`);
    for (const n of arch.systems) if (!d.systems.some((s) => s.name === n)) notes.push(`The architecture record names ${n}, and the package does not declare it.`);
  }

  // The stage is done when every permission asked for has a recorded reason,
  // so one with none refuses the package even where no other rule does.
  const left = unreasoned.filter((u) => !u.said);
  if (left.length) refusals.push(`${many(left.length, "permission")} ${left.length === 1 ? "has" : "have"} no recorded reason (${left.map((u) => u.permission).join("; ")})`);
  const verdict = refusals.length ? "refused" : "passed";
  for (const u of unreasoned) delete u.said;
  return { verdict, reaches, spends, neverDos, unreasoned, refusals, accepted, notes, parts, architecture: arch, limit };
}
