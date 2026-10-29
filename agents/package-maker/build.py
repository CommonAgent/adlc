#!/usr/bin/env python3
"""Agent Builder: turn a description of a needed agent into an Agent Package.

The create half of the create-to-deploy loop. Given a structured spec of an
agent somebody needs, this emits a complete package in the shape
docs/agent-package-draft.md describes: an Agent Plugin (plugin.json, skills/)
carrying the agent's OUTSIDE as a draft Agent Descriptor and its HOST SIDE as
its runtime requirements, so the deployment manager reads it and deploys it with no
changes, and any client that reads Agent Plugins can take the skills.

WHAT IT WILL NOT INVENT. A package is only as honest as the judgment in it,
and two parts are judgment, not transcription: what the agent refuses, and
what records it must leave. This builder REQUIRES both in the spec and refuses
to emit a package without them, rather than filling them from the description.
An agent with an empty NOT.md or no records duty is the exact failure the
conformance eval caught, and a builder that guessed them would manufacture it.

ONE AUTHORED SPELLING. Every caller-facing fact is written once, into
agent-descriptor.json; every host-facing fact once, into agent-runtime-requirements.json. The manifest
points at both by path and digest and copies nothing. NOT.md, RECORDS.md and
SYSTEMS.md are generated from those two files, for harnesses that read
markdown, and a checker regenerates them to see they still match.

Every file is written with LF line endings whatever the platform, so a
package built on Windows hashes the same as one built on Linux.

The result is a DRAFT to review, never something vouched for: nobody has run
the agent this describes. The build record says so.

Usage: build.py <agent folder | spec.json> <out_dir>   (prints a JSON result)

The agent folder is the layout of Common Agent 13.2: agent-descriptor.json,
agent-runtime-requirements.json and plugin.json, with skills/<slug>/SKILL.md
(see read_folder). A spec.json, below, is still read, with a warning, for one
transition; convert.py turns one into the folder.

Spec shape (the judgment parts are REQUIRED; everything marked ? is optional):
{
  "name": "invoice-reader",              # lowercase, digits, hyphens
  "version": "1.0.0",
  "description": "One sentence: what it does.",
  "display_name": "Invoice reader",      # ? the Descriptor's `name`: what a person calls it (6.13.1)
  "summary": "Reads an invoice and hands back its fields.",  # ? one sentence for a person, at most 200 characters
  "will_not": ["It will not pay an invoice."],  # ? what it will not do, in words a person acts on (6.13.3)
  "source": "<dir>",                     # ? base for relative file paths below;
                                         #   defaults to the spec file's directory
  "jobs": [                              # each becomes a skill; the offered ones become offerings
    { "slug": "read-the-invoice",
      "title": "Read the invoice",
      "when": "when to reach for this",
      "good": "what a good result looks like",
      "empty": "what to do when it comes back empty",
      "offered": true,                     # ? what a caller orders; until one job says so, every job is offered
      "started_by": ["person", "agent"],   # ? offered jobs only: who starts it (6.13.2)
      "works_as": "job",                   # ? offered jobs only: conversation or job (6.13.2)
      "example": { "inputs": { "invoice": { "url": "https://example.com/invoice.pdf" } },   # ? offered jobs only:
                   "good_result": "The invoice's number, date, lines and total." },     #   sample inputs, and what a good result looks like
      "steps": ["find-the-total"],         # ? the jobs this one runs, in order, to deliver (one level deep)
      "revisions": {                       # ? what a change to delivered work costs (offered jobs only):
        "included": { "count": 1, "window_days": 14 },     #   this many free within the window, then
        "steps": [ { "id": "find-the-total", "price": { "model": "flat", "amount_micro": 100000, "currency": "USD" } } ]
      },                                   #   a price per step of this job, or "flat": one price for any revision
      "trial": {                           # ? a trial of this offered job (Common Agent 7.7); needs trial_ceiling
        "who": "signed_in",                #   anyone | signed_in | verified
        "shape": { "inputs": [ { "name": "invoice", "limit": { "max_bytes": 200000 } } ] },   # ?
        "limits": { "per_requester_per_day": 2, "per_day": 50 } },  #   counts, at least one; never money
      "does": "one sentence",                                   # ?
      "inputs": [ { "name": "invoice", "kind": "application/pdf", "required": true } ],   # ?
      "outputs": [ { "name": "fields", "kind": "text", "when": "per_task" } ],            # ?
      "instructions": "long-form markdown" | { "file": "rules.md" },                      # ?
      "scripts": [ "tools/check.sh" ],                          # ? copied under scripts/
      "references": [ "notes/fields.md" ],                      # ? copied under references/
      "assets": [ "templates/page.html" ],                      # ? copied under assets/
      "lockfile": "scripts/package-lock.json" }                 # ? a copied file, hashed
  ],
  "can_use": [                           # ? the published shapes a caller may send with a job, and
    { "schema": "https://schemas.agentmesh.ai/brand/v1",   #   which fields of each this agent reads
      "reads": ["palette.ink", "type.heading.family"],     #   REQUIRED, non-empty: the field list is
      "required": false,                                   #   ? what says which agent you are hiring
      "does": "colors the page and sets the heading face",  # ?
      "without": "draws in its own house style and says so" }  # ? what it does when none is given
  ],
  "run_config": {                        # ? what a run config may set (docs/run-config-plan.md 2.2)
    "settings": [ { "name": "model", "kind": "rule",      #   preference (closest layer wins) | rule (tightest)
                    "default": "google/gemini-3.8-flash",  #   REQUIRED; must be in allowed when allowed is given
                    "allowed": ["google/gemini-3.8-flash"],  # ? non-empty
                    "job_may_set": false } ],              #   REQUIRED: may a sender who does not own it set it
    "tested_models": ["google/gemini-3.8-flash"],          # ?
    "named": [ { "name": "Deck explainer, Oct 6", "settings": {} } ]  # ? only declared settings, allowed values;
  },                                     #   each gets its digest (sha256 of its JCS form), checked when given
  "systems": [                           # the systems it needs, by NAME ("role" still read)
    { "name": "the-ledger", "access": "read", "needs": "what the access is for",
      "leaves": false,                   # ? true when a caller's material is sent to it
      "kind": "directory",               # ? directory (default) | mcp | service | model
      "protocols": ["anthropic-messages"], # ? kind model only: the formats the scripts speak (12.4.1)
      "credential": "ledger-key",        # ? NAME of the credential a service needs
      "env": "LEDGER_TOKEN",             # ? the variable the scripts read it from
      "spends": { "unit": "calls" } }    # ? present when the service costs money
  ],
  "refuses": ["one line per thing it will not do"],              # REQUIRED, non-empty
  "escalates": ["one line per thing that goes to a person"],     # ?
  "records": [ "one line per record" | { "name": "...", "when": "per_task", "file": "records/*/x.json" } ],  # REQUIRED
  "price": { "model": "flat", "amount_micro": 2000000, "currency": "USD",  # ? what the agent CHARGES others
             "covers": ["make-an-explainer"],                     #   ? which offerings; default: the whole agent
             "sku": "default" },                                  #   ? the id an agreement binds to
  "trial_ceiling": { "amount_micro": 5000000, "currency": "USD", "per": "day",   # ? REQUIRED when a job has
                     "per_1k_tokens_micro": 15000 },  #   a trial: the owner's suggested trial ceiling, written into
                                         #   the allowance at install; the cost model is used only when the
                                         #   agent has no allowance yet
  "samples_ref": true,                   # ? the bound descriptor names the platform's samples address
  "kind":      "plugin-on-harness",      # ? what the inside is made of: bare-harness |
                                         #   plugin-on-harness | mesh-coded |
                                         #   third-party-framework; routes a container agent and
                                         #   is never written into the descriptor (Common Agent 6.12)
  "license":   "Apache-2.0",             # ? the license this package is under
  "homepage":  "https://…",              # ? where a reader reads about this agent
  "repository": "https://…",             # ? where its source is kept
  "author":    { "name": "…" },          # ? name and email; an author page is an
                                         #   address and stays out (12.6 rule 3)
  "from": [                              # ? what this package was copied from,
    { "name": "quiz-maker", "version": "1.2.0",   #   nearest ancestor first
      "repository": "https://…", "commit": "9f2c…", "license": "Apache-2.0" }
  ],
  "runtimes":  [ { "name": "node", "version": ">=22" } ],        # ?
  "binaries":  [ { "name": "chromium", "purpose": "why" } ],     # ?
  "ceilings":  [ { "system": "text-to-speech", "per": "task" } ],# ? default: one per spending system
  "directories": [ { "name": "records", "purpose": "..." } ],    # ? default: records and work
  "job_seconds": 1500,                   # ? the longest one job may take (60 to 7200); the attendant's cap
  "wants_replies": true,                 # ? the agent sends work to other agents and reads their replies
  "answer": "review"                     # ? which filed piece is the reply to the sender; without it the
                                         #   host falls back to what the work printed, which for a model is
                                         #   a transcript of its own thinking rather than a deliverable
                                         #   (a runner); the attendant hands replies to the harness instead
                                         #   of acknowledging them. Default false: replies are acknowledged
                                         #   and never answered, which is what stops two agents replying
                                         #   to each other forever.
}
"""
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys

EXT = "net.agentdoc.package"
# The names of the two authored files, the manifest pointer at the second and
# its format (Common Agent 0.30.0-draft, 12.2). A writer emits only these. The
# names before 0.30.0-draft are read where the current ones are absent, and
# the current ones win where both are present, with a warning either way.
DESCRIPTOR_FILE = "agent-descriptor.json"
RUNTIME_FILE = "agent-runtime-requirements.json"
RUNTIME_FORMAT = "agent-runtime-requirements-v1"
RUNTIME_POINTER = "runtime_requirements"
LEGACY_DESCRIPTOR_FILE = "descriptor.json"
LEGACY_RUNTIME_FILE = "install.json"
LEGACY_RUNTIME_FORMAT = "agent-install-v1"
LEGACY_RUNTIME_POINTER = "install"
MANIFEST_FILE = "plugin.json"
# The one member of the package's own entry in an agent folder's plugin.json
# that is the builder's and never the package's: what it reads to assemble the
# skills and nothing a host or a caller reads. It is left out of every package.
BUILD_MEMBER = "build"
BUILD_MEMBERS = ("source", "kind", "container", "claims", "skills")
SKILL_FILE_KINDS = ("scripts", "references", "assets")
SPEC_DEPRECATED = ("building from a spec.json is deprecated: keep agent-descriptor.json, "
                   "agent-runtime-requirements.json and plugin.json in the agent's folder (convert.py writes "
                   "them from a spec) and build the folder")
# What this build read that it would rather not have: an old file name, the
# deprecated spec input. Printed to stderr as it is found and carried in the
# result, so a caller that reads only the JSON line still sees it.
WARNINGS = []


def warn(text):
    WARNINGS.append(text)
    print(f"build.py: warning: {text}", file=sys.stderr)

SCHEMA_URL = "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json"
HERE = os.path.dirname(os.path.abspath(__file__))
# The pinned copy of the Agent Plugins schema the manifest declares, so a
# moved or unavailable address cannot make a valid package unverifiable.
SCHEMA_FILE = next((p for p in (os.path.join(HERE, "agentbuilder-plugin.schema.json"),
                                os.path.join(HERE, "plugin-1.0.0.schema.json")) if os.path.exists(p)), None)
NAME_RE = re.compile(r"^[a-z][a-z0-9-]{1,62}[a-z0-9]$")
SLUG_RE = re.compile(r"^[a-z][a-z0-9-]{1,62}$")
CREDENTIAL_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,63}$")
ENV_RE = re.compile(r"^[A-Z][A-Z0-9_]{0,63}$")
ACCESS = ("read", "write", "trigger")
KINDS = ("directory", "mcp", "service", "model")
#: The request formats a model system may declare (Common Agent 0.39.0,
#: 12.4.1). The list is closed; the shared caller speaks exactly these.
MODEL_PROTOCOLS = ("anthropic-messages", "openai-chat", "gemini")
VALUE_KINDS = ("text", "identifier", "url", "document")
MEDIA_RE = re.compile(r"^[a-z]+/[a-z0-9][a-z0-9.+-]*$")
WHEN = ("per_task", "standing")
# Characters that can carry invisible instructions: zero-width, bidi
# controls, and the tag block. A package carrying one does not conform.
HIDDEN = set(range(0x200B, 0x2010)) | set(range(0x202A, 0x202F)) | set(range(0x2060, 0x2065)) | {0xFEFF} | set(range(0xE0000, 0xE0080))


RESERVED_SYSTEMS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "system-names.json")


def reserved_systems():
    """The system names the platform reserves, with the shape each promises.

    A package may declare a name outside this list and it still builds: the
    list grows when a name recurs, and refusing an unlisted one would stop
    somebody the day they need something nobody has needed yet. What it costs
    is said out loud instead, in the build record, because an unlisted name
    has to be bound by hand at every deploy and nobody should learn that at
    install time.

    The canonical list is the platform's (services/src/api/system-names.ts,
    served at /v1/stack/vocabulary); the JSON beside this file is the copy the
    builder reads, and a test on the platform side fails when the two drift.
    """
    try:
        with open(RESERVED_SYSTEMS_FILE, encoding="utf-8") as f:
            doc = json.load(f)
        return {s["name"]: s.get("state", "defined")
                for s in doc.get("systems", []) if isinstance(s, dict) and s.get("name")}
    except (OSError, ValueError):
        # A missing list is not a reason to refuse a package. The note the
        # record would have carried says so rather than claiming every name
        # was checked.
        return {}


def systems_note(systems):
    """What the build record says about the names this package declares.

    Three cases worth telling apart, because they cost different things:
    a name on the list, a name the list holds but has not settled the shape
    of, and a name nobody reserved.
    """
    reserved = reserved_systems()
    if not reserved:
        return {"kind": "systems-unchecked",
                "what": "the reserved system names could not be read, so nothing here says whether "
                        "this package declares names an account can bind"}
    names = [system_name(s) for s in systems]
    names = [n for n in names if n]
    unlisted = [n for n in names if n not in reserved]
    held = [n for n in names if reserved.get(n) == "reserved"]
    if not names:
        return {"kind": "systems", "what": "this package reaches nothing outside its own folder"}
    if not unlisted and not held:
        return {"kind": "systems",
                "what": "every system it declares is a reserved name an account can bind: " + ", ".join(sorted(set(names)))}
    parts = []
    if unlisted:
        parts.append("no reserved name covers " + ", ".join(sorted(set(unlisted)))
                     + ", so each deploy must bind it by hand")
    if held:
        parts.append(", ".join(sorted(set(held))) + " is reserved with no settled shape, so nothing can be bound to it yet")
    return {"kind": "systems-unbindable", "what": "; ".join(parts)}


def system_name(entry):
    """The name a systems[] entry gives the system it is bound to.

    Common Agent 0.16.0-draft renamed this member from `role` to `name`,
    because `role` already means the standard job an agent holds, whose
    contract is an entry at the roles registry, and one word for both made a
    document nobody could read without being told which was meant. `role` is
    accepted as an alias for one revision and `name` wins where a spec
    carries both. Returns None when an entry names neither, so the caller
    refuses it with its own words.
    """
    if not isinstance(entry, dict):
        return None
    for key in ("name", "role"):
        v = entry.get(key)
        if isinstance(v, str) and v:
            return v
    return None


# The package folder a build has started writing, so a refusal after that
# point leaves no half-built package behind.
PARTIAL = []


def out(obj):
    if not obj.get("ok"):
        for d in PARTIAL:
            shutil.rmtree(d, ignore_errors=True)
    print(json.dumps(obj))
    sys.exit(0 if obj.get("ok") else 1)


def fail(reason):
    out({"ok": False, "error": reason})


def need(spec, key, kind=list):
    v = spec.get(key)
    if kind is list and (not isinstance(v, list) or not v):
        fail(f"spec.{key} is required and must be a non-empty list")
    if kind is str and (not isinstance(v, str) or not v.strip()):
        fail(f"spec.{key} is required")
    return v


def sentence(s):
    s = s.strip()
    return s if s.endswith(".") else s + "."


def dumps(obj):
    """One spelling of a JSON file, so its digest is reproducible."""
    return json.dumps(obj, indent=2, ensure_ascii=False) + "\n"


def sha256_of(data):
    return hashlib.sha256(data.encode("utf-8") if isinstance(data, str) else data).hexdigest()


# ── the two authored files ────────────────────────────────────────────────

def is_count(v, least):
    return isinstance(v, int) and not isinstance(v, bool) and v >= least


def is_price(p):
    """The price declaration's shape, as far as a revision needs it: an
    integer amount in micro-units of a named currency, and a model when one
    is given. Never a float: no floating point touches money."""
    return (isinstance(p, dict) and is_count(p.get("amount_micro"), 0)
            and isinstance(p.get("currency"), str) and bool(p["currency"].strip())
            and ("model" not in p or isinstance(p["model"], str)))


# The five closed price shapes (SPEC §19.1) and the fields each one names.
# Mirrored from the SDK's sku.ts, deliberately, because the agent's own node
# validates a price at daemon start and a package that reaches a host with a
# malformed one fails there, in a log, with nobody to tell. Refusing it here
# puts the refusal in front of the person who wrote the number. A field a
# shape does not name is a shape error and not generosity: a price that says
# more than its model does cannot be rated.
PRICE_FIELDS = {
    "free": {"model"},
    "flat": {"model", "currency", "amount_micro"},
    "per_unit": {"model", "currency", "meter", "per", "amount_micro", "included"},
    "package": {"model", "currency", "meter", "size", "amount_micro", "period", "included"},
    "tiered": {"model", "currency", "meter", "per", "period", "tiers", "included"},
}
CURRENCY_RE = re.compile(r"^[A-Z]{3}$")
PERIODS = ("day", "month")


def price_shape(p, where):
    """One price in §19.1's shape. Stricter than is_price above, which checks
    only as much as a revision step needs: this one is the whole declaration
    the agent publishes, so it is held to the same five models, the same ISO
    currency and the same integer arithmetic the SDK holds it to."""
    if not isinstance(p, dict):
        fail(f"{where} must be an object naming a model")
    model = p.get("model")
    if model not in PRICE_FIELDS:
        fail(f"{where}: model is one of free, flat, per_unit, package, tiered; bad: {model!r}")
    for k in p:
        if k not in PRICE_FIELDS[model]:
            fail(f"{where}: {k!r} is not a field of the {model} shape")
    if model == "free":
        return
    if not (isinstance(p.get("currency"), str) and CURRENCY_RE.match(p["currency"])):
        fail(f"{where}: currency is a three-letter code like USD; bad: {p.get('currency')!r}")
    if model != "tiered" and not is_count(p.get("amount_micro"), 0):
        fail(f"{where}: amount_micro is a whole number of micro-units, 0 or more. "
             f"No floating point goes near money (§19.3), so $2.50 is written 2500000; bad: {p.get('amount_micro')!r}")
    if model == "flat":
        return
    if not (isinstance(p.get("meter"), str) and p["meter"].strip()):
        fail(f"{where}: a {model} price names the meter it rates, e.g. \"tokens_out\"")
    if "per" in p and not is_count(p["per"], 1):
        fail(f"{where}: per is a whole number above zero, the size of the unit the amount is charged for")
    if "included" in p:
        inc = p["included"]
        if not (isinstance(inc, dict) and set(inc) == {"quantity", "period"}
                and is_count(inc["quantity"], 0) and inc["period"] in PERIODS):
            fail(f"{where}: included is a whole quantity and a period of day or month; "
                 f"an allowance with no period never resets, which is a trial and not a free tier")
    if model == "package" and not is_count(p.get("size"), 1):
        fail(f"{where}: a package price needs a whole size above zero, the units one package holds")
    if model in ("package", "tiered") and p.get("period") not in PERIODS:
        fail(f"{where}: a {model} price needs a period of day or month to aggregate over")
    if model == "tiered":
        tiers = p.get("tiers")
        if not (isinstance(tiers, list) and tiers):
            fail(f"{where}: a tiered price needs at least one tier")
        prev = 0
        for i, t in enumerate(tiers):
            if not (isinstance(t, dict) and is_count(t.get("amount_micro"), 0)):
                fail(f"{where}: tier {i} needs a whole amount_micro of 0 or more")
            if i == len(tiers) - 1:
                if "up_to" in t:
                    fail(f"{where}: the last tier is unbounded. A price with a quantity ceiling is "
                         f"not a price, it is a refusal a buyer finds out about later")
            else:
                if not (is_count(t.get("up_to"), 1) and t["up_to"] > prev):
                    fail(f"{where}: tier {i} needs an up_to above the tier before it")
                prev = t["up_to"]


