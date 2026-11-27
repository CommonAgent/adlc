#!/usr/bin/env python3
"""A package is an Agent Plugin, and the parts Agent Plugins 1.0.0 reads are
held to it: plugin.json's description and keywords, each SKILL.md's
frontmatter, and mcp.json.

What is worth pinning: plugin.json's description is the Descriptor's summary
where the agent has one and its `does` where it has none, one line of at most
300 characters, while `does` keeps the whole account; a folder whose
description is anything else is refused, and so is a longer one; keywords are
the jobs and never a word about how the package was made; a SKILL.md
description YAML would misread is written quoted, and a folder's unquoted one
is refused; and mcp.json carries only servers fixed in the package, each a
declared system of kind mcp, an https address or a program the package ships,
with no credential in env or headers, while a server the organization binds
at install has no entry and the package carries no mcp.json for it.

Run: AGENTMESH_ENV=example python3 -m unittest test_plugins
"""
import importlib.util
import json
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from test_folder import Harness, spec, tree  # noqa: E402

_spec = importlib.util.spec_from_file_location("agentbuilder_build", os.path.join(HERE, "build.py"))
build = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(build)

MCP_SCHEMA = "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json"
LONG = ("Reads a note and says what it is about, in one sentence a person can act on, and keeps the note, the "
        "sentence and what the model was asked in its records, so a later reader can see how the sentence "
        "was reached; a note that is not text, or that names a person, is refused or sent to a person, as "
        "its refusals and escalations say, and nothing is guessed when the note is empty.")


class Base(Harness):
    def write_spec(self, doc):
        with open(os.path.join(self.src, "spec.json"), "w", encoding="utf-8") as f:
            json.dump(doc, f, indent=2)

    def built(self, out="out"):
        res, _ = self.build(os.path.join(self.src, "spec.json") if os.path.exists(os.path.join(self.src, "spec.json")) else self.src, out)
        return res

    def read(self, res, *p):
        with open(os.path.join(res["path"], *p), encoding="utf-8") as f:
            return f.read()


class TheManifestsWords(Base):
    def test_without_a_summary_the_line_is_what_it_does_and_the_keywords_are_the_jobs(self):
        res = self.built()
        self.assertTrue(res["ok"], res)
        m = json.loads(self.read(res, "plugin.json"))
        self.assertEqual(m["description"], spec()["description"])
        self.assertEqual(m["keywords"], ["read-a-note", "summarize"])

    def test_a_summary_is_the_line_and_does_keeps_the_whole_account(self):
        self.write_spec({**spec(), "description": LONG, "summary": "Reads a note you give it and says what it is about."})
        res = self.built("a")
        self.assertTrue(res["ok"], res)
        self.assertEqual(json.loads(self.read(res, "plugin.json"))["description"], "Reads a note you give it and says what it is about.")
        self.assertEqual(json.loads(self.read(res, "agent-descriptor.json"))["does"], LONG)
        # The folder convert.py writes carries the same line and builds the same package.
        self.convert()
        with open(os.path.join(self.src, "plugin.json"), encoding="utf-8") as f:
            self.assertEqual(json.load(f)["description"], "Reads a note you give it and says what it is about.")
        again, _ = self.build(self.src, "b")
        self.assertTrue(again["ok"], again)
        self.assertEqual(tree(res["path"]), tree(again["path"]))

    def test_a_long_line_with_no_summary_is_refused(self):
        self.write_spec({**spec(), "description": LONG})
        res = self.built()
        self.assertFalse(res["ok"], res)
        self.assertIn("at most 300 characters", res["error"])
        self.assertIn("give the agent a summary", res["error"])
        self.assertFalse(os.path.exists(os.path.join(self.tmp, "out", "folder-check")))

    def test_a_folder_whose_line_is_not_the_summary_is_refused(self):
        self.write_spec({**spec(), "summary": "Reads a note you give it and says what it is about."})
        self.convert()
        self.edit("plugin.json", lambda d: d.update(description="Something else."))
        self.refused("the Descriptor's summary")

    def test_a_folder_with_no_summary_is_held_to_does(self):
        self.convert()
        self.edit("plugin.json", lambda d: d.update(description="Something else."))
        self.refused("the Descriptor's does")

    def test_a_job_whose_slug_is_such_a_word_is_still_a_keyword(self):
        # A step named draft is what the agent does, not how the package was made.
        self.write_spec(json.loads(json.dumps(spec()).replace('"summarize"', '"draft"')))
        res = self.built("a")
        self.assertTrue(res["ok"], res)
        self.assertEqual(json.loads(self.read(res, "plugin.json"))["keywords"], ["read-a-note", "draft"])
        self.convert()
        again, _ = self.build(self.src, "b")
        self.assertTrue(again["ok"], again)

    def test_a_word_about_how_it_was_made_is_refused_as_a_keyword(self):
        self.convert()
        for word in build.INTERNAL_KEYWORDS:
            self.edit("plugin.json", lambda d, w=word: d.update(keywords=[w, "read-a-note"]))
            self.refused("say how the package was made")
        self.edit("plugin.json", lambda d: d.update(keywords=["notes", "read-a-note"]))
        res, _ = self.build(self.src, "out")
        self.assertTrue(res["ok"], res)
        self.assertEqual(json.loads(self.read(res, "plugin.json"))["keywords"], ["notes", "read-a-note"])


