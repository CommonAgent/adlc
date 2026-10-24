#!/usr/bin/env python3
"""Agent Builder procedure: spec in, packaged plugin plus signed record out.

One procedure so the brain cannot botch the build/pack/hash/record sequence.
Runs unprivileged as the agentbuilder user: building a package is just writing
files, so this needs no root and no sudoers, unlike the deployment manager.

Given a spec file (written by the brain under its own tmp) it:
  1. runs build.py to emit the package,
  2. asks the image resolver which base image the package could be built on,
     and refuses to pack one that could be built on none,
  3. tars it and hashes the tarball,
  4. builds and signs an agent-build-record-v1 with the builder's identity,
and prints one JSON object naming the package, the tarball, and the record.

Usage: pack.py <spec.json | agent folder> <identity.json> [--from <file>...] [--job <job folder>]

  The input is an agent's folder (agent-descriptor.json,
  agent-runtime-requirements.json, plugin.json and skills/, the layout Common
  Agent 13.2 says a package is authored in) or a spec.json, which the builder
  still reads, with a warning, for one transition. A run's work arrives as a
  spec and the files it names, so --from goes with a spec.

  --from   the files a run handed over with the spec or the agent's files:
           the scripts, references and assets they name, each matched by its
           name after the inbound prefix the adapter puts on an attachment,
           plus the job-manifest.json the code-writer's delivery travels with.
           They are laid out under the builder's own tmp as the package source
           with the spec or the agent's files beside them, so a package is
           built from what a run delivered and never from a copy that happened
           to be lying around.

  A run's work arrives as the agent's own files (what the spec writer
  delivers since 0.3.0) or, for one transition, as a spec. The agent's files
  are found among the attachments by content and laid out as a folder under
  the builder's tmp, and that folder is what is built; they are preferred
  where both came.
  --job    the job folder of the message this pack answers. The tarball and
           the signed build record are placed under its out/ and listed in
           pieces.json, so the reply carries the package as a piece the next
           phase of a run can take, and not only its name.
"""
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
import time

HOME = os.path.expanduser("~")
BUILT = os.path.join(HOME, "built")
DIST = os.path.join(HOME, "dist")
RECORDS = os.path.join(HOME, "records")
HERE = os.path.dirname(os.path.abspath(__file__))
BUILD = next((p for p in (os.path.join(HERE, "agentbuilder-build.py"),
                          os.path.join(HERE, "build.py")) if os.path.exists(p)),
             os.path.join(HERE, "agentbuilder-build.py"))
SIGN = next((p for p in (os.path.join(HERE, "agentbuilder-sign.mjs"),
                         os.path.join(HERE, "sign.mjs")) if os.path.exists(p)),
            os.path.join(HERE, "agentbuilder-sign.mjs"))
# The image resolver. Same two spellings as BUILD and SIGN, because this file
# runs both from the repo and installed flat in /opt/fleet beside the
# deployment manager's copy of the resolver. None when neither is here, which
# is a host that cannot answer the question rather than a package that fails
# it, and the record says which.
IMAGE = next((p for p in (os.path.join(HERE, "deploymgr-emit-image.mjs"),
                          os.path.join(HERE, os.pardir, "image", "emit-image.mjs"))
              if os.path.exists(p)), None)
# The operator's catalogue of bases, looked for where the resolver's own
# default puts it, beside the resolver. Found rather than passed in on the
# call: a path passed in is the path the resolver names back in its refusal,
# and where this machine keeps its files is nothing a requester can act on.
BASES = os.path.join(os.path.dirname(IMAGE), "bases", "catalogue.json") if IMAGE else None
ADAPTER_MODULES = "/usr/lib/node_modules/mesh-adapter/node_modules"
TAG = "agent-build-record-v1"
# The agent's repository (run-your-own-copy plan, items 17 and 21). Same two
# spellings as BUILD and SIGN. None when it is not beside this builder, which
# means a run makes no repository and everything else here is unchanged; it
# never means a build fails.
REPO = next((p for p in (os.path.join(HERE, "agentbuilder-repo.mjs"),
                         os.path.join(HERE, "repo.mjs")) if os.path.exists(p)), None)

# Ask the resolver, in its own language, and say which of its three answers
# came back. It is imported rather than run as a command because the command
# emits a whole build context and this only wants the first question it asks.
# A catalogue the resolver will not read is separated from a package it will
# not build: the first is the operator's file being wrong on this host, and
# refusing to pack for it would brick the builder over something no requester
# can fix.
RESOLVE_JS = """
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
const say = (o) => console.log(JSON.stringify(o));
const m = await import(pathToFileURL(process.env.PACK_RESOLVER).href);
try {
  m.readBases();
} catch (e) {
  say({ ok: false, catalogue: String(e?.message ?? e) });
  process.exit(0);
}
try {
  const install = JSON.parse(readFileSync(process.env.PACK_INSTALL, "utf8"));
  say({ ok: true, ...m.resolveBase(install, { packageName: process.env.PACK_NAME }) });
} catch (e) {
  if (e instanceof m.Refusal) say({ ok: false, refused: e.message });
  else say({ ok: false, error: String(e?.message ?? e) });
}
"""