def offered_slugs(jobs):
    """The slugs a caller can order. Until one job says `offered`, every job
    is, which is what every package written before that member meant."""
    anyone_says = any("offered" in j for j in jobs)
    return [j["slug"] for j in jobs if not anyone_says or j.get("offered") is True]


def one_at_a_time_declaration(spec):
    """The spec's `one_at_a_time`, checked, or None when it says nothing.

    A host keeps one conversation's messages in turn already. An agent whose
    work is spread across several senders (a process runner: the owner, each
    phase's holder, the platform, all about one run) names here what else ties
    messages together: `named_in_text`, a regular expression whose first group,
    found in a message's text, is the key. Messages with the same key are
    worked one at a time, in the order they came; different keys run at once."""
    one = spec.get("one_at_a_time")
    if one is None:
        return None
    if not isinstance(one, dict) or set(one) - {"named_in_text"}:
        fail(f"one_at_a_time is an object with named_in_text; bad: {one!r}")
    pattern = one.get("named_in_text")
    if pattern is not None:
        if not (isinstance(pattern, str) and 0 < len(pattern) <= 200):
            fail(f"one_at_a_time.named_in_text is a regular expression of at most 200 characters; bad: {pattern!r}")
        try:
            groups = re.compile(pattern).groups
        except re.error as e:
            fail(f"one_at_a_time.named_in_text does not compile: {e}")
        if groups < 1:
            fail("one_at_a_time.named_in_text needs one group, the key, in brackets")
    return {k: v for k, v in one.items() if v is not None}


def price_declaration(spec, jobs):
    """What the agent charges OTHERS for its own work (SPEC §19.1), or None.

    WHY THIS IS IN A PACKAGE AT ALL. Rule 4 of the package rules
    (common-agent-spec 12.6) says a package carries nothing commercial, and
    that a price attaches at listing and at install. One member is already
    excepted: an offered job's `revisions` policy travels in the package, with
    the price of redoing each step, because the builder is the one who knows
    what a step costs to run again, and it is a proposal rather than a
    listing. This member is the same kind of claim about the same work, for
    the same reason and one more: the file the agent's node actually reads,
    price.json in the adapter's state directory, was being placed on the host
    BY HAND, and a file placed by hand is the thing a package exists to stop.
    Rule 4's wording has not been amended to say so, and a strict reader is
    right that it needs the same sentence the revisions policy got.

    WHAT KEEPS IT INSIDE RULE 4'S INTENT. No provider and no address travel
    here. Who bills, and where a buyer goes to approve, are decided at install
    by whoever makes those decisions, and rule 3 forbids an address in a
    declaration anyway, which this file's own check at the end of install_file
    enforces. What the package carries is a proposed amount and nothing that
    binds anyone to it. An operator who disagrees with the number changes it
    on the running agent (`agentmesh price set`), and the agent's node applies
    what is on the host, never what was in the tarball.

    ONE PRICE, BECAUSE A NODE CARRIES ONE SKU. The adapter registers exactly
    one SKU per agent, so five offerings at five prices cannot be expressed
    today whatever a package says. Rather than let a spec declare a thing that
    cannot be installed, the shape here holds one price and says which
    offerings it covers. An agent whose offerings are worth different amounts
    names the one the price is for, and §19.1 answers for the rest: an
    offering covered by no SKU is FREE. That is a real statement, not a gap,
    and it is better than charging the price of the whole job for a part of
    it. When the node can carry more than one, this becomes a list and the
    packages that named one offering keep meaning what they meant.

    Returns the SKU as it will be placed, minus the provider: the deployer
    adds that and writes the file."""
    p = spec.get("price")
    if p is None:
        return None
    if not isinstance(p, dict):
        fail("price is an object: the model, the amount, the currency, and optionally "
             "the offerings it covers. No price at all means FREE, the default (§19.1)")
    if "provider" in p or "checkout_url" in p or "terms_url" in p:
        fail("price names no provider and no address. Who bills for this agent and where a buyer "
             "approves are bound at install, by whoever makes that decision, and a package that "
             "named either would be tied to one deployment (12.6 rule 3)")
    sku = p.get("sku", "default")
    if not (isinstance(sku, str) and re.match(r"^[a-z0-9-]{1,64}$", sku)):
        fail(f"price.sku is the id an agreement binds to: lowercase letters, digits and hyphens; bad: {sku!r}")
    covers = p.get("covers")
    if covers is None:
        covered = {"agent": True}
    else:
        offered = offered_slugs(jobs)
        if not (isinstance(covers, list) and covers and all(isinstance(c, str) for c in covers)):
            fail("price.covers is a list of the offerings this price is for; leave it out "
                 "and the price covers the whole agent")
        for c in covers:
            if c not in offered:
                fail(f"price.covers names {c!r}, which is not an offered job of this agent. "
                     f"A price can only cover what a caller can order: {', '.join(offered)}")
        if len(set(covers)) != len(covers):
            fail("price.covers names the same offering twice")
        covered = {"offerings": list(covers)}
    price_shape({k: v for k, v in p.items() if k not in ("sku", "covers")}, "price")
    return {"sku": sku, "covers": covered,
            "price": {k: v for k, v in p.items() if k not in ("sku", "covers")}}


# How the work is actually done (common-agent-spec 12.3), four words from four
# fixed sets. A job that carries none says nothing, which is what every package
# before this member meant.
HOW = {
    # who decides what happens next
    "control": ("script", "model", "person"),
    # how a model is used
    "intelligence": ("none", "called", "open"),
    # what running it can spend
    "cost": ("none", "metered", "unbounded"),
    # how much of the method is written down
    "contract": ("full", "ends", "goal"),
}


def how_declaration(job):
    """The job's `how`, checked and passed through. Two combinations are
    refused rather than described.

    A method written down in full and handed to a model to improvise is the
    shape that fails: the model does not follow the written method and nothing
    checks that it did. The first multi-agent run failed three times in exactly
    that way, and nothing in any package said which steps those were. Either
    the method is a program, or the contract is loosened to what must come out.

    A program that hands the work to a model to find its own way is the same
    fault from the other side: that is not a program, it is a model with a
    launcher, and calling it a script tells a caller something untrue."""
    slug, how = job["slug"], job["how"]
    if not isinstance(how, dict):
        fail(f"job {slug}: how is an object with {', '.join(HOW)}")
    for k in HOW:
        if k not in how:
            fail(f"job {slug}: how names no {k}; it must be one of {', '.join(HOW[k])}")
    for k, v in how.items():
        if k not in HOW:
            fail(f"job {slug}: how has no member {k!r}; it carries {', '.join(HOW)}")
        if v not in HOW[k]:
            fail(f"job {slug}: how.{k} is {v!r}; it must be one of {', '.join(HOW[k])}")
    if how["control"] == "model" and how["contract"] == "full":
        fail(f"job {slug}: how says a model decides what happens next and the whole method is written "
             f"down. A method written in full and handed to a model to improvise is the shape that "
             f"fails. Write it as a program (control: script), or say the contract is the ends and not "
             f"the method (contract: ends).")
    if how["control"] == "script" and how["intelligence"] == "open":
        fail(f"job {slug}: how says a program decides what happens next and a model is given the work "
             f"to find its own way. That is not a program, it is a model with a launcher. Either the "
             f"program calls a model at a named point (intelligence: called), or the model is in "
             f"control (control: model).")
    return {k: how[k] for k in HOW}


# The placeholders a run command may carry, and nothing else. A command that
# silently ran with the literal text {job_dir} in it would be worse than one
# that refused, so an unknown placeholder is an error here, at build.
RUN_PLACEHOLDERS = ("home", "package", "records", "work", "job_dir",
                    "message_id", "sender", "handle", "in_reply_to")
RUN_FILE_PLACEHOLDERS = ("file_path", "file_media_type")
PLACEHOLDER_RE = re.compile(r"\{([a-z_]+)\}")


def run_command(job):
    """The exact command the host runs for this job (common-agent-spec 12.3).

    A host that has a command for a job runs it and does not wake a model to
    decide whether to. Allowed only where the job's `how` says a program is in
    control: a job that says a program decides what happens next and then names
    no command is describing a program nobody can find, and one that names a
    command while a model is in control is claiming a determinism it does not
    have."""
    slug, r = job["slug"], job["run"]
    how = job.get("how") or {}
    if how.get("control") != "script":
        fail(f"job {slug}: run is for a job whose how says control: script; this one says "
             f"{how.get('control', 'nothing')}")
    if how.get("intelligence") == "open":
        fail(f"job {slug}: run is for a job that follows a program; this one gives the work to a model "
             f"to find its own way (intelligence: open)")
    if not isinstance(r, dict):
        fail(f"job {slug}: run is an object with command, and optionally per_file, message_file and reply")
    for k in r:
        if k not in ("command", "per_file", "message_file", "reply", "escalate_when", "calls_model"):
            fail(f"job {slug}: run has no member {k!r}; it carries command, per_file, message_file, "
                 f"reply, escalate_when, calls_model")
    cmd = r.get("command")
    if not (isinstance(cmd, list) and cmd and all(isinstance(x, str) and x for x in cmd)):
        fail(f"job {slug}: run.command is a non-empty list of strings, the program first")
    per = r.get("per_file")
    if per is not None and not (isinstance(per, list) and per and all(isinstance(x, str) and x for x in per)):
        fail(f"job {slug}: run.per_file is a non-empty list of strings, repeated once per attached file")
    mf = r.get("message_file")
    if mf is not None and not (isinstance(mf, str) and mf.strip()):
        fail(f"job {slug}: run.message_file is where the sender's text is written before the command runs")
    reply = r.get("reply", "stdout")
    if not (reply == "stdout" or (isinstance(reply, str) and reply.startswith("json:") and len(reply) > 5)):
        fail(f"job {slug}: run.reply is 'stdout' or 'json:<member>'; bad: {reply!r}")
    for where, elements, allowed in (
            ("command", cmd, RUN_PLACEHOLDERS),
            ("message_file", [mf] if mf else [], RUN_PLACEHOLDERS),
            ("per_file", per or [], RUN_PLACEHOLDERS + RUN_FILE_PLACEHOLDERS)):
        for e in elements:
            for name in PLACEHOLDER_RE.findall(e):
                if name not in allowed:
                    known = ", ".join(f"{{{x}}}" for x in allowed)
                    fail(f"job {slug}: run.{where} carries {{{name}}}, which the host does not "
                         f"substitute. It knows {known}.")
    # When the command says this turn needs judgment, the host wakes the model
    # instead of using the command's reply. The program still decides every
    # time; what it decides is whether this one turn is one it can finish.
    esc = r.get("escalate_when")
    if esc is not None and not (isinstance(esc, str) and esc.startswith("json:") and len(esc) > 5):
        fail(f"job {slug}: run.escalate_when is 'json:<member>' of what the command printed; bad: {esc!r}")
    # A script that calls a model itself says so, so the deploy gives its
    # container the model and the key (deploymgr image.needs_model_key).
    cm = r.get("calls_model")
    if cm is not None and not isinstance(cm, bool):
        fail(f"job {slug}: run.calls_model is true or false; bad: {cm!r}")
    out = {"command": list(cmd), "reply": reply}
    if esc:
        out["escalate_when"] = esc
    if cm:
        out["calls_model"] = True
    if per:
        out["per_file"] = list(per)
    if mf:
        out["message_file"] = mf
    return out


def revisions_policy(job):
    """What a change to the job's delivered work costs (common-agent-spec 5.7
    and 6.2), checked and then passed to the offering unchanged: the included
    count and window, then either a price for each step of this job that can
    be redone, or one flat price for any revision. The node applies it; the
    builder only refuses a policy it could not apply."""
    slug = job["slug"]
    r = job["revisions"]
    if not isinstance(r, dict):
        fail(f"job {slug}: revisions must be an object with included and either steps or flat")
    for k in r:
        if k not in ("included", "steps", "flat"):
            fail(f"job {slug}: revisions carries {k!r}, which is not included, steps or flat")
    inc = r.get("included")
    if not (isinstance(inc, dict) and set(inc) == {"count", "window_days"}
            and is_count(inc["count"], 0) and is_count(inc["window_days"], 1)):
        fail(f"job {slug}: revisions.included needs an integer count of 0 or more and an integer window_days of 1 or more")
    if ("steps" in r) == ("flat" in r):
        fail(f"job {slug}: revisions carries either steps, a price per step, or flat, one price for any revision; not both and not neither")
    if "flat" in r:
        if not is_price(r["flat"]):
            fail(f"job {slug}: revisions.flat is a price: an integer amount_micro of 0 or more and a currency")
        return r
    steps = r["steps"]
    own = job.get("steps") or []
    if not (isinstance(steps, list) and steps):
        fail(f"job {slug}: revisions.steps must be a non-empty list of {{id, price}}")
    seen = set()
    for st in steps:
        if not (isinstance(st, dict) and isinstance(st.get("id"), str)):
            fail(f"job {slug}: each revisions step needs an id and a price; bad: {st}")
        if st["id"] not in own:
            fail(f"job {slug}: revisions step {st['id']!r} is not a step of this job")
        if st["id"] in seen:
            fail(f"job {slug}: revisions step {st['id']!r} is priced twice")
        seen.add(st["id"])
        if not is_price(st.get("price")):
            fail(f"job {slug}: revisions step {st['id']!r} needs a price: an integer amount_micro of 0 or more and a currency")
    return r


TRIAL_WHO = ("anyone", "signed_in", "verified")
TRIAL_COUNTS = ("per_requester_per_day", "per_day", "per_requester_ever")
TRIAL_LIMIT_KEYS = ("max_chars", "max_bytes", "max_pages", "max_seconds", "max_items")


def trial_problem(t, job):
    """Why a job's `trial` (Common Agent 7.7) is not acceptable, or None. The
    rules and their order are validateTrial's in sdk-typescript/src/trial.ts,
    checked against conformance/trial.json by test_build.py, so the builder,
    the spec checker and the registry refuse the same declarations. A trial
    with no count is refused: nothing would bound it."""
    whole = lambda v: isinstance(v, int) and not isinstance(v, bool) and v >= 0  # noqa: E731
    if not isinstance(t, dict):
        return "trial must be an object with who, limits and, optionally, shape."
    if not (isinstance(t.get("who"), str) and t["who"] in TRIAL_WHO):
        return f"trial.who must be one of {', '.join(TRIAL_WHO)}."
    limits = t.get("limits")
    if not isinstance(limits, dict):
        return "trial.limits is required: a trial with no count is not bounded."
    for k in TRIAL_COUNTS:
        if k in limits and not whole(limits[k]):
            return f"trial.limits.{k} must be a whole number of trial tasks."
    for k in limits:
        if k not in TRIAL_COUNTS:
            return f"trial.limits.{k} is not a count this specification defines; limits are counts, never money."
    if not any(k in limits for k in TRIAL_COUNTS):
        return ("trial.limits must carry at least one of per_requester_per_day, per_day and per_requester_ever: "
                "a trial with no count is not bounded.")
    if "shape" not in t:
        return None
    shape = t["shape"]
    if not isinstance(shape, dict):
        return "trial.shape must be an object."
    names = lambda side: {e.get("name") for e in (job.get(side) or []) if isinstance(e, dict)}  # noqa: E731
    if "inputs" in shape:
        if not isinstance(shape["inputs"], list):
            return "trial.shape.inputs must be a list."
        for e in shape["inputs"]:
            if not (isinstance(e, dict) and isinstance(e.get("name"), str) and e["name"]):
                return "each trial.shape.inputs entry needs the name of a declared input."
            n = e["name"]
            if n not in names("inputs"):
                return f'trial.shape.inputs names "{n}", which the offering does not declare.'
            if not isinstance(e.get("limit"), dict):
                return f'trial.shape.inputs "{n}" needs a limit.'
            for k, v in e["limit"].items():
                if k not in TRIAL_LIMIT_KEYS:
                    return f'trial.shape.inputs "{n}" limit {k} is not one of {", ".join(TRIAL_LIMIT_KEYS)}.'
                if not whole(v) or v == 0:
                    return f'trial.shape.inputs "{n}" limit {k} must be a whole number above zero.'
            if not e["limit"]:
                return f'trial.shape.inputs "{n}" names no limit.'
    if "omits" in shape:
        om = shape["omits"]
        if not (isinstance(om, list) and all(isinstance(n, str) and n for n in om)):
            return "trial.shape.omits must be a list of output names."
        for n in om:
            if n not in names("outputs"):
                return f'trial.shape.omits names "{n}", which the offering does not declare as an output.'
    for k in ("live_seconds", "keeps_days"):
        if k in shape and not whole(shape[k]):
            return f"trial.shape.{k} must be a whole number."
    if "marked" in shape and not isinstance(shape["marked"], bool):
        return "trial.shape.marked must be true or false."
    return None


TRIAL_CEILING_MEMBERS = ("amount_micro", "currency", "per", "per_1k_tokens_micro")


SCOPE_ID_RE = re.compile(r"^[A-Za-z0-9:._-]{1,64}$")


def scopes_declaration(j):
    """The permissions an offered job may act with for a person at a business
    (Common Agent 7.8, PACT 5.2; BRIDGE-A2A.md 14.8): a list of {id,
    description}. The ids are the business's own; the description is shown to
    the person word for word on the consent page, so it is a plain sentence
    and never empty. Carried on the offering in the descriptor, where the A2A
    gateway reads a Brand's scopes from."""
    v = j.get("scopes")
    if not (isinstance(v, list) and v):
        fail(f"job {j['slug']}: scopes is a non-empty list of {{id, description}}, the permissions a person can grant")
    seen = set()
    out = []
    for s in v:
        if not (isinstance(s, dict) and set(s) <= {"id", "description"}):
            fail(f"job {j['slug']}: each scope is {{id, description}} and nothing else")
        sid, desc = s.get("id"), s.get("description")
        if not (isinstance(sid, str) and SCOPE_ID_RE.match(sid)):
            fail(f"job {j['slug']}: scope id {sid!r} is 1 to 64 letters, digits, colons, dots, underscores or hyphens")
        if not (isinstance(desc, str) and desc.strip()):
            fail(f"job {j['slug']}: scope {sid}: description is the sentence a person reads before allowing it")
        if sid in seen:
            fail(f"job {j['slug']}: scope {sid} is listed twice")
        seen.add(sid)
        out.append({"id": sid, "description": desc.strip()})
    return out


def trial_declarations(spec, jobs):
    """Every job's trial checked, the spec's trial_ceiling checked, and the
    ceiling returned for the install file (None when no job offers a trial).

    A trial sits on an offered job only: a step is never ordered on its own,
    so nobody could ask to try it. And a trial with no suggested ceiling is
    refused, for the reason the deploy queue refuses any ceiling without a
    number (tools/will-it-install.mjs): the publisher pays for every trial out
    of the allowance's trial scope, an install with no number there either
    spends nothing and refuses every trial on funds, or waits in the queue for
    a person to type one. The money is never in the descriptor (7.7: a
    counterparty needs only the counts); it goes to the host side."""
    can_order = set(offered_slugs(jobs))
    tried = []
    for j in jobs:
        if "trial" not in j:
            continue
        if j["slug"] not in can_order:
            fail(f"job {j['slug']}: a trial belongs to an offered job; a step is never ordered on its own, so nobody can try it")
        why = trial_problem(j["trial"], j)
        if why:
            fail(f"job {j['slug']}: {why}")
        tried.append(j["slug"])
    sr = spec.get("samples_ref")
    if sr is not None and not isinstance(sr, bool):
        fail(f"samples_ref is true or false: true has the deploy name the platform's samples address for this agent; bad: {sr!r}")
    tc = spec.get("trial_ceiling")
    if tc is None:
        if tried:
            fail(f"job {tried[0]} offers a trial and the spec suggests no trial_ceiling. The publisher pays for every trial out of "
                 "the allowance's trial scope, and an install with no number there refuses every trial on funds or waits in "
                 "the queue for a person to type one; say what a day of trials may cost: "
                 '"trial_ceiling": {"amount_micro": 5000000, "currency": "USD", "per": "day"}')
        return None
    if not tried:
        fail("trial_ceiling is set and no job offers a trial; a ceiling nothing spends against is a number nobody reads")
    if not isinstance(tc, dict):
        fail("trial_ceiling is an object: amount_micro, currency and per day")
    for k in tc:
        if k not in TRIAL_CEILING_MEMBERS:
            fail(f"trial_ceiling carries {k!r}; it carries {', '.join(TRIAL_CEILING_MEMBERS)}")
    if not (is_count(tc.get("amount_micro"), 1) and isinstance(tc.get("currency"), str)
            and re.match(r"^[A-Z]{3}$", tc["currency"]) and tc.get("per") == "day"):
        fail("trial_ceiling is what a UTC day of trials may cost: a whole amount_micro above zero, a three-letter "
             'currency and per "day"; no floating point touches money')
    if "per_1k_tokens_micro" in tc and not is_count(tc["per_1k_tokens_micro"], 0):
        fail("trial_ceiling.per_1k_tokens_micro is the suggested cost model, whole micro-units per thousand tokens")
    return {k: tc[k] for k in TRIAL_CEILING_MEMBERS if k in tc}


