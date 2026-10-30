#!/usr/bin/env python3
"""The model system (Common Agent 0.39.0, 12.4.1): what the installer binds.

What is worth pinning: a package's one system of kind model reads with its
protocols and no credential, variable or setting; the instruction must give
MODEL_NAME, MODEL_ENDPOINT and MODEL_PROTOCOL, and a protocol outside the
closed list or outside the entry's own protocols is refused before anything
is changed; MODEL_KEY is a credential the instruction names, never a setting,
and is placed empty when none is named; the binding places the four settings
under their fixed names with TEXT_MODEL beside MODEL_NAME for this version;
the host's environment file fills what the instruction leaves out, key by key,
without replacing what it gives; and a worker job whose endpoint is on
loopback is given its own gateway's settings.

Run: python3 -m unittest discover -p "test_*.py"
"""
import json
import os
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import install  # noqa: E402

TMP = tempfile.mkdtemp(prefix="dm-model-test-")
os.environ.setdefault("DM_FLEET", TMP)
os.environ.setdefault("DM_HOME", TMP)
import steps  # noqa: E402

MODEL = {"name": "text-reasoning", "kind": "model", "access": "read", "credential": None, "env": None,
         "settings": [], "spends": None, "protocols": ["anthropic-messages"]}
PKG = {"systems": [MODEL], "install": {"ceilings": []}}
GOOD = {"MODEL_NAME": "claude-sonnet-5-5", "MODEL_ENDPOINT": "http://127.0.0.1:8788",
        "MODEL_PROTOCOL": "anthropic-messages"}