def git_source(path):
    """Where the builder read what it built, when it read a repository at a
    commit (Common Agent 8.2 `source`, 0.17.0-draft). Three rules, and each
    one is why a member is absent rather than wrong:

      - not a git checkout: nothing to name, so no member;
      - anything uncommitted under that path: the commit does not describe the
        bytes that were built, and a commit that describes nothing is worse
        than no commit at all;
      - a remote whose address carries a user or a token: the address is
        stripped of it, because a record is published and a token in one is a
        token leaked.

    An absent member says this builder did not observe where its source came
    from, which is Section 8.3's rule about absent members.
    """
    def git(*args):
        r = subprocess.run(["git", "-C", path, *args], capture_output=True, text=True, timeout=20)
        return r.stdout.strip() if r.returncode == 0 else None

    if not os.path.isdir(path):
        return None
    top = git("rev-parse", "--show-toplevel")
    commit = git("rev-parse", "HEAD")
    if not top or not commit:
        return None
    dirty = git("status", "--porcelain", "--", path)
    if dirty is None or dirty:
        return None
    remote = git("remote", "get-url", "origin") or ""
    remote = re.sub(r"^(https?://)[^/@]*@", r"\1", remote.strip())
    if not remote:
        return None
    rel = os.path.relpath(os.path.abspath(path), os.path.abspath(top)).replace(os.sep, "/")
    return {"repository": remote, "commit": commit, **({"path": rel} if rel not in (".", "") else {})}


def out(obj):
    print(json.dumps(obj))
    sys.exit(0 if obj.get("ok") else 1)


# The prefix the adapter puts on an inbound attachment's name so two files
# with the same name do not collide: <n>-<8 character id>-<the name as sent>.
# The id is exactly eight characters and may itself hold a dash, so the
# match is by count, never by a dash that could sit inside a sent name.
# Two forms: a file staged on a container's mount is <n>-<8 chars>-<name>;
# a file the adapter downloads for a host agent is <8 chars>-<name>, with no
# counter. On 2026-09-15 the second form matched nothing and the pack refused
# five scripts that were sitting in the folder.
INBOUND_PREFIX = re.compile(r"^(?:\d+-)?[A-Za-z0-9_-]{8}-(?=.)")
MANIFEST_NAME = "job-manifest.json"


def sent_name(path):
    """The name a file was sent under, with the adapter's inbound prefix off.
    Taken off as many times as it is there: a file the process runner passed
    on from one phase to the next arrives with a prefix per hop, and the
    name the spec knows is the one under all of them."""
    name = os.path.basename(path)
    while True:
        stripped = INBOUND_PREFIX.sub("", name, count=1)
        if stripped == name:
            return name
        name = stripped


def lay_out(spec_path, files):
    """The package source a run handed over, laid out the way the builder
    reads it: the spec as spec.json under the builder's tmp, every file the
    spec names at the relative path it names (matched by the file's sent
    name against the entry's basename), and the delivery manifest beside the
    spec where the provenance check looks for it. Returns the new spec path
    and what was placed, missing or left over."""
    with open(spec_path, encoding="utf-8") as f:
        spec = json.load(f)
    name = spec.get("name") or "package"
    version = spec.get("version") or "0.0.0"
    root = os.path.join(HOME, "tmp", f"{name}-{version}-run")
    shutil.rmtree(root, ignore_errors=True)
    os.makedirs(root)
    wanted = {}
    for j in spec.get("jobs") or []:
        for kind in ("scripts", "references", "assets"):
            for rel in j.get(kind) or []:
                if isinstance(rel, str) and rel and ".." not in rel.split("/") and not rel.startswith("/"):
                    wanted.setdefault(os.path.basename(rel), rel)
    placed, left = [], []
    manifest = None
    for path in files:
        sent = sent_name(path)
        if sent == MANIFEST_NAME:
            manifest = os.path.join(root, MANIFEST_NAME)
            shutil.copy(path, manifest)
            continue
        rel = wanted.get(sent)
        if not rel:
            left.append(sent)
            continue
        dest = os.path.join(root, rel)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        shutil.copy(path, dest)
        placed.append(rel)
    new_spec = os.path.join(root, "spec.json")
    spec.pop("source", None)
    with open(new_spec, "w", encoding="utf-8") as f:
        json.dump(spec, f, indent=2)
    missing = sorted(set(wanted.values()) - set(placed))
    return new_spec, {"placed": sorted(placed), "missing": missing, "left_over": sorted(left),
                      "manifest": manifest}


AGENT_DESCRIPTOR_FORMAT = "agent-descriptor-v1"
AGENT_RUNTIME_FORMATS = ("agent-runtime-requirements-v1", "agent-install-v1")
SLUG_RE = re.compile(r"^[a-z][a-z0-9-]{1,62}$")