# A schema is named by an absolute https URI, and the version is part of the
# URI. Anything else is an address that can be edited under every declaration
# that ever pointed at it.
SCHEMA_URI_RE = re.compile(r"^https://[a-z0-9][a-z0-9.-]*(?::\d+)?/\S+$", re.I)
CAN_USE_MEMBERS = ("schema", "reads", "required", "does", "without")


def can_use_declaration(spec):
    """What a caller may send with a job that this agent will actually read
    (descriptor-spec 3.4): a published shape by schema, and the fields of it
    this agent honors.

    Two things are refused rather than described. A schema that is not an
    absolute https URI is an address nobody else can resolve, or one that can
    be edited under every declaration pointing at it; the version belongs in
    the URI for the same reason. And an entry with no fields is the claim this
    member exists to make impossible: "reads brand profiles" is the same
    sentence from an agent that honors one color and one that honors all of
    them, so an entry without the field list has said nothing a buyer can act
    on."""
    if "can_use" not in spec:
        return None
    entries = spec["can_use"]
    if not isinstance(entries, list):
        fail("can_use is a list of the shapes a caller may send with a job; each names a schema and the "
             "fields of it this agent reads")
    if not entries:
        # An empty list is a statement (Common Agent 6.14.4, proposed): the
        # agent reads no standing asset, where an absent member says nothing.
        return []
    seen = set()
    out_entries = []
    for e in entries:
        if not isinstance(e, dict):
            fail(f"each can_use entry is an object with schema and reads; bad: {e}")
        for k in e:
            if k not in CAN_USE_MEMBERS:
                fail(f"can_use entry has no member {k!r}; it carries {', '.join(CAN_USE_MEMBERS)}")
        schema = e.get("schema")
        if not (isinstance(schema, str) and SCHEMA_URI_RE.match(schema.strip())):
            fail(f"can_use schema {schema!r} must be an absolute https URI naming a published shape, with "
                 f"the version in the URI: https://schemas.example/brand/v1")
        schema = schema.strip()
        if schema in seen:
            fail(f"can_use names schema {schema} twice; one entry per shape, with every field it reads")
        seen.add(schema)
        reads = e.get("reads")
        if not (isinstance(reads, list) and reads and all(isinstance(f, str) and f.strip() for f in reads)):
            fail(f"can_use entry {schema}: reads is a non-empty list of field paths, the fields this agent "
                 f"honors. Naming a shape and no fields says nothing a buyer can act on")
        reads = [f.strip() for f in reads]
        if len(set(reads)) != len(reads):
            fail(f"can_use entry {schema}: a field is listed twice in reads")
        entry = {"schema": schema, "reads": reads}
        if "required" in e:
            if not isinstance(e["required"], bool):
                fail(f"can_use entry {schema}: required is true or false; bad: {e['required']!r}")
            entry["required"] = e["required"]
        if "does" in e:
            if not (isinstance(e["does"], str) and e["does"].strip()):
                fail(f"can_use entry {schema}: does is one sentence on what those fields change about the "
                     f"result")
            entry["does"] = e["does"].strip()
        # What the agent does when none is given. Its absence is a finding of
        # the standing-asset rules (apply_standing_rules), by the cut-over,
        # not a refusal here; a value that is there must be a sentence.
        if "without" in e:
            if not (isinstance(e["without"], str) and e["without"].strip()):
                fail(f"can_use entry {schema}: without is one sentence on what the agent does when none is given")
            entry["without"] = e["without"].strip()
        out_entries.append(entry)
    return out_entries


RUN_CONFIG_MEMBERS = ("settings", "tested_models", "named", "replay")
RUN_CONFIG_SETTING_MEMBERS = ("name", "kind", "default", "allowed", "label", "about", "value_labels", "range",
                              "multiple", "min", "max", "step", "job_may_set", "does")
#: The members of a setting's `range` (Common Agent 6.13.4, proposed).
RANGE_MEMBERS = ("min", "max", "step")
RUN_CONFIG_KINDS = ("preference", "rule")
RUN_CONFIG_NAMED_MEMBERS = ("name", "settings", "does", "digest")


def jcs(value):
    """The JCS (RFC 8785) canonical JSON of a value: keys sorted, no spaces,
    strings as JSON writes them, and a number as JavaScript writes it (an
    integral number with no fraction). Enough for a run config, whose values
    are words, whole numbers, yes or no, and lists and objects of them."""
    if isinstance(value, bool) or value is None:
        return json.dumps(value)
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        if value != value or value in (float("inf"), float("-inf")):
            fail("a run config value may not be NaN or infinite")
        return str(int(value)) if value.is_integer() and abs(value) < 1e21 else repr(value)
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, list):
        return "[" + ",".join(jcs(v) for v in value) + "]"
    if isinstance(value, dict):
        return "{" + ",".join(json.dumps(k, ensure_ascii=False) + ":" + jcs(value[k]) for k in sorted(value)) + "}"
    fail(f"a run config value must be JSON; bad: {value!r}")


def run_config_digest(entry):
    """`sha256:` and the hex SHA-256 of an entry's JCS form without `digest`
    (Common Agent 5.8; docs/run-config-plan.md 3.2 decision 1)."""
    body = {k: v for k, v in entry.items() if k != "digest"}
    return "sha256:" + hashlib.sha256(jcs(body).encode("utf-8")).hexdigest()


def run_config_declaration(spec):
    """What a run config may set for this agent (docs/run-config-plan.md 2.2,
    owner 2026-10-07): the settings its author declares, each a preference
    (the closest layer wins) or a rule (the tightest layer wins), with its
    default, the values allowed, and whether a sender who does not own the
    agent may set it per job; the models it was tested on; and its named run
    configs. Carried into the descriptor as declared, because the platform
    resolves and refuses a run config from the registered descriptor and
    nothing else, and only a setting declared here can ever be set.

    Refused rather than carried: a setting with no name or a kind that is
    neither, a default outside its own allowed list, a name declared twice,
    and a named run config that sets a setting nobody declared or a value the
    setting does not allow, because the platform would refuse that run config
    the first time anybody chose it."""
    if "run_config" not in spec:
        return None
    rc = spec["run_config"]
    if not isinstance(rc, dict):
        fail("run_config is an object with settings, and optionally tested_models and named")
    for k in rc:
        if k not in RUN_CONFIG_MEMBERS:
            fail(f"run_config has no member {k!r}; it carries {', '.join(RUN_CONFIG_MEMBERS)}")
    settings = rc.get("settings")
    if not isinstance(settings, list):
        fail("run_config.settings is a list of the settings a run config may set (an empty list says none may)")
    out_settings = []
    declared = {}
    for s in settings:
        if not isinstance(s, dict):
            fail(f"each run_config setting is an object with name, kind, default and job_may_set; bad: {s}")
        for k in s:
            if k not in RUN_CONFIG_SETTING_MEMBERS:
                fail(f"run_config setting has no member {k!r}; it carries {', '.join(RUN_CONFIG_SETTING_MEMBERS)}")
        name = s.get("name")
        if not (isinstance(name, str) and name.strip()):
            fail(f"each run_config setting has a name; bad: {s}")
        name = name.strip()
        if name in declared:
            fail(f"run_config declares the setting {name} twice")
        if s.get("kind") not in RUN_CONFIG_KINDS:
            fail(f"run_config setting {name}: kind is preference (the closest layer wins) or rule (the tightest "
                 f"layer wins); bad: {s.get('kind')!r}")
        if "default" not in s:
            fail(f"run_config setting {name}: a default is required, the value used when no layer sets it")
        if not isinstance(s.get("job_may_set"), bool):
            fail(f"run_config setting {name}: job_may_set is true or false, whether a sender who does not own "
                 f"the agent may set it per job")
        entry = {"name": name, "kind": s["kind"], "default": s["default"]}
        # `multiple` (6.13.4): the value is a list of several allowed values.
        if "multiple" in s and not isinstance(s["multiple"], bool):
            fail(f"run_config setting {name}: multiple is true or false, whether its value is a list of several allowed values")
        many = s.get("multiple") is True
        if many and "allowed" not in s:
            fail(f"run_config setting {name}: multiple picks several of its allowed values, and the setting has none")
        if "allowed" in s:
            allowed = s["allowed"]
            if not (isinstance(allowed, list) and allowed):
                fail(f"run_config setting {name}: allowed is a non-empty list of the values it may take; leave it "
                     f"out when any value goes")
            if many:
                if not (isinstance(s["default"], list) and all(v in allowed for v in s["default"])):
                    fail(f"run_config setting {name}: multiple is true, so the default is a list of its allowed values")
            elif s["default"] not in allowed:
                fail(f"run_config setting {name}: the default {s['default']!r} is not in its own allowed list")
            entry["allowed"] = allowed
        if "multiple" in s:
            entry["multiple"] = s["multiple"]
        # What a person sees for the setting (Common Agent 6.13, proposed):
        # its label, a sentence about it, a label for each allowed value, and
        # for a number its range. Carried as declared; whether a setting says
        # all it should is the option rules' question (apply_option_rules).
        for k in ("label", "about"):
            if k in s:
                if not (isinstance(s[k], str) and s[k].strip()):
                    fail(f"run_config setting {name}: {k} is a short text for a person")
                entry[k] = s[k].strip()
        if "value_labels" in s:
            vl = s["value_labels"]
            if not (isinstance(vl, dict) and vl and all(isinstance(v, str) and v.strip() for v in vl.values())):
                fail(f"run_config setting {name}: value_labels maps each allowed value to a label for a person")
            if "allowed" not in s:
                fail(f"run_config setting {name}: value_labels labels the allowed values, and the setting has none")
            keys = {str(a) for a in s["allowed"]}
            for k in vl:
                if k not in keys:
                    fail(f"run_config setting {name}: value_labels names {k!r}, which is not an allowed value")
            entry["value_labels"] = {k: v.strip() for k, v in vl.items()}
        # A number's range (6.13.4): `range: {min, max, step}`. The members
        # min, max and step written on the setting itself are the older
        # spelling, still read and carried as written, with a warning.
        flat = [k for k in RANGE_MEMBERS if k in s]
        if "range" in s and flat:
            fail(f"run_config setting {name}: says its range twice; write range: {{min, max, step}} and not {', '.join(flat)} beside it")
        if "range" in s:
            rg = s["range"]
            if not (isinstance(rg, dict) and rg and all(k in RANGE_MEMBERS for k in rg)):
                fail(f"run_config setting {name}: range is an object of min, max and step")
            where, bounds = entry.setdefault("range", {}), rg
        else:
            if flat:
                warn(f"run_config setting {name}: min, max and step on the setting are the older spelling; "
                     f"write range: {{min, max, step}} (Common Agent 6.13.4)")
            where, bounds = entry, {k: s[k] for k in flat}
        for k, v in bounds.items():
            if isinstance(v, bool) or not isinstance(v, (int, float)):
                fail(f"run_config setting {name}: {k} is a number")
            where[k] = v
        if "step" in bounds and not bounds["step"] > 0:
            fail(f"run_config setting {name}: step is more than zero")
        if "min" in bounds and "max" in bounds and bounds["min"] > bounds["max"]:
            fail(f"run_config setting {name}: min is more than max")
        if bounds:
            d = s["default"]
            if isinstance(d, bool) or not isinstance(d, (int, float)):
                fail(f"run_config setting {name}: a range is for a number, and the default is not one")
            if ("min" in bounds and d < bounds["min"]) or ("max" in bounds and d > bounds["max"]):
                fail(f"run_config setting {name}: the default {d!r} is outside its own range")
        entry["job_may_set"] = s["job_may_set"]
        if "does" in s:
            if not (isinstance(s["does"], str) and s["does"].strip()):
                fail(f"run_config setting {name}: does is one sentence on what the setting changes")
            entry["does"] = s["does"].strip()
        declared[name] = entry
        out_settings.append(entry)
    out = {"settings": out_settings}
    if "tested_models" in rc:
        tm = rc["tested_models"]
        if not (isinstance(tm, list) and all(isinstance(m, str) and m.strip() for m in tm)):
            fail("run_config.tested_models is a list of model names, each a non-empty string")
        out["tested_models"] = [m.strip() for m in tm]
    if "named" in rc:
        named = rc["named"]
        if not isinstance(named, list):
            fail("run_config.named is a list of named run configs, each with a name and settings")
        seen = set()
        out_named = []
        for n in named:
            if not isinstance(n, dict):
                fail(f"each named run config is an object with name and settings; bad: {n}")
            for k in n:
                if k not in RUN_CONFIG_NAMED_MEMBERS:
                    fail(f"named run config has no member {k!r}; it carries {', '.join(RUN_CONFIG_NAMED_MEMBERS)}")
            nm = n.get("name")
            if not (isinstance(nm, str) and nm.strip()):
                fail(f"each named run config has a name; bad: {n}")
            nm = nm.strip()
            if nm in seen:
                fail(f"run_config names the run config {nm!r} twice")
            seen.add(nm)
            vals = n.get("settings")
            if not isinstance(vals, dict):
                fail(f"named run config {nm!r}: settings is an object of setting name to value")
            for k, v in vals.items():
                if k not in declared:
                    fail(f"named run config {nm!r} sets {k}, which this agent does not declare in run_config.settings")
                if "allowed" in declared[k]:
                    ok = (isinstance(v, list) and all(x in declared[k]["allowed"] for x in v)) \
                        if declared[k].get("multiple") is True else v in declared[k]["allowed"]
                    if not ok:
                        fail(f"named run config {nm!r} sets {k} to {v!r}, which is not in its allowed list")
            e = {"name": nm, "settings": vals}
            if "does" in n:
                if not (isinstance(n["does"], str) and n["does"].strip()):
                    fail(f"named run config {nm!r}: does is one sentence on what it is for")
                e["does"] = n["does"].strip()
            # Its digest over the entry as carried, without digest: written
            # in when the spec leaves it out, refused when the spec's is wrong.
            want = run_config_digest(e)
            if "digest" in n and n["digest"] != want:
                fail(f"named run config {nm!r}: its digest {n['digest']!r} is not the SHA-256 of its JCS form "
                     f"without digest, {want}")
            e["digest"] = want
            out_named.append(e)
        out["named"] = out_named
    # Whether the agent can replay a saved job's step without calling a model
    # (Common Agent 0.24.0-draft 6.2 `replay`; docs/run-config-plan.md phase 2
    # item 5): carried only as true, since absent already means it cannot.
    if "replay" in rc:
        if not isinstance(rc["replay"], bool):
            fail("run_config.replay is true when the agent can replay a saved job's step without calling a model, "
                 "or false; leave it out when it cannot")
        if rc["replay"]:
            out["replay"] = True
    return out



# ---- The format rules (owner, 2026-10-27) ----
#
# What an agent takes and hands on is declared with a kind, and two things
# went wrong with kinds across the platform's agents: about 180 pieces were
# declared as bare application/json, which says nothing about what is inside,
# and 59 pieces were declared as one thing and sent as another, or sent and
# never declared at all (the JSON inventory of 2026-10-27). The spec writer
# now writes specific kinds; these are the checks that hold a package to
# them, here where every package is made.
#
#   1. An input or output whose kind is bare application/json. A JSON piece is
#      declared by what it is, application/vnd.agentmesh.<name>+json or another
#      registered +json type; content a person reads, or one agent hands to
#      another, is text/markdown with a convention.
#   2. A piece the scripts deliver that the spec does not declare, where the
#      build can see one: a literal piece entry ({name, ..., media_type}) in a
#      job's pieces script, and the entries of a pieces.json at the top of the
#      agent's folder or named by PIECES (paths separated by the path
#      separator or a comma). A pieces.json deeper in the folder (a test's
#      fixture, a leftover out/) is not the agent's delivery and is not read.
#   3. A literal model name in a job's scripts or skills (gemini-2.5-flash,
#      claude-sonnet-4-5, gpt-4o and the like). A model is a bound system,
#      text-reasoning with access trigger: the script reads which model from
#      configuration (AGENT_MODEL or TEXT_MODEL, through the shared caller),
#      so the install and a run config choose it, and a model that is retired
#      is a setting changed and not a package rebuilt. Brand reader shipped
#      with gemini-2.5-flash written into a script, and it answered 404 when
#      that model went. Comment lines are not read.
#
# THE CUT-OVER. All three are findings, and what a finding does depends on whether
# the agent is new. An agent released before FORMAT_CUTOVER is EXISTING: its
# findings are warnings, said on stderr and carried in the result, and the
# package is built as before. Any other agent is NEW and its findings refuse
# the package. Existing means the spec's name is in FORMAT_EXISTING_NAMES (the
# agents released when the rule came in; the list is never added to), or the
# caller says so with FORMAT_EXISTING=1, which the pack procedure sets when
# this builder released the name before the rule existed (an earlier build
# record written before FORMAT_CUTOVER that carries no format_rules member). FORMAT_EXISTING=0 treats a
# listed name as new. To turn the warnings into refusals once the existing
# agents are fixed, remove each fixed name from the list, or set
# FORMAT_EXISTING_MODE to "refuse" to do it for all of them at once.
FORMAT_CUTOVER = "2026-10-27"
FORMAT_EXISTING_MODE = "warn"
FORMAT_EXISTING_NAMES = frozenset("""
    agentbuilder agentevaluator animation-renderer animation-writer announcer
    audio-video-transcriber brand-reader brief-writer catalog channel-maker code-writer
    conformance-checker converter copywriter deck-importer deployment-manager deploymgr
    digest-writer document-reader documenter evaluator explainer-critic explainer-maker
    facilitator fact-checker fact-writer help hn-reader incident-recorder lens-writer
    linkedin-skills meme-writer menu-reader models narration open-calls package-maker
    pitch-writer planner ponder-planner posting-reader practice presence-publisher
    presentation-reader prettier process-runner publisher quiz-maker rank-checker
    repo-architect repo-converter repo-reader repo-scanner ride-maker room-manager
    scene-writer script-writer self-check-writer shop-desk site-auditor site-reader
    slot-mapper solstice solution-planner source-reader spec-writer store-reader
    story-editor story-ranker test-writer timeline-researcher tone-teller transform
    video-watcher web-analytics web-searcher x-reader yt-dlp
""".split())
FORMAT_MODES = ("warn", "refuse")
# Who gives an input (Common Agent 6.13, proposed in common-agent-standards
# #113, optional): a person, another agent, or either.
GIVEN_BY = ("person", "agent", "either")
#: Who starts an offering (Common Agent 6.13.2, proposed): a person from a
#: page, other agents as a step of a larger job, or both.
STARTED_BY = ("person", "agent")
#: How an offering is used once started (6.13.2): a turn-by-turn exchange or a job.
WORKS_AS = ("conversation", "job")
#: How a person views or gives an input or output (6.13.5).
PRESENTATIONS = ("quiz", "document", "facts", "table", "media", "audio", "package")
DIGEST_RE = re.compile(r"^sha256:[0-9a-f]{64}$")


