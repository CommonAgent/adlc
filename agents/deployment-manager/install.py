#!/usr/bin/env python3
"""The installer's reading and checking half, as plain functions.

Everything the deploy procedure decides before it touches the host lives
here: reading a package and refusing one that does not hold together,
checking the host has what the install file names, checking the owner's
instruction supplies every credential name, address and ceiling the package
needs and carries no credential value, planning the bindings, rendering the
environment the agent's scripts read, laying the skills and the harness
configuration out for the harness that will run them, and the ledger of
placed files that "what is deployed" is answered from.

No root, no network, no side effect beyond the functions that say they
write. steps.py runs these in order and stops at the first refusal; the
tests run them against a package the builder emits.

The per-harness residue is one table, HARNESSES: which instructions file the
harness reads, which directory it discovers skills in, and how its
configuration names an MCP server. Everything else here is the same for
every harness.

Deployed beside steps.py as /opt/fleet/deploymgr-install.py; steps.py loads
it from its own directory.
"""
import hashlib
import json
import os
import re
import shlex
import shutil
import subprocess

EXT = "net.agentdoc.package"
# The namespace packages carried before the package format was published.
OLD_EXT = "com.agentcatalog.agent"
SCHEMA_URL = "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json"
# The runtime requirements' format (Common Agent 0.30.0-draft, 12.2), and the
# one it had before, which a reader still accepts: a package published under
# the former names stays installable.
INSTALL_FORMAT = "agent-runtime-requirements-v1"
LEGACY_INSTALL_FORMAT = "agent-install-v1"
INSTALL_FORMATS = (INSTALL_FORMAT, LEGACY_INSTALL_FORMAT)
# The two authored files under their names, then their names before
# 0.30.0-draft. A reader takes the current name where it is present and the
# former one where it is not.
DESCRIPTOR_FILES = ("agent-descriptor.json", "descriptor.json")
INSTALL_FILES = ("agent-runtime-requirements.json", "install.json")
# The manifest pointers at the runtime requirements: current, then former.
INSTALL_POINTERS = ("runtime_requirements", "install")
DESCRIPTOR_FORMAT = "agent-descriptor-v1"
HERE = os.path.dirname(os.path.abspath(__file__))
# The pinned copy of the Agent Plugins schema: beside this file on a host,
# beside the builder in the source tree.
SCHEMA_FILE = next((p for p in (os.path.join(HERE, "deploymgr-plugin.schema.json"),
                                os.path.join(HERE, "plugin-1.0.0.schema.json"),
                                os.path.join(HERE, "..", "package-maker", "plugin-1.0.0.schema.json"))
                    if os.path.exists(p)), None)

CREDENTIAL_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,63}$")
ENV_RE = re.compile(r"^[A-Z][A-Z0-9_]{0,63}$")
SYSTEM_NAME_RE = re.compile(r"^[a-z][a-z0-9-]{1,62}$")
KINDS = ("directory", "mcp", "service", "model")
# THE MODEL SYSTEM (Common Agent 0.39.0, 12.4.1). An agent declares at most one
# system of kind model, whose entry names the formats its scripts speak and no
# credential, variable or setting: the four settings have the same names in
# every agent and the installer binds them without being told. The formats are
# a closed list, and an instruction outside it, or outside the entry's own
# protocols, is refused before anything is changed.
MODEL_PROTOCOLS = ("anthropic-messages", "openai-chat", "gemini")
MODEL_KEY_VAR = "MODEL_KEY"
# The three the instruction supplies as values; MODEL_KEY is a credential the
# instruction names (or leaves empty, for a gateway on the agent's own host).
MODEL_VALUES = ("MODEL_NAME", "MODEL_ENDPOINT", "MODEL_PROTOCOL")
# For 0.39.0 only a host MAY set the former name beside the current one; the
# platform's older scripts still read TEXT_MODEL, so it is placed too.
MODEL_ALIASES = {"TEXT_MODEL": "MODEL_NAME"}
# Characters that can carry invisible instructions: zero-width, bidi
# controls, and the tag block. The depot refuses these at its door; the
# installer refuses them again because a package can reach it another way.
HIDDEN = set(range(0x200B, 0x2010)) | set(range(0x202A, 0x202F)) | set(range(0x2060, 0x2065)) | {0xFEFF} | set(range(0xE0000, 0xE0080))
# Strings that look like a credential VALUE: the prefixes vendors stamp on
# their keys, a signed token, or a long run of token characters mixing
# letters and digits. A hex digest is not one (it is how packages are named).
VALUE_RE = re.compile(
    r"AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20,}|gh[ous]_[A-Za-z0-9]{20,}|xox[abp]-[A-Za-z0-9-]{20,}"
    r"|ya29\.[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{30,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}"
    r"|(?<![A-Za-z0-9])(?:sk|rk|pk)[-_](?:live|test|proj|ant|or|api)?[-_]?[A-Za-z0-9]{16,}")
TOKENISH_RE = re.compile(r"^[A-Za-z0-9+/=_.-]{32,}$")
# The shape of a model name, the same one the procedure holds a model to
# (steps.MODEL_RE): lower case, with its provider in front.
# "@" once at the end for a Vertex model's version, as opencode lists Claude on
# Vertex: google-vertex-anthropic/claude-sonnet-5-5@default (2026-09-29).
MODEL_NAME_RE = re.compile(r"^[a-z0-9][a-z0-9._-]*(/[a-z0-9][a-z0-9._-]*){1,2}(@[a-z0-9._-]+)?$")
HEX_RE = re.compile(r"^[0-9a-f]{32,}$")

# What a runtime or binary name may be found as on a host. A missing name is
# reported as missing; nothing is substituted.
ALIASES = {
    "chromium": ("chromium", "chromium-browser", "google-chrome", "google-chrome-stable"),
    "python": ("python3", "python"),
}