def skill_slug_of(text):
    """The skill a SKILL.md names: exactly one unindented `name:` line inside
    the frontmatter, between the opening `---` and the next. The same rule as
    agent-folder.mjs's skillSlugOf, so a file is a skill to every reader or
    to none."""
    t = text.replace("\r", "")
    if not t.startswith("---\n"):
        return None
    end = t.find("\n---", 3)
    if end < 0:
        return None
    names = [ln[5:].strip() for ln in t[4:end].split("\n") if ln.startswith("name:")]
    return names[0] if len(names) == 1 and SLUG_RE.match(names[0]) else None


def agent_file_kind(text):
    """What one attached file is, by its content: ("descriptor", doc),
    ("runtime", doc), ("manifest", doc), ("skill", slug), or None. Told apart
    by content, never by name, for the reason spec_among gives."""
    if text.startswith("---"):
        slug = skill_slug_of(text)
        return ("skill", slug) if slug else None
    try:
        doc = json.loads(text)
    except Exception:  # noqa: BLE001
        return None
    if not isinstance(doc, dict):
        return None
    if doc.get("format") == AGENT_DESCRIPTOR_FORMAT:
        return ("descriptor", doc)
    if doc.get("format") in AGENT_RUNTIME_FORMATS:
        return ("runtime", doc)
    ext = doc.get("extensions")
    if isinstance(ext, dict) and ("net.agentdoc.package" in ext or "agent-plugins.org" in str(doc.get("$schema", ""))):
        return ("manifest", doc)
    return None


def agent_files_among(files):
    """One agent's own files among the attachments, or None unless a
    manifest, a descriptor and runtime requirements are all there. The same
    choice as agent-folder.mjs's agentFilesAmongTexts: the manifest first
    (the last carrying the builder's entry, else the last), then the
    descriptor whose agent_version is its version (else the last), the last
    runtime requirements, and only the skills the manifest's build entry
    names (or the descriptor's offerings and steps), the later of two for one
    skill. Everything else is an ordinary attachment, laid out where the
    agent's files name it. A job manifest is skipped by name."""
    of = {"manifest": [], "descriptor": [], "runtime": []}
    skills = []
    for path in files:
        if sent_name(path) == MANIFEST_NAME:
            continue
        try:
            with open(path, encoding="utf-8") as f:
                text = f.read()
        except Exception:  # noqa: BLE001
            continue
        k = agent_file_kind(text)
        if not k:
            continue
        if k[0] == "skill":
            skills.append((path, k[1]))
        else:
            of[k[0]].append((path, k[1]))

    def last(xs, ok=lambda x: True):
        return next((x for x in reversed(xs) if ok(x)), None)

    def build_of(doc):
        b = ((doc.get("extensions") or {}).get("net.agentdoc.package") or {}).get("build")
        return b if isinstance(b, dict) else None

    manifest = last(of["manifest"], lambda m: build_of(m[1]) is not None) or last(of["manifest"])
    if not manifest:
        return None
    version = manifest[1].get("version")
    descriptor = (last(of["descriptor"], lambda d: version is not None and str(d[1].get("agent_version")) == str(version))
                  or last(of["descriptor"]))
    runtime = last(of["runtime"])
    if not (descriptor and runtime):
        return None
    build = build_of(manifest[1]) or {}
    if isinstance(build.get("skills"), dict):
        wanted = set(build["skills"])
    else:
        wanted = set()
        for o in descriptor[1].get("offerings") or []:
            if isinstance(o, dict):
                wanted.add(o.get("id"))
                wanted.update(s.get("id") for s in o.get("steps") or [] if isinstance(s, dict))
    chosen = {}
    for path, slug in skills:
        if slug in wanted:
            chosen[slug] = path
    found = {"manifest": manifest[0], "descriptor": descriptor[0], "runtime": runtime[0], "skills": chosen}
    found["used"] = [found["descriptor"], found["runtime"], found["manifest"], *chosen.values()]
    return found