def example_declaration(j):
    """An offering's `example` (Common Agent 6.13.8, proposed): the sample
    inputs a person or a tester can run it with, and one sentence on what a
    good result looks like. `inputs` maps a declared input's name to a
    string, as a person would type it, or to a file: one the package carries,
    `{file, digest, media_type, name}`, or one at a public address,
    `{url, media_type, digest, name}`. Returned as authored, once its shape
    is right."""
    ex = j["example"]
    where = f"job {j['slug']}: example"
    if not isinstance(ex, dict) or set(ex) - {"inputs", "good_result"}:
        fail(f"{where} is {{inputs, good_result}}: the sample inputs and one sentence on what a good result looks like")
    good = ex.get("good_result")
    if not (isinstance(good, str) and good.strip() and len(good.strip().splitlines()) == 1 and len(good.strip()) <= 300):
        fail(f"{where}.good_result is one sentence of at most 300 characters on what a good result looks like")
    ins = ex.get("inputs")
    if not (isinstance(ins, dict) and ins):
        fail(f"{where}.inputs names at least one input and the value to give it")
    declared = [e.get("name") for e in (j.get("inputs") or []) if isinstance(e, dict)]
    for name, v in ins.items():
        if declared and name not in declared:
            fail(f"{where}.inputs names {name!r}, which is not one of this job's inputs ({', '.join(declared)})")
        if isinstance(v, str) and v.strip():
            continue
        if not isinstance(v, dict) or set(v) - {"file", "digest", "url", "media_type", "name"} or not (v.get("file") or v.get("url")):
            fail(f"{where}.inputs.{name} is a string as a person would type it, or a file: in the package as {{file, digest, media_type, name}}, or at a public address as {{url, media_type, digest, name}}")
        if v.get("file") is not None:
            f = v["file"]
            if not (isinstance(f, str) and f.strip() and not f.startswith("/") and "\\" not in f and ".." not in f.split("/") and "://" not in f):
                fail(f"{where}.inputs.{name}.file is a path in the package, relative, with forward slashes and no .. segment")
            if not v.get("digest"):
                fail(f"{where}.inputs.{name} names a file in the package and needs its digest")
        if v.get("digest") is not None and not (isinstance(v["digest"], str) and DIGEST_RE.match(v["digest"])):
            fail(f"{where}.inputs.{name}.digest is sha256: and 64 lowercase hex characters")
        if v.get("url") is not None and not (isinstance(v["url"], str) and re.match(r"^https://[^\s]+$", v["url"])):
            fail(f"{where}.inputs.{name}.url is a public https address")
        if v.get("media_type") is not None and not (isinstance(v["media_type"], str) and MEDIA_RE.match(v["media_type"])):
            fail(f"{where}.inputs.{name}.media_type is a media type")
        if v.get("name") is not None and not (isinstance(v["name"], str) and v["name"].strip()):
            fail(f"{where}.inputs.{name}.name is the file's name")
    return {"inputs": ins, "good_result": good.strip()}


def person_members(spec):
    """The members a person reads (Common Agent 6.13.1 and 6.13.3, proposed):
    the agent's display `name`, a one-sentence `summary` of at most 200
    characters, and `will_not`, the things it will not do in words a person
    deciding whether to use it can act on. Carried as authored, after their
    shape is checked; none is derived, because each is the operator's own
    statement and a guessed one would be a claim nobody made."""
    out = {}
    if "display_name" in spec:
        n = spec["display_name"]
        if not (isinstance(n, str) and n.strip() and len(n.strip()) <= 60 and "\n" not in n):
            fail("name is the agent's display name for a person, a few words on one line (at most 60 characters)")
        out["name"] = n.strip()
    if "summary" in spec:
        sm = spec["summary"]
        if not (isinstance(sm, str) and sm.strip() and len(sm.strip()) <= 200 and "\n" not in sm):
            fail("summary is one plain sentence for a person, at most 200 characters")
        out["summary"] = sm.strip()
    if "will_not" in spec:
        wn = spec["will_not"]
        if not (isinstance(wn, list) and wn and all(isinstance(w, str) and w.strip() for w in wn)):
            fail("will_not is a non-empty list of sentences, each one thing the agent will not do")
        out["will_not"] = [w.strip() for w in wn]
    return out


BARE_JSON = "application/json"


def is_bare_json(kind):
    return isinstance(kind, str) and kind.split(";")[0].strip().lower() == BARE_JSON


def format_existing(name):
    """Whether this agent was released before the format rules, and so is
    warned rather than refused. The caller's word wins when it gives one."""
    said = os.environ.get("FORMAT_EXISTING", "").strip().lower()
    if said in ("1", "true", "yes"):
        return True
    if said in ("0", "false", "no"):
        return False
    return name in FORMAT_EXISTING_NAMES


def format_mode(existing):
    return FORMAT_EXISTING_MODE if existing else "refuse"


# A literal piece entry in a pieces script: an object carrying a quoted name
# and a media_type, in either order, with no braces inside it. A name built at
# run time (a template string) is not seen, which is what "where the checks
# can see that" means.
PIECE_ENTRY_RES = (
    re.compile(r"\{[^{}]*?[\"']?\bname[\"']?\s*:\s*([\"'])([^\"'`$\\\n]+?)\1[^{}]*?[\"']?\bmedia_type[\"']?\s*:[^{}]*\}"),
    re.compile(r"\{[^{}]*?[\"']?\bmedia_type[\"']?\s*:[^{}]*?[\"']?\bname[\"']?\s*:\s*([\"'])([^\"'`$\\\n]+?)\1[^{}]*\}"),
)


def piece_list_names(jobs, src_base):
    """(piece name, where it was seen) for every literal piece entry in a job's
    pieces script (scripts/pieces*.mjs or .js)."""
    seen = []
    for j in jobs:
        for rel in j.get("scripts") or []:
            base = os.path.basename(str(rel))
            if not (base.startswith("pieces") and base.endswith((".mjs", ".js"))):
                continue
            p = os.path.normpath(os.path.join(src_base, rel))
            try:
                text = open(p, encoding="utf-8").read()
            except OSError:
                continue
            for rx in PIECE_ENTRY_RES:
                for m in rx.finditer(text):
                    seen.append((m.group(2).strip(), str(rel).replace(os.sep, "/")))
    return seen


def pieces_json_names(src_base):
    """(piece name, where) for every entry of the pieces.json at the top of
    the agent's folder, and of each file PIECES names. Only the top: a
    pieces.json deeper down is a fixture, an input from another agent or a
    leftover, and reading it would refuse a new agent for a piece it never
    delivers."""
    paths = [p.strip() for p in re.split("[" + re.escape(os.pathsep) + ",]", os.environ.get("PIECES", "")) if p.strip()]
    if src_base and os.path.isfile(os.path.join(src_base, "pieces.json")):
        paths.append(os.path.join(src_base, "pieces.json"))
    seen = []
    for p in paths:
        try:
            entries = json.load(open(p, encoding="utf-8"))
        except Exception:  # noqa: BLE001
            continue
        if isinstance(entries, dict):
            entries = entries.get("pieces") or []
        try:
            where = os.path.relpath(p, src_base) if src_base else p
        except ValueError:
            where = p
        for e in entries if isinstance(entries, list) else []:
            if isinstance(e, dict) and isinstance(e.get("name"), str) and e["name"].strip():
                seen.append((e["name"].strip(), where.replace(os.sep, "/")))
    return seen


def is_declared_piece(piece, declared):
    """A delivered piece is declared when an output has its name, or when it
    is one of several files filed under one output as "<output> (<file>)"."""
    p = piece.strip().lower()
    for d in declared:
        d = d.strip().lower()
        if p == d or p.startswith(d + " ("):
            return True
    return False


# A model named by its own name: the families the platform's agents have
# called, with a version or a size after the family. A provider prefix
# (google-vertex-anthropic/, openai/) is read with it.
MODEL_NAME_RE = re.compile(
    r"(?<![\w-])(?:[a-z][a-z0-9-]*[/.])*("
    r"gemini-(?:\d[\w.-]*|pro\b[\w.-]*|flash\b[\w.-]*|ultra\b[\w.-]*|embedding-[\w.-]+)"
    r"|gemma-?\d[\w.-]*"
    r"|(?:chat)?gpt-(?:\d(?![\w.]*-(?:encoder|tokens?|tokenizer)\b)[\w.-]*|4o[\w.-]*|oss[\w.-]*)"
    r"|text-embedding-(?:\d|ada)[\w.-]*"
    r"|claude-(?:opus|sonnet|haiku|instant|\d)[\w.:-]*"
    r"|o[134]-(?:mini|preview|pro)[\w.-]*"
    r"|llama-?\d[\w.-]*"
    r"|mistral-(?:large|medium|small|tiny)[\w.-]*"
    r"|command-r(?:-plus)?(?:-\d[\w.-]*)?(?![\w-])"
    r"|deepseek-(?:r\d|v\d|chat|coder|reasoner)[\w.-]*"
    r"|qwen-?\d[\w.-]*"
    r"|grok-\d[\w.-]*"
    # Named in words, as a person writes it in a SKILL.md or a spec.
    r"|gemini \d(?:\.\d+)?(?: (?:pro|flash|ultra)\b(?:[ -]lite)?)?"
    r"|claude (?:opus|sonnet|haiku) \d(?:\.\d+)?"
    r"|gpt (?:4o|\d(?:\.\d+)?)\b"
    r")", re.I)
# Comment lines, by the language of the file: // and /* and a * continuation
# in JavaScript (not #, which starts a private field there), # in Python and
# shell (not **, which unpacks in Python).
COMMENT_LINE_RES = {
    "js": re.compile(r"^\s*(//|/\*|\*/|\*(\s|$))"),
    "hash": re.compile(r"^\s*#(?!\{)"),
}


def model_names_in(text, markdown=False, lang="js"):
    """(model, line number) for every model named in a file's text, comment
    lines left out (a script's comments, by its language; nothing is left out
    of a SKILL.md, which is read whole by a harness)."""
    out = []
    comment = None if markdown else COMMENT_LINE_RES.get(lang)
    for n, line in enumerate(str(text).splitlines(), 1):
        if comment and comment.match(line):
            continue
        for m in MODEL_NAME_RE.finditer(line):
            out.append((m.group(1).rstrip(".:-"), n))
    return out


SCRIPT_LANGS = {".mjs": "js", ".js": "js", ".cjs": "js", ".ts": "js", ".py": "hash", ".sh": "hash"}


def model_findings(jobs, src_base, authored=None):
    """A sentence for every literal model name in what a job ships: its
    scripts (a folder named under scripts is read whole), every script and
    SKILL.md already inside an agent folder's own skill, and for a spec the
    instructions and the sentences the builder writes into its SKILL.md."""
    found = []
    told = set()

    def say(where, hits):
        for model, n in hits:
            if (where, model.lower()) in told:
                continue
            told.add((where, model.lower()))
            found.append(f"{where} names the model {model!r} (line {n}). A model is a bound system, text-reasoning "
                         f"with access trigger: read it from AGENT_MODEL or TEXT_MODEL through the shared caller so the "
                         f"install and a run config choose it, and say in the spec the capability the job needs "
                         f"(text, vision, long context), never a model")

    def read_file(path, where):
        ext = os.path.splitext(path)[1].lower()
        if ext not in SCRIPT_LANGS and ext != ".md":
            return
        try:
            text = open(path, encoding="utf-8").read()
        except (OSError, UnicodeDecodeError):
            return
        say(where, model_names_in(text, markdown=(ext == ".md"), lang=SCRIPT_LANGS.get(ext, "js")))

    def read_tree(path, where):
        if os.path.isdir(path):
            for root, dirs, files in os.walk(path):
                dirs[:] = [d for d in dirs if d not in ("node_modules", ".git")]
                for f in sorted(files):
                    p = os.path.join(root, f)
                    read_file(p, (where.rstrip("/") + "/" + os.path.relpath(p, path)).replace(os.sep, "/"))
        else:
            read_file(path, where)

    for j in jobs:
        for rel in j.get("scripts") or []:
            read_tree(os.path.normpath(os.path.join(src_base, rel)), str(rel).replace(os.sep, "/"))
        if authored and j["slug"] in (authored.get("skills") or {}):
            # Everything the folder's own skill carries ships as it is.
            read_tree(authored["skills"][j["slug"]], f"skills/{j['slug']}")
            continue
        ins = j.get("instructions")
        if isinstance(ins, dict) and ins.get("file"):
            read_file(os.path.normpath(os.path.join(src_base, ins["file"])), str(ins["file"]).replace(os.sep, "/"))
        text = "\n".join(str(j.get(k)) for k in ("when", "good", "empty", "does") if isinstance(j.get(k), str))
        if isinstance(ins, str):
            text = ins + "\n" + text
        if text.strip():
            say(f"skills/{j['slug']}/SKILL.md", model_names_in(text, markdown=True))
    return found

def format_findings(jobs, src_base, authored=None):
    """Every finding of the three rules, as sentences."""
    found = []
    for j in jobs:
        for side, word in (("inputs", "input"), ("outputs", "output")):
            for e in j.get(side) or []:
                if isinstance(e, dict) and is_bare_json(e.get("kind")):
                    found.append(
                        f"job {j['slug']}: {word} {e.get('name')!r} is declared bare application/json. Say what it is: "
                        f"text/markdown with a convention when a person reads it or one agent hands it to another, "
                        f"or a specific JSON kind such as application/vnd.agentmesh.<name>+json for exact typed data "
                        f"only code reads")
    declared = [e["name"] for j in jobs for e in (j.get("outputs") or [])
                if isinstance(e, dict) and isinstance(e.get("name"), str)]
    told = set()
    for piece, where in piece_list_names(jobs, src_base) + pieces_json_names(src_base):
        if is_declared_piece(piece, declared) or (piece.lower(), where) in told:
            continue
        told.add((piece.lower(), where))
        found.append(f"{where} delivers a piece {piece!r} that no job declares as an output; declare it, with its kind, "
                     f"or stop delivering it")
    return found + model_findings(jobs, src_base, authored)


def apply_format_rules(name, jobs, src_base, authored=None):
    """Warn or refuse on the format findings, by the cut-over, and return what
    the result and the build record carry about it."""
    existing = format_existing(name)
    mode = format_mode(existing)
    if mode not in FORMAT_MODES:
        fail(f"FORMAT_EXISTING_MODE is warn or refuse; bad: {mode!r}")
    found = format_findings(jobs, src_base, authored)
    if found and mode == "refuse":
        why = (f"it is a new agent, and the format rules refuse a new agent's findings since {FORMAT_CUTOVER}"
               if not existing else "the format rules now refuse an existing agent's findings too")
        fail(f"{name} is refused on its formats and models, because {why}: " + "; ".join(found)
             + ". An agent released before the cut-over is warned instead; FORMAT_EXISTING=1 says so for one this builder does not list")
    for f in found:
        warn(f"{'model' if ' names the model ' in f else 'format'}: {f}")
    return {"existing": existing, "mode": mode, "since": FORMAT_CUTOVER, "findings": found}


# ── standing assets ───────────────────────────────────────────────────────
#
# Standing assets are the organization's shared material many agents read: a
# brand profile, a style guide, a glossary, media templates. An agent declares
# each kind it reads as a can_use entry. Since STANDING_CUTOVER the builder
# holds every package to three rules, the audit checklist's can-use-known-schema,
# can-use-without and person-facing-declares-library:
#
#   1. Every can_use entry names a schema on the list of known standing-asset
#      kinds, standards/standing-asset-schemas.json at the top of the adlc
#      repository. A schema nobody publishes is a shape an organization cannot
#      keep, approve or hand over.
#   2. Every can_use entry says `without`: what the agent does when none is
#      given. Most jobs run without the organization's brand at hand.
#   3. A new agent whose offered jobs hand a person something to read, watch
#      or hear (text/markdown, text/html, an image, video or audio) and that
#      declares no can_use is WARNED, unless its architecture record says why
#      none apply. The record is read from architecture-record.md at the top of
#      the agent's folder, or the file ARCHITECTURE_RECORD names; it says why
#      when its header says `standing_assets: none` and its "## Standing assets"
#      section gives the reason.
#
# The cut-over is the format rules' own: rules 1 and 2 refuse a new agent and
# warn for an existing one (format_existing, FORMAT_EXISTING_NAMES and
# FORMAT_EXISTING), and FORMAT_EXISTING_MODE = "refuse" refuses both. Rule 3
# is a warning only, and only for a new agent.
#
# The list is read at the version this builder pins, STANDING_SCHEMAS_PIN, the
# sha256 of its bytes. On a fleet host it sits beside this file as
# agentbuilder-standing-asset-schemas.json; in the repository it is read from
# standards/. A list whose bytes are not the pinned version is not read: rule
# 1 is not run, the build is warned and the result says so under not_checked,
# because a changed list is adopted on purpose, by re-pinning here and
# releasing. With no list at all, rule 1 is not run either, and the result
# says so.
STANDING_CUTOVER = "2026-10-28"
STANDING_SCHEMAS_PIN = "sha256:c4b89a0b7a10d82a9788f5072a5805149372f818ba866566a622d3c01ead3328"
STANDING_SCHEMAS_FILES = (os.path.join(HERE, "agentbuilder-standing-asset-schemas.json"),
                          os.path.join(HERE, "standing-asset-schemas.json"),
                          os.path.join(HERE, "..", "..", "standards", "standing-asset-schemas.json"))
STANDING_LEVELS = {"can-use-known-schema": "refuse", "can-use-without": "refuse", "person-facing-declares-library": "warn"}


def standing_schemas():
    """The list of known standing-asset kinds at the pinned version, its
    digest, and why it was not read: (table, digest, None), or (None, digest
    or None, reason) when it is not beside this builder, is not the pinned
    version, or is not JSON."""
    path = next((p for p in STANDING_SCHEMAS_FILES if os.path.isfile(p)), None)
    if not path:
        return None, None, "the standing-asset schema list is not beside this builder"
    data = open(path, "rb").read()
    digest = "sha256:" + hashlib.sha256(data).hexdigest()
    if digest != STANDING_SCHEMAS_PIN:
        why = (f"the standing-asset schema list at {path} is {digest}, not the version this builder pins "
               f"({STANDING_SCHEMAS_PIN}); re-pin STANDING_SCHEMAS_PIN in build.py to adopt it")
        warn(f"standing assets: {why}")
        return None, digest, why
    try:
        return json.loads(data.decode("utf-8")), digest, None
    except ValueError:
        warn(f"standing assets: the standing-asset schema list at {path} is not JSON")
        return None, digest, f"the standing-asset schema list at {path} is not JSON"


def kind_matches(kind, pattern):
    k = str(kind or "").split(";")[0].strip().lower()
    p = str(pattern or "").strip().lower()
    return k.startswith(p[:-1]) if p.endswith("/*") else k == p


def person_facing_outputs(jobs, table):
    """(job, output name, kind) for every output of an offered job that a person
    reads, watches or hears."""
    kinds = (table or {}).get("person_facing_kinds") or ["text/markdown", "text/html", "image/*", "video/*", "audio/*"]
    offered = set(offered_slugs(jobs))
    out = []
    for j in jobs:
        if j["slug"] not in offered:
            continue
        for o in j.get("outputs") or []:
            if isinstance(o, dict) and any(kind_matches(o.get("kind"), p) for p in kinds)                     and not any((n, k) == (o.get("name"), o.get("kind")) for _, n, k in out):
                out.append((j["slug"], o.get("name"), o.get("kind")))
    return out


def record_says_none(src_base):
    """The reason a person gave, in the architecture record, for declaring no
    standing asset, or None. Only a person's own reason counts ("the person
    said none apply"): a record that says no output is read by a person was
    written from its formats, and an agent whose jobs hand a person something
    shows that record was wrong, which is what the warning is for."""
    paths = [p for p in (os.environ.get("ARCHITECTURE_RECORD", "").strip(),
                         os.path.join(src_base, "architecture-record.md") if src_base else "") if p]
    for p in paths:
        try:
            text = open(p, encoding="utf-8").read()
        except OSError:
            continue
        head = re.match(r"^﻿?---\r?\n([\s\S]*?)\r?\n---", text)
        if not head or not re.search(r"^standing_assets:\s*none\s*$", head.group(1), re.M):
            continue
        sec = re.search(r"^## Standing assets\s*\n([\s\S]*?)(?=^## |\Z)", text, re.M)
        why = re.search(r"None, because (.+)", sec.group(1)) if sec else None
        if why and why.group(1).strip().startswith("the person said none apply"):
            return why.group(1).strip().rstrip(".")
    return None


