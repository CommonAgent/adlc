#!/usr/bin/env python3
"""Acting inside a customer's own Google Cloud project: the guard, the flag,
and the reading of what a failed call meant.

What is worth pinning: a service account and a project that disagree are
refused with both halves named and nothing called; a google-managed account is
not a grant; an instruction carrying its own project id has to agree with the
grant's; with no grant the flag is the empty list, so the call is byte for byte
the call this deployer has always made; a revocation reads differently from an
outage, and a call the customer's own project refused for want of a role is
neither of those; and a line of the action log carries names and never values.

Nothing here calls a cloud. That is the point of the split: the case that
matters most is a pairing that must never reach a call, so it has to be
testable with no call available.

Run: python3 -m unittest discover -s fleet-manager/deploymgr -p "test_*.py"
"""
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import cloud  # noqa: E402
import image  # noqa: E402

THEIRS = "acme-analytics-42"
GRANT = {"provider": "gcp", "project": THEIRS,
         "impersonate": f"agentmesh-deploy@{THEIRS}.iam.gserviceaccount.com"}
# OURS: the account the customer's binding grants to, and the middle of the
# chain. This host's machine identity becomes it; it becomes theirs.
OURS = "agentmesh-deployer@langbench-1528148150979.iam.gserviceaccount.com"


class TheAccountMustBelongToTheProject(unittest.TestCase):
    """The deployer guard. One deployer service account holds grants from many
    customers, so the way a bug in any of this shows up is acting in one
    customer's project with another customer's account, and a project and an
    account that disagree is the shape that bug takes."""

    def test_a_pairing_that_agrees_is_not_refused(self):
        self.assertIsNone(cloud.refusal(GRANT))

    def test_a_pairing_that_disagrees_is_refused_and_names_both_halves(self):
        other = "globex-media-77"
        bad = {**GRANT, "impersonate": f"agentmesh-deploy@{other}.iam.gserviceaccount.com"}
        why = cloud.refusal(bad)
        self.assertIsNotNone(why)
        # BOTH halves, because the refusal has to be actionable by somebody who
        # can see only one of them: the project they meant and the project the
        # account actually belongs to.
        self.assertIn(THEIRS, why)
        self.assertIn(other, why)
        self.assertIn("Nothing was called", why)

    def test_a_google_managed_account_is_not_a_grant(self):
        # A grant on the default compute account is a grant on whatever else
        # already runs in that project, which is not what anybody agreed to.
        for account in (f"210987654321-compute@developer.gserviceaccount.com",
                        f"{THEIRS}@appspot.gserviceaccount.com",
                        "someone@example.com", "", None):
            why = cloud.refusal({**GRANT, "impersonate": account})
            self.assertIsNotNone(why, account)
            self.assertIn("Nothing was called", why)

    def test_the_project_is_read_out_of_the_account(self):
        self.assertEqual(cloud.project_of(GRANT["impersonate"]), THEIRS)
        self.assertIsNone(cloud.project_of("210987654321-compute@developer.gserviceaccount.com"))

    def test_a_cloud_this_deployer_cannot_act_in_is_refused(self):
        why = cloud.refusal({**GRANT, "provider": "aws"})
        self.assertIn("gcp", why)
        self.assertIn("Nothing was called", why)

    def test_a_project_id_that_is_not_one_is_refused(self):
        for project in ("Acme-Prod", "no", "x" * 40, 7, None):
            self.assertIsNotNone(cloud.refusal({**GRANT, "project": project}), project)

    def test_a_cloud_block_that_is_not_an_object_is_refused(self):
        for block in ("acme-analytics-42", ["gcp"], 7):
            self.assertIn("must be an object", cloud.refusal(block))

    def test_an_instruction_naming_a_different_project_is_the_same_disagreement(self):
        # Read from the other side: the grant is for one project and the rest
        # of the instruction would act in another. Which half is the mistake is
        # not this function's to guess, so it refuses rather than picking one.
        why = cloud.refusal(GRANT, project="langbench-1528148150979")
        self.assertIn("langbench-1528148150979", why)
        self.assertIn(THEIRS, why)
        # And an instruction that names the same project is fine, which is what
        # the platform half sends when it mints one from the grant record.
        self.assertIsNone(cloud.refusal(GRANT, project=THEIRS))

    def test_one_rule_for_a_project_id_and_not_two(self):
        # Spelled in two files so this one can refuse on its own. Two spellings
        # of one rule drift, and the half that drifts is whichever nobody reads.
        self.assertEqual(cloud.PROJECT_RE.pattern, image.PROJECT_RE.pattern)


