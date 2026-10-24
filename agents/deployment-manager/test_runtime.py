#!/usr/bin/env python3
"""The runtime record: where an agent's WORK runs, said so an owner can read it.

What is worth pinning: the record separates the machine that holds the inbox
from the machine that does the work, and never lets one stand in for the other;
a container record carries the job, the region, the image digest and the cap on
one message; a host record carries none of those, because its producer observed
no image and created no job; a record cannot be built without an agent key,
since there is nothing to file it under; the signed bytes are the same tag-
newline-canonical convention every other record here uses; and a failed post
comes back as words rather than as an exception, because a deploy that finished
must never be reported as a refusal.

Run: python3 -m unittest discover -s fleet-manager/deploymgr -p "test_*.py"
"""
import json
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import runtime  # noqa: E402

AGENT = {"key": "U" + "A" * 55, "handle": "watcher.jeff@agentmesh.ai", "name": "watcher"}

CONTAINER_ENTRY = {
    "name": "watcher", "package": "explainer-maker", "version": "0.4.1",
    "sha256": "a" * 64, "url": "https://example.invalid/p.tar.gz",
    "runs_on": "cloud-run", "job": "agent-watcher", "region": "us-central1",
    "project": "langbench-1528148150979", "bucket": "mesh-agent-work",
    "mount": "/mnt/mesh", "binding": "gs://mesh-agent-work/binding/watcher",
    "directories": {"records": "gs://mesh-agent-work/agents/watcher/records"},
    "image": "us-central1-docker.pkg.dev/p/agents/watcher:0.4.1",
    "image_digest": "sha256:" + "b" * 64, "interaction": "service",
    "job_seconds": 600, "harness": "opencode", "model": "google/gemini-2.5-flash",
    "deployed_at": "2026-09-11T09:00:00Z", "state": "running",
}

HOST_ENTRY = {
    "name": "scout", "package": "process-runner", "version": "1.2.0",
    "sha256": "c" * 64, "harness": "opencode", "interaction": "service",
    "job_seconds": 900, "deployed_at": "2026-09-11T09:00:00Z", "state": "running",
}


def built(entry, kind=None, agent=AGENT):
    return runtime.build(entry, agent=agent, adapter_host="fleet-host",
                         produced_at="2026-09-11T10:00:00Z", by="UDM", kind=kind)


class TheTwoSides(unittest.TestCase):
    def test_the_adapter_host_is_stated_on_both_kinds(self):
        # The whole reason the record exists: a reader must be able to tell the
        # machine holding the inbox from the machine doing the work, on every
        # record, including the one where they are the same machine.
        for entry in (CONTAINER_ENTRY, HOST_ENTRY):
            self.assertEqual(built(entry)["adapter"], {"host": "fleet-host"})

    def test_a_container_record_says_container_and_names_the_job(self):
        w = built(CONTAINER_ENTRY)["work"]
        self.assertEqual(w["runs"], "container")
        self.assertEqual(w["platform"], "cloud-run")
        self.assertEqual(w["job"], "agent-watcher")
        self.assertEqual(w["region"], "us-central1")
        self.assertEqual(w["image_digest"], "sha256:" + "b" * 64)
        self.assertEqual(w["storage"]["bucket"], "mesh-agent-work")
        self.assertEqual(w["storage"]["mount"], "/mnt/mesh")
        self.assertIn("records", w["storage"]["directories"])
        # And it does NOT claim the work happens on the adapter's machine.
        self.assertNotIn("host", w)

    def test_a_host_record_says_host_and_observes_no_image(self):
        w = built(HOST_ENTRY)["work"]
        self.assertEqual(w["runs"], "host")
        self.assertEqual(w["host"], "fleet-host")
        # An absent member is a statement (8.3): this producer started no image
        # and created no job, so it names neither rather than emitting nulls a
        # reader would take for observations.
        for absent in ("image", "image_digest", "job", "region", "project", "platform", "storage"):
            self.assertNotIn(absent, w)

    def test_the_kind_is_read_off_the_row_when_it_is_not_forced(self):
        self.assertEqual(built(CONTAINER_ENTRY, kind=None)["work"]["runs"], "container")
        self.assertEqual(built(HOST_ENTRY, kind=None)["work"]["runs"], "host")