def standing_findings(spec, jobs, src_base, table):
    """(findings, warnings) of the standing-asset rules, as sentences: the
    findings are rules 1 and 2, the warnings rule 3 (checked only by the
    caller, for a new agent)."""
    findings = []
    known = {s.get("schema") for s in (table or {}).get("schemas") or [] if isinstance(s, dict)}
    entries = spec.get("can_use") if isinstance(spec.get("can_use"), list) else []
    for e in entries:
        if not isinstance(e, dict):
            continue
        schema = str(e.get("schema") or "").strip()
        if table is not None and schema not in known:
            findings.append(f"can_use names {schema}, which is not a known kind of standing asset; use one from "
                            f"standards/standing-asset-schemas.json ({', '.join(sorted(known))}), or add the kind "
                            f"to that list first")
        if not (isinstance(e.get("without"), str) and e["without"].strip()):
            findings.append(f"can_use {schema} does not say without: what the agent does when none is given. Say it "
                            f"in one sentence, such as \"writes in a plain, neutral voice and says that none was given\"")
    warnings = []
    # An empty can_use is the operator's statement that the agent reads no
    # standing asset (Common Agent 6.14.4), so rule 3 has nothing to ask.
    if not entries and not isinstance(spec.get("can_use"), list):
        facing = person_facing_outputs(jobs, table)
        if facing:
            said = ", ".join(f"{n!r} ({k})" for _, n, k in facing)
            warnings.append(f"the agent hands a person {said} and declares no can_use: say which of the organization's "
                            f"standing assets it reads (a brand profile for what a person sees, a style guide for what "
                            f"a person reads, media templates for film and sound), or let the architecture record say "
                            f"why none apply")
    return findings, warnings


# ── options and settings ──────────────────────────────────────────────────
#
# Two more design-time rules, the audit checklist's options-are-settings and
# settings-declared-fully, with the format rules' cut-over (refuse a new
# agent, warn an existing one):
#
#   options-are-settings. An input is the material the job is about. One that
#   only shapes how the job runs (a voice, a tone, a length, a style, a format
#   choice) is a run-config setting with a label, a default and its allowed
#   values, and brand or palette material is a can_use standing asset. Read
#   from the offered jobs' input names (and their about), so a person's page
#   draws a choice and not a free-text box. Explainer maker declared Voice,
#   "How it sounds", Target length and Palette as inputs.
#   settings-declared-fully. Every run-config setting has a label, an about
#   and a default; allowed whenever its value has a natural set of choices
#   (its name says voice, tone, length, format and the like, or it is a
#   rule); a label for each allowed value; and range {min, max, step} for a
#   number (the older min, max and step on the setting are still read).
OPTION_RULES_CUTOVER = "2026-10-28"
OPTION_WORDS = re.compile(r"\b(voice|tone|sounds?|style|length|word[ -]?count|format|duration|pace|speed|level|"
                          r"mode|size|register|formality|persona)\b", re.I)
LIBRARY_WORDS = re.compile(r"\b(brand|palette|colou?rs?|logo|fonts?|typefaces?|style[ -]guide|glossary)\b", re.I)
VALUE_INPUT_KINDS = ("text", "identifier")
OPTION_LEVELS = {"options-are-settings": "refuse", "settings-declared-fully": "refuse"}


def words_of(name):
    return re.sub(r"[-_]+", " ", str(name or ""))


def option_findings(spec, jobs):
    """Sentences, each starting with its check id, for inputs that are
    options or library material, and settings that do not say all they
    should."""
    found = []
    offered = set(offered_slugs(jobs))
    for j in jobs:
        if j["slug"] not in offered:
            continue
        for i in j.get("inputs") or []:
            if not isinstance(i, dict):
                continue
            n = words_of(i.get("name"))
            kind = str(i.get("kind") or "")
            # A name is read only on an input of a plain value kind: one
            # declared with a media type or vendor kind of its own (a brand
            # site's read, a PDF) already says it is material the job is about.
            plain = kind in VALUE_INPUT_KINDS or kind == BARE_JSON
            if LIBRARY_WORDS.search(n) and plain:
                found.append(f"options-are-settings: job {j['slug']}: input {i.get('name')!r} is brand or library material; "
                             f"declare it as a can_use standing asset (a brand profile, a style guide, media templates) "
                             f"with what the agent does without it, not as an input")
            elif OPTION_WORDS.search(n) and kind in VALUE_INPUT_KINDS:
                found.append(f"options-are-settings: job {j['slug']}: input {i.get('name')!r} only shapes how the job runs; "
                             f"declare it as a run_config setting with a label, an about, a default and its allowed values, "
                             f"so a page draws a choice and not a free-text box. Inputs are the material the job is about")
    rc = spec.get("run_config") if isinstance(spec.get("run_config"), dict) else {}
    for st in rc.get("settings") or []:
        if not isinstance(st, dict):
            continue
        nm = st.get("name")
        missing = [k for k in ("label", "about") if not (isinstance(st.get(k), str) and st[k].strip())]
        if "default" not in st:
            missing.append("default")
        d = st.get("default")
        numeric = isinstance(d, (int, float)) and not isinstance(d, bool)
        if "allowed" not in st and not numeric and (st.get("kind") == "rule" or OPTION_WORDS.search(words_of(nm))):
            missing.append("allowed (its natural set of choices)")
        if "allowed" in st:
            labelled = st.get("value_labels") if isinstance(st.get("value_labels"), dict) else {}
            unlabelled = [a for a in st.get("allowed") or [] if str(a) not in labelled]
            if unlabelled:
                missing.append("value_labels for " + ", ".join(repr(a) for a in unlabelled))
        if numeric and "allowed" not in st:
            rg = st.get("range") if isinstance(st.get("range"), dict) else st
            missing += [f"range.{k}" for k in RANGE_MEMBERS if k not in rg]
        if missing:
            found.append(f"settings-declared-fully: run_config setting {nm!r} does not declare {', '.join(missing)}; every "
                         f"option gets a label, an about, a default and its choices, decided at design time")
    return found


def apply_option_rules(name, spec, jobs):
    """Warn or refuse on options-are-settings and settings-declared-fully, by
    the format rules' cut-over, and return what the result and the build
    record carry about them."""
    existing = format_existing(name)
    mode = format_mode(existing)
    found = option_findings(spec, jobs)
    if found and mode == "refuse":
        why = (f"it is a new agent, and the option rules refuse a new agent's findings since {OPTION_RULES_CUTOVER}"
               if not existing else "the option rules now refuse an existing agent's findings too")
        fail(f"{name} is refused on its inputs and settings, because {why}: " + "; ".join(found)
             + ". An agent released before the cut-over is warned instead; FORMAT_EXISTING=1 says so for one this builder does not list")
    for f in found:
        warn(f"options: {f}")
    return {"existing": existing, "mode": mode, "since": OPTION_RULES_CUTOVER, "findings": found,
            "levels": dict(OPTION_LEVELS)}


def apply_standing_rules(name, spec, jobs, src_base):
    """Warn or refuse on the standing-asset rules, by the cut-over, and return
    what the result and the build record carry about it."""
    table, digest, unread = standing_schemas()
    existing = format_existing(name)
    mode = format_mode(existing)
    found, facing = standing_findings(spec, jobs, src_base, table)
    if found and mode == "refuse":
        why = (f"it is a new agent, and the standing-asset rules refuse a new agent's findings since {STANDING_CUTOVER}"
               if not existing else "the standing-asset rules now refuse an existing agent's findings too")
        fail(f"{name} is refused on its standing assets, because {why}: " + "; ".join(found)
             + ". An agent released before the cut-over is warned instead; FORMAT_EXISTING=1 says so for one this builder does not list")
    for f in found:
        warn(f"standing assets: {f}")
    warnings = []
    none_because = None
    if facing and not existing:
        none_because = record_says_none(src_base)
        if none_because is None:
            warnings = facing
            for w in warnings:
                warn(f"standing assets: {w}")
    out = {"existing": existing, "mode": mode, "since": STANDING_CUTOVER, "findings": found, "warnings": warnings,
           "schemas_digest": digest, "levels": dict(STANDING_LEVELS)}
    if table is None:
        out["not_checked"] = [f"can-use-known-schema: {unread}"]
    if none_because:
        out["none_because"] = none_because
    return out


def draft_descriptor(spec, jobs, systems, refuses, escalates, records):
    """The draft Agent Descriptor (descriptor-spec §3.1): the builder's
    statement of what it built, with no subject, because the agent does not
    exist yet. The deployer binds it at deploy. Only what the spec actually
    said goes in: an offering with no declared inputs simply has none, which
    a reader must treat as not stated, never as "takes anything".

    Two members here are PROPOSED additions to the descriptor
    (docs/agent-package-draft.md §3.2): `records`, the obligation the
    descriptor had no home for, and `escalates`, what always goes to a
    person. A consumer that does not know them ignores them, which the
    descriptor's own rule requires."""
    def project(j):
        """One job as the descriptor carries it: id, name, what it does, and
        what goes in and comes out. The same shape for an offering and for a
        step under it."""
        o = {"id": j["slug"], "name": j["title"]}
        if isinstance(j.get("does"), str) and j["does"].strip():
            o["does"] = j["does"].strip()
        for side in ("inputs", "outputs"):
            v = j.get(side)
            if v is None:
                continue
            if not (isinstance(v, list) and all(
                    isinstance(e, dict) and isinstance(e.get("name"), str) and isinstance(e.get("kind"), str)
                    for e in v)):
                fail(f"job {j['slug']}: each of {side} needs at least a name and a kind")
            for e in v:
                if not (MEDIA_RE.match(e["kind"]) or e["kind"] in VALUE_KINDS):
                    fail(f"job {j['slug']}: {side} kind {e['kind']!r} is neither a media type nor one of {VALUE_KINDS}")
                if side == "outputs" and e.get("when") not in (None, *WHEN):
                    fail(f"job {j['slug']}: output when must be one of {WHEN}")
                if side == "inputs" and "given_by" in e and e["given_by"] not in GIVEN_BY:
                    fail(f"job {j['slug']}: input {e['name']!r} given_by is who gives it, one of {', '.join(GIVEN_BY)}; bad: {e['given_by']!r}")
                if side == "outputs" and "given_by" in e:
                    fail(f"job {j['slug']}: output {e['name']!r} carries given_by, which says who gives an input")
                if "presentation" in e and e["presentation"] not in PRESENTATIONS:
                    fail(f"job {j['slug']}: {side[:-1]} {e['name']!r} presentation is how a person meets it, one of {', '.join(PRESENTATIONS)}; bad: {e['presentation']!r}")
                # `accepts` on a document input lists the media types it reads
                # (6.13.7). Older packages carry their own `accepts` on other
                # inputs, which this rule leaves alone.
                if side == "inputs" and e["kind"] == "document" and "accepts" in e:
                    acc = e["accepts"]
                    if not (isinstance(acc, list) and acc and all(isinstance(m, str) and MEDIA_RE.match(m) for m in acc)):
                        fail(f"job {j['slug']}: input {e['name']!r} accepts is a non-empty list of media types")
            o[side] = v
        # How this one is actually done, when the spec says (12.3). A caller
        # is entitled to know whether the step it is buying is a fixed program
        # or a model improvising, so it travels on the offering and on each
        # step, not only in the builder's own checks.
        if "how" in j:
            o["how"] = how_declaration(j)
        # Requests in words the job takes (Common Agent 4.7.1): the standard
        # reply to input an agent cannot use quotes the first as its example.
        ex = j.get("examples")
        if ex is not None:
            if not (isinstance(ex, list) and ex and all(isinstance(e, str) and e.strip() for e in ex)):
                fail(f"job {j['slug']}: examples is a list of requests in words, each a non-empty string")
            o["examples"] = [e.strip() for e in ex][:5]
        return o

    # Every job is checked; only the offered ones become offerings. A job is
    # what a caller orders (offered) or what the agent runs to deliver it (a
    # step, listed under the offering in order). Until one job says
    # `offered`, every job is offered, which is what every package before
    # this member meant.
    by_slug = {j["slug"]: j for j in jobs}
    projected = {j["slug"]: project(j) for j in jobs}
    can_order = set(offered_slugs(jobs))
    offerings = []
    for j in jobs:
        offered = j["slug"] in can_order
        if "revisions" in j and not offered:
            fail(f"job {j['slug']}: revisions belong to an offered job; a step is not revised on its own")
        for k in ("started_by", "works_as", "example"):
            if k in j and not offered:
                fail(f"job {j['slug']}: {k} belongs to an offered job; a step is started by the offering it is part of")
        if "scopes" in j and not offered:
            fail(f"job {j['slug']}: scopes belong to an offered job; a person grants them to what a caller orders")
        if not offered:
            continue
        o = dict(projected[j["slug"]])
        if j.get("steps"):
            o["steps"] = [dict(projected[s]) for s in j["steps"]]
        if "revisions" in j:
            o["revisions"] = revisions_policy(j)
        # Who starts it and how it is used (Common Agent 6.13.2, proposed).
        if "started_by" in j:
            sb = j["started_by"]
            if not (isinstance(sb, list) and sb and all(x in STARTED_BY for x in sb) and len(set(sb)) == len(sb)):
                fail(f"job {j['slug']}: started_by lists who starts it, from {', '.join(STARTED_BY)}; bad: {sb!r}")
            o["started_by"] = list(sb)
        if "works_as" in j:
            if j["works_as"] not in WORKS_AS:
                fail(f"job {j['slug']}: works_as is one of {', '.join(WORKS_AS)}; bad: {j['works_as']!r}")
            o["works_as"] = j["works_as"]
        # The sample inputs it can be run with, and what a good result looks
        # like (Common Agent 6.13, proposed): what a page offers to fill the
        # form with, and what a usability tester runs.
        if "example" in j:
            o["example"] = example_declaration(j)
        # The trial as declared (7.7), checked in trial_declarations before
        # any file was written; the counts travel, the money does not.
        if "trial" in j:
            o["trial"] = j["trial"]
        # The permissions a person can grant this offering at a business
        # (PACT Delegated), as the spec declares them.
        if "scopes" in j:
            o["scopes"] = scopes_declaration(j)
        offerings.append(o)
    if not offerings:
        fail("no job is offered; at least one job must be what a caller orders")
    doc = {
        "format": "agent-descriptor-v1",
        "agent_version": str(spec.get("version", "1.0.0")),
        **person_members(spec),
        "does": spec["description"].strip(),
        "offerings": offerings,
        # Prose, one sentence per line: the descriptor asks for the operator's
        # own words, and one refusal per line is what lets an evaluator turn
        # each into a probe without guessing at sentence boundaries.
        "refusals": "\n".join(sentence(r) for r in refuses),
    }
    if escalates:
        doc["escalates"] = [sentence(e) for e in escalates]
    doc["records"] = records
    # The spec's `kind` (what the inside is made of) is never written into the
    # draft: Common Agent 0.28.0-draft removed `shape` from the Descriptor
    # (6.12), and whether code or a model decides is `decided_by` on each
    # refusal and limit. The builder still reads `kind` to route a container
    # agent (container_spec), and a deployment record MAY say what was
    # installed (8.3).
    if systems:
        doc["systems"] = [{"name": s["name"], "access": s["access"],
                           **({"needs": s["needs"].strip()} if s.get("needs") else {}),
                           **({"leaves": True} if s.get("leaves") is True else {})} for s in systems]
    # What a caller may send with a job and this agent will read: carried
    # through as declared, because a schema and its field list are the
    # operator's statement and there is nothing here to derive.
    can_use = can_use_declaration(spec)
    if can_use is not None:
        doc["can_use"] = can_use
    # What a run config may set for this agent (docs/run-config-plan.md 2.2):
    # carried as declared, for the platform's resolver to read.
    run_config = run_config_declaration(spec)
    if run_config is not None:
        doc["run_config"] = run_config
    return doc


def ceiling_side(entry, package="?"):
    """Which side applies this system's ceiling, derived from how the package
    reaches the system and never written into the spec. A system the scripts
    call themselves, with the credential the install file names, is capped by
    the runtime that makes the call or by nobody. A system reached through
    something that is not the agent is capped by that party. With nothing to
    derive it from the build stops: a wrong word here reads to a buyer as
    somebody watching the spend."""
    if entry.get("credential"):
        return "runtime"
    # A model system is called by the scripts themselves, through the shared
    # caller, so its ceiling is applied by the runtime that makes the call.
    if entry.get("kind") == "model":
        return "runtime"
    if entry.get("kind") == "mcp":
        return "platform"
    fail(f"system {system_name(entry)}: cannot tell which side applies its ceiling. A spending service the "
         f"scripts call needs the credential they read and the variable they read it from; a system reached "
         f"through something that is not the agent is kind mcp. Package {package!r}")


#: What an agent's inside is made of (Common Agent 9.5.1). A closed set: a
#: harness answering as itself, a harness reading a package, code that answers
#: on the network with no harness, or somebody else's runtime owning the loop.
#: Not to be confused with KINDS, which is what a SYSTEM is bound to.
AGENT_KINDS = ("bare-harness", "plugin-on-harness", "mesh-coded", "third-party-framework")


def agent_kind(spec):
    """The spec's `kind`, checked against the four values and otherwise left
    out. Absent means not stated, which is what a reader computing the kind
    from a deployment record wants: a default typed here would be a claim
    nobody made."""
    k = spec.get("kind")
    if k is None:
        return
    if k not in AGENT_KINDS:
        fail(f"kind is what this agent's inside is made of, one of {', '.join(AGENT_KINDS)}; bad: {k!r}")


#: The two kinds whose code lives in its own repository folder with its own
#: Dockerfile (docs/container-agents-plan.md). The lifecycle installs them as
#: they are; this builder checks their spec and makes no package of them.
CONTAINER_KINDS = ("mesh-coded", "third-party-framework")
CONTAINER_MEMBERS = ("repository", "path", "commit", "dockerfile", "placement", "holds_own_key",
                     "settings", "secrets", "port", "cpu", "memory", "ready_line", "framework", "language")