class WithNoGrantNothingChanges(unittest.TestCase):
    """The promise that makes this safe to ship: an instruction that names no
    customer produces the call this deployer has always made."""

    def test_no_grant_is_no_flag_at_all(self):
        for absent in (None, {}, False):
            self.assertEqual(cloud.flag(absent), [])
            # And no deployer account needed to say so: an act of ours never
            # touches this arrangement at all.
            self.assertEqual(cloud.flag(absent, OURS), [])

    def test_a_grant_is_exactly_one_flag(self):
        self.assertEqual(cloud.flag(GRANT, OURS),
                         [f"--impersonate-service-account={OURS},{GRANT['impersonate']}"])


class TheChainIsOursThenTheirs(unittest.TestCase):
    """Two hops, because this host's own identity is the project's default
    compute service account: shared by everything on the box and the exact
    shape this file refuses when a CUSTOMER offers one. Ours sits in the
    middle, holding no role anywhere, so a customer can grant to it without
    granting to anything else of ours."""

    def test_the_last_account_in_the_list_is_the_one_acted_as(self):
        # Verified rather than reasoned about, because gcloud's own help text
        # contradicts itself on this point. Its source settles it
        # (googlecloudsdk/core/credentials/store.py ParseImpersonationAccounts
        # returns service_account_ids[-1] as the target principal and [:-1] as
        # the delegates), and so did a live read-only run: "All API calls will
        # be executed as [<the last one>] ... via delegate chain: <ours>".
        chain = cloud.flag(GRANT, OURS)[0].split("=", 1)[1].split(",")
        self.assertEqual(chain, [OURS, GRANT["impersonate"]])
        self.assertEqual(chain[-1], GRANT["impersonate"])

    def test_a_grant_with_no_deployer_account_builds_no_flag_at_all(self):
        # The flag without the chain impersonates from this machine's own
        # identity inside a customer's project. There is no safe value to
        # return, so nothing is returned: the act stops here, having called
        # nothing, rather than at gcloud with the wrong identity.
        with self.assertRaises(ValueError):
            cloud.flag(GRANT)
        for absent in ("", None, False):
            with self.assertRaises(ValueError):
                cloud.flag(GRANT, absent)

    def test_a_host_that_does_not_name_its_deployer_account_is_refused(self):
        for bad in ("", None, 7, "agentmesh-deployer", "deploys@agentmesh.ai",
                    # The one that matters: our own default compute account,
                    # which is what a VM's metadata server hands out and what a
                    # careless fix would paste in.
                    "123456789012-compute@developer.gserviceaccount.com",
                    "langbench-1528148150979@appspot.gserviceaccount.com"):
            why = cloud.deployer_refusal(bad)
            self.assertIsNotNone(why, bad)
            self.assertIn("MESH_CLOUD_DEPLOYER_SA", why)
            self.assertIn("Nothing was called", why)

    def test_a_real_deployer_account_passes(self):
        self.assertIsNone(cloud.deployer_refusal(OURS))
        # Held to the same rule as a customer's own account, which is the point:
        # if we would not accept this shape from them, we cannot offer it to
        # them either.
        self.assertIsNotNone(cloud.refusal({**GRANT, "impersonate": OURS}))
        self.assertEqual(cloud.project_of(OURS), "langbench-1528148150979")


