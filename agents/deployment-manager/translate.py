#!/usr/bin/env python3
"""Flatten an Agent Package into the instructions file a CLI harness reads.

This is the translation step of the install for a harness that reads an
instructions file rather than the package format: the job in one paragraph,
a pointer to each skill, the declared system names and how each is bound on
this host (a directory, a service whose credential sits in a named variable,
an MCP server named in the harness configuration), the ceilings as binding,
the records duty, and the NOT list as binding. Wording follows the two
hand-walks recorded in docs/deploy-walk-redline.md.

The package's facts are read from where the format keeps them
(Common Agent Specification, chapter 12): the caller-facing ones from
descriptor.json, the host-facing ones from install.json, both named by the
manifest's extension entry. A package from before that format, whose
manifest carries the systems inline, is still read, so the abstract agents
already in the catalog keep deploying.

Usage: translate.py <package_dir> <agent_name> [bindings.json]
       (the instructions file on stdout; bindings.json is what steps.py
       planned, so the file says which variable and which ceiling each
       service got on this host)
"""
import json
import os
import sys

EXT = "net.agentdoc.package"
# The namespace packages carried before the package format was published.
OLD_EXT = "com.agentcatalog.agent"


def system_name(entry):
    """The name a systems[] entry gives the system it is bound to.

    Common Agent 0.16.0-draft renamed this member from `role` to `name`,
    because `role` already means the standard job an agent holds. `role` is
    read as an alias for one revision, so a package built before the rename
    still translates, and `name` wins where a document carries both.
    """
    if not isinstance(entry, dict):
        return None
    for key in ("name", "role"):
        v = entry.get(key)
        if isinstance(v, str) and v:
            return v
    return None