def container_spec(spec, name, version, jobs):
    """A container agent's spec, checked, with no package made.

    Its code is somebody else's program in its own repository, in any
    language, and it holds its own key and its own connection. So a job names
    no scripts, references or assets (there is nothing here to copy), and the
    spec says instead where the code is: the repository, the folder, the
    commit and the Dockerfile, how it runs, what it reads from its
    environment, and the roles it claims. Refused in words like everything
    else here; returns the checked facts the answer carries."""
    for j in jobs:
        for k in ("scripts", "references", "assets", "lockfile", "run", "instructions"):
            if j.get(k):
                fail(f"job {j['slug']}: a {spec.get('kind')} agent's code lives in its own repository, so a job names no {k}")
    if spec.get("verify"):
        fail("a container agent is checked by the role it claims, after its install, and names no verify script")
    c = spec.get("container")
    if not isinstance(c, dict):
        fail("a container agent's spec carries a container block: the repository, the folder, the commit and the Dockerfile")
    extra = sorted(k for k in c if k not in CONTAINER_MEMBERS)
    if extra:
        fail(f"container: {', '.join(extra)} is not something a container block says")
    repo = str(c.get("repository", "")).rstrip("/")
    if repo.endswith(".git"):
        repo = repo[:-4]
    if not re.match(r"^https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", repo):
        fail("container.repository is a public GitHub repository address, https://github.com/<owner>/<name>")
    path = str(c.get("path", "")).strip("/")
    if path and (not re.match(r"^[A-Za-z0-9_.-]+(/[A-Za-z0-9_.-]+)*$", path) or ".." in path.split("/")):
        fail("container.path is a folder inside the repository")
    commit = str(c.get("commit", "")).lower()
    if not re.match(r"^[0-9a-f]{40}$", commit):
        fail("container.commit is the full 40-character commit the spec describes; a branch moves and a spec must not")
    dockerfile = str(c.get("dockerfile") or "Dockerfile")
    if not re.match(r"^[A-Za-z0-9_.-]+(/[A-Za-z0-9_.-]+)*$", dockerfile) or ".." in dockerfile.split("/"):
        fail("container.dockerfile is a file inside the folder")
    if c.get("placement", "service") != "service":
        fail("container.placement is service: the lifecycle installs a container agent as an always-on service, and a per-message job for one is not built")
    if c.get("holds_own_key") is not True:
        fail("container.holds_own_key is true: an always-on service holds its own key and its own connection, and a container that does not speak the mesh is not an agent this lifecycle installs")
    for side in ("settings", "secrets"):
        for e in c.get(side) or []:
            if not (isinstance(e, dict) and ENV_RE.match(str(e.get("env", ""))) and str(e.get("purpose", "")).strip()):
                fail(f"container.{side}: each entry names the variable (env) and says what it is for (purpose); bad: {e}")
            if side == "secrets" and "value" in e:
                fail(f"container.secrets: {e['env']} carries a value; a secret is named by the credential it is stored under, at the deploy")
            if side == "secrets" and e.get("credential") is not None and not CREDENTIAL_RE.match(str(e["credential"])):
                fail(f"container.secrets: {e['env']} names a credential that is not a name")
    port = c.get("port")
    if port is not None and not (isinstance(port, int) and not isinstance(port, bool) and 1 <= port <= 65535):
        fail("container.port is a port number")
    if c.get("cpu") is not None and not re.match(r"^(0\.[1-9]|[1-4])$", str(c["cpu"])):
        fail("container.cpu is 0.1 to 0.9 or 1 to 4")
    if c.get("memory") is not None and not re.match(r"^([1-9][0-9]{2,3}Mi|[1-8]Gi)$", str(c["memory"])):
        fail("container.memory is like 512Mi or 1Gi")
    rl = c.get("ready_line")
    if rl is not None and not (isinstance(rl, str) and 0 < len(rl) <= 120 and not re.search(r'["\\\n]', rl)):
        fail("container.ready_line is one short line the program logs once it is listening, with no quotes")
    claims = spec.get("claims") or []
    if not (isinstance(claims, list) and all(isinstance(r, str) and re.match(r"^[a-z][a-z0-9-]{1,62}$", r) for r in claims)):
        fail("claims is a list of role ids, such as ring-member")
    return {
        "ok": True, "act": "checked", "name": name, "version": version, "kind": spec["kind"],
        "packed": False,
        "why": (f"a {spec['kind']} agent is not packed: its code lives in {repo}"
                f"{'/' + path if path else ''} at {commit[:12]}, and the deployment manager builds that "
                f"folder's own Dockerfile in the cloud and installs it as it is"),
        "container": {"repository": repo, "path": path, "commit": commit, "dockerfile": dockerfile,
                      **{k: c[k] for k in ("placement", "holds_own_key", "port", "cpu", "memory", "ready_line", "framework", "language") if k in c},
                      "settings": [e["env"] for e in c.get("settings") or []],
                      "secrets": [e["env"] for e in c.get("secrets") or []]},
        "claims": claims,
        "jobs": [j["slug"] for j in jobs],
    }


def where_it_is_read(spec):
    """The three manifest members that name where a READER goes: the license
    this package is under, the page about it, and the repository its source is
    kept in (Common Agent 12.6 rule 3, 0.17.0-draft). Nothing at install or at
    run fetches any of them, which is why they are excepted from the rule that
    keeps addresses out of a package."""
    for k in ("homepage", "repository"):
        v = spec.get(k)
        if v is None:
            continue
        if not (isinstance(v, str) and re.match(r"^https://[^\s]+$", v)):
            where = "a reader reads about this agent" if k == "homepage" else "its source is kept"
            fail(f"{k} is the https address where {where}; bad: {v!r}")
    lic = spec.get("license")
    if lic is not None and not (isinstance(lic, str) and lic.strip()):
        fail("license names the license this package is under, such as Apache-2.0")
    fallback = os.environ.get("DEFAULT_LICENSE", "").strip()
    if lic is None and fallback:
        # The license a workspace publishes under, when the spec names none.
        #
        # A license is the owner's statement about the whole of what they
        # publish, so a workspace that decided once should not have to say it
        # again in every spec, and nobody should be hand-editing a spec to put
        # it there. A spec that names its own license always wins, because an
        # agent may be published under different terms from its neighbours.
        # Absent on both sides stays absent, which means nobody may copy the
        # package, which is the honest reading of saying nothing.
        spec["license"] = fallback
    # The other two members that reach the manifest. The manifest check at the
    # end refuses an address in either of them too; refusing here as well means
    # a spec refused for one leaves no half-built package behind, which is the
    # rule every other shape check in this builder follows.
    addr = re.compile(r"[a-z][a-z0-9+.\-]*://")
    if addr.search(spec.get("description") or ""):
        fail("description carries an address; the members that may are homepage and repository, and who built this is in the build record")
    author = spec.get("author")
    if author is not None:
        if not isinstance(author, dict) or any(k not in ("name", "email") for k in author):
            fail("author is the builder's name and email; an author page is an address and stays out of a package")
        if any(addr.search(str(v)) for v in author.values()):
            fail("author carries an address; an author page is not one of the addresses a package may carry")


def lineage(spec):
    """`from`: the packages this one descends from, nearest ancestor first
    (Common Agent 13.5). It is provenance and nothing else: nothing fetches an
    entry at build, install or run, and a consumer that reads one as a
    dependency has made a copy somebody else's again."""
    entries = spec.get("from")
    if entries is None:
        return None
    if not (isinstance(entries, list) and entries):
        fail("from lists the packages this one was copied from, nearest ancestor first, and is left out when there are none")
    known = ("name", "version", "repository", "commit", "license")
    out_entries = []
    for e in entries:
        if not isinstance(e, dict):
            fail(f"each from entry names a package's name, version, repository and commit; bad: {e}")
        for k in ("name", "version", "repository", "commit"):
            if not (isinstance(e.get(k), str) and e[k].strip()):
                fail(f"from entry {e.get('name', '?')!r} is missing {k}")
        if not re.match(r"^https://[^\s]+$", e["repository"]):
            fail(f"from entry {e['name']!r}: repository is the https address of the repository it was copied from; bad: {e['repository']!r}")
        extra = sorted(set(e) - set(known))
        if extra:
            fail(f"from entry {e['name']!r} carries {', '.join(extra)}, which a lineage entry does not have")
        out_entries.append({k: e[k] for k in known if k in e})
    return out_entries


def verify_script(spec, jobs):
    """The path inside the package of the delivery check, or None. Refuses a
    verify that does not name a job of this spec and one of that job's own
    scripts, so the check always ships with the package it checks."""
    verify = spec.get("verify")
    if verify is None:
        return None
    if not (isinstance(verify, dict) and isinstance(verify.get("job"), str) and isinstance(verify.get("script"), str)):
        fail(f"verify names a job and one of its scripts, {{\"job\": \"<slug>\", \"script\": \"scripts/x.mjs\"}}; bad: {verify!r}")
    vjob = next((j for j in jobs if j["slug"] == verify["job"]), None)
    if not vjob:
        fail(f"verify names job {verify['job']!r}, which is not a job of this spec")
    if verify["script"] not in (vjob.get("scripts") or []):
        fail(f"verify names {verify['script']!r}, which job {verify['job']} does not ship under scripts")
    return f"skills/{verify['job']}/{verify['script']}"


def install_file(spec, jobs, systems, lockfiles):
    """The host side (docs/agent-package-draft.md §3.3): what an installer
    must have and do. Names, never values."""
    runtimes = spec.get("runtimes", [])
    binaries = spec.get("binaries", [])
    for r in runtimes:
        if not (isinstance(r, dict) and isinstance(r.get("name"), str) and r["name"]):
            fail(f"each runtime needs a name; bad: {r}")
    for b in binaries:
        if not (isinstance(b, dict) and isinstance(b.get("name"), str) and b["name"]):
            fail(f"each binary needs a name; bad: {b}")
    sys_entries = []
    for s in systems:
        kind = s.get("kind", "directory")
        if kind not in KINDS:
            fail(f"system {s['name']}: kind must be one of {KINDS}")
        e = {"name": s["name"], "kind": kind}
        if kind == "model":
            # The model system (12.4.1): its entry names the formats the
            # scripts speak and no credential, variable or setting, because
            # the four settings (MODEL_NAME, MODEL_ENDPOINT, MODEL_KEY,
            # MODEL_PROTOCOL) have the same names in every agent and the
            # installer binds them without being told.
            if any(o.get("kind") == "model" for o in sys_entries):
                fail(f"system {s['name']}: an agent declares at most one system of kind model")
            protocols = s.get("protocols")
            if not (isinstance(protocols, list) and protocols and all(p in MODEL_PROTOCOLS for p in protocols)
                    and len(set(protocols)) == len(protocols)):
                fail(f"system {s['name']}: a model system names the formats its scripts speak under protocols, "
                     f"one or more of {', '.join(MODEL_PROTOCOLS)}; bad: {protocols!r}")
            for k in ("credential", "env", "settings"):
                if s.get(k) is not None:
                    fail(f"system {s['name']}: a model system takes no {k}; the installer places MODEL_NAME, "
                         f"MODEL_ENDPOINT, MODEL_KEY and MODEL_PROTOCOL for it")
            e["protocols"] = list(protocols)
        elif s.get("protocols") is not None:
            fail(f"system {s['name']}: only a system of kind model names protocols")
        if s.get("credential") is not None:
            if kind == "directory":
                fail(f"system {s['name']}: a directory takes no credential")
            if not (isinstance(s["credential"], str) and CREDENTIAL_RE.match(s["credential"])):
                fail(f"system {s['name']}: credential must be a NAME (lowercase, digits, . _ -), never a value")
            e["credential"] = s["credential"]
        if s.get("env") is not None:
            if not (isinstance(s["env"], str) and ENV_RE.match(s["env"])):
                fail(f"system {s['name']}: env must be a variable name like TTS_TOKEN")
            e["env"] = s["env"]
        if s.get("spends") is not None:
            sp = s["spends"]
            if not (isinstance(sp, dict) and isinstance(sp.get("unit"), str) and sp["unit"]):
                fail(f"system {s['name']}: spends needs a unit, e.g. {{\"unit\": \"characters\"}}")
            if kind not in ("service", "model"):
                fail(f"system {s['name']}: only a service or a model spends")
            e["spends"] = {"unit": sp["unit"]}
        if s.get("settings") is not None:
            # A non-secret value the scripts read and the host must supply
            # (a billing project, a region): named here by variable and
            # purpose, valued in the owner's install instruction.
            if kind == "directory":
                fail(f"system {s['name']}: a directory takes no settings")
            sts = s["settings"]
            if not (isinstance(sts, list) and sts and all(isinstance(st, dict) and isinstance(st.get("env"), str)
                                                          and ENV_RE.match(st["env"]) for st in sts)):
                fail(f"system {s['name']}: each setting names the variable the scripts read, e.g. {{\"env\": \"TTS_PROJECT\", \"purpose\": \"...\"}}")
            e["settings"] = [{"env": st["env"], **({"purpose": st["purpose"]} if st.get("purpose") else {})} for st in sts]
        sys_entries.append(e)
    spending = [e["name"] for e in sys_entries if "spends" in e]
    ceilings = spec.get("ceilings")
    if ceilings is None:
        ceilings = [{"system": r, "per": "task"} for r in spending]
    by_name = {e["name"]: e for e in sys_entries}
    priced = []
    for c in ceilings:
        if not (isinstance(c, dict) and c.get("system") in spending and c.get("per") in ("task", "day")):
            fail(f"each ceiling names a spending system and per task or day; bad: {c}")
        # A suggested number, in the system's unit, that an approver's form may
        # offer as the default. The owner's instruction still sets the number.
        if "suggested" in c and not (isinstance(c["suggested"], (int, float)) and not isinstance(c["suggested"], bool) and c["suggested"] > 0):
            fail(f"a ceiling's suggested value is a number above zero in the system's unit; bad: {c}")
        if "enforced_by" in c:
            fail(f"system {c['system']}: a ceiling's enforcing side is derived from how the package reaches the system, never written into the spec")
        side = ceiling_side(by_name[c["system"]], spec.get("name", "?"))
        priced.append({"system": c["system"], "per": c["per"], "enforced_by": side,
                       **({"suggested": c["suggested"]} if "suggested" in c else {})})
    ceilings = priced
    for r in spending:
        if not any(c["system"] == r for c in ceilings):
            fail(f"system {r} spends money and has no ceiling")
    # How long one job may take, in seconds. The attendant that runs the
    # harness caps each job; a package whose work takes longer than the
    # default four minutes has to say so, or every job is cut off. A host
    # fact for the installer, never a promise to a caller.
    job_seconds = spec.get("job_seconds")
    if job_seconds is not None and not (isinstance(job_seconds, int) and not isinstance(job_seconds, bool)
                                        and 60 <= job_seconds <= 7200):
        fail(f"job_seconds is the longest one job may take, a whole number of seconds from 60 to 7200; bad: {job_seconds!r}")
    # Whether the agent reads replies to work it sent. A worker never does:
    # its attendant acknowledges replies without answering, which is what
    # keeps two unattended agents from replying to each other forever. A
    # runner must, because the replies are the work coming back. A host fact.
    wants_replies = spec.get("wants_replies")
    if wants_replies is not None and not isinstance(wants_replies, bool):
        fail(f"wants_replies is true or false; bad: {wants_replies!r}")
    # WHICH FILED PIECE IS THE ANSWER.
    #
    # A package that files a deliverable and does not say which one answers the
    # sender leaves the host to decide at run time, and the only thing a host
    # has to decide with is what the work printed. For a command that is the
    # declared reply and it is fine. For a model it is a transcript of thinking:
    # on 2026-09-11 a critic filed a correct review and its sender received four
    # thousand bytes of the model narrating itself, with the review nowhere in
    # it, and every exit code was zero. Naming the piece here moves that
    # decision to the one party that knows the answer, at the time it is known.
    answer = spec.get("answer")
    if answer is not None and not (isinstance(answer, str) and SLUG_RE.match(answer)):
        fail(f"answer names one piece this agent files, as a lowercase-hyphen name; bad: {answer!r}")
    directories = spec.get("directories") or [
        {"name": "records", "purpose": "every record the descriptor names"},
        {"name": "work", "purpose": "inputs and drafts in progress"},
    ]
    for d in directories:
        if not (isinstance(d, dict) and isinstance(d.get("name"), str) and SLUG_RE.match(d["name"])):
            fail(f"each directory needs a lowercase-hyphen name; bad: {d}")
    # What the agent charges (§19.1). It lands in the INSTALL file rather than
    # the descriptor because of what has to happen with it: the installer
    # places a file the agent's node reads, and the node is what publishes the
    # price to callers, on the manifest and on the storefront. The descriptor
    # points at a price and does not restate one (common-agent-spec 6.2's
    # `price_ref`), so writing it into both would be the one authored spelling
    # rule broken for no gain, and the two copies would drift the first time
    # an operator re-priced a running agent.
    price = price_declaration(spec, jobs)
    runs = {j["slug"]: run_command(j) for j in jobs if "run" in j}
    # WHAT CHECKS A DELIVERY FROM OUTSIDE THE WORK. A job where the model is in
    # control can write any record it likes, including one that says it is
    # done: on 2026-09-14 a code writer wrote its own verdict, claimed 28 of 28
    # tests passed, and delivered no scripts. So a package may name a script
    # the HOST runs over the job folder before the reply is accepted, and the
    # supervisor refuses the delivery when it fails. It names a job and one of
    # that job's own scripts, so the check ships with the package it checks.
    verify_path = verify_script(spec, jobs)
    trial_ceiling = trial_declarations(spec, jobs)
    doc = {
        "format": RUNTIME_FORMAT,
        "runtimes": [{"name": r["name"], **({"version": r["version"]} if r.get("version") else {})} for r in runtimes],
        "binaries": [{"name": b["name"], **({"purpose": b["purpose"]} if b.get("purpose") else {})} for b in binaries],
        "dependencies": lockfiles,
        "systems": sys_entries,
        "ceilings": ceilings,
        "directories": directories,
        **({"job_seconds": job_seconds} if job_seconds is not None else {}),
        **({"wants_replies": True} if wants_replies is True else {}),
        # Which messages the host keeps in turn for this agent, beyond one
        # conversation at a time (runtime/fleet/supervisor.mjs, ONE AT A TIME
        # PER KEY). A host fact, copied as the spec wrote it.
        **({"one_at_a_time": one_at_a_time_declaration(spec)} if spec.get("one_at_a_time") is not None else {}),
        # The SKU as it will be placed, missing only its provider: no price
        # means no SKU means free, the default, and a package that says
        # nothing here installs and charges nothing.
        **({"price": price} if price else {}),
        # An object rather than a bare name so a package can later say where
        # its answer is without a second member beside this one.
        **({"answer": {"piece": answer}} if answer else {}),
        # The command the host runs for an offered job, when the job names
        # one. A host that has it runs it and does not wake a model to decide
        # whether to; the step is the same every time and cannot be improvised
        # into something else. Keyed by the job's slug, because an agent may
        # offer more than one and each has its own command.
        **({"run": runs} if runs else {}),
        **({"verify": verify_path} if verify_path else {}),
        # Two host facts about trials (Common Agent 7.7). `samples_ref: true`
        # asks the deploy to name the platform's samples address in the bound
        # descriptor; it is a flag and not the address, because the address
        # needs the handle and the mesh, which only the deploy knows, and an
        # install file carries no address. `trial_ceiling` is the suggested
        # trial scope of the owner's allowance (7.5), which the deploy writes
        # where the owner has not set one; it never reaches the descriptor.
        **({"samples_ref": True} if spec.get("samples_ref") is True else {}),
        **({"trial_ceiling": trial_ceiling} if trial_ceiling else {}),
    }
    text = dumps(doc)
    if "://" in text:
        fail(f"{RUNTIME_FILE} must not carry an address; name the system and the credential, and bind at install")
    return doc


# ── the generated views ───────────────────────────────────────────────────

def skill_md(job, agent_name, copied):
    when = job.get("when", "When the request matches this job.").strip()
    desc = when[:1024]
    lines = ["---", f"name: {job['slug']}", f"description: {desc}", "---", "",
             f"# {job['title']}", "", f"Part of {agent_name}. {when}", "",
             "## When to use this", "", when, ""]
    if job.get("inputs"):
        lines += ["## What this needs", ""]
        for i in job["inputs"]:
            group = i.get("one_of") if isinstance(i.get("one_of"), str) and i.get("one_of").strip() else None
            req = "required" if i.get("required") else (f"any one of the {group} group" if group else "optional")
            lines.append(f"- {i['name']} ({i['kind']}, {req})")
        lines.append("")
    lines += ["## What a good result looks like", "",
              job.get("good", "The job is done and its records are left.").strip(), ""]
    if job.get("outputs"):
        lines += ["## What it produces", ""]
        for o in job["outputs"]:
            tail = (', ' + o['when'].replace('_', ' ') if o.get('when') else '') + (', working out' if o.get('working') is True else '')
            lines.append(f"- {o['name']} ({o['kind']}{tail})")
        lines.append("")
    lines += ["## When it comes back empty", "",
              job.get("empty", "Say so plainly and name what is missing, rather than inventing a result.").strip(), ""]
    if job.get("_instructions"):
        lines += ["## How to do it", "", job["_instructions"].strip(), ""]
    if copied.get("scripts"):
        lines += ["## Scripts", "", "Run these from this skill's folder; each one says what it needs at the top.", ""]
        lines += [f"- scripts/{p}" for p in copied["scripts"]] + [""]
    if copied.get("references"):
        lines += ["## References", ""]
        lines += [f"- references/{p}" for p in copied["references"]] + [""]
    if copied.get("assets"):
        lines += ["## Assets", "", "Templates and resources the scripts fill in; never edited by hand.", ""]
        lines += [f"- assets/{p}" for p in copied["assets"]] + [""]
    return "\n".join(lines)


def not_md(desc):
    body = ["# Where this agent stops", ""]
    body += [ln for ln in desc["refusals"].split("\n") if ln.strip()]
    if desc.get("escalates"):
        body += ["", "## What always goes to a person", ""]
        body += [f"- {e}" for e in desc["escalates"]]
    return "\n".join(body) + "\n"


