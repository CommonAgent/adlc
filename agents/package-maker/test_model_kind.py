#!/usr/bin/env python3
"""The model system (Common Agent 0.39.0, 12.4.1) as the builder writes it.

What is worth pinning: a system of kind model with protocols from the closed
list builds, from a spec and from an agent folder, and the runtime requirements carry its kind and protocols and no
credential, variable or setting; a second model system, a protocol outside the
list, a model system naming a credential, and protocols on another kind are
each refused.

Run: AGENTMESH_ENV=example python3 -m unittest test_model_kind
"""
import json
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from test_standing import Harness, announcement_spec  # noqa: E402

MODEL = {"name": "text-reasoning", "access": "read", "needs": "writes the announcement",
         "kind": "model", "protocols": ["anthropic-messages", "openai-chat"]}


def with_systems(*systems, name="announcement-writer"):
    s = announcement_spec(name=name, kind="application/vnd.agentmesh.points+json")
    s["systems"] = [dict(x) for x in systems]
    s.pop("ceilings", None)
    return s


class TheModelSystem(Harness):
    def test_a_model_system_builds_with_its_protocols_and_nothing_else(self):
        res, _ = self.build(with_systems(MODEL))
        self.assertTrue(res["ok"], res)
        with open(os.path.join(self.tmp, "out", "announcement-writer", "agent-runtime-requirements.json"), encoding="utf-8") as f:
            doc = json.load(f)
        self.assertEqual(doc["systems"], [{"name": "text-reasoning", "kind": "model",
                                           "protocols": ["anthropic-messages", "openai-chat"]}])

    def test_an_agent_folder_with_a_model_system_builds_with_its_protocols(self):
        # An agent kept as its own files (Common Agent 13.2), as every agent in
        # a repository is: convert.py writes them from the spec, and building
        # the folder reads the protocols from its runtime requirements.
        import subprocess
        path = os.path.join(self.src, "spec.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(with_systems(MODEL), f, indent=2)
        e = {**os.environ, "AGENTMESH_ENV": "example"}
        run = lambda *a: json.loads(subprocess.run([sys.executable, *a], capture_output=True, text=True,
                                                   encoding="utf-8", env=e).stdout.strip().splitlines()[-1])
        converted = run(os.path.join(HERE, "convert.py"), path, self.src)
        self.assertTrue(converted.get("ok", True), converted)
        os.remove(path)
        built = run(os.path.join(HERE, "build.py"), self.src, os.path.join(self.tmp, "folder"))
        self.assertTrue(built["ok"], built)
        with open(os.path.join(self.tmp, "folder", "announcement-writer", "agent-runtime-requirements.json"), encoding="utf-8") as f:
            doc = json.load(f)
        self.assertEqual(doc["systems"], [{"name": "text-reasoning", "kind": "model",
                                           "protocols": ["anthropic-messages", "openai-chat"]}])

    def test_two_model_systems_are_refused(self):
        res, _ = self.build(with_systems(MODEL, {**MODEL, "name": "second-model"}), out="two")
        self.assertFalse(res["ok"], res)
        self.assertIn("at most one system of kind model", res["error"])

    def test_a_protocol_outside_the_list_is_refused(self):
        res, _ = self.build(with_systems({**MODEL, "protocols": ["bedrock"]}), out="bad-protocol")
        self.assertFalse(res["ok"], res)
        self.assertIn("protocols", res["error"])

    def test_a_model_system_naming_a_credential_is_refused(self):
        res, _ = self.build(with_systems({**MODEL, "credential": "model-key", "env": "MODEL_KEY"}), out="cred")
        self.assertFalse(res["ok"], res)
        self.assertIn("a model system takes no credential", res["error"])

    def test_protocols_on_another_kind_are_refused(self):
        res, _ = self.build(with_systems({"name": "the-ledger", "access": "read", "needs": "x", "kind": "service",
                                          "protocols": ["gemini"]}), out="svc")
        self.assertFalse(res["ok"], res)
        self.assertIn("only a system of kind model names protocols", res["error"])


if __name__ == "__main__":
    unittest.main()