# The per-harness residue. `instructions` is the file the harness reads at
# the agent's home; `skills_dir` is where it discovers skills, so a link
# there lets the harness find them by name (the instructions file names the
# package paths regardless, so nothing depends on discovery); `mcp` names the
# renderer for its configuration. A harness not in this table cannot be a
# deploy target, and the deployer's coverage claim is exactly this table.
HARNESSES = {
    "codex": {"instructions": "AGENTS.md", "skills_dir": ".agents/skills", "mcp": "codex"},
    "opencode": {"instructions": "AGENTS.md", "skills_dir": ".agents/skills", "mcp": "opencode"},
    "claude": {"instructions": ".claude/CLAUDE.md", "skills_dir": ".claude/skills", "mcp": "claude"},
}


# ── small helpers ─────────────────────────────────────────────────────────

def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def sha256_text(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def read_json(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:  # noqa: BLE001
        return None


def looks_like_value(s):
    """True for a string that looks like a credential value rather than a
    name, an address, or a digest."""
    if not isinstance(s, str):
        return False
    if VALUE_RE.search(s):
        return True
    if HEX_RE.match(s):
        return False
    return bool(TOKENISH_RE.match(s) and re.search(r"[A-Za-z]", s) and re.search(r"[0-9]", s))


def model_named(s):
    """True for a setting that is a model name (TEXT_MODEL and the like):
    lower case, provider in front, no known key shape. Claude on Vertex is
    google-vertex-anthropic/claude-sonnet-5-5, a run long enough that the
    token sweep reads it as a value (2026-09-29)."""
    return bool(MODEL_NAME_RE.match(s)) and not VALUE_RE.search(s)


def strings_in(obj):
    if isinstance(obj, str):
        yield obj
    elif isinstance(obj, dict):
        for v in obj.values():
            yield from strings_in(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from strings_in(v)


def system_name(entry):
    """The name a systems[] entry gives the system it is bound to.

    Common Agent 0.16.0-draft renamed this member from `role` to `name`,
    because `role` already means the standard job an agent holds, whose
    contract is an entry at the roles registry. `role` is accepted as an
    alias for one revision, so a package built before the rename still
    installs, and `name` wins where a document carries both. Returns None
    when an entry names neither, which is how a malformed entry is refused
    with the caller's own words rather than a KeyError.
    """
    if not isinstance(entry, dict):
        return None
    for key in ("name", "role"):
        v = entry.get(key)
        if isinstance(v, str) and v:
            return v
    return None


def ceiling_var(name):
    return "CEILING_" + re.sub(r"[^A-Z0-9]", "_", name.upper())


def version_tuple(v):
    """(major, minor, patch) from a version string, ignoring anything after."""
    m = re.match(r"v?(\d+)(?:\.(\d+))?(?:\.(\d+))?", str(v or "").strip())
    if not m:
        return None
    return tuple(int(x or 0) for x in m.groups())


def version_satisfies(found, wanted):
    """Does the version found satisfy `wanted`? Understands >=, >, =, ^, ~
    and a bare version (read as at least that). Unknown wording is treated
    as at least the number in it."""
    f = version_tuple(found)
    if f is None:
        return False
    m = re.match(r"\s*(>=|>|<=|<|=|\^|~)?\s*v?(\d+(?:\.\d+){0,2})", str(wanted or ""))
    if not m:
        return True
    op, w = m.group(1) or ">=", version_tuple(m.group(2))
    if op == ">":
        return f > w
    if op == "<":
        return f < w
    if op == "<=":
        return f <= w
    if op == "=":
        return f[:len(version_tuple(m.group(2)))] == w[:len(version_tuple(m.group(2)))]
    if op == "^":
        return f >= w and f[0] == w[0]
    if op == "~":
        return f >= w and f[:2] == w[:2]
    return f >= w


# ── 1. the package ────────────────────────────────────────────────────────

def check_manifest(manifest):
    """The pinned Agent Plugins schema, applied by hand, the same checks the
    builder applies before it emits. Returns a list of problems."""
    problems = []
    if not SCHEMA_FILE:
        return ["the pinned plugin schema is missing beside the installer; a manifest cannot be verified without it"]
    schema = read_json(SCHEMA_FILE) or {}
    props = schema.get("properties", {})
    if not isinstance(manifest, dict):
        return ["plugin.json is not an object"]
    for k in schema.get("required", []):
        if k not in manifest:
            problems.append(f"plugin.json is missing {k}")
    for k in manifest:
        if k not in props:
            problems.append(f"plugin.json carries {k!r}, which the Agent Plugins schema does not allow")
    if manifest.get("$schema") != SCHEMA_URL:
        problems.append(f"plugin.json must declare {SCHEMA_URL}; it declares {manifest.get('$schema')!r}")
    pat = props.get("name", {}).get("pattern")
    if pat and isinstance(manifest.get("name"), str) and not re.match(pat, manifest["name"]):
        problems.append(f"plugin.json name {manifest['name']!r} does not match the schema's pattern")
    if "extensions" in manifest and not (isinstance(manifest["extensions"], dict)
                                         and all(isinstance(v, dict) for v in manifest["extensions"].values())):
        problems.append("plugin.json extensions must map a namespace to an object")
    return problems


def hidden_characters(pkg_dir):
    found = []
    for root, _, files in os.walk(pkg_dir):
        for fn in files:
            p = os.path.join(root, fn)
            try:
                with open(p, encoding="utf-8") as f:
                    text = f.read()
            except (UnicodeDecodeError, OSError):
                continue
            for i, ch in enumerate(text):
                if ord(ch) in HIDDEN:
                    found.append(f"{os.path.relpath(p, pkg_dir).replace(os.sep, '/')} carries a hidden character U+{ord(ch):04X} at offset {i}")
                    break
    return found


def package_file(pkg_dir, names):
    """The path of the first of `names` present in `pkg_dir`, or None. Used
    with DESCRIPTOR_FILES and INSTALL_FILES, so a package written under the
    current names and one written under the former names both read."""
    for n in names:
        p = os.path.join(pkg_dir, n)
        if os.path.exists(p):
            return p
    return None


def read_package(pkg_dir):
    """Read a package and check it holds together. Returns a dict:
    manifest, descriptor (or None), install (or None), systems (the merged
    list the bindings are planned from), legacy (True for a package from
    before the format), and problems (a list; empty means it can be
    installed). Nothing here executes anything from the package."""
    problems = []
    manifest = read_json(os.path.join(pkg_dir, "plugin.json"))
    if manifest is None:
        return {"manifest": None, "descriptor": None, "install": None, "systems": [],
                "legacy": False, "problems": ["the package has no readable plugin.json"]}
    problems += check_manifest(manifest)
    exts = manifest.get("extensions") if isinstance(manifest.get("extensions"), dict) else {}
    ext = exts.get(EXT)
    legacy = False
    if not isinstance(ext, dict):
        ext = exts.get(OLD_EXT) if isinstance(exts.get(OLD_EXT), dict) else {}
        legacy = True

    def pointed(keys, default_names):
        """A file the manifest points at by path and digest; the pointer's
        digest must match the bytes, or the package is not what was built.
        The first pointer present is read (the current name before the
        former one), and with no pointer the first file present."""
        if isinstance(keys, str):
            keys = (keys,)
        if isinstance(default_names, str):
            default_names = (default_names,)
        key = next((k for k in keys if isinstance(ext.get(k), dict) and isinstance(ext[k].get("path"), str)), keys[0])
        ptr = ext.get(key)
        if isinstance(ptr, dict) and isinstance(ptr.get("path"), str):
            rel = ptr["path"]
            path = os.path.normpath(os.path.join(pkg_dir, rel))
            if not path.startswith(os.path.normpath(pkg_dir)):
                problems.append(f"the manifest's {key} pointer leaves the package: {rel}")
                return None
            if not os.path.exists(path):
                problems.append(f"the manifest points at {rel} for its {key}, and the file is missing")
                return None
            if isinstance(ptr.get("sha256"), str) and sha256_file(path) != ptr["sha256"]:
                problems.append(f"{rel} does not hash to the digest the manifest names for it; the package is not what was built")
                return None
            doc = read_json(path)
            if doc is None:
                problems.append(f"{rel} is not readable JSON")
            return doc
        path = package_file(pkg_dir, default_names)
        return read_json(path) if path else None

    descriptor = pointed("descriptor", DESCRIPTOR_FILES)
    install = pointed(INSTALL_POINTERS, INSTALL_FILES)

    if descriptor is not None:
        if descriptor.get("format") != DESCRIPTOR_FORMAT:
            problems.append(f"the descriptor's format is {descriptor.get('format')!r}, not {DESCRIPTOR_FORMAT}")
        if descriptor.get("subject"):
            problems.append("the package carries a bound descriptor, not a draft; a package's descriptor has no subject")
    if not legacy:
        if descriptor is None:
            problems.append("the package has no descriptor draft")
        if install is None:
            problems.append("the package has no install file")
    if install is not None and install.get("format") not in INSTALL_FORMATS:
        problems.append(f"the install file's format is {install.get('format')!r}, not {INSTALL_FORMAT} (or {LEGACY_INSTALL_FORMAT}, its name before 0.30.0-draft)")

    # The systems, merged: the caller-facing half from the descriptor, the
    # host-facing half from the install file, and the two sets of names equal.
    systems = []
    desc_names = [system_name(s) for s in (descriptor or {}).get("systems", []) if system_name(s)]
    inst_entries = {system_name(s): s for s in (install or {}).get("systems", []) if system_name(s)}
    if install is not None:
        if set(desc_names) != set(inst_entries):
            problems.append(f"the descriptor names the systems {sorted(desc_names)} and the install file {sorted(inst_entries)}; the two sets must be equal")
        for name in desc_names:
            e = inst_entries.get(name, {})
            kind = e.get("kind", "directory")
            if kind not in KINDS:
                problems.append(f"system {name}: kind {kind!r} is not one of {KINDS}")
            if e.get("credential") is not None and not (isinstance(e["credential"], str) and CREDENTIAL_RE.match(e["credential"])):
                problems.append(f"system {name}: the credential must be a name, never a value")
            if e.get("env") is not None and not (isinstance(e["env"], str) and ENV_RE.match(e["env"])):
                problems.append(f"system {name}: env must be a variable name")
            protocols = e.get("protocols")
            if kind == "model":
                if sum(1 for o in inst_entries.values() if o.get("kind") == "model") > 1:
                    problems.append(f"system {name}: an agent declares at most one system of kind model")
                if not (isinstance(protocols, list) and protocols and all(p in MODEL_PROTOCOLS for p in protocols)):
                    problems.append(f"system {name}: a model system names its formats under protocols, one or more of {', '.join(MODEL_PROTOCOLS)}")
                for k in ("credential", "env", "settings"):
                    if e.get(k) is not None:
                        problems.append(f"system {name}: a model system names no {k}; the installer binds MODEL_NAME, MODEL_ENDPOINT, MODEL_KEY and MODEL_PROTOCOL")
            elif protocols is not None:
                problems.append(f"system {name}: only a system of kind model names protocols")
            settings = e.get("settings") or []
            for st in settings:
                if not (isinstance(st, dict) and isinstance(st.get("env"), str) and ENV_RE.match(st["env"])):
                    problems.append(f"system {name}: each setting names the variable the scripts read, e.g. {{\"env\": \"TTS_PROJECT\"}}")
            d = next((s for s in descriptor["systems"] if system_name(s) == name), {})
            systems.append({"name": name, "kind": kind, "access": d.get("access", "read"),
                            "credential": e.get("credential"), "env": e.get("env"),
                            "settings": [st for st in settings if isinstance(st, dict) and isinstance(st.get("env"), str)],
                            "spends": e.get("spends"),
                            **({"protocols": [p for p in protocols if isinstance(p, str)]}
                               if kind == "model" and isinstance(protocols, list) else {})})
    elif legacy:
        for s in ext.get("servers", []):
            if system_name(s):
                systems.append({"name": system_name(s), "kind": "directory", "access": s.get("access", "read"),
                                "credential": None, "env": None, "settings": [], "spends": None})

    # Every spending system has a ceiling entry; every ceiling names one.
    if install is not None:
        spending = {s["name"] for s in systems if s.get("spends")}
        ceilings = install.get("ceilings") or []
        for c in ceilings:
            if not (isinstance(c, dict) and c.get("system") in spending and c.get("per") in ("task", "day")):
                problems.append(f"the install file's ceiling {c} does not name a spending system per task or day")
        for r in sorted(spending):
            if not any(isinstance(c, dict) and c.get("system") == r for c in ceilings):
                problems.append(f"system {r} spends and the install file gives it no ceiling")

    # Each lockfile exists and hashes to what the install file says.
    for dep in (install or {}).get("dependencies", []) or []:
        if not (isinstance(dep, dict) and isinstance(dep.get("lockfile"), str)):
            problems.append(f"a dependency entry names no lockfile: {dep}")
            continue
        lp = os.path.normpath(os.path.join(pkg_dir, dep["lockfile"]))
        if not lp.startswith(os.path.normpath(pkg_dir)) or not os.path.exists(lp):
            problems.append(f"lockfile {dep['lockfile']} is missing from the package")
        elif isinstance(dep.get("sha256"), str) and sha256_file(lp) != dep["sha256"]:
            problems.append(f"lockfile {dep['lockfile']} does not hash to the digest the install file names")

    # Values nowhere, hidden characters nowhere. A string that names a file the
    # package itself carries (an offering's example, such as
    # skills/transcribe/references/example-narration-12s.mp3) is a path, not a
    # value, however long its run of letters and digits.
    root = os.path.normpath(pkg_dir)
    def carried(s):
        p = os.path.normpath(os.path.join(root, s))
        return p.startswith(root + os.sep) and os.path.isfile(p)
    for doc, label in ((descriptor, "the descriptor"), (install, "the install file")):
        for s in strings_in(doc or {}):
            if looks_like_value(s) and not carried(s):
                problems.append(f"{label} carries what looks like a credential value; a package names credentials and never carries them")
                break
    if install is not None and "://" in json.dumps(install):
        problems.append("the install file carries an address; a package names systems and the instruction supplies addresses")
    problems += hidden_characters(pkg_dir)

    return {"manifest": manifest, "descriptor": descriptor, "install": install,
            "systems": systems, "legacy": legacy, "problems": problems}


# ── 2. the host ───────────────────────────────────────────────────────────

def default_probe(name):
    """Find a runtime or binary on this host and return its version line, or
    None when it is not here. Tries the known aliases; runs `--version` and
    reads the first line, which is enough for every runtime named so far."""
    for cand in ALIASES.get(name, (name,)):
        path = shutil.which(cand)
        if not path:
            continue
        try:
            p = subprocess.run([path, "--version"], capture_output=True, text=True, timeout=20)
            line = ((p.stdout or "") + (p.stderr or "")).strip().splitlines()
            return line[0] if line else "present"
        except Exception:  # noqa: BLE001
            return "present"
    return None


def check_host(install, probe=None):
    """What the install file names that this host does not have. Each line
    says the name, what was wanted, what was found, and what it is for, so
    the refusal reads as an escalation and never as a guess."""
    probe = probe or default_probe
    missing = []
    for r in (install or {}).get("runtimes", []) or []:
        if not isinstance(r, dict) or not r.get("name"):
            continue
        found = probe(r["name"])
        if found is None:
            missing.append(f"runtime {r['name']}{' ' + r['version'] if r.get('version') else ''}: not on this host")
        elif r.get("version") and not version_satisfies(found, r["version"]):
            missing.append(f"runtime {r['name']} {r['version']}: found {found}")
    for b in (install or {}).get("binaries", []) or []:
        if not isinstance(b, dict) or not b.get("name"):
            continue
        if probe(b["name"]) is None:
            why = f" ({b['purpose']})" if b.get("purpose") else ""
            missing.append(f"binary {b['name']}: not on this host{why}")
    return missing


def find_binaries(install, which=None):
    """Where each binary the install file names is on this host, by the
    package's own name for it: {name: path}. The path goes into the agent's
    environment as BINARY_<NAME>, so a script asks for the binary the package
    declared and never guesses a path. A name not found is left out; the
    host check has already refused the install by then."""
    which = which or shutil.which
    found = {}
    for b in (install or {}).get("binaries", []) or []:
        if not isinstance(b, dict) or not b.get("name"):
            continue
        for cand in ALIASES.get(b["name"], (b["name"],)):
            path = which(cand)
            if path:
                found[b["name"]] = path
                break
    return found


def binary_var(name):
    return "BINARY_" + re.sub(r"[^A-Z0-9]", "_", name.upper())


# ── 3. the instruction ────────────────────────────────────────────────────

def check_instruction(args, pkg, store_has=None):
    """What the owner's instruction must supply for this package, and what it
    must not carry. Returns refusals; empty means the bindings can be planned.

    `credentials` maps a service system to the NAME the credential is stored
    under (absent: the name the package expects). `settings` maps a service
    system to the non-secret values its scripts read (each declared by the
    install file). `addresses` maps an mcp system to a URL or a command line.
    `ceilings` maps a spending system to a number. `store_has(name)` says
    whether the owner's store holds a credential of that name."""
    refusals = []
    systems = pkg.get("systems", [])
    declared = {s["name"] for s in systems}
    creds = args.get("credentials") or {}
    settings = args.get("settings") or {}
    addresses = args.get("addresses") or {}
    ceilings = args.get("ceilings") or {}
    for label, m in (("credentials", creds), ("settings", settings), ("addresses", addresses), ("ceilings", ceilings)):
        if not isinstance(m, dict):
            refusals.append(f"{label} must map a system to its value")
            continue
        for k in m:
            if k not in declared:
                refusals.append(f"{label} names {k!r}, which is not a system this package has")

    for s in systems:
        sysname = s["name"]
        if s["kind"] == "service":
            name = creds.get(sysname, s.get("credential")) if isinstance(creds, dict) else s.get("credential")
            if s.get("credential") or (isinstance(creds, dict) and sysname in creds):
                if not (isinstance(name, str) and CREDENTIAL_RE.match(name)):
                    refusals.append(f"service {sysname}: the credential must be a NAME in the store, never a value")
                elif store_has is not None and not store_has(name):
                    refusals.append(f"service {sysname}: no credential named {name} in the store; place it there and name it")
                elif not s.get("env"):
                    refusals.append(f"service {sysname}: the package names a credential and no variable to place it in")
            got = settings.get(sysname) if isinstance(settings, dict) else None
            for st in s.get("settings", []):
                v = (got or {}).get(st["env"]) if isinstance(got, dict) else None
                if v in (None, ""):
                    why = f" ({st['purpose']})" if st.get("purpose") else ""
                    refusals.append(f"service {sysname}: the instruction must supply {st['env']}{why}")
                elif not isinstance(v, (str, int, float)):
                    refusals.append(f"service {sysname}: {st['env']} must be a string or a number")
                elif looks_like_value(str(v)) and not model_named(str(v)):
                    refusals.append(f"service {sysname}: {st['env']} looks like a credential value; credentials go in the store by name")
            if isinstance(got, dict):
                for k in got:
                    if k not in {st["env"] for st in s.get("settings", [])}:
                        refusals.append(f"service {sysname}: the instruction supplies {k}, which the package does not declare")
        elif s["kind"] == "model":
            refusals += check_model_instruction(s, creds, settings, store_has)
        elif s["kind"] == "mcp":
            addr = addresses.get(sysname) if isinstance(addresses, dict) else None
            if not (isinstance(addr, str) and addr.strip()):
                refusals.append(f"mcp {sysname}: the instruction must supply an address (a URL or a command line)")
            elif looks_like_value(addr) or any(looks_like_value(t) for t in re.split(r"[\s?&=/]+", addr)):
                refusals.append(f"mcp {sysname}: the address carries what looks like a credential value; name a credential instead")
            if s.get("credential"):
                name = creds.get(sysname, s["credential"]) if isinstance(creds, dict) else s["credential"]
                if not (isinstance(name, str) and CREDENTIAL_RE.match(name)):
                    refusals.append(f"mcp {sysname}: the credential must be a NAME in the store, never a value")
                elif store_has is not None and not store_has(name):
                    refusals.append(f"mcp {sysname}: no credential named {name} in the store; place it there and name it")
                elif not s.get("env"):
                    refusals.append(f"mcp {sysname}: the package names a credential and no variable to place it in")

    for c in (pkg.get("install") or {}).get("ceilings", []) or []:
        if not isinstance(c, dict):
            continue
        n = ceilings.get(c.get("system")) if isinstance(ceilings, dict) else None
        if not (isinstance(n, (int, float)) and not isinstance(n, bool) and n > 0):
            unit = next((s.get("spends", {}).get("unit") for s in systems if s["name"] == c.get("system") and s.get("spends")), "units")
            refusals.append(f"{c.get('system')} spends {unit} and needs a ceiling per {c.get('per')}; the instruction gives none")

    # A value anywhere in the instruction is refused before it is used. The
    # addresses are not swept: a registry path such as gcr.io/<project>/<x>
    # is forty token characters mixing letters and digits, which is what a
    # value looks like, and on 2026-09-14 that refused every update of a
    # container agent on this host. Each of them is checked for its own
    # shape where it is used (the image against its pinned digest, the
    # package address against the allowed hosts).
    # `stack_bindings` is not swept either. It carries addresses, a Google
    # Cloud project id and credential names by design, and a project id with
    # digits in it is exactly what a value looks like to this sweep; the
    # procedure reads that list member by member (steps.read_stack_bindings)
    # and refuses a credential that is not a name there.
    # `owner` is not swept: it names who the agent becomes (an account or
    # organisation id, the kind of long token an id is), and the procedure
    # reads it only to choose the node that holds that owner's agents
    # (steps.node_for_owner). Sweeping it refused the first update filed
    # after the executor began passing it (2026-09-22).
    # `model` is checked for its own shape, not swept: a model name such as
    # google-vertex-anthropic/claude-sonnet-5-5@default is a long token mixing
    # letters and digits, which the sweep reads as a value. That refused the
    # first update filed with a model in its instruction (spec-writer 0.2.6,
    # 2026-09-29). A known key shape is still refused.
    model = args.get("model")
    if model is not None:
        if not (isinstance(model, str) and MODEL_NAME_RE.match(model)) or VALUE_RE.search(model):
            refusals.append("the instruction's model is not a model name; a model is provider/model in lower case, such as google-vertex-anthropic/claude-sonnet-5-5")
    for k, v in args.items():
        if k in ("settings", "addresses", "registry", "image", "package_url", "bucket", "stack_bindings", "owner", "model"):
            continue
        for s in strings_in(v):
            if looks_like_value(s):
                refusals.append(f"the instruction's {k} carries what looks like a credential value; place it in the store and name it")
                break
    return refusals


def check_model_instruction(s, creds, settings, store_has=None):
    """What the instruction must give a model system (12.4.1): MODEL_NAME,
    MODEL_ENDPOINT and MODEL_PROTOCOL as values under settings, and, when the
    endpoint asks for one, the NAME of the credential placed as MODEL_KEY under
    credentials. Absent, MODEL_KEY is placed empty: a gateway on the agent's own
    host needs none. Refusals in words, naming the setting, never a value."""
    sysname = s["name"]
    refusals = []
    got = settings.get(sysname) if isinstance(settings, dict) else None
    got = got if isinstance(got, dict) else {}
    for k in MODEL_VALUES:
        v = got.get(k)
        if v in (None, ""):
            refusals.append(f"model {sysname}: the instruction must supply {k}")
        elif not isinstance(v, str):
            refusals.append(f"model {sysname}: {k} must be a string")
    for k in got:
        if k == MODEL_KEY_VAR:
            refusals.append(f"model {sysname}: MODEL_KEY is a credential; name it under credentials, never give it as a setting")
        elif k not in MODEL_VALUES:
            refusals.append(f"model {sysname}: the instruction supplies {k}, which a model system does not take")
    protocol = got.get("MODEL_PROTOCOL")
    if isinstance(protocol, str) and protocol:
        if protocol not in MODEL_PROTOCOLS:
            refusals.append(f"model {sysname}: MODEL_PROTOCOL {protocol} is not one of {', '.join(MODEL_PROTOCOLS)}")
        elif s.get("protocols") and protocol not in s["protocols"]:
            refusals.append(f"model {sysname}: MODEL_PROTOCOL {protocol} is not one this package's model system speaks ({', '.join(s['protocols'])})")
    endpoint = got.get("MODEL_ENDPOINT")
    if isinstance(endpoint, str) and endpoint:
        if not re.match(r"^https?://[^\s/@]+(/\S*)?$", endpoint):
            refusals.append(f"model {sysname}: MODEL_ENDPOINT must be an http or https address with no credential in it")
        elif any(looks_like_value(t) for t in re.split(r"[\s?&=/]+", endpoint)):
            refusals.append(f"model {sysname}: MODEL_ENDPOINT carries what looks like a credential value")
    name = got.get("MODEL_NAME")
    if isinstance(name, str) and name and looks_like_value(name) and not model_named(name):
        refusals.append(f"model {sysname}: MODEL_NAME looks like a credential value")
    if isinstance(creds, dict) and sysname in creds:
        cred = creds[sysname]
        if not (isinstance(cred, str) and CREDENTIAL_RE.match(cred)):
            refusals.append(f"model {sysname}: the credential must be a NAME in the store, never a value")
        elif store_has is not None and not store_has(cred):
            refusals.append(f"model {sysname}: no credential named {cred} in the store; place it there and name it")
    return refusals


def model_system(pkg):
    """The package's model system, found by its kind and never by its name, or None."""
    return next((s for s in (pkg or {}).get("systems", []) if s.get("kind") == "model"), None)


# ── 4. the dependencies ───────────────────────────────────────────────────

# Where the dependencies a lockfile names are installed: under the agent's own
# home, which is what 12.4 section 2 requires, and outside the package, which
# it does not say and which everything downstream needs.
#
# WHY OUTSIDE THE PACKAGE. npm reads its manifest and its lockfile out of the
# directory it runs in, so the obvious directory is the skill's own scripts
# folder, and that is where the installer ran it until 2026-09-11. It left a
# node_modules inside the installed package, and from that moment the installed
# copy was no longer the package that was installed. The ledger has to skip the
# tree to stay stable, and the image builder refuses a package carrying one
# outright, because a package that ships its own node_modules is a package
# whose dependencies nobody verified: an image built from it would hold
# whatever that host happened to have rather than what the lockfile names. So
# an agent that had been installed once could never be turned into an image
# again, nothing said so, and the only cure was a reinstall from the original
# package. The package directory is now written once, by the copy that places
# it, and never again.
#
# WHY THE DIGEST NAMES THE DIRECTORY. Two skills in one package may name the
# same lockfile, and the explainer maker's two browser skills do; naming the
# directory after the digest installs that tree once and points both skills at
# it. Two skills naming different lockfiles get two directories, with nothing
# merged and no package refused. And a script looking for its dependencies
# computes the same digest from the lockfile it carries, so what it loads is
# what its own lockfile named or nothing at all.
DEPS_DIR = ".deps"
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")


def deps_root(home):
    """Where every dependency tree for this agent sits. Hidden, and a name no
    package can take: the directories an install file declares are
    lowercase-hyphen names and are placed at ~/<name>."""
    return os.path.join(home, DEPS_DIR)


def deps_plan(home, install):
    """One entry per dependency the install file names, in its order: the
    skill, the lockfile's path inside the package, its digest, and the
    directory its tree goes in. Two entries with the same digest name the same
    directory, so the caller installs that tree once.

    Returns (plan, problems). A dependency with no digest is a problem rather
    than a directory named after nothing: the digest is the only thing tying a
    tree to the lockfile it came from, and a script that cannot name the tree
    it wants cannot tell it from any other."""
    plan, problems = [], []
    for dep in (install or {}).get("dependencies", []) or []:
        rel = dep.get("lockfile") if isinstance(dep, dict) else None
        sha = dep.get("sha256") if isinstance(dep, dict) else None
        if not (isinstance(rel, str) and rel) or rel.startswith("/") or ".." in rel.split("/"):
            problems.append(f"a dependency names {rel!r}, which is not a path inside the package")
            continue
        if not (isinstance(sha, str) and SHA256_RE.match(sha)):
            problems.append(f"the install file names {rel} with no digest, so nothing can say which tree belongs to it")
            continue
        plan.append({"skill": dep.get("skill"), "lockfile": rel, "sha256": sha,
                     "dir": os.path.join(deps_root(home), sha)})
    return plan, problems


# ── 5. the bindings ───────────────────────────────────────────────────────

def plan_bindings(args, pkg, home):
    """One binding per system name: where a directory lives, which named
    credential and settings a service gets and under which variables, what a
    ceiling is set to, and what address an mcp system is bound to. Names and
    addresses only; the values are placed by the procedure."""
    creds = args.get("credentials") or {}
    settings = args.get("settings") or {}
    addresses = args.get("addresses") or {}
    ceilings = args.get("ceilings") or {}
    limits = {c["system"]: c for c in (pkg.get("install") or {}).get("ceilings", []) or [] if isinstance(c, dict)}
    out = []
    for s in pkg.get("systems", []):
        b = {"name": s["name"], "kind": s["kind"], "access": s.get("access", "read")}
        if s["kind"] == "directory":
            b["path"] = f"{home}/work/{s['name']}"
        elif s["kind"] == "model":
            # The four settings under their fixed names (12.4.1), the former
            # name beside the current one for this version, and MODEL_KEY as a
            # credential when the instruction names one, empty when it does not.
            got = settings.get(s["name"]) if isinstance(settings, dict) else {}
            got = got if isinstance(got, dict) else {}
            b["settings"] = {k: str(got.get(k)) for k in MODEL_VALUES}
            for alias, of in MODEL_ALIASES.items():
                b["settings"][alias] = b["settings"][of]
            if isinstance(creds, dict) and creds.get(s["name"]):
                b["credential"] = creds[s["name"]]
                b["env"] = MODEL_KEY_VAR
            else:
                b["settings"][MODEL_KEY_VAR] = ""
            if s.get("spends"):
                b["spends"] = s["spends"].get("unit")
                if s["name"] in limits:
                    b["ceiling"] = {"per": limits[s["name"]]["per"], "limit": ceilings.get(s["name"]),
                                    "env": ceiling_var(s["name"]),
                                    **({"enforced_by": limits[s["name"]]["enforced_by"]}
                                       if limits[s["name"]].get("enforced_by") in ("runtime", "platform") else {})}
        else:
            if s.get("credential") or s["name"] in creds:
                b["credential"] = creds.get(s["name"], s.get("credential"))
                b["env"] = s.get("env")
            got = settings.get(s["name"]) if isinstance(settings, dict) else {}
            b["settings"] = {st["env"]: str((got or {}).get(st["env"])) for st in s.get("settings", [])}
            if s["kind"] == "mcp":
                b["address"] = addresses.get(s["name"])
            if s.get("spends"):
                b["spends"] = s["spends"].get("unit")
                if s["name"] in limits:
                    # The enforcing side travels with the number (12.4 rule 4):
                    # a number alone does not say who can refuse a charge over
                    # it. The install file states it and the builder derives it
                    # from how the package reaches the system; nothing here
                    # derives it a second time, and a package that states none
                    # leaves it absent rather than being given the flattering
                    # word by an installer that did not observe it.
                    b["ceiling"] = {"per": limits[s["name"]]["per"], "limit": ceilings.get(s["name"]),
                                    "env": ceiling_var(s["name"]),
                                    **({"enforced_by": limits[s["name"]]["enforced_by"]}
                                       if limits[s["name"]].get("enforced_by") in ("runtime", "platform") else {})}
        out.append(b)
    return out


def shell_quote(v):
    return "'" + str(v).replace("'", "'\"'\"'") + "'"


def env_file(bindings, values, binaries=None, deps=None):
    """The file the brain sources before it runs the harness: every placed
    credential under the variable the scripts read, every setting, every
    ceiling with its unit and period, and where each declared binary is on
    this host. `values` maps a credential NAME to its value, fetched from the
    store by the procedure; nothing here reads a store.

    `deps` is where the dependency trees were installed, which a skill's
    scripts read as AGENT_DEPS and under which they look for the tree named
    after their own lockfile's digest. It is left out when the package names
    no lockfile, because this file says what was placed and nothing was."""
    lines = ["# Placed by the deployment manager. Credentials by name from the owner's store;",
             "# settings and ceilings from the owner's instruction; binaries where this host has them.",
             "# Never edited by hand."]
    if deps:
        lines.append(f"export AGENT_DEPS={shell_quote(deps)}")
    for name, path in sorted((binaries or {}).items()):
        lines.append(f"export {binary_var(name)}={shell_quote(path)}")
    for b in bindings:
        if b.get("credential") and b.get("env"):
            if b["credential"] not in values:
                raise KeyError(b["credential"])
            lines.append(f"export {b['env']}={shell_quote(values[b['credential']])}")
        for k, v in (b.get("settings") or {}).items():
            lines.append(f"export {k}={shell_quote(v)}")
        if b.get("ceiling"):
            c = b["ceiling"]
            lines.append(f"export {c['env']}={shell_quote(c['limit'])}")
            lines.append(f"export {c['env']}_PER={shell_quote(c['per'])}")
            if b.get("spends"):
                lines.append(f"export {c['env']}_UNIT={shell_quote(b['spends'])}")
    return "\n".join(lines) + "\n"


def ceilings_doc(bindings):
    """The ceilings file the agent reads: the number, what it is per, the unit,
    the variable it is in, and which side applies it. The enforcing side is
    here as well as in the record because the agent is one of the two sides:
    under `runtime` there is nobody else in the path, and a package whose
    scripts read this file should not have to guess that."""
    return {"ceilings": [{"system": b["name"], "per": b["ceiling"]["per"], "limit": b["ceiling"]["limit"],
                          "unit": b.get("spends"), "env": b["ceiling"]["env"],
                          **({"enforced_by": b["ceiling"]["enforced_by"]} if b["ceiling"].get("enforced_by") else {})}
                         for b in bindings if b.get("ceiling")]}


def placed_names(bindings):
    """What the record may say: credential names, setting variable names,
    and the ceilings set, each with the side that applies it. Never a value."""
    return {"credentials": sorted({b["credential"] for b in bindings if b.get("credential")}),
            "settings": sorted({k for b in bindings for k in (b.get("settings") or {})}),
            "ceilings": [{"system": b["name"], "per": b["ceiling"]["per"], "limit": b["ceiling"]["limit"],
                          **({"unit": b["spends"]} if b.get("spends") else {}),
                          **({"enforced_by": b["ceiling"]["enforced_by"]} if b["ceiling"].get("enforced_by") else {})}
                         for b in bindings if b.get("ceiling")]}


# ── 6. the harness ────────────────────────────────────────────────────────

def mcp_servers(bindings):
    """The mcp bindings in the shape the renderers take: name, remote URL or
    local command, and the variable holding a bearer credential when the
    package names one."""
    out = []
    for b in bindings:
        if b["kind"] != "mcp" or not b.get("address"):
            continue
        addr = b["address"].strip()
        e = {"name": b["name"]}
        if re.match(r"^https?://", addr):
            e["url"] = addr
        else:
            e["command"] = shlex.split(addr)
        if b.get("env"):
            e["bearer_env"] = b["env"]
        out.append(e)
    return out


def render_codex_config(model, name, servers):
    """~/.codex/config.toml, whole: the model provider the fleet uses (Claude
    on Vertex AI through the host's responses-bridge on 127.0.0.1:8788, no
    key; owner, 2026-10-03), the home as a trusted project,
    and one table per MCP server."""
    lines = [f'model = "{model}"', 'model_provider = "vertex"', "",
             "[model_providers.vertex]", 'name = "Claude on Vertex AI (fleet bridge)"',
             'base_url = "http://127.0.0.1:8788/v1"',
             'wire_api = "responses"', "",
             f'[projects."/home/{name}"]', 'trust_level = "trusted"']
    for s in servers:
        lines += ["", f'[mcp_servers.{s["name"]}]']
        if "url" in s:
            lines.append(f'url = {json.dumps(s["url"])}')
            if s.get("bearer_env"):
                lines.append(f'bearer_token_env_var = "{s["bearer_env"]}"')
        else:
            lines.append(f'command = {json.dumps(s["command"][0])}')
            lines.append(f'args = {json.dumps(s["command"][1:])}')
    return "\n".join(lines) + "\n"


def render_opencode_config(servers):
    """~/.config/opencode/opencode.json: the MCP servers by system name."""
    mcp = {}
    for s in servers:
        if "url" in s:
            e = {"type": "remote", "url": s["url"], "enabled": True}
            if s.get("bearer_env"):
                e["headers"] = {"Authorization": "Bearer {env:%s}" % s["bearer_env"]}
        else:
            e = {"type": "local", "command": s["command"], "enabled": True}
        mcp[s["name"]] = e
    return json.dumps({"$schema": "https://opencode.ai/config.json", "mcp": mcp}, indent=2) + "\n"


def render_claude_config(servers):
    """~/.claude.json: the MCP servers by system name, at user scope."""
    mcp = {}
    for s in servers:
        if "url" in s:
            e = {"type": "http", "url": s["url"]}
            if s.get("bearer_env"):
                e["headers"] = {"Authorization": "Bearer ${%s}" % s["bearer_env"]}
        else:
            e = {"command": s["command"][0], "args": s["command"][1:]}
        mcp[s["name"]] = e
    return json.dumps({"mcpServers": mcp}, indent=2) + "\n"


def harness_files(harness, name, model, bindings):
    """The harness configuration to place, as {relative path: text}. The
    codex file is rendered whole because the deployer owns it; the others
    are rendered whole because the agent's home is new."""
    servers = mcp_servers(bindings)
    if harness == "codex":
        return {".codex/config.toml": render_codex_config(model, name, servers)}
    if harness == "opencode":
        return {".config/opencode/opencode.json": render_opencode_config(servers)} if servers else {}
    if harness == "claude":
        return {".claude.json": render_claude_config(servers)} if servers else {}
    return {}


def lay_out_skills(home, pkg_name, skills, harness, link=True):
    """Put the package's skills where the harness discovers them: one entry
    per skill under the harness's skills directory, linked to the package's
    own copy so there is one set of bytes. Returns the relative paths made."""
    made = []
    rel_dir = HARNESSES[harness]["skills_dir"]
    os.makedirs(os.path.join(home, rel_dir), exist_ok=True)
    for slug in skills:
        src = os.path.join(home, pkg_name, "skills", slug)
        dst = os.path.join(home, rel_dir, slug)
        if os.path.lexists(dst):
            if os.path.islink(dst) or os.path.isfile(dst):
                os.remove(dst)
            else:
                shutil.rmtree(dst)
        if link:
            os.symlink(src, dst)
        else:
            shutil.copytree(src, dst)
        made.append(f"{rel_dir}/{slug}")
    return made


# ── 7. the ledger ─────────────────────────────────────────────────────────

def walk_files(root, rel):
    """Every file under root/rel, as relative paths with forward slashes."""
    base = os.path.join(root, rel)
    if os.path.isfile(base):
        return [rel]
    out = []
    for r, dirs, files in os.walk(base):
        dirs[:] = [d for d in dirs if d != "node_modules"]
        for fn in files:
            out.append(os.path.relpath(os.path.join(r, fn), root).replace(os.sep, "/"))
    return sorted(out)


def ledger(root, rels, withhold=()):
    """The ledger of placed files: each with its digest, except the ones
    whose digest is withheld because the file holds credentials (a digest of
    a small secret is a hint about the secret)."""
    entries = []
    for rel in rels:
        for f in walk_files(root, rel):
            if f in withhold:
                entries.append({"path": f, "sha256": None, "withheld": "holds credentials"})
            else:
                entries.append({"path": f, "sha256": sha256_file(os.path.join(root, f))})
    return entries


def ledger_digest(entries):
    return sha256_text(json.dumps(entries, sort_keys=True, separators=(",", ":")))


def drift(entries, root):
    """Every placed file that no longer matches its ledger entry: changed or
    missing. Files whose digest was withheld are checked for presence only."""
    out = []
    for e in entries:
        p = os.path.join(root, e["path"])
        if not os.path.exists(p):
            out.append({"path": e["path"], "state": "missing"})
        elif e.get("sha256") and sha256_file(p) != e["sha256"]:
            out.append({"path": e["path"], "state": "changed"})
    return out