def records_md(desc):
    body = ["# The records this agent must leave", "",
            "This is the contract. The agent leaves the following behind, on",
            "every run.", ""]
    for r in desc.get("records", []):
        line = f"- {r['name']}"
        if r.get("when") == "standing":
            line += " (kept across tasks)"
        if r.get("file"):
            line += f" — at `{r['file']}`"
        body.append(line)
    body += ["", "An agent that leaves less than this does not do this job,",
             "whatever else it does well."]
    return "\n".join(body) + "\n"


def systems_md(desc, inst):
    kinds = {system_name(s): s for s in inst.get("systems", [])}
    body = ["# The systems this agent needs", "",
            "Named by what the work needs rather than by product. The access level",
            "is the most this work needs; a deployment that grants more is granting",
            "more than the job requires.", "",
            "| System | Kind | Access | What the access is for |", "|---|---|---|---|"]
    for s in desc.get("systems", []):
        k = kinds.get(system_name(s), {})
        extra = []
        if k.get("credential"):
            extra.append(f"credential `{k['credential']}`")
        if k.get("spends"):
            extra.append(f"spends per {k['spends']['unit']}")
        if s.get("leaves"):
            extra.append("the caller's material is sent to it")
        needs = s.get("needs", "")
        if extra:
            needs = (needs + "; " if needs else "") + ", ".join(extra)
        body.append(f"| {system_name(s)} | {k.get('kind', 'directory')} | {s['access']} | {needs} |")
    body += ["", "Whoever deploys this agent binds these systems to their own,",
             "and places any named credential. Nothing here names a product."]
    return "\n".join(body) + "\n"


def generated_views(desc, inst):
    return {"NOT.md": not_md(desc), "RECORDS.md": records_md(desc), "SYSTEMS.md": systems_md(desc, inst)}


# ── checks ────────────────────────────────────────────────────────────────

def check_manifest(manifest):
    """The pinned Agent Plugins schema, applied by hand: required members,
    no member the schema does not list, the name pattern, and the types of
    what is present. Small enough that a dependency would cost more than it
    saves, and exact enough that a manifest passing here validates."""
    if not SCHEMA_FILE:
        fail("the pinned plugin schema is missing beside build.py")
    schema = json.load(open(SCHEMA_FILE))
    props = schema.get("properties", {})
    for k in schema.get("required", []):
        if k not in manifest:
            fail(f"plugin.json is missing {k}")
    for k in manifest:
        if k not in props:
            fail(f"plugin.json carries {k!r}, which the Agent Plugins schema does not allow")
    if manifest["$schema"] != SCHEMA_URL:
        fail(f"plugin.json must declare {SCHEMA_URL}")
    pat = props.get("name", {}).get("pattern")
    if pat and not re.match(pat, manifest["name"]):
        fail(f"plugin.json name {manifest['name']!r} does not match the schema's pattern")
    for k in ("version", "description", "homepage", "repository", "license"):
        if k in manifest and not isinstance(manifest[k], str):
            fail(f"plugin.json {k} must be a string")
    if "keywords" in manifest and not (isinstance(manifest["keywords"], list) and all(isinstance(x, str) for x in manifest["keywords"])):
        fail("plugin.json keywords must be strings")
    if "author" in manifest:
        a = manifest["author"]
        allowed = set(props.get("author", {}).get("properties", {}).keys()) or {"name", "email", "url"}
        if not isinstance(a, dict) or any(k not in allowed for k in a):
            fail("plugin.json author may carry only name, email, url")
    # Addresses, by member and by file (Common Agent 0.17.0-draft, 12.6 rule 3).
    # Four members may carry one, and every one of them names where a READER
    # goes: the manifest's own $schema, the homepage, the repository the source
    # is kept in, and the repository of each ancestor a copy descends from.
    # Nothing at install or at run fetches any of them. An author page is not
    # one of the four, and the descriptor and install file carry none at all.
    def carries_address(node):
        if isinstance(node, str):
            return bool(re.match(r"[a-z][a-z0-9+.\-]*://", node))
        if isinstance(node, dict):
            return any(carries_address(v) for v in node.values())
        if isinstance(node, list):
            return any(carries_address(v) for v in node)
        return False
    for k, v in manifest.items():
        if k in ("$schema", "homepage", "repository"):
            continue
        if k == "extensions":
            for ns, body in (v or {}).items():
                for mk, mv in (body or {}).items():
                    if ns == EXT and mk == "from":
                        # Each entry's own repository is the excepted address;
                        # anything else inside the entry is not.
                        for e in mv:
                            if any(carries_address(x) for key, x in e.items() if key != "repository"):
                                fail("plugin.json from carries an address outside its repository member")
                        continue
                    if carries_address(mv):
                        fail(f"plugin.json extensions {ns}.{mk} carries an address; a package's declarations name things and never places")
            continue
        if carries_address(v):
            fail(f"plugin.json {k} carries an address; the members that may are $schema, homepage, repository, and each from entry's repository")
    if "extensions" in manifest and not (isinstance(manifest["extensions"], dict)
                                         and all(isinstance(v, dict) for v in manifest["extensions"].values())):
        fail("plugin.json extensions must map a namespace to an object")


def check_hidden(pkg):
    for root, _, files in os.walk(pkg):
        for fn in files:
            p = os.path.join(root, fn)
            try:
                text = open(p, encoding="utf-8").read()
            except (UnicodeDecodeError, OSError):
                continue
            for i, ch in enumerate(text):
                if ord(ch) in HIDDEN:
                    fail(f"{os.path.relpath(p, pkg)} carries a hidden character U+{ord(ch):04X} at offset {i}; a package must not")


# A reference to a file in the repository's shared standards/ folder, as the
# Builders name them from their own folders: ../../standards/<file>.
STANDARDS_REF = re.compile(r"^(?:\.\./)+standards/([^/]+)$")


def copy_into(src_base, rel, dest_dir):
    """Copy a file or directory named in the spec under a skill folder.
    Returns the names placed, for the SKILL.md to list."""
    src = os.path.normpath(os.path.join(src_base, rel))
    shared = STANDARDS_REF.match(str(rel).replace(os.sep, "/"))
    if shared and os.path.isfile(os.path.join(src_base, "standards", shared.group(1))):
        # A Builder reads the repository's shared standards/ (../../standards/
        # <file>). Laid out from sent files, that file is placed at
        # standards/<file> beside the agent's own files (pack.py), and the
        # copy that was sent wins over anything two folders up.
        src = os.path.join(src_base, "standards", shared.group(1))
    if not os.path.exists(src):
        fail(f"file named in the spec does not exist: {rel}")
    os.makedirs(dest_dir, exist_ok=True)
    name = os.path.basename(src.rstrip("/\\"))
    dest = os.path.join(dest_dir, name)
    if os.path.isdir(src):
        shutil.copytree(src, dest, dirs_exist_ok=True)
    else:
        shutil.copy2(src, dest)
    return name


# ── the agent's folder ────────────────────────────────────────────────────

def read_json_file(path, what):
    try:
        with open(path, encoding="utf-8") as f:
            v = json.load(f)
    except Exception as e:  # noqa: BLE001
        fail(f"{what} is not readable JSON: {e}")
    if not isinstance(v, dict):
        fail(f"{what} is a JSON object")
    return v


def pick_name(folder, name, legacy):
    """The file an authored fact is read from: its current name, or its name
    before 0.30.0-draft where the current one is absent. Returns the name it
    was found under, or None."""
    now = os.path.isfile(os.path.join(folder, name))
    old = os.path.isfile(os.path.join(folder, legacy))
    if now and old:
        warn(f"both {name} and {legacy} are in the agent's folder; {name} is read and {legacy} is ignored")
        return name
    if now:
        return name
    if old:
        warn(f"{legacy} is read as {name}, its name since Common Agent 0.30.0-draft; rename it")
        return legacy
    return None


def has_skill_frontmatter(text, slug):
    """An Agent Skill's SKILL.md opens with frontmatter naming the skill and
    saying when to use it, and the name is the folder's."""
    if not text.startswith("---\n"):
        return False
    end = text.find("\n---", 4)
    if end < 0:
        return False
    fm = text[4:end].split("\n")
    names = [ln.split(":", 1)[1].strip() for ln in fm if ln.startswith("name:")]
    return names == [slug] and any(ln.startswith("description:") and ln.split(":", 1)[1].strip() for ln in fm)


def read_folder(folder):
    """An agent kept the way Common Agent 13.2 says a package is authored:
    agent-descriptor.json, agent-runtime-requirements.json and plugin.json,
    with the skills under skills/<slug>/. Returns the spec those files state,
    the folder the skills' files are copied from, and what was authored, so
    the build can say exactly where the folder says something it would not
    have written.

    The spec is an inside detail: everything downstream of it is the same
    build a spec.json gets, every check included, and the two authored files
    it writes are then held to what the folder says. Building adds no fact
    the source did not state, and the source states none the builder would
    not have written."""
    if not os.path.isfile(os.path.join(folder, MANIFEST_FILE)):
        fail(f"the agent's folder has no {MANIFEST_FILE}")
    dname = pick_name(folder, DESCRIPTOR_FILE, LEGACY_DESCRIPTOR_FILE)
    rname = pick_name(folder, RUNTIME_FILE, LEGACY_RUNTIME_FILE)
    if not dname:
        fail(f"the agent's folder has no {DESCRIPTOR_FILE}")
    if not rname:
        fail(f"the agent's folder has no {RUNTIME_FILE}")
    if os.path.isfile(os.path.join(folder, "spec.json")):
        warn(f"spec.json beside {DESCRIPTOR_FILE} is ignored; the folder's authored files are what is built")
    manifest = read_json_file(os.path.join(folder, MANIFEST_FILE), MANIFEST_FILE)
    desc = read_json_file(os.path.join(folder, dname), dname)
    inst = read_json_file(os.path.join(folder, rname), rname)
    if inst.get("format") == LEGACY_RUNTIME_FORMAT:
        warn(f'{rname} says format "{LEGACY_RUNTIME_FORMAT}", read as "{RUNTIME_FORMAT}", its format since Common Agent 0.30.0-draft')
        inst["format"] = RUNTIME_FORMAT
    elif inst.get("format") != RUNTIME_FORMAT:
        fail(f'{rname} says format {inst.get("format")!r}; the runtime requirements say "{RUNTIME_FORMAT}"')
    if desc.get("format") != "agent-descriptor-v1":
        fail(f'{dname} says format {desc.get("format")!r}; a draft Descriptor says "agent-descriptor-v1"')

    exts = manifest.get("extensions")
    if exts is not None and not (isinstance(exts, dict) and all(isinstance(v, dict) for v in exts.values())):
        fail(f"{MANIFEST_FILE} extensions maps a namespace to an object")
    own = dict((exts or {}).get(EXT) or {})
    generated = [k for k in own if k in ("descriptor", RUNTIME_POINTER, LEGACY_RUNTIME_POINTER, "built", "draft")]
    if generated:
        warn(f"{MANIFEST_FILE} extensions.{EXT} carries {', '.join(generated)}, which the build writes; what the folder says there is ignored")
    for k in own:
        if k not in ("from", BUILD_MEMBER, "descriptor", RUNTIME_POINTER, LEGACY_RUNTIME_POINTER, "built", "draft"):
            fail(f"{MANIFEST_FILE} extensions.{EXT}.{k} is not something the package's own entry carries")
    b = own.get(BUILD_MEMBER) or {}
    if not isinstance(b, dict):
        fail(f"{MANIFEST_FILE} extensions.{EXT}.{BUILD_MEMBER} is an object")
    for k in b:
        if k not in BUILD_MEMBERS:
            fail(f"{MANIFEST_FILE} extensions.{EXT}.{BUILD_MEMBER}.{k} is not something the builder reads; it reads {', '.join(BUILD_MEMBERS)}")
    src = b.get("source")
    if src is not None and not (isinstance(src, str) and src.strip()):
        fail(f"{BUILD_MEMBER}.source is the folder, relative to this one, that the skills' files are copied from")
    src_base = os.path.normpath(os.path.join(folder, src)) if src else folder

    # The jobs, in the order the skills are listed, each projected back from
    # the offering or step that carries it.
    offerings = desc.get("offerings")
    if not (isinstance(offerings, list) and offerings and all(isinstance(o, dict) for o in offerings)):
        fail(f"{dname} has no offering; at least one is what a caller orders")
    projected, seen_order = {}, []
    for o in offerings:
        for p in [o] + [s for s in (o.get("steps") or []) if isinstance(s, dict)]:
            pid = p.get("id")
            if not (isinstance(pid, str) and SLUG_RE.match(pid)):
                fail(f"each offering and step in {dname} has an id (lowercase-hyphen); bad: {pid!r}")
            if pid not in projected:
                projected[pid] = p
                seen_order.append(pid)
    skills_map = b.get("skills")
    if skills_map is None:
        order = seen_order
        skills_map = {}
    else:
        if not isinstance(skills_map, dict):
            fail(f"{BUILD_MEMBER}.skills maps each skill to the files copied into it")
        order = list(skills_map)
        for slug in order:
            if slug not in projected:
                # A skill no offering or step stands for. Common Agent 12.5
                # says there is none, and one package (a scorer its own
                # offering runs as a tool) has one; it is carried as it always
                # was, and said out loud.
                warn(f"skills/{slug} stands for no offering or step in {dname}; Common Agent 12.5 says every skill stands for one")
        for slug in seen_order:
            if slug not in skills_map:
                fail(f"{dname} names {slug} and {BUILD_MEMBER}.skills does not list it")
        for slug, files in skills_map.items():
            if not isinstance(files, dict) or any(k not in SKILL_FILE_KINDS for k in files):
                fail(f"{BUILD_MEMBER}.skills.{slug} names files by kind: {', '.join(SKILL_FILE_KINDS)}")
            for k, v in files.items():
                if not (isinstance(v, list) and all(isinstance(x, str) and x for x in v)):
                    fail(f"{BUILD_MEMBER}.skills.{slug}.{k} is a list of paths relative to the agent's folder")
    sdir = os.path.join(folder, "skills")
    on_disk = sorted(n for n in os.listdir(sdir) if os.path.isdir(os.path.join(sdir, n))) if os.path.isdir(sdir) else []
    for n in on_disk:
        if n not in projected and n not in skills_map:
            fail(f"skills/{n} stands for no offering or step in {dname}; every skill stands for one")
    authored_skills = {}
    for slug in order:
        md = os.path.join(sdir, slug, "SKILL.md")
        if not os.path.isfile(md):
            fail(f"offering or step {slug} has no skills/{slug}/SKILL.md in the agent's folder; a package is authored with the skills it names")
        with open(md, encoding="utf-8") as f:
            text = f.read()
        if not has_skill_frontmatter(text, slug):
            fail(f"skills/{slug}/SKILL.md needs frontmatter with name {slug} and a description (the Agent Skills format)")
        authored_skills[slug] = os.path.join(sdir, slug)

    offered_ids = [o["id"] for o in offerings]
    by_offering = {o["id"]: o for o in offerings}
    runs = inst.get("run") or {}
    deps = {}
    for d in inst.get("dependencies") or []:
        if isinstance(d, dict) and isinstance(d.get("skill"), str):
            deps.setdefault(d["skill"], d)
    jobs = []
    for slug in order:
        p = by_offering.get(slug) or projected.get(slug) or {"name": slug}
        j = {"slug": slug, "title": p.get("name")}
        for k in ("does", "inputs", "outputs", "how", "examples"):
            if k in p:
                j[k] = p[k]
        j["offered"] = slug in offered_ids
        if slug in by_offering:
            o = by_offering[slug]
            if o.get("steps"):
                j["steps"] = [s.get("id") for s in o["steps"] if isinstance(s, dict)]
            for k in ("revisions", "trial", "scopes", "started_by", "works_as", "example"):
                if k in o:
                    j[k] = o[k]
        if isinstance(runs, dict) and slug in runs:
            j["run"] = runs[slug]
        if slug in deps:
            lp = str(deps[slug].get("lockfile", ""))
            prefix = f"skills/{slug}/"
            if not lp.startswith(prefix):
                fail(f"{rname} names the lockfile {lp} for {slug}, which is not under skills/{slug}/")
            j["lockfile"] = lp[len(prefix):]
        for k in SKILL_FILE_KINDS:
            if skills_map.get(slug, {}).get(k):
                j[k] = list(skills_map[slug][k])
        jobs.append(j)

    refusals = desc.get("refusals")
    if not (isinstance(refusals, str) and refusals.strip()):
        fail(f"{dname} does not say what the agent refuses; a package must carry it and it is not something to invent")
    if not (isinstance(desc.get("records"), list) and desc["records"]):
        fail(f"{dname} does not say what records the agent must leave; a package must carry it and it is not something to invent")

    version = manifest.get("version")
    if version is None:
        version = desc.get("agent_version", "1.0.0")
    if not isinstance(version, str):
        fail(f"{MANIFEST_FILE} version must be a string")
    if desc.get("agent_version") is not None and str(desc["agent_version"]) != version:
        fail(f"{MANIFEST_FILE} says version {version} and {dname} says agent_version {desc['agent_version']}; they are one version")
    spec = {"name": manifest.get("name", ""), "version": version, "description": manifest.get("description")}
    for k in ("license", "homepage", "repository", "author"):
        if k in manifest:
            spec[k] = manifest[k]
    if "from" in own:
        spec["from"] = own["from"]
    for k in ("kind", "container", "claims"):
        if k in b:
            spec[k] = b[k]
    spec["jobs"] = jobs
    if "name" in desc:
        spec["display_name"] = desc["name"]
    for k in ("summary", "will_not"):
        if k in desc:
            spec[k] = desc[k]
    spec["refuses"] = [ln for ln in refusals.split("\n") if ln.strip()]
    if desc.get("escalates"):
        spec["escalates"] = desc["escalates"]
    spec["records"] = desc["records"]

    # A system is one name in both files: what the access is for in the
    # descriptor, how it is bound in the runtime requirements.
    dsys = desc.get("systems") or []
    isys = inst.get("systems") or []
    if not (isinstance(dsys, list) and isinstance(isys, list)):
        fail(f"systems is a list in {dname} and in {rname}")
    inst_by = {system_name(e): e for e in isys if isinstance(e, dict)}
    if {system_name(d) for d in dsys if isinstance(d, dict)} != set(inst_by) or len(dsys) != len(isys):
        fail(f"{dname} and {rname} name different systems")
    systems = []
    for d in dsys:
        e = inst_by[system_name(d)]
        s = {"name": system_name(d), "access": d.get("access")}
        for k in ("needs", "leaves"):
            if k in d:
                s[k] = d[k]
        for k in ("kind", "credential", "env", "spends", "settings", "protocols"):
            if k in e:
                s[k] = e[k]
        systems.append(s)
    spec["systems"] = systems
    for k in ("can_use", "run_config"):
        if k in desc:
            spec[k] = desc[k]

    for k in ("runtimes", "binaries", "directories"):
        if k in inst:
            spec[k] = inst[k]
    if "ceilings" in inst:
        if not isinstance(inst["ceilings"], list):
            fail(f"{rname} ceilings is a list")
        # The enforcing side is derived; the build writes it again and the
        # comparison below holds the folder's word to the derivation.
        spec["ceilings"] = [{k: v for k, v in c.items() if k != "enforced_by"} if isinstance(c, dict) else c
                            for c in inst["ceilings"]]
    for k in ("job_seconds", "wants_replies", "one_at_a_time", "samples_ref", "trial_ceiling"):
        if k in inst:
            spec[k] = inst[k]
    if "answer" in inst:
        a = inst["answer"]
        if not (isinstance(a, dict) and set(a) == {"piece"}):
            fail(f'{rname} answer is {{"piece": "<name>"}}')
        spec["answer"] = a["piece"]
    if "price" in inst:
        pr = inst["price"]
        if not (isinstance(pr, dict) and isinstance(pr.get("price"), dict) and isinstance(pr.get("covers"), dict)):
            fail(f"{rname} price is the SKU as it will be placed: sku, covers and price")
        price = dict(pr["price"])
        if "sku" in pr:
            price["sku"] = pr["sku"]
        if "offerings" in pr["covers"]:
            price["covers"] = pr["covers"]["offerings"]
        spec["price"] = price
    if "verify" in inst:
        m = re.match(r"^skills/([^/]+)/(.+)$", str(inst["verify"]))
        if not m:
            fail(f"{rname} verify is the path of one skill's script inside the package, skills/<slug>/scripts/<file>")
        spec["verify"] = {"job": m.group(1), "script": m.group(2)}

    authored = {"folder": folder, "descriptor_name": dname, "runtime_name": rname,
                "descriptor": desc, "runtime": inst, "manifest": manifest, "skills": authored_skills}
    return spec, src_base, authored