def with_env_file(doc):
    """Point the environment reader at a file holding `doc` for one test."""
    path = os.path.join(TMP, f"env-{len(os.listdir(TMP))}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"name": "t", **doc}, f)
    return path


class TheInstruction(unittest.TestCase):
    def test_a_complete_instruction_passes(self):
        self.assertEqual(install.check_instruction({"settings": {"text-reasoning": dict(GOOD)}}, PKG), [])

    def test_each_missing_setting_is_named(self):
        r = install.check_instruction({}, PKG)
        for k in ("MODEL_NAME", "MODEL_ENDPOINT", "MODEL_PROTOCOL"):
            self.assertTrue(any(k in x for x in r), (k, r))

    def test_a_protocol_outside_the_list_or_the_entry_is_refused(self):
        r = install.check_instruction({"settings": {"text-reasoning": {**GOOD, "MODEL_PROTOCOL": "bedrock"}}}, PKG)
        self.assertTrue(any("not one of" in x for x in r), r)
        r = install.check_instruction({"settings": {"text-reasoning": {**GOOD, "MODEL_PROTOCOL": "gemini"}}}, PKG)
        self.assertTrue(any("not one this package's model system speaks" in x for x in r), r)

    def test_a_key_given_as_a_setting_is_refused(self):
        r = install.check_instruction({"settings": {"text-reasoning": {**GOOD, "MODEL_KEY": "x"}}}, PKG)
        self.assertTrue(any("MODEL_KEY is a credential" in x for x in r), r)

    def test_an_endpoint_with_a_credential_in_it_is_refused(self):
        r = install.check_instruction({"settings": {"text-reasoning": {**GOOD, "MODEL_ENDPOINT": "https://u:p@example.com"}}}, PKG)
        self.assertTrue(any("MODEL_ENDPOINT" in x for x in r), r)

    def test_a_credential_name_must_be_in_the_store(self):
        args = {"settings": {"text-reasoning": dict(GOOD)}, "credentials": {"text-reasoning": "model-key"}}
        self.assertEqual(install.check_instruction(args, PKG, store_has=lambda n: True), [])
        r = install.check_instruction(args, PKG, store_has=lambda n: False)
        self.assertTrue(any("no credential named model-key" in x for x in r), r)


class TheBinding(unittest.TestCase):
    def test_the_four_settings_and_the_former_name_are_placed(self):
        [b] = install.plan_bindings({"settings": {"text-reasoning": dict(GOOD)}}, PKG, "/home/a")
        self.assertEqual(b["settings"], {**GOOD, "TEXT_MODEL": "claude-sonnet-5-5", "MODEL_KEY": ""})
        self.assertNotIn("credential", b)
        text = install.env_file([b], {})
        self.assertIn("export MODEL_ENDPOINT='http://127.0.0.1:8788'", text)
        self.assertIn("export MODEL_KEY=''", text)

    def test_a_named_key_is_placed_as_MODEL_KEY(self):
        args = {"settings": {"text-reasoning": dict(GOOD)}, "credentials": {"text-reasoning": "model-key"}}
        [b] = install.plan_bindings(args, PKG, "/home/a")
        self.assertEqual((b["credential"], b["env"]), ("model-key", "MODEL_KEY"))
        self.assertNotIn("MODEL_KEY", b["settings"])
        self.assertIn("export MODEL_KEY='sk-held'", install.env_file([b], {"model-key": "sk-held"}))
        self.assertEqual(install.placed_names([b])["credentials"], ["model-key"])


class TheHostFillsTheGaps(unittest.TestCase):
    def setUp(self):
        self.was = os.environ.get("AGENTMESH_ENV_FILE")
        os.environ["AGENTMESH_ENV_FILE"] = with_env_file({
            "vertex": {"project": "p-vertex"},
            "model": {"name": "claude-sonnet-5-5", "endpoint": "http://127.0.0.1:8788", "key": "",
                      "protocol": "anthropic-messages", "gateway": {"vertex_project": "p-gw", "vertex_region": "global"}}})

    def tearDown(self):
        if self.was is None:
            os.environ.pop("AGENTMESH_ENV_FILE", None)
        else:
            os.environ["AGENTMESH_ENV_FILE"] = self.was

    def test_what_the_instruction_leaves_out_comes_from_the_host(self):
        args = steps.with_model_defaults({}, PKG)
        self.assertEqual(args["settings"]["text-reasoning"], GOOD)
        self.assertNotIn("credentials", args)
        self.assertEqual(install.check_instruction(args, PKG), [])

    def test_what_the_instruction_gives_is_kept(self):
        args = steps.with_model_defaults({"settings": {"text-reasoning": {"MODEL_NAME": "claude-haiku-5-5"}}}, PKG)
        self.assertEqual(args["settings"]["text-reasoning"]["MODEL_NAME"], "claude-haiku-5-5")
        self.assertEqual(args["settings"]["text-reasoning"]["MODEL_ENDPOINT"], "http://127.0.0.1:8788")

    def test_a_package_with_no_model_system_is_untouched(self):
        self.assertEqual(steps.with_model_defaults({}, {"systems": []}), {})

    def test_a_loopback_endpoint_gives_the_job_its_own_gateway(self):
        args = steps.with_model_defaults({}, PKG)
        self.assertEqual(steps.model_gateway_env(args, PKG),
                         {"BRIDGE_VERTEX_PROJECT": "p-gw", "BRIDGE_VERTEX_REGION": "global", "BRIDGE_PORT": "8788"})
        far = {"settings": {"text-reasoning": {**GOOD, "MODEL_ENDPOINT": "https://models.example.com/v1"}}}
        self.assertEqual(steps.model_gateway_env(far, PKG), {})

    def test_an_agent_picks_gemini_through_its_instruction_and_still_reaches_the_gateway_with_no_key(self):
        pkg = {"systems": [{**MODEL, "protocols": ["anthropic-messages", "gemini"]}], "install": {"ceilings": []}}
        args = steps.with_model_defaults({"settings": {"text-reasoning": {"MODEL_PROTOCOL": "gemini", "MODEL_NAME": "gemini-3.8-flash"}}}, pkg)
        self.assertEqual(install.check_instruction(args, pkg), [])
        [b] = install.plan_bindings(args, pkg, "/home/a")
        self.assertEqual(b["settings"], {"MODEL_NAME": "gemini-3.8-flash", "MODEL_ENDPOINT": "http://127.0.0.1:8788",
                                         "MODEL_PROTOCOL": "gemini", "TEXT_MODEL": "gemini-3.8-flash", "MODEL_KEY": ""})
        self.assertEqual(steps.model_gateway_env(args, pkg)["BRIDGE_PORT"], "8788")
        # A package whose model system does not speak gemini is refused it.
        args = steps.with_model_defaults({"settings": {"text-reasoning": {"MODEL_PROTOCOL": "gemini"}}}, PKG)
        self.assertTrue(any("not one this package's model system speaks" in r for r in install.check_instruction(args, PKG)))


class TheSpeechPassthrough(unittest.TestCase):
    SPEECH = {"name": "speech-to-text", "kind": "service", "access": "read", "credential": None, "env": None, "spends": None,
              "settings": [{"env": "STT_ENDPOINT"}, {"env": "STT_PROJECT"}, {"env": "STT_MODEL"}]}

    def setUp(self):
        self.was = os.environ.get("AGENTMESH_ENV_FILE")
        os.environ["AGENTMESH_ENV_FILE"] = with_env_file({
            "vertex": {"project": "p-vertex"},
            "model": {"name": "claude-sonnet-5-5", "endpoint": "http://127.0.0.1:8788", "key": "", "protocol": "anthropic-messages",
                      "gateway": {"vertex_project": "p-gw", "vertex_region": "global", "gemini_region": "global", "speech_project": "p-gw",
                                  "settings": {"STT_ENDPOINT": "http://127.0.0.1:8788", "STT_PROJECT": "p-gw"}}}})

    def tearDown(self):
        if self.was is None:
            os.environ.pop("AGENTMESH_ENV_FILE", None)
        else:
            os.environ["AGENTMESH_ENV_FILE"] = self.was

    def test_a_speech_service_is_pointed_at_the_gateway_and_the_job_gets_its_gateway(self):
        pkg = {"systems": [self.SPEECH], "install": {"ceilings": []}}
        args = steps.with_model_defaults({"settings": {"speech-to-text": {"STT_MODEL": "chirp_3"}}}, pkg)
        self.assertEqual(args["settings"]["speech-to-text"], {"STT_MODEL": "chirp_3", "STT_ENDPOINT": "http://127.0.0.1:8788", "STT_PROJECT": "p-gw"})
        self.assertEqual(install.check_instruction(args, pkg), [])
        self.assertEqual(steps.model_gateway_env(args, pkg), {"BRIDGE_VERTEX_PROJECT": "p-gw", "BRIDGE_VERTEX_REGION": "global", "BRIDGE_PORT": "8788",
                                                              "BRIDGE_GEMINI_REGION": "global", "BRIDGE_SPEECH_PROJECT": "p-gw"})

    def test_an_address_setting_comes_from_the_environments_setting_bindings_and_one_with_none_is_refused(self):
        os.environ["AGENTMESH_ENV_FILE"] = with_env_file({"vertex": {"project": "p"}, "setting_bindings": {
            "about": "words", "TTS_ENDPOINT": "https://generativelanguage.googleapis.com/v1beta"}})
        tts = {"name": "text-to-speech", "kind": "service", "access": "read", "credential": "tts-key", "env": "TTS_KEY", "spends": None,
               "settings": [{"env": "TTS_ENDPOINT"}, {"env": "TTS_MODEL"}]}
        pkg = {"systems": [tts], "install": {"ceilings": []}}
        args = steps.with_model_defaults({"settings": {"text-to-speech": {"TTS_MODEL": "m"}}}, pkg)
        self.assertEqual(args["settings"]["text-to-speech"]["TTS_ENDPOINT"], "https://generativelanguage.googleapis.com/v1beta")
        self.assertEqual(install.check_instruction(args, pkg), [])
        speech = {**tts, "name": "speech", "settings": [{"env": "SPEECH_ENDPOINT"}]}
        bare = {"systems": [speech], "install": {"ceilings": []}}
        refused = install.check_instruction(steps.with_model_defaults({}, bare), bare)
        self.assertTrue(any("must supply SPEECH_ENDPOINT" in r for r in refused), refused)

    def test_what_the_instruction_gives_wins_and_a_service_that_declares_neither_is_untouched(self):
        pkg = {"systems": [self.SPEECH], "install": {"ceilings": []}}
        args = steps.with_model_defaults({"settings": {"speech-to-text": {"STT_ENDPOINT": "https://speech.example.com", "STT_MODEL": "x"}}}, pkg)
        self.assertEqual(args["settings"]["speech-to-text"]["STT_ENDPOINT"], "https://speech.example.com")
        self.assertEqual(steps.model_gateway_env(args, pkg), {})
        other = {"systems": [{**self.SPEECH, "settings": [{"env": "TTS_VOICE"}]}], "install": {"ceilings": []}}
        self.assertEqual(steps.with_model_defaults({}, other), {"settings": {}})


if __name__ == "__main__":
    unittest.main()
