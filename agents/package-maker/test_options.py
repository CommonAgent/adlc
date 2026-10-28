#!/usr/bin/env python3
"""The option rules (the audit checklist's options-are-settings and
settings-declared-fully).

What is worth pinning: an offered job's input that only shapes how the job
runs (a voice, a tone, a length) or that is brand or palette material refuses
a new agent and warns for an existing one; a run-config setting without its
label, about, choices, value labels or range does the same; a setting that
says all of them builds, and the descriptor carries them; and the result
carries option_rules.

Run: AGENTMESH_ENV=example python3 -m unittest test_options
"""
import json
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from test_standing import Harness, announcement_spec  # noqa: E402

FULL = {"name": "tone", "kind": "preference", "label": "Tone", "about": "How the announcement sounds.",
        "default": "warm", "allowed": ["warm", "plain"], "value_labels": {"warm": "Warm", "plain": "Plain"},
        "job_may_set": True}
PACE = {"name": "pace", "kind": "preference", "label": "Pace", "about": "Words a second.", "default": 2.5,
        "min": 1.5, "max": 3.5, "step": 0.5, "job_may_set": True}


def with_inputs(*inputs, settings=None, name="announcement-writer"):
    s = announcement_spec(name=name, kind="application/vnd.agentmesh.points+json")
    s["jobs"][0]["inputs"] = [{"name": "note", "kind": "text", "required": True}, *inputs]
    if settings is not None:
        s["run_config"] = {"settings": settings}
    return s


class OptionsAreSettings(Harness):
    def test_a_new_agent_with_a_voice_and_a_length_as_inputs_is_refused(self):
        res, _ = self.build(with_inputs({"name": "voice", "kind": "identifier"}, {"name": "target length", "kind": "text"}))
        self.assertFalse(res["ok"], res)
        self.assertIn("refused on its inputs and settings", res["error"])
        self.assertIn("options-are-settings: job read-a-note: input 'voice' only shapes how the job runs", res["error"])
        self.assertIn("input 'target length'", res["error"])

    def test_palette_as_an_input_is_library_material(self):
        res, _ = self.build(with_inputs({"name": "palette", "kind": "identifier"}))
        self.assertFalse(res["ok"], res)
        self.assertIn("input 'palette' is brand or library material; declare it as a can_use standing asset", res["error"])

    def test_an_existing_agent_is_warned_and_built(self):
        res, err = self.build(with_inputs({"name": "how it sounds", "kind": "text"}), env={"FORMAT_EXISTING": "1"})
        self.assertTrue(res["ok"], res)
        rules = res["option_rules"]
        self.assertEqual((rules["mode"], rules["existing"], rules["since"]), ("warn", True, "2026-10-28"))
        self.assertEqual(len(rules["findings"]), 1)
        self.assertIn("options:", err)

    def test_the_material_the_job_is_about_is_not_an_option(self):
        res, _ = self.build(with_inputs({"name": "product brief", "kind": "text/markdown"}))
        self.assertTrue(res["ok"], res)
        self.assertEqual(res["option_rules"]["findings"], [])


class SettingsDeclaredFully(Harness):
    def test_settings_that_say_everything_build_and_the_descriptor_carries_it(self):
        res, _ = self.build(with_inputs(settings=[FULL, PACE]))
        self.assertTrue(res["ok"], res)
        self.assertEqual(res["option_rules"]["findings"], [])
        with open(os.path.join(res["path"], "agent-descriptor.json"), encoding="utf-8") as f:
            settings = json.load(f)["run_config"]["settings"]
        self.assertEqual(settings[0]["value_labels"], FULL["value_labels"])
        self.assertEqual((settings[1]["min"], settings[1]["max"], settings[1]["step"]), (1.5, 3.5, 0.5))
        self.assertEqual(settings[0]["label"], "Tone")

    def test_a_new_agent_whose_setting_leaves_its_choices_open_is_refused(self):
        bare = {"name": "tone", "kind": "preference", "default": "warm", "job_may_set": True}
        res, _ = self.build(with_inputs(settings=[bare]))
        self.assertFalse(res["ok"], res)
        self.assertIn("settings-declared-fully: run_config setting 'tone' does not declare label, about, allowed", res["error"])

    def test_unlabelled_values_and_a_number_without_its_range_are_findings(self):
        half = dict(FULL, value_labels={"warm": "Warm"})
        number = {k: v for k, v in PACE.items() if k not in ("min", "max", "step")}
        res, _ = self.build(with_inputs(settings=[half, number]), env={"FORMAT_EXISTING": "1"})
        found = " ".join(res["option_rules"]["findings"])
        self.assertIn("value_labels for 'plain'", found)
        self.assertIn("min, max, step", found)

    def test_a_value_label_for_a_value_that_is_not_allowed_is_refused(self):
        res, _ = self.build(with_inputs(settings=[dict(FULL, value_labels={"warm": "Warm", "plain": "Plain", "loud": "Loud"})]))
        self.assertFalse(res["ok"], res)
        self.assertIn("value_labels names 'loud', which is not an allowed value", res["error"])

    def test_a_default_outside_its_range_is_refused(self):
        res, _ = self.build(with_inputs(settings=[dict(PACE, default=5)]))
        self.assertFalse(res["ok"], res)
        self.assertIn("outside its own range", res["error"])


if __name__ == "__main__":
    unittest.main()