def read_json(path):
    try:
        return json.load(open(path, encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return None


def package_facts(pkg_dir):
    """The manifest, the descriptor (or None), the install file (or None),
    and the systems as a list of {name, access, kind, credential?, env?}."""
    plugin = json.load(open(os.path.join(pkg_dir, "plugin.json"), encoding="utf-8"))
    exts = plugin.get("extensions") or {}
    ext = exts.get(EXT) or exts.get(OLD_EXT) or {}
    desc = inst = None
    if isinstance(ext.get("descriptor"), dict) and ext["descriptor"].get("path"):
        desc = read_json(os.path.join(pkg_dir, ext["descriptor"]["path"]))
    elif os.path.exists(os.path.join(pkg_dir, "descriptor.json")):
        desc = read_json(os.path.join(pkg_dir, "descriptor.json"))
    if isinstance(ext.get("install"), dict) and ext["install"].get("path"):
        inst = read_json(os.path.join(pkg_dir, ext["install"]["path"]))
    elif os.path.exists(os.path.join(pkg_dir, "install.json")):
        inst = read_json(os.path.join(pkg_dir, "install.json"))

    systems = []
    if desc and isinstance(desc.get("systems"), list):
        kinds = {system_name(s): s for s in (inst or {}).get("systems", []) if system_name(s)}
        for s in desc["systems"]:
            n = system_name(s)
            if not n:
                continue
            k = kinds.get(n, {})
            systems.append({"name": n, "access": s.get("access", "read"),
                            "kind": k.get("kind", "directory"), "credential": k.get("credential"),
                            "env": k.get("env"),
                            "settings": [st.get("env") for st in (k.get("settings") or []) if isinstance(st, dict) and st.get("env")]})
    else:
        # The older shape: systems copied into the manifest as `servers`.
        for s in ext.get("servers", []):
            if system_name(s):
                systems.append({"name": system_name(s), "access": s.get("access", "read"),
                                "kind": "directory", "credential": None, "env": None, "settings": []})
    return plugin, desc, inst, systems


def bound_line(s, b):
    """How one system is bound on this host, in one cell."""
    if s["kind"] == "service":
        env = (b or {}).get("env") or s.get("env")
        cred = (b or {}).get("credential") or s.get("credential")
        if env:
            bound = f"a service; its credential is in ${env}"
            if cred:
                bound += f" (the secret named {cred})"
        elif cred:
            bound = f"a service; the host placed the secret named {cred}"
        else:
            bound = "a service"
        settings = list(((b or {}).get("settings") or {}).keys()) or s.get("settings") or []
        if settings:
            bound += "; its settings are in " + ", ".join(f"${k}" for k in settings)
        c = (b or {}).get("ceiling")
        if c:
            unit = (b or {}).get("spends") or "units"
            bound += f"; ceiling ${c['env']} = {c['limit']} {unit} per {c['per']}"
        return bound
    if s["kind"] == "mcp":
        return f"the MCP server named {s['name']} in your harness configuration"
    return f"~/work/{s['name']}"


def render(pkg_dir, name, bindings=None):
    plugin, desc, inst, systems = package_facts(pkg_dir)
    pkg = plugin["name"]
    home_pkg = f"~/{pkg}"
    by_name = {b["name"]: b for b in (bindings or []) if isinstance(b, dict) and b.get("name")}
    # The generated views live under the package's namespace directory.
    views = EXT if os.path.isdir(os.path.join(pkg_dir, EXT)) else OLD_EXT

    skills = sorted(
        d for d in os.listdir(os.path.join(pkg_dir, "skills"))
        if os.path.isdir(os.path.join(pkg_dir, "skills", d))
    )
    dirs = [d.get("name") for d in (inst or {}).get("directories", []) if isinstance(d, dict) and d.get("name")]
    records_dir = "records" if "records" in dirs else (dirs[0] if dirs else "work")
    ceilings = [b for b in (bindings or []) if isinstance(b, dict) and b.get("ceiling")]

    lines = [
        f"# {name}, deployed from the {pkg} package",
        "",
        f"You are {name}, a mesh agent implementing the abstract agent",
        f"`{pkg}`, published at {plugin.get('homepage', 'agentcatalog.com')}.",
        f"The package is unpacked at {home_pkg} and it is your job description.",
        "",
        "Messages arrive from the mesh; your reply goes back to the sender.",
        "Answer plainly, in prose. Keep replies short unless a produced",
        "document is the deliverable.",
        "",
        "## The job",
        "",
        ((desc or {}).get("does") or plugin.get("description", "")).strip(),
        "",
        "## How to work a request",
        "",
        "Before acting, read the skill that matches the request:",
        "",
    ]
    lines += [f"- {home_pkg}/skills/{s}/SKILL.md" for s in skills]
    lines += [
        "",
        "## Where the systems live",
        "",
        "The systems the job needs, by name, and how each is bound on this host:",
        "",
        "| system | bound to | access |",
        "|---|---|---|",
    ]
    for s in systems:
        lines.append(f"| {s['name']} | {bound_line(s, by_name.get(s['name']))} | {s['access']} |")
    if any(s["kind"] == "service" for s in systems):
        lines += [
            "",
            "The variables above are set in your environment before you run;",
            "a script reads them and never receives a value any other way. If",
            "one is missing, stop and say which, rather than asking for a value.",
        ]
    if ceilings:
        lines += ["", "## Ceilings", ""]
        for b in ceilings:
            c = b["ceiling"]
            unit = b.get("spends") or "units"
            lines.append(f"- {b['name']}: {c['limit']} {unit} per {c['per']}, in ${c['env']}.")
        lines += [
            "",
            "A ceiling is binding. A script that would pass one stops and says",
            "so; you report it and never raise it. The owner sets ceilings.",
        ]
    lines += [
        "",
        "## Records",
        "",
        f"Leave the records named in {home_pkg}/{views}/RECORDS.md under",
        f"~/{records_dir}/ as you work, one folder per task. A job that leaves",
        "no records did not happen.",
        "",
        "## Where you stop",
        "",
        f"{home_pkg}/{views}/NOT.md is binding. When a request matches the",
        "escalation list there, name who it goes to instead of answering it.",
        "",
        "## Work outside the job",
        "",
        "If a request has nothing to do with this job, decline it in one",
        "sentence and say what you do do. Do not answer off-topic work.",
        "",
    ]
    return "\n".join(lines)


def main() -> None:
    pkg_dir, name = sys.argv[1], sys.argv[2]
    bindings = read_json(sys.argv[3]) if len(sys.argv) > 3 else None
    sys.stdout.write(render(pkg_dir, name, bindings))


if __name__ == "__main__":
    main()