class WhatTheRecordCarries(unittest.TestCase):
    def test_the_job_cap_travels(self):
        self.assertEqual(built(CONTAINER_ENTRY)["job_seconds"], 600)
        self.assertEqual(built(HOST_ENTRY)["job_seconds"], 900)

    def test_a_row_with_no_cap_states_none(self):
        self.assertNotIn("job_seconds", built({**HOST_ENTRY, "job_seconds": None}))
        # A zero or a boolean is not a cap, and neither is a string.
        for bad in (0, True, "600"):
            self.assertNotIn("job_seconds", built({**HOST_ENTRY, "job_seconds": bad}))

    def test_the_package_and_the_harness_travel(self):
        doc = built(CONTAINER_ENTRY)
        self.assertEqual(doc["package"], {"name": "explainer-maker", "version": "0.4.1",
                                          "sha256": "a" * 64})
        self.assertEqual(doc["harness"], "opencode")
        self.assertEqual(doc["model"], "google/gemini-2.5-flash")

    def test_a_package_that_wakes_no_model_names_no_harness(self):
        # A container that runs the command the package declared starts no
        # harness, so the record names none rather than claiming one ran.
        doc = built({k: v for k, v in CONTAINER_ENTRY.items() if k not in ("harness", "model")})
        self.assertNotIn("harness", doc)
        self.assertNotIn("model", doc)

    def test_the_model_the_job_was_read_to_carry_is_the_one_named(self):
        # Technical debt 456: a script package's job reads its model from its
        # own variable, and a job keeps a model set on it by hand; the record
        # names what the job carries, not what an instruction asked for.
        script = {k: v for k, v in CONTAINER_ENTRY.items() if k not in ("harness", "model")}
        doc = built({**script, "model_placed": {"model": "google/gemini-3.8-flash", "variable": "AGENT_MODEL"}})
        self.assertEqual(doc["model"], "google/gemini-3.8-flash")
        self.assertNotIn("harness", doc)
        doc = built({**CONTAINER_ENTRY, "model_placed": {"model": "google/gemini-3.8-flash", "variable": "AGENT_MODEL"}})
        self.assertEqual(doc["model"], "google/gemini-3.8-flash")
        self.assertNotIn("model", built({**script, "model_placed": None}))

    def test_the_state_travels_so_a_dead_job_is_not_read_as_a_place(self):
        self.assertEqual(built({**CONTAINER_ENTRY, "state": "removed"})["state"], "removed")

    def test_the_agent_is_named_by_key_handle_and_install_name(self):
        self.assertEqual(built(CONTAINER_ENTRY)["agent"],
                         {"key": AGENT["key"], "handle": AGENT["handle"], "name": "watcher"})

    def test_without_a_key_there_is_nothing_to_file_it_under(self):
        with self.assertRaises(ValueError):
            built(CONTAINER_ENTRY, agent={"handle": "watcher.jeff@agentmesh.ai"})
        with self.assertRaises(ValueError):
            built(CONTAINER_ENTRY, agent=None)


