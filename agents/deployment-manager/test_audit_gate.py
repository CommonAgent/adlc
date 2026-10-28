#!/usr/bin/env python3
"""The deployment manager's audit gate (lifecycle plan item 4c).

Where the gate is on, a package is installed only with a current audit pass
for that exact package digest, read from the platform's audit door and judged
from the signed report's own bytes: the report must hash to the digest the
audit names, be for this package digest, be signed by an auditor key this
environment pins, say pass or pass_with_findings, and not have expired.
Anything else is refused before a token, an argfile or the procedure, with a
sentence that names the digest, what is missing and the report, or that none
exists.

Nothing here reaches a network or runs node: the control plane and the
signature check are answered through their seams.

Run: AGENTMESH_ENV=example python3 -m unittest test_audit_gate
"""
import hashlib
import importlib.util
import json
import os
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location("deploy_executor", os.path.join(HERE, "deploy-executor.py"))
ex = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ex)

AUDITOR = "UAUDITORAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
STRANGER = "USTRANGERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
HEX = "a" * 64
DIGEST = "sha256:" + HEX
NOW = 1_800_000_000  # 2027-01-15


def report(**over):
    h = {"audit_report": "v1", "agent": "quiz-maker.platform@agentmesh.ai", "version": "0.7.0",
         "package_digest": DIGEST, "checklist": "https://schemas.agentmesh.ai/audit-checklist/v1",
         "checklist_digest": "sha256:" + "c" * 64, "verdict": "pass", "audited_at": "2026-10-28T12:00:00Z",
         "expires_at": "2099-01-01T00:00:00Z", "signed_by": AUDITOR, "signature": "c2ln"}
    h.update(over)
    return "---\n" + "".join(f"{k}: {v}\n" for k, v in h.items()) + "---\n\n# Audit\n\nStage records: all present.\n"


def rdigest(text):
    return "sha256:" + hashlib.sha256(text.encode("utf-8")).hexdigest()


def answer_for(text, current_pass=True, why="the newest audit is pass"):
    return {"package_digest": DIGEST, "current_pass": current_pass, "why": why,
            "current": {"package_digest": DIGEST, "verdict": "pass", "expires_at": "2099-01-01T00:00:00Z",
                        "signed_by": AUDITOR, "report_digest": rdigest(text),
                        "report_url": f"https://api.dev.agentmesh.ai/v1/audit-reports/{rdigest(text)}"}}


REQ = {"id": "dr_Gate1234abcd", "args": {"name": "quiz-maker", "harness": "opencode"}, "boot_token": "am_x",
       "package_url": "https://api.dev.agentmesh.ai/v1/deploy-requests/dr_Gate1234abcd/package.tar.gz",
       "package": {"name": "quiz-maker", "version": "0.7.0", "sha256": HEX},
       "audit_gate": {"required": True, "auditor_keys": [AUDITOR]}}


class Gate(unittest.TestCase):
    """A control plane that answers the audit door and serves report bytes."""

    def setUp(self):
        self.answer = None
        self.served = {}
        self.verified = []
        for p in (mock.patch.object(ex, "_am_env_section", return_value=None),
                  mock.patch.object(ex, "call", side_effect=self.call),
                  mock.patch.object(ex, "fetch_text", side_effect=lambda path, timeout=30: self.served[path]),
                  mock.patch.object(ex, "signature_verifies", side_effect=self.verify),
                  mock.patch.dict(os.environ, {}, clear=False)):
            p.start()
            self.addCleanup(p.stop)
        os.environ.pop("AUDIT_GATE", None)
        self.good_sig = True

    def call(self, path, method="GET", body=None, timeout=30):
        assert path == f"/audits/{DIGEST}", path
        if isinstance(self.answer, Exception):
            raise self.answer
        return self.answer

    def verify(self, key, message, sig):
        self.verified.append((key, message, sig))
        return self.good_sig

    def serve(self, text, **answer):
        self.served[f"/audit-reports/{rdigest(text)}"] = text
        self.answer = answer_for(text, **answer)