class SkillFrontmatter(Base):
    def test_a_plain_value_is_told_from_one_yaml_would_misread(self):
        for ok in ("when somebody needs a note read", "reads notes, then says so", "the 3 things"):
            self.assertTrue(build.yaml_plain_ok(ok), ok)
        for bad in ("on every message: a reply", "a note # with a hash", "- a list", "yes", "12", "ends with:", "'quoted",
                    " padded", ""):
            self.assertFalse(build.yaml_plain_ok(bad), bad)

    def test_a_when_yaml_would_misread_is_written_quoted(self):
        doc = spec()
        doc["jobs"][0]["when"] = "on every message: a reply, or a \"quoted\" word"
        self.write_spec(doc)
        res = self.built()
        self.assertTrue(res["ok"], res)
        line = next(ln for ln in self.read(res, "skills", "read-a-note", "SKILL.md").split("\n") if ln.startswith("description:"))
        self.assertEqual(json.loads(line[len("description: "):]), doc["jobs"][0]["when"])
        # The folder keeps it quoted, and builds.
        self.convert()
        again, _ = self.build(self.src, "b")
        self.assertTrue(again["ok"], again)

    def test_a_folder_skill_whose_description_is_not_one_yaml_string_is_refused(self):
        self.convert()
        p = os.path.join(self.src, "skills", "summarize", "SKILL.md")
        with open(p, encoding="utf-8") as f:
            text = f.read()
        lines = text.split("\n")
        at = next(i for i, ln in enumerate(lines) if ln.startswith("description:"))
        lines[at] = "description: when asked: write the sentence"
        with open(p, "w", encoding="utf-8", newline="\n") as f:
            f.write("\n".join(lines))
        self.refused("put it in double quotes")


def mcp_spec(servers, **system):
    doc = spec()
    doc["systems"].append({"name": "the-ledger", "access": "read", "needs": "to look up the account a note names",
                           "kind": "mcp", **system})
    doc["mcp"] = {"$schema": MCP_SCHEMA, "mcpServers": servers}
    return doc


HTTP = {"type": "streamable-http", "url": "https://ledger.example.com/mcp", "headers": {"X-Tenant": "public"}}


