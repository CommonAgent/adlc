#!/usr/bin/env python3
"""The members a person reads (Common Agent 6.13, proposed): name, summary
and will_not on the Descriptor, started_by and works_as on an offering, and
presentation and accepts on an input or output.

What is worth pinning: a spec and an agent folder that state them build, and
the Descriptor carries them exactly as authored; a folder that states them is
not refused as saying something the build would not write; and a value
outside its list, a summary that is not one sentence, or `accepts` on
anything but a document input is refused.

Run: AGENTMESH_ENV=example python3 -m unittest test_person
"""
import json
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from test_standing import Harness, announcement_spec  # noqa: E402
from test_folder import Harness as FolderHarness  # noqa: E402


def person_spec(**extra):
    s = announcement_spec(kind="application/vnd.agentmesh.points+json")
    s["display_name"] = "Announcement writer"
    s["summary"] = "Writes a short announcement from a note you give it."
    s["will_not"] = ["It will not announce anything you did not write in the note."]
    job = s["jobs"][0]
    job["started_by"] = ["person", "agent"]
    job["works_as"] = "job"
    job["inputs"] = [{"name": "note", "kind": "text", "required": True, "given_by": "person"},
                     {"name": "reading", "kind": "document", "required": False, "given_by": "either",
                      "accepts": ["text/markdown", "application/pdf"], "presentation": "document"}]
    for k, v in extra.items():
        s[k] = v
    return s


def descriptor(res):
    with open(os.path.join(res["path"], "agent-descriptor.json"), encoding="utf-8") as f:
        return json.load(f)


class ThePersonMembers(Harness):
    def test_a_spec_that_states_them_builds_and_the_descriptor_carries_them(self):
        res, _ = self.build(person_spec())
        self.assertTrue(res["ok"], res)
        d = descriptor(res)
        self.assertEqual(d["name"], "Announcement writer")
        self.assertEqual(d["summary"], "Writes a short announcement from a note you give it.")
        self.assertEqual(d["will_not"], ["It will not announce anything you did not write in the note."])
        o = d["offerings"][0]
        self.assertEqual((o["started_by"], o["works_as"]), (["person", "agent"], "job"))
        self.assertEqual(o["inputs"][1]["accepts"], ["text/markdown", "application/pdf"])
        self.assertEqual(o["inputs"][1]["presentation"], "document")

    def test_without_them_nothing_is_written(self):
        res, _ = self.build(announcement_spec(kind="application/vnd.agentmesh.points+json"))
        self.assertTrue(res["ok"], res)
        d = descriptor(res)
        for k in ("name", "summary", "will_not"):
            self.assertNotIn(k, d)
        self.assertNotIn("started_by", d["offerings"][0])

    def test_a_summary_of_more_than_one_line_or_200_characters_is_refused(self):
        res, _ = self.build(person_spec(summary="x" * 201))
        self.assertFalse(res["ok"], res)
        self.assertIn("summary is one plain sentence", res["error"])

    def test_will_not_is_a_list_of_sentences(self):
        res, _ = self.build(person_spec(will_not="It will not."))
        self.assertFalse(res["ok"], res)
        self.assertIn("will_not is a non-empty list", res["error"])

    def test_started_by_and_works_as_take_values_from_their_lists(self):
        s = person_spec()
        s["jobs"][0]["started_by"] = ["owner"]
        res, _ = self.build(s)
        self.assertFalse(res["ok"], res)
        self.assertIn("started_by lists who starts it", res["error"])
        s = person_spec()
        s["jobs"][0]["works_as"] = "chat"
        res, _ = self.build(s)
        self.assertFalse(res["ok"], res)
        self.assertIn("works_as is one of conversation, job", res["error"])

    def test_accepts_belongs_to_a_document_input_and_presentation_to_its_list(self):
        s = person_spec()
        s["jobs"][0]["inputs"][0]["accepts"] = ["text/plain"]
        res, _ = self.build(s)
        self.assertFalse(res["ok"], res)
        self.assertIn("carries accepts, which only an input of kind document has", res["error"])
        s = person_spec()
        s["jobs"][0]["inputs"][1]["presentation"] = "slides"
        res, _ = self.build(s)
        self.assertFalse(res["ok"], res)
        self.assertIn("presentation is how a person meets it", res["error"])


class AFolderThatStatesThem(FolderHarness):
    def test_the_folder_builds_and_its_descriptor_is_carried_as_authored(self):
        self.convert()

        def add(doc):
            doc["name"] = "Folder check"
            doc["summary"] = "Checks a folder for you."
            doc["will_not"] = ["It will not change the folder."]
            doc["offerings"][0]["started_by"] = ["person"]
            doc["offerings"][0]["works_as"] = "job"
        self.edit("agent-descriptor.json", add)
        res, _ = self.build(self.src, "out")
        self.assertTrue(res["ok"], res)
        d = descriptor(res)
        self.assertEqual((d["name"], d["summary"], d["will_not"]),
                         ("Folder check", "Checks a folder for you.", ["It will not change the folder."]))
        self.assertEqual((d["offerings"][0]["started_by"], d["offerings"][0]["works_as"]), (["person"], "job"))


if __name__ == "__main__":
    unittest.main()