class AnInstallNeedsACurrentPass(Gate):

    def test_a_current_pass_lets_it_through_and_the_signature_is_checked_over_the_tagged_text(self):
        text = report()
        self.serve(text)
        self.assertIsNone(ex.audit_refusal(dict(REQ), now=NOW))
        key, message, sig = self.verified[0]
        self.assertEqual((key, sig), (AUDITOR, "c2ln"))
        self.assertTrue(message.startswith("agent-audit-report-v1\n---\n"))
        self.assertNotIn("signature:", message)

    def test_pass_with_findings_is_a_pass(self):
        self.serve(report(verdict="pass_with_findings"))
        self.assertIsNone(ex.audit_refusal(dict(REQ), now=NOW))

    def test_no_report_is_refused_and_said(self):
        self.answer = {"package_digest": DIGEST, "current_pass": False, "why": f"no audit has been filed for {DIGEST}", "current": None, "reports": []}
        why = ex.audit_refusal(dict(REQ), now=NOW)
        self.assertEqual(why, f"quiz-maker 0.7.0 cannot be deployed here: no current audit pass for {DIGEST}: no audit report exists for this package digest.")

    def test_an_expired_pass_is_refused_with_the_report(self):
        text = report(expires_at="2026-11-27T12:00:00Z")
        self.serve(text, current_pass=False, why="the newest audit, 2026-10-28T12:00:00Z, is pass but expired at 2026-11-27T12:00:00Z")
        why = ex.audit_refusal(dict(REQ), now=NOW)
        self.assertIn("expired at 2026-11-27T12:00:00Z", why)
        self.assertIn(f"The audit report: https://api.dev.agentmesh.ai/v1/audit-reports/{rdigest(text)}", why)

    def test_an_expired_pass_is_refused_even_when_the_answer_says_pass(self):
        self.serve(report(expires_at="2026-11-27T12:00:00Z"))
        self.assertIn("expired at 2026-11-27T12:00:00Z", ex.audit_refusal(dict(REQ), now=NOW))

    def test_a_pass_for_a_different_digest_is_refused(self):
        self.serve(report(package_digest="sha256:" + "b" * 64))
        self.assertIn("is for sha256:" + "b" * 64 + ", not this digest", ex.audit_refusal(dict(REQ), now=NOW))

    def test_a_pass_the_pinned_auditor_did_not_sign_is_refused(self):
        self.serve(report(signed_by=STRANGER))
        self.assertIn("not the auditor key this environment pins", ex.audit_refusal(dict(REQ), now=NOW))

    def test_a_signature_that_does_not_verify_is_refused(self):
        self.serve(report())
        self.good_sig = False
        self.assertIn("signature does not verify", ex.audit_refusal(dict(REQ), now=NOW))

    def test_a_fail_is_refused(self):
        self.serve(report(verdict="fail"), current_pass=False, why="the newest audit, 2026-10-28T12:00:00Z, is fail")
        self.assertIn("is fail", ex.audit_refusal(dict(REQ), now=NOW))

    def test_bytes_that_are_not_the_named_report_are_refused(self):
        text = report()
        self.serve(text)
        self.served[f"/audit-reports/{rdigest(text)}"] = text + "tampered"
        self.assertIn("not the one the audit names", ex.audit_refusal(dict(REQ), now=NOW))

    def test_an_audit_door_that_cannot_be_read_refuses(self):
        self.answer = OSError("connection refused")
        self.assertIn("the audit could not be read", ex.audit_refusal(dict(REQ), now=NOW))


class WhereTheGateIsOn(Gate):

    def test_off_by_default_asks_nothing(self):
        r = {k: v for k, v in REQ.items() if k != "audit_gate"}
        self.assertIsNone(ex.audit_refusal(r, now=NOW))
        self.assertIsNone(self.answer)

    def test_the_switch_turns_it_on(self):
        r = {k: v for k, v in REQ.items() if k != "audit_gate"}
        os.environ["AUDIT_GATE"] = "on"
        self.answer = {"current_pass": False, "why": "none", "current": None}
        self.assertIn("no audit report exists", ex.audit_refusal(r, now=NOW))
        # and with no auditor key pinned anywhere, even a pass is refused
        self.serve(report())
        self.assertIn("pins no auditor key", ex.audit_refusal(r, now=NOW))

    def test_an_environment_that_requires_it_cannot_be_turned_off(self):
        with mock.patch.object(ex, "_am_env_section", return_value={"required": True, "auditor_keys": [AUDITOR]}):
            os.environ["AUDIT_GATE"] = "off"
            r = {k: v for k, v in REQ.items() if k != "audit_gate"}
            self.answer = {"current_pass": False, "why": "none", "current": None}
            self.assertIn("no audit report exists", ex.audit_refusal(r, now=NOW))

    def test_the_environment_pins_the_auditor_before_the_request_does(self):
        with mock.patch.object(ex, "_am_env_section", return_value={"required": True, "auditor_keys": [STRANGER]}):
            self.serve(report())
            self.assertIn("not the auditor key this environment pins", ex.audit_refusal(dict(REQ), now=NOW))


class ARefusalPlacesNothing(Gate):

    def test_run_one_refuses_before_the_token_and_the_procedure_and_records_it(self):
        self.answer = {"current_pass": False, "why": "none", "current": None}
        ran = []

        def run(argv, **kw):
            ran.append(argv)
            return mock.Mock(stdout=json.dumps({"act": "refuse", "signatures": [{"sig": "x"}]}), stderr="", returncode=0)

        with mock.patch.object(ex.subprocess, "run", side_effect=run), mock.patch("builtins.open", mock.mock_open()), \
                mock.patch.object(ex.os, "makedirs"), mock.patch("builtins.print"):
            out = ex.run_one(dict(REQ))
        self.assertFalse(out["ok"])
        self.assertEqual(out["result"]["step"], "audit-gate")
        self.assertIn("no audit report exists", out["result"]["error"])
        self.assertEqual([a[:2] for a in ran], [["python3", ex.RECORD]])
        self.assertEqual(out["record"]["act"], "refuse")

    def test_a_retirement_and_a_container_are_not_asked(self):
        with mock.patch.object(ex, "run_version_act", return_value={"ok": True}), \
                mock.patch.object(ex, "run_container", return_value={"ok": True}):
            self.assertTrue(ex.run_one({**REQ, "retire": {"version": "0.6.0"}})["ok"])
            self.assertTrue(ex.run_one({**REQ, "container": {"source": "x"}})["ok"])
        self.assertIsNone(self.answer)


if __name__ == "__main__":
    unittest.main()