class McpJson(Base):
    def test_the_schema_is_the_manifests_own_release(self):
        self.assertEqual(build.MCP_SCHEMA_URL, MCP_SCHEMA)

    def test_a_server_fixed_in_the_package_is_written_as_agent_plugins_reads_it(self):
        self.write_spec(mcp_spec({"the-ledger": HTTP}))
        res = self.built("a")
        self.assertTrue(res["ok"], res)
        self.assertEqual(json.loads(self.read(res, "mcp.json")), {"$schema": MCP_SCHEMA, "mcpServers": {"the-ledger": HTTP}})
        self.assertEqual(res["mcp_servers"], ["the-ledger"])
        for f in ("plugin.json", "agent-descriptor.json", "agent-runtime-requirements.json"):
            self.assertNotIn("ledger.example.com", self.read(res, f), f)
        # convert.py writes the folder's mcp.json, and the folder builds the same package.
        wrote = self.convert()["wrote"]
        self.assertIn("mcp.json", wrote)
        again, _ = self.build(self.src, "b")
        self.assertTrue(again["ok"], again)
        self.assertEqual(tree(res["path"]), tree(again["path"]))

    def test_a_server_the_organization_binds_at_install_has_no_mcp_json(self):
        doc = mcp_spec({})
        del doc["mcp"]
        self.write_spec(doc)
        res = self.built()
        self.assertTrue(res["ok"], res)
        self.assertFalse(os.path.exists(os.path.join(res["path"], "mcp.json")))
        self.assertEqual(res["mcp_servers"], [])

    def test_a_program_the_package_ships_is_started_from_inside_it(self):
        servers = {"the-ledger": {"type": "stdio", "command": "node",
                                  "args": ["${PLUGIN_ROOT}/skills/read-a-note/scripts/read.mjs", "--data", "${PLUGIN_DATA}/ledger"],
                                  "env": {"LEDGER_MODE": "read"}, "cwd": "${PLUGIN_DATA}"}}
        self.write_spec(mcp_spec(servers))
        res = self.built()
        self.assertTrue(res["ok"], res)
        self.write_spec(mcp_spec({"the-ledger": {"type": "stdio", "command": "./skills/read-a-note/scripts/read.mjs"}}))
        res = self.built("b")
        self.assertTrue(res["ok"], res)

    def test_a_program_the_package_does_not_carry_is_refused(self):
        self.write_spec(mcp_spec({"the-ledger": {"type": "stdio", "command": "./skills/read-a-note/scripts/server.mjs"}}))
        self.assertIn("is not a file in the package", self.built()["error"])
        self.write_spec(mcp_spec({"the-ledger": {"type": "stdio", "command": "node", "args": ["${PLUGIN_ROOT}/bin/server.mjs"]}}))
        self.assertIn("is not in the package", self.built()["error"])

    def test_what_agent_plugins_or_the_package_rules_do_not_allow_is_refused(self):
        stdio = {"type": "stdio", "command": "node"}
        cases = [
            ({"another": HTTP}, {}, "every server is a system this agent declares"),
            ({"the-ledger": {**HTTP, "url": "http://ledger.example.com/mcp"}}, {}, "over https"),
            ({"the-ledger": {**HTTP, "url": "https://me:pw@ledger.example.com/mcp"}}, {}, "user information"),
            ({"the-ledger": {**HTTP, "url": "https://ledger.example.com/mcp#x"}}, {}, "fragment"),
            ({"the-ledger": {**HTTP, "url": "https://${HOST}/mcp"}}, {}, "no placeholder"),
            ({"the-ledger": {**HTTP, "headers": {"Authorization": "Bearer abc"}}}, {}, "carries a credential"),
            ({"the-ledger": {**HTTP, "headers": {"X-One": "a", "x-one": "b"}}}, {}, "given twice"),
            ({"the-ledger": {**HTTP, "command": "node"}}, {}, "is not a member of a streamable-http server"),
            ({"the-ledger": {"type": "websocket", "url": "https://ledger.example.com/mcp"}}, {}, "type is one of"),
            ({"the-ledger": {**stdio, "env": {"LEDGER_TOKEN": "x"}}}, {}, "named for a credential"),
            ({"the-ledger": {**stdio, "env": {"PLUGIN_ROOT": "x"}}}, {}, "which the client sets itself"),
            ({"the-ledger": {**stdio, "args": ["/opt/ledger/server.js"]}}, {}, "not spelled from ${PLUGIN_ROOT}"),
            ({"the-ledger": {**stdio, "args": ["./server.js"]}}, {}, "not spelled from ${PLUGIN_ROOT}"),
            ({"the-ledger": {**stdio, "args": ["${PLUGIN_ROOT}/../other"]}}, {}, "not spelled from ${PLUGIN_ROOT}"),
            ({"the-ledger": {**stdio, "cwd": "data"}}, {}, "cwd starts with"),
            ({"the-ledger": {**stdio, "command": "node server.js"}}, {}, "one executable token"),
            ({"the-ledger": {**stdio, "command": "../bin/server"}}, {}, "a path inside the package that starts with ./"),
            ({"the-ledger": HTTP}, {"spends": {"unit": "calls"}}, "hold a ceiling"),
            ({"the-ledger": HTTP}, {"credential": "ledger-key"}, "names no credential"),
        ]
        for servers, system, phrase in cases:
            self.write_spec(mcp_spec(servers, **system))
            res = self.built()
            self.assertFalse(res["ok"], (servers, res))
            self.assertIn(phrase, res["error"], servers)
            self.assertFalse(os.path.exists(os.path.join(self.tmp, "out", "folder-check")), "a package was written for a refused spec")
        doc = mcp_spec({"the-ledger": HTTP})
        doc["mcp"]["$schema"] = "https://agent-plugins.org/schemas/2.0.0/mcp.schema.json"
        self.write_spec(doc)
        self.assertIn("the version of Agent Plugins plugin.json declares", self.built()["error"])
        doc["mcp"] = {"$schema": MCP_SCHEMA, "mcpServers": {}, "servers": {}}
        self.write_spec(doc)
        self.assertIn("nothing else", self.built()["error"])

    def test_a_loopback_server_may_be_reached_over_http(self):
        for url in ("http://localhost:8080/mcp", "http://127.0.0.1:8080/mcp", "http://[::1]:8080/mcp"):
            self.write_spec(mcp_spec({"the-ledger": {"type": "sse", "url": url}}))
            res = self.built()
            self.assertTrue(res["ok"], (url, res))


if __name__ == "__main__":
    unittest.main()
