/**
 * The audit gate's rule (lifecycle plan item 4c), as the catalog applies it
 * before listing an agent version: a current audit pass for the exact package
 * digest the version was deployed from, signed by the auditor key the
 * environment pins, with a verdict of pass or pass_with_findings, not expired.
 */
import { describe, it, expect } from "vitest";
import { gateRequired, judgeAudit, refusalText, type AuditAnswer, type AuditHeader } from "../src/audit-gate.js";

const AUDITOR = "UAUDITORAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const D = `sha256:${"a".repeat(64)}`;
const NOW = new Date("2026-10-28T12:00:00Z");
const header = (over: Partial<AuditHeader> = {}): AuditHeader => ({
  package_digest: D, verdict: "pass", expires_at: "2026-11-27T12:00:00Z", signed_by: AUDITOR,
  report_url: "https://api.example/v1/audit-reports/sha256:c", ...over,
});
const pass = (over: Partial<AuditHeader> = {}): AuditAnswer => ({ current_pass: true, why: "pass", current: header(over) });

describe("listing an agent version", () => {
  it("needs a current pass for its exact digest", () => {
    expect(judgeAudit(pass(), D, [AUDITOR], NOW).ok).toBe(true);
    expect(judgeAudit(pass({ verdict: "pass_with_findings" }), D, [AUDITOR], NOW).ok).toBe(true);
  });

  it("is refused with no report, and the refusal says so", () => {
    const j = judgeAudit({ current_pass: false, why: "none", current: null }, D, [AUDITOR], NOW);
    if (j.ok) throw new Error("expected a refusal");
    expect(refusalText("list", { name: "quiz-maker", version: "0.7.0", digest: D }, j))
      .toBe(`quiz-maker 0.7.0 cannot be listed here: no current audit pass for ${D}: no audit report exists for this package digest.`);
  });

  it("is refused for an expired pass, a pass for another digest, or another signer, pointing to the report", () => {
    for (const a of [pass({ expires_at: "2026-10-01T00:00:00Z" }), pass({ package_digest: `sha256:${"b".repeat(64)}` }), pass({ signed_by: "U" + "S".repeat(55) })]) {
      const j = judgeAudit(a, D, [AUDITOR], NOW);
      expect(j.ok).toBe(false);
      if (!j.ok) expect(refusalText("list", { digest: D }, j)).toContain("The audit report: https://api.example/v1/audit-reports/sha256:c");
    }
  });

  it("is required where the environment says, and switched on elsewhere", () => {
    expect(gateRequired({ required: true }, { AUDIT_GATE: "off" }).required).toBe(true);
    expect(gateRequired({ required: false }, {}).required).toBe(false);
    expect(gateRequired({ required: false }, { AUDIT_GATE: "on" }).required).toBe(true);
  });
});