def first_difference(a, b, path=""):
    """Where two JSON values first differ, as a path, or None when they are
    the same. Object member order does not count; list order does."""
    if isinstance(a, dict) and isinstance(b, dict):
        for k in list(a) + [k for k in b if k not in a]:
            if k not in a:
                return f"{path}.{k} (the folder does not say it, and the build would)"
            if k not in b:
                return f"{path}.{k} (the folder says it, and the build would not)"
            d = first_difference(a[k], b[k], f"{path}.{k}")
            if d:
                return d
        return None
    if isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            return f"{path} (the folder lists {len(a)}, the build would list {len(b)})"
        for i, (x, y) in enumerate(zip(a, b)):
            d = first_difference(x, y, f"{path}[{i}]")
            if d:
                return d
        return None
    if a == b and type(a) is type(b):
        return None
    return f"{path} (the folder says {json.dumps(a)[:80]}, the build would say {json.dumps(b)[:80]})"


# ── main ──────────────────────────────────────────────────────────────────

def main():
    if len(sys.argv) != 3:
        fail("usage: build.py <agent folder | spec.json> <out_dir>")
    src, out_dir = sys.argv[1], sys.argv[2]
    if os.path.basename(os.path.normpath(src)) == MANIFEST_FILE and os.path.isfile(src):
        src = os.path.dirname(os.path.abspath(src))
    if os.path.isdir(src):
        spec, src_base, authored = read_folder(os.path.abspath(src))
    else:
        try:
            spec = json.load(open(src, encoding="utf-8"))
        except Exception as e:  # noqa: BLE001
            fail(f"cannot read spec: {e}")
        if not isinstance(spec, dict):
            fail("cannot read spec: it is not a JSON object")
        warn(SPEC_DEPRECATED)
        src_base = spec.get("source") or os.path.dirname(os.path.abspath(src))
        authored = None
    build(spec, src_base, out_dir, authored)


def build(spec, src_base, out_dir, authored):
    """One build, whichever input it came from. `authored` is None for a
    spec.json; for an agent's folder it holds the files the folder authored,
    and the build holds them to what it writes."""
    name = spec.get("name", "")
    if not (isinstance(name, str) and NAME_RE.match(name)):
        fail(f"{'plugin.json name' if authored else 'spec.name'} {name!r} must be lowercase letters, digits and hyphens")
    version = str(spec.get("version", "1.0.0"))
    if authored:
        if not (isinstance(spec.get("description"), str) and spec["description"].strip()):
            fail(f"{MANIFEST_FILE} needs a description, one sentence on what the agent does")
        description = spec["description"]
    else:
        description = need(spec, "description", str)
    jobs = need(spec, "jobs")
    systems = spec.get("systems", [])
    refuses = need(spec, "refuses")       # the judgment parts: required, never invented
    raw_records = need(spec, "records")
    escalates = spec.get("escalates", [])

    for j in jobs:
        if not (isinstance(j, dict) and SLUG_RE.match(j.get("slug", "")) and j.get("title")):
            fail(f"each job needs a slug (lowercase-hyphen) and a title; bad: {j}")
    if len({j["slug"] for j in jobs}) != len(jobs):
        fail("two jobs share a slug")
    slugs = {j["slug"] for j in jobs}
    for j in jobs:
        if "offered" in j and not isinstance(j["offered"], bool):
            fail(f"job {j['slug']}: offered must be true or false")
        steps = j.get("steps")
        if steps is None:
            continue
        if not (isinstance(steps, list) and steps and all(isinstance(s, str) for s in steps)):
            fail(f"job {j['slug']}: steps must be a non-empty list of job slugs")
        if len(set(steps)) != len(steps):
            fail(f"job {j['slug']}: a step is listed twice")
        for s in steps:
            if s not in slugs:
                fail(f"job {j['slug']}: step {s!r} is not a job in this spec")
            if s == j["slug"]:
                fail(f"job {j['slug']}: a job cannot be its own step")
    for j in jobs:
        for s in j.get("steps") or []:
            if next(x for x in jobs if x["slug"] == s).get("steps"):
                fail(f"job {j['slug']}: step {s!r} has steps of its own; steps are one level deep")
    # How each job is done, checked before any file is written like the rest.
    for j in jobs:
        if "how" in j:
            how_declaration(j)
        if "run" in j:
            run_command(j)
    # A revision policy is checked here, before any file is written, so a
    # refused spec leaves no half-built package behind.
    anyone_says = any("offered" in j for j in jobs)
    for j in jobs:
        if "revisions" not in j:
            continue
        if anyone_says and j.get("offered") is not True:
            fail(f"job {j['slug']}: revisions belong to an offered job; a step is not revised on its own")
        revisions_policy(j)
    # Trials and their ceiling, refused before any file is written too.
    trial_declarations(spec, jobs)
    # Scopes (PACT Delegated) likewise: only on an offered job, and well formed.
    offered_now = set(offered_slugs(jobs))
    for j in jobs:
        if "scopes" in j:
            if j["slug"] not in offered_now:
                fail(f"job {j['slug']}: scopes belong to an offered job; a person grants them to what a caller orders")
            scopes_declaration(j)
    # Refused before any file is written, like every other shape check here.
    js = spec.get("job_seconds")
    if js is not None and not (isinstance(js, int) and not isinstance(js, bool) and 60 <= js <= 7200):
        fail(f"job_seconds is the longest one job may take, a whole number of seconds from 60 to 7200; bad: {js!r}")
    wr = spec.get("wants_replies")
    if wr is not None and not isinstance(wr, bool):
        fail(f"wants_replies is true or false; bad: {wr!r}")
    one_at_a_time_declaration(spec)
    # What the agent charges, checked here too and not only where it is
    # written, for the reason above: a spec refused for its price must leave no
    # half-built package behind. The check is pure, so running it twice costs
    # nothing and there is one spelling of the refusal.
    price_declaration(spec, jobs)
    # What a caller may send with a job, checked here for the same reason: a
    # spec refused for a schema it cannot name must leave no half-built
    # package behind. The check is pure, so running it twice costs nothing.
    can_use_declaration(spec)
    # What a run config may set, checked before any file is written too.
    run_config_declaration(spec)
    # `name` with `role` as the alias Common Agent 0.16.0-draft keeps for one
    # revision. Both spellings are read here, once, and everything downstream
    # reads `name` and nothing else, so there is one place that knows.
    normalized = []
    for s in systems:
        n = system_name(s)
        if not (isinstance(s, dict) and n and SLUG_RE.match(n) and s.get("access") in ACCESS):
            fail(f"each system needs a name (lowercase-hyphen) and access one of {ACCESS}; bad: {s}")
        e = {k: v for k, v in s.items() if k != "role"}
        e["name"] = n
        normalized.append(e)
    systems = normalized
    if len({s["name"] for s in systems}) != len(systems):
        fail("two systems share a name")
    # Which side applies a ceiling is derived from the system, so both ways a
    # ceiling can be wrong are refused here, before any file is written, like
    # every other shape check.
    for c in spec.get("ceilings") or []:
        if isinstance(c, dict) and "enforced_by" in c:
            fail(f"system {c.get('system')}: a ceiling's enforcing side is derived from how the package reaches the system, never written into the spec")
    for s in systems:
        if s.get("spends") is not None:
            ceiling_side(s, name)
    records = []
    for r in raw_records:
        if isinstance(r, str) and r.strip():
            records.append({"name": r.strip(), "when": "per_task"})
        elif isinstance(r, dict) and isinstance(r.get("name"), str) and r["name"].strip():
            e = {"name": r["name"].strip(), "when": r.get("when", "per_task")}
            if e["when"] not in WHEN:
                fail(f"record {e['name']!r}: when must be one of {WHEN}")
            if r.get("file"):
                if not isinstance(r["file"], str) or r["file"].startswith(("/", "..")) or "://" in r["file"]:
                    fail(f"record {e['name']!r}: file must be a pattern relative to the records directory")
                e["file"] = r["file"]
            records.append(e)
        else:
            fail(f"each record is a line or {{name, when?, file?}}; bad: {r}")

    # The required coder check, optional. When REQUIRED_CODER names a code
    # writer's key (OFFICIAL_CODER is read too, as the older name), every
    # script this package would ship has to be traced to a delivery that key
    # signed: the adapter's job manifest, which lists each piece with its
    # digest. A script written or changed by hand has no such piece, and the
    # package is refused with the reply naming where to send it. Unset, the
    # builder packs scripts from any code writer. The check itself is the node
    # script beside this file, so it verifies with the same library and the
    # same canonical form the adapter signed with.
    official = (os.environ.get("REQUIRED_CODER", "").strip()
                or os.environ.get("OFFICIAL_CODER", "").strip())
    if official:
        manifest = os.environ.get("PROVENANCE", "").strip() or os.path.join(src_base, "job-manifest.json")
        door = next((p for p in (os.path.join(HERE, "agentbuilder-provenance.mjs"), os.path.join(HERE, "provenance.mjs")) if os.path.exists(p)), None)
        if not door:
            fail("REQUIRED_CODER is set and the provenance check is not beside this builder, so no script can be traced; nothing is packed")
        wanted = sorted({os.path.normpath(os.path.join(src_base, rel)) for j in jobs for rel in (j.get("scripts") or [])})
        if not os.path.isfile(manifest):
            fail(f"REQUIRED_CODER is set and there is no delivery manifest at {manifest}: these scripts cannot be traced to the required code writer. "
                 "Send the code to that code writer with the spec, and pack what it delivers.")
        try:
            r = subprocess.run(["node", door, manifest, official, *wanted], capture_output=True, text=True, timeout=120)
            verdict = json.loads(r.stdout or "{}")
        except Exception as e:  # noqa: BLE001
            fail(f"the provenance check could not run: {e}")
        if not verdict.get("ok"):
            # Name the files only when the manifest itself is good and some of
            # them are not in it; a bad or foreign manifest is the whole story.
            untraced = [os.path.basename(f["path"]) for f in verdict.get("files", []) if not f.get("ok")] if verdict.get("agent_ok") else []
            named = f": {', '.join(untraced)}" if untraced else ""
            fail(f"{verdict.get('said', 'the scripts cannot be traced to the required code writer')}{named}. "
                 f"{verdict.get('door') or 'Send the code to the required code writer with the spec, and pack what it delivers.'}")

    agent_kind(spec)           # what the inside is made of, when it is said
    where_it_is_read(spec)     # the license, the page and the repository
    # The format rules: warned for an agent released before them, refused for
    # a new one, before any file is written.
    formats = apply_format_rules(name, jobs, src_base, authored)
    # The standing-asset rules, by the same cut-over, before any file is written.
    standing = apply_standing_rules(name, spec, jobs, src_base)
    options = apply_option_rules(name, spec, jobs)
    if spec.get("kind") in CONTAINER_KINDS:
        # Checked, and nothing written: its code is in its own repository.
        out({**container_spec(spec, name, version, jobs), "format_rules": formats, "standing_rules": standing, "option_rules": options,
             **({"warnings": list(WARNINGS)} if WARNINGS else {})})
    lin = lineage(spec)        # what this package was copied from, if anything
    verify_script(spec, jobs)  # refuse a bad verify before anything is written
    pkg = os.path.join(out_dir, name)
    # The package folder is emptied before it is written, so it must not be
    # the source or hold it: `build.py agents/x agents` names agents/x as both.
    real_pkg = os.path.realpath(pkg)
    for src in {os.path.realpath(src_base), *([os.path.realpath(authored["folder"])] if authored else [])}:
        if src == real_pkg or src.startswith(real_pkg + os.sep):
            fail(f"the package would be written to {pkg}, which is the folder it is built from or holds it; name another out folder")
    if os.path.isdir(pkg):
        shutil.rmtree(pkg)
    PARTIAL.append(pkg)
    os.makedirs(os.path.join(pkg, "skills"), exist_ok=True)
    os.makedirs(os.path.join(pkg, EXT), exist_ok=True)

    # Skills: one per job, with whatever the job brings along. From a folder,
    # the skill is the folder's own, SKILL.md as written, and the files its
    # build entry names are copied into it; from a spec, SKILL.md is written
    # from the job.
    lockfiles = []
    for j in jobs:
        d = os.path.join(pkg, "skills", j["slug"])
        if authored:
            shutil.copytree(authored["skills"][j["slug"]], d)
        os.makedirs(d, exist_ok=True)
        copied = {"scripts": [], "references": [], "assets": []}
        for kind in ("scripts", "references", "assets"):
            for rel in j.get(kind, []) or []:
                copied[kind].append(copy_into(src_base, rel, os.path.join(d, kind)))
        ins = j.get("instructions")
        if isinstance(ins, dict) and ins.get("file"):
            p = os.path.normpath(os.path.join(src_base, ins["file"]))
            if not os.path.exists(p):
                fail(f"job {j['slug']}: instructions file does not exist: {ins['file']}")
            j["_instructions"] = open(p, encoding="utf-8").read()
        elif isinstance(ins, str):
            j["_instructions"] = ins
        if j.get("lockfile"):
            lp = os.path.join(d, j["lockfile"])
            if not os.path.isfile(lp):
                fail(f"job {j['slug']}: lockfile {j['lockfile']} was not copied into the skill; name it under scripts or references")
            lockfiles.append({"skill": j["slug"], "lockfile": f"skills/{j['slug']}/{j['lockfile']}",
                              "sha256": sha256_of(open(lp, "rb").read())})
        if not authored:
            open(os.path.join(d, "SKILL.md"), "w", encoding="utf-8", newline="\n").write(skill_md(j, name, copied))

    # An example's file in the package (Common Agent 6.13.8) is checked against
    # the package as it now stands: it is there, and its bytes are its digest.
    # A wrong path or a stale digest would otherwise ship and fail every run
    # of the example after release.
    for j in jobs:
        if j.get("example") is None:
            continue
        for ex_input, v in example_declaration(j)["inputs"].items():
            if not (isinstance(v, dict) and v.get("file")):
                continue
            at = os.path.join(pkg, *v["file"].split("/"))
            if not os.path.isfile(at):
                fail(f"job {j['slug']}: example.inputs.{ex_input} names {v['file']}, which the package does not carry; copy it in under a skill's scripts, references or assets")
            if "sha256:" + sha256_of(open(at, "rb").read()) != v.get("digest"):
                fail(f"job {j['slug']}: example.inputs.{ex_input}: {v['file']} in the package is not the file its digest names")

    # The two authored files, then the manifest that points at them.
    desc = draft_descriptor(spec, jobs, systems, refuses, escalates, records)
    inst = install_file(spec, jobs, systems, lockfiles)
    if {s["name"] for s in desc.get("systems", [])} != {s["name"] for s in inst["systems"]}:
        fail("the descriptor and the runtime requirements name different systems")
    if authored:
        # The folder's two files are the package's, and what the build makes
        # of them must be what they say: a member the builder does not write,
        # a ceiling's enforcing side the system does not imply, a lockfile
        # whose digest is not the file's, are each refused here by name.
        for label, made, said in ((authored["descriptor_name"], desc, authored["descriptor"]),
                                  (authored["runtime_name"], inst, authored["runtime"])):
            diff = first_difference(said, made)
            if diff:
                fail(f"{label} {diff.lstrip('.')}. A package is built from what its authored files say, and the "
                     f"build would not write this; correct the file")
    desc_text, inst_text = dumps(desc), dumps(inst)
    open(os.path.join(pkg, DESCRIPTOR_FILE), "w", encoding="utf-8", newline="\n").write(desc_text)
    open(os.path.join(pkg, RUNTIME_FILE), "w", encoding="utf-8", newline="\n").write(inst_text)

    pointers = {
        "descriptor": {"path": DESCRIPTOR_FILE, "sha256": sha256_of(desc_text)},
        RUNTIME_POINTER: {"path": RUNTIME_FILE, "sha256": sha256_of(inst_text)},
        "built": True,
        "draft": True,
        # Where this package was copied from, when it was copied at all.
        **({"from": lin} if lin else {}),
    }
    if authored:
        # The manifest is the folder's, less what is the builder's alone,
        # with the pointers and digests written in.
        m = authored["manifest"]
        if "$schema" in m and m["$schema"] != SCHEMA_URL:
            fail(f"plugin.json must declare {SCHEMA_URL}")
        others = {k: v for k, v in (m.get("extensions") or {}).items() if k != EXT}
        manifest = {
            "$schema": SCHEMA_URL,
            "name": name,
            "version": version,
            "description": description.strip(),
            **({"license": spec["license"].strip()} if spec.get("license") else {}),
            **({"homepage": spec["homepage"]} if spec.get("homepage") else {}),
            **({"repository": spec["repository"]} if spec.get("repository") else {}),
            **({"author": m["author"]} if "author" in m else {}),
            **({"keywords": m["keywords"]} if "keywords" in m else {}),
            "extensions": {EXT: pointers, **others},
        }
        known = {"$schema", "name", "version", "description", "license", "homepage", "repository", "author", "keywords", "extensions"}
        for k in m:
            if k not in known:
                fail(f"plugin.json carries {k!r}, which this builder does not carry into a package")
    else:
        manifest = {
            "$schema": SCHEMA_URL,
            "name": name,
            "version": version,
            "description": description.strip(),
            **({"license": spec["license"].strip()} if spec.get("license") else {}),
            **({"homepage": spec["homepage"]} if spec.get("homepage") else {}),
            **({"repository": spec["repository"]} if spec.get("repository") else {}),
            # An author is a name and never a page: the three addresses a manifest
            # may carry are its own $schema, the homepage and the repository (12.6
            # rule 3), and an author page is not one of them. Who built this is in
            # the build record, by key.
            "author": spec.get("author") or {"name": "Agent Builder"},
            "keywords": ["built-agent", "draft"] + [j["slug"] for j in jobs],
            "extensions": {EXT: pointers},
        }
    check_manifest(manifest)
    open(os.path.join(pkg, MANIFEST_FILE), "w", encoding="utf-8", newline="\n").write(dumps(manifest))

    for fn, text in generated_views(desc, inst).items():
        open(os.path.join(pkg, EXT, fn), "w", encoding="utf-8", newline="\n").write(text)
    open(os.path.join(pkg, "README.md"), "w", encoding="utf-8", newline="\n").write(
        f"# {name}\n\nAn agent built from a description by the Agent Builder, as an\n"
        f"Agent Package: an Agent Plugin carrying a draft Agent Descriptor (what\n"
        f"the agent does, refuses, needs and records) and its runtime requirements\n"
        f"(what a host must have and do). It carries {len(jobs)} skill(s). Nobody has run\n"
        f"it: this is a draft to review, not a vouched-for agent.\n")
    check_hidden(pkg)

    rr_sha = manifest["extensions"][EXT][RUNTIME_POINTER]["sha256"]
    out({"ok": True, "name": name, "version": version, "path": pkg,
         "schema": SCHEMA_URL,
         "input": "folder" if authored else "spec",
         "descriptor": f"{DESCRIPTOR_FILE} (draft, no subject; the deployer binds it)",
         "descriptor_sha256": manifest["extensions"][EXT]["descriptor"]["sha256"],
         "runtime_requirements_sha256": rr_sha,
         # The same digest under the name callers read before 0.30.0-draft.
         "install_sha256": rr_sha,
         "skills": [j["slug"] for j in jobs],
         "systems": [s["name"] for s in systems],
         # Whether those names are ones an account can bind on its stack. The
         # package maker copies this straight into the signed build record.
         "systems_note": systems_note(systems),
         "lockfiles": lockfiles,
         "refuses_count": len(refuses), "records_count": len(records),
         "format_rules": formats,
         "standing_rules": standing,
         "option_rules": options,
         "draft": True,
         **({"warnings": list(WARNINGS)} if WARNINGS else {}),
         "note": "Draft package. Nobody has run this agent; review before deploying."})


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as e:  # noqa: BLE001
        fail(f"unexpected: {e!r}")