class WhichInventoryIsTheAuthority(unittest.TestCase):
    def test_a_running_container_wins_over_the_host_row(self):
        # The host install of the same name is still the agent: it holds the
        # key and the inbox. The work is in the job, and reading the host row
        # would put the wrong machine on the page for exactly the agents this
        # record exists for.
        kind, entry = runtime.which_entry("watcher", [CONTAINER_ENTRY],
                                          [{"name": "watcher", "agent_key": AGENT["key"]}])
        self.assertEqual(kind, "container")
        self.assertEqual(entry["job"], "agent-watcher")

    def test_a_torn_down_container_loses_to_the_host_row(self):
        # A removed or failed container deploy stays in the file with its own
        # state. Treating one as the place the work happens would send somebody
        # to a job that no longer exists; where a host install remains, the work
        # is back on this machine.
        for state in ("removed", "failed at job"):
            kind, entry = runtime.which_entry("watcher", [{**CONTAINER_ENTRY, "state": state}],
                                              [HOST_ENTRY | {"name": "watcher"}])
            self.assertEqual(kind, "host")
            self.assertEqual(entry["name"], "watcher")

    def test_a_container_with_no_state_counts_as_running(self):
        # The member was added after the first entries were written, and the
        # roster reads an absent state the same way.
        entry = {k: v for k, v in CONTAINER_ENTRY.items() if k != "state"}
        self.assertEqual(runtime.which_entry("watcher", [entry], [])[0], "container")

    def test_a_name_in_neither_inventory_has_no_answer(self):
        self.assertEqual(runtime.which_entry("nobody", [CONTAINER_ENTRY], [HOST_ENTRY]), (None, None))
        self.assertEqual(runtime.which_entry("watcher", None, None), (None, None))


class TheSignature(unittest.TestCase):
    def test_the_signed_bytes_are_the_tag_then_the_canonical_document(self):
        doc = built(CONTAINER_ENTRY)
        msg = runtime.message(doc)
        tag, _, body = msg.partition("\n")
        self.assertEqual(tag, "agent-runtime-record-v1")
        # Signatures are not in the signed bytes, and the body is canonical.
        parsed = json.loads(body)
        self.assertNotIn("signatures", parsed)
        self.assertEqual(body, runtime.canonical(parsed))

    def test_an_unsigned_record_says_so_rather_than_being_withheld(self):
        doc = runtime.signed(built(CONTAINER_ENTRY), None, "UDM")
        self.assertEqual(doc["signatures"], [])
        self.assertIn("unsigned", doc["_unsigned"])
        # The facts are still all there: a faithful unsigned record beats none.
        self.assertEqual(doc["work"]["job"], "agent-watcher")

    def test_a_signed_record_attributes_to_the_deployment_manager(self):
        doc = runtime.signed(built(CONTAINER_ENTRY), "SIGBYTES", "UDM")
        self.assertEqual(doc["signatures"],
                         [{"tag": "agent-runtime-record-v1", "by": "UDM", "sig": "SIGBYTES",
                           "alg": "ed25519"}])
        self.assertNotIn("_unsigned", doc)


class Posting(unittest.TestCase):
    def test_no_bearer_posts_nothing_and_says_why(self):
        ok, why = runtime.publish(built(CONTAINER_ENTRY), "https://example.invalid/v1", "")
        self.assertFalse(ok)
        self.assertIn("bearer", why)

    def test_a_control_plane_that_is_not_there_comes_back_as_words(self):
        # Never an exception: the caller is a deploy procedure, and a finished
        # install must not be reported as a refusal because a page is stale.
        ok, why = runtime.publish(built(CONTAINER_ENTRY),
                                  "http://127.0.0.1:9/v1", "t", timeout=1)
        self.assertFalse(ok)
        self.assertTrue(why)

    def test_a_retraction_names_only_the_agent(self):
        sent = {}

        def fake(body, control, bearer, timeout=20):
            sent.update(body)
            return True, ""

        real, runtime.post = runtime.post, fake
        try:
            self.assertEqual(runtime.retract(AGENT["key"], "c", "t"), (True, ""))
        finally:
            runtime.post = real
        self.assertEqual(sent, {"agent": AGENT["key"], "retracted": True})

    def test_a_removal_says_the_install_is_gone(self):
        sent = {}

        def fake(body, control, bearer, timeout=20):
            sent.update(body)
            return True, ""

        real, runtime.post = runtime.post, fake
        try:
            runtime.retract(AGENT["key"], "c", "t", removed=True)
        finally:
            runtime.post = real
        self.assertEqual(sent, {"agent": AGENT["key"], "retracted": True, "removed": True})


if __name__ == "__main__":
    unittest.main()