def lay_out_folder(found, files):
    """The agent's files a run handed over, laid out as the agent's folder
    under the builder's tmp, with every file its build entry names placed at
    the path it names (matched by the file's sent name against the entry's
    basename) and the delivery manifest beside them, as lay_out does for a
    spec. Returns the folder and what was placed, missing or left over."""
    with open(found["manifest"], encoding="utf-8") as f:
        manifest = json.load(f)
    name = manifest.get("name") or "agent"
    version = manifest.get("version") or "0.0.0"
    if not re.match(r"^[a-z0-9][a-z0-9.-]{0,80}$", f"{name}-{version}"):
        name, version = "agent", "0.0.0"
    root = os.path.join(HOME, "tmp", f"{name}-{version}-run")
    shutil.rmtree(root, ignore_errors=True)
    os.makedirs(os.path.join(root, "skills"))
    own = (manifest.get("extensions") or {}).get("net.agentdoc.package") or {}
    build = own.get("build") if isinstance(own.get("build"), dict) else {}
    # The files are laid out here, so the build reads them here.
    build.pop("source", None)
    with open(os.path.join(root, "plugin.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
        f.write("\n")
    for src, rel in ((found["descriptor"], "agent-descriptor.json"), (found["runtime"], "agent-runtime-requirements.json")):
        shutil.copy(src, os.path.join(root, rel))
    for slug, src in found["skills"].items():
        os.makedirs(os.path.join(root, "skills", slug), exist_ok=True)
        shutil.copy(src, os.path.join(root, "skills", slug, "SKILL.md"))
    wanted = {}
    for entry in (build.get("skills") or {}).values():
        for kind in ("scripts", "references", "assets"):
            for rel in (entry or {}).get(kind) or []:
                if isinstance(rel, str) and rel and ".." not in rel.split("/") and not rel.startswith("/"):
                    wanted.setdefault(os.path.basename(rel), rel)
    placed, left = [], []
    manifest_path = None
    used = {os.path.abspath(u) for u in found["used"]}
    for path in files:
        if os.path.abspath(path) in used:
            continue
        sent = sent_name(path)
        if sent == MANIFEST_NAME:
            manifest_path = os.path.join(root, MANIFEST_NAME)
            shutil.copy(path, manifest_path)
            continue
        rel = wanted.get(sent)
        if not rel:
            left.append(sent)
            continue
        dest = os.path.join(root, rel)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        shutil.copy(path, dest)
        placed.append(rel)
    missing = sorted(set(wanted.values()) - set(placed))
    return root, {"placed": sorted(placed), "missing": missing, "left_over": sorted(left),
                  "manifest": manifest_path, "skills": sorted(found["skills"])}


def file_pieces(job_dir, name, version, tgz, rec_path, sha256):
    """The package and its build record, under the job folder's out/ and
    listed in pieces.json, the way every packaged agent hands its result on.
    A run's next phase takes files, not sentences."""
    out_dir = os.path.join(job_dir, "out")
    os.makedirs(out_dir, exist_ok=True)
    tgz_name = f"{name}-{version}.tar.gz"
    rec_name = f"{name}-build.json"
    shutil.copy(tgz, os.path.join(out_dir, tgz_name))
    shutil.copy(rec_path, os.path.join(out_dir, rec_name))
    entries = [
        {"name": "package", "step": "pack", "path": f"out/{tgz_name}", "media_type": "application/gzip",
         "produced_from": ["the spec", "the scripts"],
         "about": f"The signed package {name} {version}, sha256 {sha256}. A deployment manager installs it; nobody has run the agent it describes."},
        {"name": "build record", "step": "pack", "path": f"out/{rec_name}", "media_type": "application/json",
         "produced_from": ["package"],
         "about": "The build record, signed by the package maker: what was packed, its digest, and which base image it resolved to."},
    ]
    with open(os.path.join(job_dir, "pieces.json"), "w", encoding="utf-8") as f:
        json.dump(entries, f, indent=2)
        f.write("\n")
    return [e["path"] for e in entries]


def fail(step, error):
    out({"ok": False, "step": step, "error": str(error)[:500]})


def canonical(obj):
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def sign(identity_path, message):
    if not (identity_path and os.path.exists(identity_path) and os.path.exists(SIGN)):
        return None
    try:
        env = dict(os.environ, NODE_PATH=ADAPTER_MODULES)
        p = subprocess.run(["node", SIGN, identity_path], input=message,
                           capture_output=True, text=True, timeout=30, env=env)
        return p.stdout.strip() or None if p.returncode == 0 else None
    except Exception:  # noqa: BLE001
        return None


def resolve_base(pkg_dir, name):
    """Which base image the runtimes and binaries this package declares resolve
    to, asked of the image resolver.

    The question is not whether this package builds, it is whether it could
    ever be built. The resolver answers it from the operator's catalogue
    without opening an image or running a build, and it answers in one of three
    ways: a base, a refusal naming what is missing and what to do about it, or
    nothing at all, because the resolver and the catalogue belong to the
    deployment side and a builder host may carry neither.

    The third answer is reported and never treated as the first. A check that
    quietly passes when it did not run is how invoice-reader, contract-reviewer
    and site-auditor were packed, signed and handed on with no install file at
    all, and nobody found out for a week.
    """
    # The runtime requirements under their name, or under the name they had
    # before Common Agent 0.30.0-draft, for a builder that still writes it.
    install_path = next((os.path.join(pkg_dir, n) for n in ("agent-runtime-requirements.json", "install.json")
                         if os.path.exists(os.path.join(pkg_dir, n))), os.path.join(pkg_dir, "agent-runtime-requirements.json"))
    if not os.path.exists(install_path):
        return {"state": "refused", "refused":
                "the package carries no runtime requirements, so nothing says what a host must have before this agent can "
                "run and no base image can be chosen for it. Build it again with a builder that writes one."}
    try:
        json.load(open(install_path, encoding="utf-8"))
    except Exception as e:  # noqa: BLE001
        return {"state": "refused", "refused":
                f"the package's runtime requirements are not readable JSON ({e}), so nothing can say which base image it "
                "could be built on."}
    if not (IMAGE and os.path.exists(BASES)):
        return {"state": "unchecked",
                "why": "the image resolver is not on this host" if not IMAGE
                       else "the operator's base catalogue is not on this host"}
    env = dict(os.environ, PACK_RESOLVER=IMAGE, PACK_INSTALL=install_path, PACK_NAME=name)
    try:
        p = subprocess.run(["node", "--input-type=module", "-e", RESOLVE_JS],
                           capture_output=True, text=True, timeout=60, env=env)
    except Exception as e:  # noqa: BLE001
        return {"state": "unchecked", "why": f"the image resolver could not be run here ({e.__class__.__name__})"}
    try:
        res = json.loads(p.stdout.strip().splitlines()[-1])
    except Exception:  # noqa: BLE001
        return {"state": "unchecked", "why": "the image resolver produced no answer here: "
                + (p.stderr or p.stdout or "no output").strip()[:200]}
    if res.get("ok"):
        return {"state": "resolved", "image": res["image"], "from": res["from"]}
    if res.get("refused"):
        return {"state": "refused", "refused": res["refused"]}
    if res.get("catalogue"):
        return {"state": "unchecked", "why": "the base catalogue on this host is not one the resolver reads: "
                + str(res["catalogue"])[:200]}
    return {"state": "unchecked", "why": "the image resolver failed here: " + str(res.get("error"))[:200]}


def files_in_prompt(text):
    """The job folder and the attached files named in the framed prompt the
    supervisor hands a brain: the `job folder: <path>` line, and under
    `attached:` one path per line with its media type in brackets."""
    job_dir = None
    files = []
    in_files = False
    for raw in str(text or "").split(chr(10)):
        line = raw.rstrip()
        if line.startswith("job folder: "):
            job_dir = line[len("job folder: "):].split("  (")[0].strip()
            continue
        if line.startswith("attached:"):
            in_files = True
            continue
        if in_files:
            stripped = line.strip()
            if not stripped:
                in_files = False
                continue
            path = stripped.split("  (")[0].strip()
            if "NOT downloaded" not in stripped and os.path.isfile(path):
                files.append(path)
            elif not (stripped.startswith("/") or re.match(r"^[A-Za-z]:[\/]", stripped)):
                in_files = False
    return job_dir, files


def spec_among(files):
    """The one attached file whose content is a spec: a JSON object with a
    name, a version and jobs. Told apart by content, never by name, because
    a file that came through the process runner may carry any label."""
    for path in files:
        try:
            with open(path, encoding="utf-8") as f:
                doc = json.load(f)
        except Exception:  # noqa: BLE001
            continue
        if isinstance(doc, dict) and isinstance(doc.get("name"), str) and isinstance(doc.get("jobs"), list):
            return path
    return None


def run_from_prompt(prompt_path, identity_path):
    """The package maker's turn in the lifecycle, without a model. The brain
    hands the framed prompt here first: when the attached files carry a
    spec, the package is built from them by the ordinary pack procedure and
    the reply is printed in plain words; when they do not, exit 3 tells the
    brain this is not a run's work and the model takes the turn. On
    2026-09-15 the model, given the same files, passed the spec alone, then
    ran out of its four minutes; a mechanical job is done mechanically."""
    with open(prompt_path, encoding="utf-8") as f:
        text = f.read()
    job_dir, files = files_in_prompt(text)
    # The agent's own files are preferred: they are what the spec writer
    # delivers, and a spec is read only where they did not come.
    agent = agent_files_among(files)
    spec = agent["descriptor"] if agent else spec_among(files)
    if not spec:
        sys.exit(3)
    others = [f for f in files if f != spec]
    argv = [sys.executable, os.path.abspath(__file__), spec, identity_path]
    if others:
        argv += ["--from", *others]
    if job_dir and os.path.isdir(job_dir):
        argv += ["--job", job_dir]
    p = subprocess.run(argv, capture_output=True, text=True)
    try:
        res = json.loads((p.stdout or "").strip().splitlines()[-1])
    except Exception:  # noqa: BLE001
        print("The package could not be built: the pack procedure gave no answer. " + (p.stderr or "").strip()[-300:])
        return
    if res.get("act") == "build" and res.get("ok"):
        pkg = res.get("package") or {}
        name = pkg.get("name") or res.get("name")
        version = pkg.get("version") or res.get("version")
        sha = pkg.get("sha256") or res.get("sha256")
        print(f"Built {name} {version}: sha256 {sha}. The package tarball and its signed build record are delivered as pieces. "
              + str(res.get("note") or "").strip())
    elif res.get("act") == "refuse":
        print(f"The package was not built: {res.get('refused')}")
    else:
        print(f"The package could not be built: {res.get('error') or res}")


def repo_step(args):
    """One call into repo.mjs, which is where every git act of a run happens.

    Returns the object it printed. A refusal is fatal: a run that could not put
    its work in the agent's repository has not finished, and the honest place
    to say so is here rather than three phases later when somebody clones and
    finds nothing.
    """
    r = subprocess.run(["node", REPO, *args], capture_output=True, text=True, timeout=600)
    line = (r.stdout or "").strip().splitlines()
    try:
        answer = json.loads(line[-1]) if line else {}
    except Exception:  # noqa: BLE001
        answer = {}
    if not answer.get("ok"):
        why = answer.get("why") or (r.stderr or "the repository step said nothing").strip()
        detail = answer.get("detail")
        fail("repository", f"{why}: {detail}" if detail else why)
    return answer


def main():
    argv = sys.argv[1:]
    if len(argv) == 3 and argv[0] == "--run":
        run_from_prompt(argv[1], argv[2])
        return
    if len(argv) < 2:
        fail("usage", "pack.py <spec.json | agent folder> <identity.json> [--from <file>...] [--from-dir <folder>] [--job <job folder>]")
    spec_path, identity_path = argv[0], argv[1]
    files, job_dir = [], None
    repo_remote, repo_branch, license_file = None, "main", None
    i = 2
    while i < len(argv):
        if argv[i] == "--job" and i + 1 < len(argv):
            job_dir = argv[i + 1]
            i += 2
        elif argv[i] == "--repo-remote" and i + 1 < len(argv):
            # Where this agent's repository lives. Absent means a run that
            # makes no repository, which is every run before item 17 and every
            # run on a host that has no remote to push to.
            repo_remote = argv[i + 1]
            i += 2
        elif argv[i] == "--repo-branch" and i + 1 < len(argv):
            repo_branch = argv[i + 1]
            i += 2
        elif argv[i] == "--license-file" and i + 1 < len(argv):
            # The text of that license, copied into the repository as LICENSE.
            license_file = argv[i + 1]
            i += 2
        elif argv[i] == "--license" and i + 1 < len(argv):
            # The license this workspace publishes under, for a spec that names
            # none. The builder reads it from the environment, the same way it
            # reads the required coder and the provenance manifest.
            os.environ["DEFAULT_LICENSE"] = argv[i + 1]
            i += 2
        elif argv[i] == "--from":
            i += 1
            while i < len(argv) and not argv[i].startswith("--"):
                files.append(argv[i])
                i += 1
        elif argv[i] == "--from-dir" and i + 1 < len(argv):
            # Every file a run handed over, from the folder the adapter put
            # them in, so the brain passes one path rather than eight. On
            # 2026-09-15 it passed the spec alone and the pack refused for the
            # seven files that were sitting beside it.
            d = argv[i + 1]
            if not os.path.isdir(d):
                fail("validate", f"the folder of handed-over files does not exist: {d}")
            files.extend(sorted(os.path.join(d, n) for n in os.listdir(d) if os.path.isfile(os.path.join(d, n))))
            i += 2
        else:
            fail("usage", f"unknown argument {argv[i]!r}")
    if job_dir and not os.path.isdir(job_dir):
        fail("validate", f"the job folder does not exist: {job_dir}")
    for f in files:
        if not os.path.isfile(f):
            fail("validate", f"a file the run handed over is not here: {f}")
    files = [f for f in files if os.path.abspath(f) != os.path.abspath(spec_path)]
    laid = None
    # An agent's folder holds every file it is built from already, so nothing
    # is laid out for it, and this procedure does not yet commit one to the
    # agent's repository: a run's work arrives as a spec.
    is_folder = os.path.isdir(spec_path)
    agent_files = None if is_folder else agent_files_among([spec_path, *files])
    if is_folder and files:
        fail("validate", "files are handed over with a spec or with the agent's files; an agent's folder already holds the files it is built from")
    if (is_folder or agent_files) and repo_remote:
        fail("validate", "an agent's folder is not committed to the agent's repository by this procedure; hand over a spec for a run that makes one")
    if agent_files:
        # The agent's own files, handed over by a run: laid out as its folder,
        # with the scripts they name beside them, and the folder is built.
        try:
            spec_path, laid = lay_out_folder(agent_files, files)
        except Exception as e:  # noqa: BLE001
            fail("validate", f"the agent's files could not be read to lay them out: {e}")
        is_folder = True
        if laid["missing"]:
            out({"ok": True, "act": "refuse", "record": None, "laid_out": laid,
                 "refused": "the run handed over no file for " + ", ".join(laid["missing"])
                            + "; the agent's files name them and the package cannot be built without them"})
        if laid["manifest"]:
            os.environ.setdefault("PROVENANCE", laid["manifest"])
    elif files:
        try:
            spec_path, laid = lay_out(spec_path, files)
        except Exception as e:  # noqa: BLE001
            fail("validate", f"the spec could not be read to lay the files out: {e}")
        if laid["missing"]:
            out({"ok": True, "act": "refuse", "record": None, "laid_out": laid,
                 "refused": "the run handed over no file for " + ", ".join(laid["missing"])
                            + "; the spec names them and the package cannot be built without them"})
        if laid["manifest"]:
            os.environ.setdefault("PROVENANCE", laid["manifest"])
    if not os.path.abspath(spec_path).startswith(os.path.join(HOME, "tmp") + os.sep):
        fail("validate", "the spec or agent folder must be under the builder's own tmp dir")

    # 0. The agent's repository, before anything is built.
    #
    # The input this build is about to read goes into the repository and is
    # committed, so that the builder reads a clean checkout and `git_source`
    # below can name a repository and a commit. That is the whole of item 21:
    # without this commit, `source` is absent from every lifecycle build record
    # and a deployment cannot be checked against source the customer holds.
    work, source_commit = None, None
    if repo_remote:
        if not REPO:
            fail("repository", "a repository remote was given and repo.mjs is not beside this builder")
        try:
            spec_name = json.load(open(spec_path)).get("name") or "agent"
        except Exception as e:  # noqa: BLE001
            fail("validate", f"the spec could not be read: {e}")
        work = os.path.join(HOME, "tmp", f"{spec_name}-repo")
        # What goes into the repository is THIS run's input and nothing else.
        # A run that was handed files has them laid out in a directory of its
        # own already; a bare spec gets one, because the builder's whole tmp
        # directory holds other runs and none of them belongs in this agent's
        # repository.
        source_dir = os.path.dirname(os.path.abspath(spec_path))
        if os.path.abspath(source_dir) == os.path.abspath(os.path.join(HOME, "tmp")):
            # A spec sitting loose in the builder's tmp directory has no
            # directory of its own, and that directory holds other runs. Give
            # it one rather than committing somebody else's work.
            source_dir = os.path.join(HOME, "tmp", f"{spec_name}-input")
            os.makedirs(source_dir, exist_ok=True)
            shutil.copy(spec_path, os.path.join(source_dir, os.path.basename(spec_path)))
        repo_step(["prepare", "--work", work, "--remote", repo_remote, "--branch", repo_branch])
        committed = repo_step(["commit-source", "--work", work,
                               "--from", source_dir,
                               "--message", f"The input {spec_name} was built from"])
        source_commit = committed["commit"]
        # The build now reads the committed copy, which is what makes the
        # commit the build record names the commit the bytes came from.
        spec_path = os.path.join(work, committed["source"], os.path.basename(spec_path))
        if not os.path.isfile(spec_path):
            fail("repository", "the spec did not land in the repository, so nothing was built")

    os.makedirs(BUILT, exist_ok=True)
    os.makedirs(DIST, exist_ok=True)
    os.makedirs(RECORDS, exist_ok=True)

    # 1. Build. build.py fails closed on a spec missing refuses/records.
    p = subprocess.run(["python3", BUILD, spec_path, BUILT],
                       capture_output=True, text=True, timeout=60)
    try:
        built = json.loads(p.stdout.strip().splitlines()[-1])
    except Exception:
        fail("build", (p.stderr or p.stdout or "build produced no result")[:400])
    if not built.get("ok"):
        # A refusal is a legitimate, recorded outcome, not a crash.
        out({"ok": True, "act": "refuse", "refused": built.get("error", "build refused"),
             "record": None})
    name, version = built["name"], built["version"]
    pkg_dir = built["path"]

    # 2. Could this package be turned into a container image? Before the tar,
    #    because a package nothing can be built on should not become a tarball
    #    somebody deploys, and a refusal here costs the requester one message
    #    instead of a week.
    image = resolve_base(pkg_dir, name)
    if image["state"] == "refused":
        # A refusal is a legitimate, recorded outcome, not a crash. The
        # resolver's own words: they name what is missing, what it was declared
        # for, and what to build next, which is more than this file knows.
        out({"ok": True, "act": "refuse", "record": None,
             "refused": "this package cannot be turned into a container image, so nothing was packed. "
                        + image["refused"]})

    # 3. Tar and hash.
    tgz = os.path.join(DIST, f"{name}.tar.gz")
    with tarfile.open(tgz, "w:gz") as t:
        t.add(pkg_dir, arcname=name)
    sha256 = hashlib.sha256(open(tgz, "rb").read()).hexdigest()

    # 4. Build and sign the record. Where the spec came out of a repository,
    #    the record names the repository and the commit it was read at; where
    #    a run handed the files over, there is nothing to name and the member
    #    is absent (git_source above).
    try:
        if is_folder:
            b = (json.load(open(os.path.join(spec_path, "plugin.json"), encoding="utf-8")).get("extensions") or {})                 .get("net.agentdoc.package", {}).get("build") or {}
            source = git_source(os.path.normpath(os.path.join(spec_path, b["source"])) if b.get("source") else spec_path)
        else:
            source = git_source(json.load(open(spec_path)).get("source") or os.path.dirname(os.path.abspath(spec_path)))
    except Exception:  # noqa: BLE001
        source = None
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    by = "agent-builder"
    try:
        by = json.load(open(identity_path)).get("public_key", by)
    except Exception:  # noqa: BLE001
        pass
    doc = {
        "record": "v1", "role": "agent-builder", "act": "build",
        "requested_by": built.get("requested_by", "the requester"),
        "package": {"name": name, "version": version,
                    "schema": built.get("schema", "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json"),
                    "sha256": sha256,
                    # The two authored files inside the package, by digest, so a
                    # verifier can tie the bound descriptor an agent serves back
                    # to the draft that was built (agent-package-draft.md §6).
                    **({"descriptor_sha256": built["descriptor_sha256"]} if built.get("descriptor_sha256") else {}),
                    # Under its name since Common Agent 0.30.0-draft, and under
                    # install_sha256 too, the name a verifier of a record from
                    # before then reads, until no reader needs it.
                    **({"runtime_requirements_sha256": built.get("runtime_requirements_sha256") or built["install_sha256"],
                        "install_sha256": built.get("runtime_requirements_sha256") or built["install_sha256"]}
                       if built.get("runtime_requirements_sha256") or built.get("install_sha256") else {})},
        # Where the source was read, when it was read from a clean checkout.
        # It is what joins a published package to the repository it came from
        # (Common Agent 13.7), and it is this builder's word, not a promise
        # that building that commit again produces these bytes.
        **({"source": source} if source else {}),
        "shape": {"skills": len(built["skills"]), "systems": len(built["systems"]),
                  "refuses": built["refuses_count"], "records": built["records_count"]},
        # Every lockfile the skills carry, so an installer can verify what it
        # installs against what was built.
        "lockfiles": built.get("lockfiles", []),
        # The builder ran nothing: the only honest grade for a fresh package.
        # A builder that ran the package's own acceptance script would say
        # {"kind": "acceptance", "passed": ..., "what": ...} here instead.
        # The second entry is the base the package resolved to, or the reason
        # nothing here could look, which is a different thing from a pass and
        # is written down as one.
        "checks": [{"kind": "unrun", "what": "nobody has run the agent this package describes"},
                   # Whether the systems this package declares are names an
                   # account can bind on its stack, or names somebody has to
                   # bind by hand at every deploy. Said here because install
                   # time is too late to learn it.
                   *([built["systems_note"]] if isinstance(built.get("systems_note"), dict) else []),
                   {"kind": "image", "base": image["image"], "catalogue": image["from"],
                    "what": "the runtimes and binaries this package declares resolve to a base the operator has "
                            "built; no image was built and nothing opened that one to look"}
                   if image["state"] == "resolved" else
                   {"kind": "image-unchecked",
                    "what": "nothing here could say whether this package can be turned into a container image: "
                            f"{image['why']}"}],
        "draft": True, "produced_at": now, "by": by, "signatures": [],
    }
    message = TAG + "\n" + canonical({k: v for k, v in doc.items() if k != "signatures"})
    sig = sign(identity_path, message)
    if sig:
        doc["signatures"] = [{"tag": TAG, "by": by, "sig": sig, "alg": "ed25519"}]
    else:
        doc["_unsigned"] = "signer unavailable; record is faithful but unsigned"
    rec_path = os.path.join(RECORDS, f"{name}-build.json")
    with open(rec_path, "w") as f:
        json.dump(doc, f, indent=2)

    note = "Draft package. Nobody has run this agent; review before deploying."
    if image["state"] == "resolved":
        printed = {"base": image["image"], "from": image["from"]}
    else:
        printed = {"base": None, "unchecked": image["why"]}
        note += f" Nothing checked whether it can be built into a container image: {image['why']}."
    # 6. The package goes into the repository beside the input it was built
    # from, and the repository is pushed. A person who clones it gets the
    # agent: the package, its AgentDoc, the suite, and the input.
    #
    # This happens after the record is written and signed, because the record
    # names the commit the build READ, and this commit comes after that one.
    repository = None
    if work:
        args = ["commit-package", "--work", work, "--package", pkg_dir,
                "--source", "source", "--push",
                "--message", f"{name} {version}"]
        if license_file:
            args.extend(["--license-file", license_file])
        suite = os.path.join(work, "source", "test")
        if os.path.isdir(suite):
            args.extend(["--tests", suite])
        committed = repo_step(args)
        repository = {"remote": repo_remote, "branch": committed["branch"],
                      "source_commit": source_commit, "commit": committed["commit"],
                      **({"notes": committed["notes"]} if committed.get("notes") else {})}

    pieces = file_pieces(job_dir, name, version, tgz, rec_path, sha256) if job_dir else None
    out({"ok": True, "act": "build", "name": name, "version": version,
         "package_dir": pkg_dir, "tarball": tgz, "sha256": sha256,
         "shape": doc["shape"], "draft": True, "record": rec_path,
         "signed": bool(sig), "image": printed, "note": note,
         **({"laid_out": laid} if laid else {}),
         **({"warnings": built["warnings"]} if built.get("warnings") else {}),
         **({"repository": repository} if repository else {}),
         **({"pieces": pieces} if pieces else {})})


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as e:  # noqa: BLE001
        fail("unexpected", repr(e))