class ARevocationIsNotAnOutage(unittest.TestCase):
    """Collapsing the two means retrying a revocation forever, which is how a
    vendor becomes a nuisance."""

    REVOCATIONS = (
        "ERROR: (gcloud.run.jobs.create) Failed to impersonate "
        "[agentmesh-deploy@acme-analytics-42.iam.gserviceaccount.com]. Make sure the account that's trying "
        "to impersonate it has access to the service account itself and the "
        '"roles/iam.serviceAccountTokenCreator" role.',
        "ERROR: gcloud crashed: Unable to acquire impersonated credentials",
        "PERMISSION_DENIED: Permission 'iam.serviceAccounts.getAccessToken' denied on resource "
        "(or it may not exist).",
        "Error creating a target credential: PERMISSION_DENIED",
    )
    OUTAGES = (
        "ERROR: (gcloud.run.jobs.create) INTERNAL_ERROR: Internal error encountered.",
        "ERROR: 503 Service Unavailable",
        "ERROR: (gcloud.builds.submit) 500 Internal error",
        "DEADLINE_EXCEEDED: Deadline Exceeded",
        "urllib3.exceptions.ProtocolError: Connection reset by peer",
        "ERROR: 429 Too Many Requests",
    )
    THEIR_PROJECT_SAID_NO = (
        "ERROR: (gcloud.run.jobs.create) PERMISSION_DENIED: The caller does not have permission",
        "ERROR: (gcloud.secrets.create) Permission denied on resource project acme-analytics-42.",
        "ERROR: Cloud Run Admin API has not been used in project acme-analytics-42 before or it is "
        "disabled.",
    )

    def test_the_binding_being_gone_reads_as_a_revocation(self):
        for said in self.REVOCATIONS:
            self.assertEqual(cloud.outcome_of(GRANT, 1, said), "revoked", said[:60])

    def test_the_account_itself_being_gone_reads_as_a_revocation(self):
        said = (f"ERROR: (gcloud.run.jobs.create) NOT_FOUND: Unknown service account "
                f"{GRANT['impersonate']}")
        self.assertEqual(cloud.outcome_of(GRANT, 1, said), "revoked")

    def test_a_not_found_about_something_else_is_not_a_revocation(self):
        # A job that was never created says nothing about whether the grant is
        # still there, and calling it a revocation would tell a customer they
        # had done something they had not.
        said = "ERROR: (gcloud.run.jobs.describe) Cannot find job [watcher-worker]: NOT_FOUND"
        self.assertEqual(cloud.outcome_of(GRANT, 1, said), "failed")

    def test_an_outage_reads_as_an_outage(self):
        for said in self.OUTAGES:
            self.assertEqual(cloud.outcome_of(GRANT, 1, said), "unreachable", said[:60])

    def test_a_timeout_is_an_outage_whatever_it_said(self):
        self.assertEqual(cloud.outcome_of(GRANT, 124, "timed out after 600s: gcloud run jobs create",
                                          timed_out=True), "unreachable")

    def test_their_project_refusing_us_a_role_is_neither(self):
        # The impersonation WORKED, so the grant is live; the call was refused
        # inside their project. Calling that a revocation would send a customer
        # to re-grant a binding that is already there.
        for said in self.THEIR_PROJECT_SAID_NO:
            self.assertEqual(cloud.outcome_of(GRANT, 1, said), "denied", said[:60])

    def test_a_call_that_worked_is_ok(self):
        self.assertEqual(cloud.outcome_of(GRANT, 0, ""), "ok")

    def test_only_an_outage_is_worth_sending_again(self):
        self.assertIs(cloud.retryable("unreachable"), True)
        for outcome in ("revoked", "denied", "failed", "ok"):
            self.assertIs(cloud.retryable(outcome), False, outcome)

    def test_the_grant_record_learns_only_what_was_observed(self):
        self.assertEqual(cloud.state_of("ok"), "verified")
        # A call the target API refused is a call that was MADE, which means a
        # token was minted, which means the grant is live.
        self.assertEqual(cloud.state_of("denied"), "verified")
        self.assertEqual(cloud.state_of("revoked"), "revoked")
        self.assertEqual(cloud.state_of("unreachable"), "unreachable")
        # And a failure that says nothing about the grant writes nothing over
        # the record somebody else keeps.
        self.assertIsNone(cloud.state_of("failed"))


