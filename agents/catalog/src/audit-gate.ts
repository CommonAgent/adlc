/**
 * The audit gate: whether an agent version may be deployed or listed here
 * (lifecycle plan item 4c; TERMS.md "Audit" and "Gates").
 *
 * Two gates ask this. The deploy gate refuses to approve or queue a deploy of
 * a package without a current audit pass for that exact package digest, and
 * the catalog gate refuses to list an agent version without one. Both put the
 * same question in the same words, so this file is the one place that says
 * what lets a version through.
 *
 * The audit itself is read from the platform's audit store (item 4b,
 * services/src/audits, GATE-READ.md): its answer for a digest is
 * `{ current_pass, why, current }`, where `current` is the header of the
 * newest report for that digest. The store checked the report's signature
 * against its `signed_by` key when the report was filed. This gate adds what
 * the store cannot know: that `signed_by` is the auditor key THIS environment
 * pins, and that the report is for exactly the digest at hand. It checks
 * verdict and expiry again too, so a stale answer cannot let a version in.
 *
 * Pure: no network, no store and no clock of its own, so the same text runs
 * in the services and in the catalog (catalog/src/audit-gate.ts is a
 * byte-for-byte copy, held to this one by a test).
 */

/** The verdicts that count as a pass. */
export const PASSING_VERDICTS = ["pass", "pass_with_findings"] as const;

/** A report's header, as the audit store answers it (GATE-READ.md). */
export interface AuditHeader {
  agent?: string;
  version?: string;
  package_digest: string;
  checklist?: string;
  checklist_digest?: string;
  verdict: string;
  audited_at?: string;
  expires_at: string;
  signed_by: string;
  report_digest?: string;
  filed_at?: string;
  report_url?: string;
}

/** The audit store's answer for one package digest. */
export interface AuditAnswer {
  current_pass: boolean;
  why: string;
  current: AuditHeader | null;
  reports?: AuditHeader[];
}

export type GateJudgement =
  | { ok: true; current: AuditHeader }
  | { ok: false; missing: string; report_url: string | null };

/** `sha256:<64 lowercase hex>` from that form or bare hex; null otherwise. */
export function normalizeDigest(d: unknown): string | null {
  if (typeof d !== "string") return null;
  const s = d.trim().toLowerCase();
  const hex = s.startsWith("sha256:") ? s.slice(7) : s;
  return /^[0-9a-f]{64}$/.test(hex) ? `sha256:${hex}` : null;
}

/** Whether this environment requires the gate. `required` is the
 *  environment file's word (env/<name>.json audit_gate.required; prod: true).
 *  Where the file does not require it, the switch variable (audit_gate.switch,
 *  default AUDIT_GATE) set to on, 1 or true turns it on. The switch only turns
 *  the gate on: where the file requires it, nothing turns it off. */
export function gateRequired(
  setting: { required?: unknown; switch?: unknown } | null | undefined,
  env: Record<string, string | undefined>,
): { required: boolean; why: string } {
  if (setting?.required === true) return { required: true, why: "this environment requires a current audit pass" };
  const name = typeof setting?.switch === "string" && setting.switch ? setting.switch : "AUDIT_GATE";
  const v = String(env[name] ?? "").trim().toLowerCase();
  if (v === "on" || v === "1" || v === "true") return { required: true, why: `${name} is on in this environment` };
  return { required: false, why: `this environment does not require an audit pass (${name} is off)` };
}

/** The auditor keys an environment pins (audit_gate.auditor_keys): nkey
 *  user public keys only, anything else dropped. */
export function auditorKeysOf(setting: { auditor_keys?: unknown } | null | undefined): string[] {
  const keys = setting?.auditor_keys;
  return Array.isArray(keys) ? keys.filter((k): k is string => typeof k === "string" && /^U[A-Z2-7]{55}$/.test(k)) : [];
}

/** An answer read off the wire (GET /v1/audits/<digest>), or null when it is
 *  not the shape GATE-READ.md describes. */
export function readAuditAnswer(doc: unknown): AuditAnswer | null {
  if (!doc || typeof doc !== "object") return null;
  const d = doc as Record<string, unknown>;
  if (typeof d.current_pass !== "boolean") return null;
  const cur = d.current;
  if (cur !== null && cur !== undefined) {
    const c = cur as Record<string, unknown>;
    if (typeof cur !== "object" || typeof c.package_digest !== "string" || typeof c.verdict !== "string"
      || typeof c.expires_at !== "string" || typeof c.signed_by !== "string") return null;
  }
  return {
    current_pass: d.current_pass,
    why: typeof d.why === "string" ? d.why : "",
    current: (cur ?? null) as AuditHeader | null,
    ...(Array.isArray(d.reports) ? { reports: d.reports as AuditHeader[] } : {}),
  };
}

/** Judge the audit store's answer for a digest. `answer` null means the audit
 *  could not be read, which refuses: the gate fails closed. */
export function judgeAudit(
  answer: AuditAnswer | null,
  digest: string,
  auditorKeys: readonly string[],
  now: Date,
): GateJudgement {
  const want = normalizeDigest(digest);
  if (!want) return { ok: false, missing: `"${String(digest).slice(0, 80)}" is not a sha256 package digest`, report_url: null };
  if (!answer) return { ok: false, missing: "the audit could not be read", report_url: null };
  const cur = answer.current;
  const url = cur?.report_url ?? answer.reports?.[0]?.report_url ?? null;
  if (!cur) return { ok: false, missing: "no audit report exists for this package digest", report_url: null };
  if (!answer.current_pass) return { ok: false, missing: answer.why || `the newest audit is ${cur.verdict}`, report_url: url };
  if (normalizeDigest(cur.package_digest) !== want) {
    return { ok: false, missing: `the audit on record is for ${cur.package_digest}, not this digest`, report_url: url };
  }
  if (!auditorKeys.length) return { ok: false, missing: "this environment pins no auditor key, so no audit can be accepted", report_url: url };
  if (!auditorKeys.includes(cur.signed_by)) {
    return { ok: false, missing: `the audit is signed_by ${cur.signed_by}, which is not the auditor key this environment pins`, report_url: url };
  }
  if (!(PASSING_VERDICTS as readonly string[]).includes(cur.verdict)) {
    return { ok: false, missing: `the newest audit is ${cur.verdict}`, report_url: url };
  }
  const expires = Date.parse(cur.expires_at);
  if (!Number.isFinite(expires) || expires <= now.getTime()) {
    return { ok: false, missing: `the audit pass expired at ${cur.expires_at}`, report_url: url };
  }
  return { ok: true, current: cur };
}

/** The refusal, in one sentence a publisher can act on: what was refused,
 *  for which digest, what is missing, and the report, or that none exists. */
export function refusalText(
  act: "deploy" | "list",
  what: { name?: string; version?: string; digest: string },
  j: Extract<GateJudgement, { ok: false }>,
): string {
  const who = [what.name, what.version].filter(Boolean).join(" ");
  const verb = act === "deploy" ? "deployed" : "listed";
  const digest = normalizeDigest(what.digest) ?? what.digest;
  const head = `${who ? `${who} ` : ""}cannot be ${verb} here: no current audit pass for ${digest}: ${j.missing}`;
  return j.report_url ? `${head}. The audit report: ${j.report_url}` : `${head}.`;
}