class ARevocationIsToldCalmly(unittest.TestCase):
    """The customer did a supported thing. The right answer is to stop, say so
    plainly, and say what would restore it."""

    def test_a_revocation_names_the_role_and_says_nothing_was_retried(self):
        said = cloud.explain("revoked", GRANT)
        self.assertIn("roles/iam.serviceAccountTokenCreator", said)
        self.assertIn(GRANT["impersonate"], said)
        self.assertIn("nothing was retried", said)
        # Not an incident, not an error on their side, not a fault of ours.
        self.assertIn("the customer's to do", said)

    def test_an_outage_says_the_same_instruction_can_be_sent_again(self):
        said = cloud.explain("unreachable", GRANT)
        self.assertIn("outage", said)
        self.assertIn("sent again", said)
        self.assertNotIn("roles/iam.serviceAccountTokenCreator", said)

    def test_their_project_refusing_a_role_says_the_grant_is_in_place(self):
        said = cloud.explain("denied", GRANT)
        self.assertIn("the grant is in place", said)
        self.assertIn("customer's to change", said)


class TheActionLogCarriesNamesAndNeverValues(unittest.TestCase):
    """Their Cloud Audit Logs already show these calls. The point of ours is
    that it agrees with theirs and is offered rather than requested."""

    def test_the_command_is_the_command_and_not_its_arguments(self):
        self.assertEqual(cloud.command_of(
            ["run", "jobs", "create", "watcher-worker", "--image", "gcr.io/x/y@sha256:ab",
             "--env-vars-file=/tmp/dm-watcher-env.yaml"]), "run jobs create watcher-worker")
        self.assertEqual(cloud.command_of(
            ["storage", "cp", "/tmp/dm-watcher-binding/ceilings.json",
             "gs://example-agent-state/bindings/watcher/ceilings.json", "--quiet"]), "storage cp")
        self.assertEqual(cloud.command_of(
            ["builds", "submit", "/tmp/dm-watcher-ctx", "--tag", "gcr.io/x/y:1"]), "builds submit")
        self.assertEqual(cloud.command_of(
            ["secrets", "versions", "add", "fleet-gemini-api-key", "--data-file=-"]),
            "secrets versions add fleet-gemini-api-key")

    def test_one_line_says_what_when_where_under_whom_and_how_it_went(self):
        row = cloud.action(GRANT, ["run", "jobs", "create", "watcher-worker"], "ok",
                           "2026-09-12T10:00:00Z", 1.2345, act="deploy", agent="watcher")
        self.assertEqual(row["project"], THEIRS)
        self.assertEqual(row["service_account"], GRANT["impersonate"])
        self.assertEqual(row["command"], "run jobs create watcher-worker")
        self.assertEqual(row["at"], "2026-09-12T10:00:00Z")
        self.assertEqual(row["outcome"], "ok")
        self.assertEqual(row["seconds"], 1.234)
        self.assertEqual(row["act"], "deploy")
        self.assertEqual(row["agent"], "watcher")

    def test_a_call_that_worked_carries_no_error_line(self):
        row = cloud.action(GRANT, ["run", "jobs", "create"], "ok", "2026-09-12T10:00:00Z", 1,
                           error="some noise on stderr")
        self.assertNotIn("error", row)

    def test_a_failure_carries_the_words_the_customer_will_find_at_their_end(self):
        row = cloud.action(GRANT, ["run", "jobs", "create"], "revoked", "2026-09-12T10:00:00Z", 1,
                           error="  Failed to impersonate [x]  ")
        self.assertEqual(row["error"], "Failed to impersonate [x]")


if __name__ == "__main__":
    unittest.main()
