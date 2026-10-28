#!/usr/bin/env python3
"""Build and sign the record of one act (agentroles.ai SPEC §11.3).

Takes a deploy/update/reconfigure/attest/remove/build/refusal result object from steps.py on
stdin, emits the signed record on stdout. The signature is the family
convention: the ASCII tag, one newline, then the JCS (RFC 8785) canonical
JSON of the document with `signatures` removed. Ed25519 over the deployment
manager's own identity key.

The record carries what the Common Agent Specification's chapter 12 says a
deploy record carries: the package digest, the bound descriptor's digest,
the credentials placed by name, the ceilings set, the checks with their
grade, and the ledger of placed files. Secret values never enter a record:
steps.py emits NAMES only, and this file copies them through unchanged.

TWO TAGS, BECAUSE TWO DIFFERENT THINGS GET MADE. An installer that builds an
image and starts nothing has deployed nothing: nothing has an address and
nobody has been given a key. So `image` produces an agent-build-record-v1
naming the package digest it built from and the image digest it produced
(spec 8.2), and only the side that STARTS the agent produces the one
agent-deployment-record-v1, naming the digest of the image it started (8.3,
12.7.1). Two records over one package, each attesting what its own producer
made.

AN ABSENT MEMBER IS A STATEMENT (8.3). It means this producer did not observe
the thing. It never means the thing was not required and never that the thing
did not happen. So nothing here fills a member in from somewhere else: a
deploy that started no image carries no `image_digest`, and one that minted no
subject carries no `key_custody`, rather than either carrying a value copied
out of an instruction.
"""
import json
import os
import subprocess
import sys
import time

TAG = "agent-deployment-record-v1"
# The acts that change how an installed agent runs without installing a
# version (steps.py model, jobs-at-once, rebind), each recorded as a
# reconfigure naming the package already running.
RECONFIGURE_ACTS = ("model", "jobs-at-once", "rebind")
BUILD_TAG = "agent-build-record-v1"
# The adapter's own nkeys.js, so a record is signed by the same library and the
# same identity the agent presents on the mesh. No extra software installed.
ADAPTER_MODULES = "/usr/lib/node_modules/mesh-adapter/node_modules"
# Installed beside this file as deploymgr-sign.mjs; falls back to sign.mjs for
# running straight from the source tree.
_here = os.path.dirname(os.path.abspath(__file__))
SIGN_JS = next((p for p in (os.path.join(_here, "deploymgr-sign.mjs"),
                            os.path.join(_here, "sign.mjs")) if os.path.exists(p)),
               os.path.join(_here, "deploymgr-sign.mjs"))


def canonical(obj):
    # RFC 8785 subset sufficient for these flat records: sorted keys, no
    # whitespace, UTF-8, integers and strings only.
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


SIGN_FAILURE = "signer unavailable"


def sign(identity_path, message):
    # Sign through node + the adapter's nkeys, with the agent's identity key,
    # the way every mesh agent signs its envelopes and rosters. A failure here
    # yields None: the record is still produced and says it is unsigned. A
    # faithful record with no signature beats no record — but the note now
    # carries WHY, because two real records went out unsigned and "signer
    # unavailable" alone said nothing. The timeout is generous: node's cold
    # start on a host mid-deploy blew the old 30 seconds.
    global SIGN_FAILURE  # noqa: PLW0603
    if not (identity_path and os.path.exists(identity_path)):
        SIGN_FAILURE = "no identity file"
        return None
    if not os.path.exists(SIGN_JS):
        SIGN_FAILURE = f"no signer at {SIGN_JS}"
        return None
    try:
        # Never hand node a parent's pm2 IPC channel: it aborts on it (exit 134).
        env = {k: v for k, v in os.environ.items() if not k.startswith("NODE_CHANNEL")}
        env["NODE_PATH"] = ADAPTER_MODULES
        p = subprocess.run(["node", SIGN_JS, identity_path], input=message,
                           capture_output=True, text=True, timeout=90, env=env)
        if p.returncode != 0 or not p.stdout.strip():
            SIGN_FAILURE = f"signer exit {p.returncode}: {(p.stderr or '').strip()[:200]}"
            return None
        return p.stdout.strip()
    except Exception as e:  # noqa: BLE001
        SIGN_FAILURE = str(e)[:200]
        return None


def smoke_check(res, now):
    """The post-start check, smoke grade and called that. A smoke check proves
    the agent started and answered, nothing more; it is never a conformance
    check. A container's check observes different things from a host's, so it
    says what it observed in its own words rather than being described in the
    host's."""
    smoke = res.get("smoke") or {}
    if smoke.get("what"):
        what = smoke["what"]
    elif smoke.get("started") is not None:
        what = (f"one execution answered a probe message, by {smoke.get('by') or '?'}, exit "
                f"{smoke.get('exit_code')}" if smoke.get("passed")
                else smoke.get("why") or "the execution did not answer")
    else:
        what = ("adapter listening and the brain answered a direct probe" if smoke.get("passed")
                else "adapter did not confirm listening or the brain returned nothing")
    return {"kind": "smoke", "passed": bool(smoke.get("passed")), "at": now, "what": what}


def descriptor_part(d):
    """The bound descriptor as the record states it: its digest, whether it
    is signed, and which members the binding added to or changed in the
    draft, so a verifier knows what to expect when it lays one over the
    other. A package without a draft says so."""
    d = d or {}
    if d.get("absent"):
        return {"absent": d["absent"]}
    return {"sha256": d.get("digest"), "signed": bool(d.get("signed")),
            **({"added": d["added"]} if d.get("added") is not None else {}),
            **({"changed": d["changed"]} if d.get("changed") else {})}


def observed(res, *members):
    """The members this producer observed, and no others. A member missing
    from the result is left OUT of the record rather than emitted as null:
    8.3 reads an absent member as "the producer did not observe this", and a
    null would be read as an observation of nothing."""
    return {k: res[k] for k in members if res.get(k) is not None}


def cloud_part(res):
    """Where the act ran when it ran in a CUSTOMER's own cloud project, and
    every call it made there: the project, the service account we impersonated,
    what the last call meant, and the action log.

    ABSENT ON OUR OWN MACHINES, which is every act but this route, and absent
    is a statement the same as everywhere else here: this producer acted in
    nobody's project but ours.

    THE LOG RIDES IN THE RECORD RATHER THAN IN A SECOND DOCUMENT. A record is
    already signed by the deployment manager's own identity, already produced
    once per act, and already the thing that is kept; a separate list of calls
    would be a second format to sign, to store and to keep in step with this
    one, and a customer holding two documents that disagree is worse off than
    one holding neither. What we owe them is a list that agrees with their own
    Cloud Audit Logs, and it agrees best when it is the same list the act was
    recorded with.

    steps.py fills it and this copies it through unchanged. It carries names
    and outcomes: a command without its arguments, a project, an account, a
    time, a duration and gcloud's own words for a failure. No value the owner's
    credential store holds ever reaches it, because no call site puts one on a
    command line.
    """
    c = res.get("cloud")
    return {"cloud": c} if isinstance(c, dict) and c else {}


def target_part(res):
    """Where the deploy went. `harness` is absent where there is none to name:
    a container running the command the package declared wakes no model, and
    naming a harness it never started would be a claim about a program that
    was not in the path."""
    return {"host": res.get("host", "agent-fleet"),
            **({"harness": res["harness"]} if res.get("harness") else {})}


def placed_part(res):
    """What was placed, by name only, and the ceilings set.

    `ceilings` carries each entry as the deploy set it, INCLUDING the
    `enforced_by` the install file states (12.4 rule 4). The enforcing side
    travels with the number because the number alone does not say who can
    refuse a charge over it, and a reader who cannot see the side reads an
    unstated one as the stronger one and believes somebody is watching the
    spend. Nothing here derives the word: it comes from the install file
    through the binding, and a package that states none leaves it absent."""
    creds = list(res.get("credentials_placed") or [])
    settings = list(res.get("settings_placed") or [])
    return {
        # §11.3's member: every secret the deploy placed, by name, the model
        # key this host lends and the package's credentials alike.
        "secrets_placed": [s for s in ([res.get("secret_placed")] + creds) if s],
        "credentials_placed": creds,
        "settings_placed": settings,
        "ceilings": list(res.get("ceilings") or []),
        # What stood behind each system the package declares, per
        # docs/account-stack.md section 7: the system name, the product, the
        # environment, which precedence step supplied it, the credential's NAME
        # and the address. Never a value. Absent where the instruction carried
        # no bindings at all, which is every deploy filed before the stack
        # existed and every one typed by hand: absent means this producer did
        # not observe them, which is 8.3's own rule, and is not the same as
        # saying there were none.
        **({"bindings": list(res["bindings"])} if res.get("bindings") else {}),
        # What the agent charges, as the deploy placed it, and ABSENT where
        # the package declared nothing. Absent means free here, the same as
        # everywhere else (§19.1), and it is kept absent rather than written
        # out as a zero: a record that stated a price of nothing would be a
        # record stating terms, and this deploy set none.
        **({"price": res["price"]} if res.get("price") else {}),
        # Reach from outside the mesh over A2A, as the instruction set it, and
        # ABSENT where this deploy set no stance at all. A container deploy sets
        # none: the door belongs to whatever holds the agent's key and answers
        # at its address, and a flat false here would say this producer had
        # closed a door it never touched.
        **({"exposed_a2a": bool(res["exposed_a2a"])} if "exposed_a2a" in res else {}),
        # The model the agent runs with as placed: the job's own variable where
        # its work runs in a container, the brain script's on a host (technical
        # debt 456). A deploy request's args.model is only what was asked, and
        # on dev on 2026-10-07 the two differed. Absent where this producer did
        # not observe it; null where the job carries no model.
        **({"model_placed": res["model_placed"]} if "model_placed" in res else {}),
        # What the agent can reach on the network after the act, as steps.py
        # provided it (Common Agent 8.3 `egress`). Copied through, never
        # filled in: a result that does not carry it leaves it out, which says
        # this producer did not observe it.
        **observed(res, "egress"),
        "dependencies": list(res.get("dependencies") or []),
    }


def build(res, identity_path, dm_key):
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    act = res.get("act")
    tag = TAG
    if act == "build" and res.get("ok"):
        # An image was built and NOTHING was started (12.7.1): no address, no
        # key, nobody to answer. So this is a build record naming the package
        # it built from and the image it produced, and the deployment record
        # for this package is somebody else's to produce, even when that
        # somebody is the next procedure on this same host.
        tag = BUILD_TAG
        doc = {
            "record": "v1", "role": "agent-builder", "act": "build",
            "requested_by": res.get("instructed_by", "the owner"),
            "package": {"name": res["package"], "version": res["version"],
                        "schema": res.get("schema"), "url": res.get("url"), "sha256": res["sha256"],
                        # The two authored files inside the package, by digest,
                        # spelled as the agent builder's own build record spells
                        # them, so the two records over one package join.
                        **observed(res, "descriptor_sha256", "install_sha256")},
            "image_digest": res["image_digest"],
            "image": res.get("image"),
            "base": res.get("base"),
            # Each file's digest as built, beside the image digest, so a reader
            # can ask what is inside a layer without starting it (12.7.1). It
            # covers what the installer PLACED; the dependency trees npm
            # resolves during the build are covered by the lockfile digests the
            # install file names and by the image digest over the whole thing.
            "files_as_built": res.get("files_as_built"),
            "shape": res.get("shape"),
            **cloud_part(res),
            # A build record never clears the draft: nobody has run this agent.
            "draft": True,
            "checks": list(res.get("checks") or []),
            "produced_at": now, "by": dm_key, "signatures": [],
        }
    elif act == "deploy" and res.get("ok"):
        doc = {
            "record": "v1", "role": "deployment-manager", "act": "deploy",
            "instructed_by": res.get("instructed_by", "the owner"),
            "package": {"name": res["package"], "version": res["version"],
                        "url": res["url"], "sha256": res["sha256"]},
            # The digest of the image THIS deploy started, where it started one
            # (8.3). Absent on a host deploy, which started processes and no
            # image, and never copied out of a build record: a reader compares
            # the two to learn whether the agent runs what was built, and a
            # copy would make that comparison compare a number with itself.
            **observed(res, "image_digest"),
            "target": target_part(res),
            **cloud_part(res),
            **({"agent": {"key": res["agent_key"], "handle": res.get("handle")}} if res.get("agent_key") else {}),
            # How the subject's key came to exist and who holds the private
            # half now (8.3). Absent where this deploy minted no subject: a
            # record that named a key and stopped leaves a reader unable to
            # count the parties who can speak as it, and one that guessed would
            # be worse than one that is silent.
            **observed(res, "key_custody"),
            **({"declarations": {"interaction": res["interaction"],
                                 "admitted_at_start": res["admitted_at_start"]}}
               if res.get("interaction") else {}),
            # Where the deploy went (Common Agent spec §8.3). Optional in the
            # argfile, so only emitted when stated; absent means unstated.
            **({"environment": res["environment"]} if res.get("environment") else {}),
            # Absent where nothing was bound. The bound Descriptor's signature
            # is made with the subject's own key (6.6), so a deploy that minted
            # no subject bound nothing, and a descriptor member with a null
            # digest would say a document exists whose digest went unrecorded.
            **({"descriptor": descriptor_part(res["descriptor"])} if res.get("descriptor") else {}),
            **placed_part(res),
            # The ledger answers "what is deployed" by rehashing what was
            # placed. In an image the files are layers and the answer is the
            # image digest above, so a container deploy carries no file ledger
            # rather than an empty one (12.7.1).
            **observed(res, "ledger"),
            "checks": [smoke_check(res, now)],
            "produced_at": now, "by": dm_key, "signatures": [],
        }
    elif act == "update":
        prev = res.get("previous") or {}
        doc = {
            "record": "v1", "role": "deployment-manager", "act": "update",
            "instructed_by": res.get("instructed_by", "the owner"),
            "package": {"name": res["package"], "version": res["version"],
                        "url": res["url"], "sha256": res["sha256"]},
            "previous_package": {"name": res["package"], "version": prev.get("version"),
                                 "sha256": prev.get("sha256")},
            "target": target_part(res),
            **cloud_part(res),
            "agent": {"key": res["agent_key"], "handle": res.get("handle")},
            "descriptor": descriptor_part(res.get("descriptor")),
            "previous_descriptor": descriptor_part(prev.get("descriptor")),
            **placed_part(res),
            # Files that no longer matched the old ledger when the update
            # began: a hand edit to a running agent, reported never hidden.
            "drift_before": list(res.get("drift_before") or []),
            "restored": bool(res.get("restored")),
            **({"ledger": res["ledger"]} if res.get("ledger") else {}),
            "checks": [smoke_check(res, now)],
            "produced_at": now, "by": dm_key, "signatures": [],
        }
        if res.get("restored"):
            doc["outcome"] = f"the check failed on {res['version']}; {prev.get('version')} was restored and restarted"
        # The watch after the install (guard.mjs) found the node unwell and
        # the old version was put back. Said in the words the owner reads.
        if res.get("rolled_back"):
            doc["outcome"] = f"rolled back: {res.get('error')}; {res.get('state')}"
            doc["watch"] = res.get("watch")
    elif act == "attest" and res.get("ok"):
        # The running install, attested without installing anything: the
        # package digest the inventory names, the ledger re-hashed and found
        # unchanged, and the image the job runs where its work runs in a
        # container. Made for a version that was deployed before every
        # deploy and update left a record, so it can carry one without being
        # redeployed. It says it is an attest, never a deploy: what it
        # observed is what runs now, not the act that put it there.
        doc = {
            "record": "v1", "role": "deployment-manager", "act": "attest",
            "instructed_by": res.get("instructed_by", "the owner"),
            "package": {"name": res["package"], "version": res["version"],
                        **({"url": res["url"]} if res.get("url") else {}), "sha256": res["sha256"]},
            **observed(res, "image_digest"),
            "target": target_part(res),
            "agent": {"key": res["agent_key"], "handle": res.get("handle")},
            **({"environment": res["environment"]} if res.get("environment") else {}),
            **observed(res, "deployed_at"),
            "ledger": res.get("ledger"),
            "checks": [{"kind": "ledger", "passed": True, "at": now,
                        "what": ("every file of the package and its brain re-hashed to the digest it was placed with"
                                 + (f"; {len((res.get('ledger') or {}).get('drift') or [])} other placed file(s) "
                                    "differ, listed under ledger.drift" if (res.get("ledger") or {}).get("drift") else ""))}],
            "produced_at": now, "by": dm_key, "signatures": [],
        }
    elif act in RECONFIGURE_ACTS and res.get("ok"):
        # A change to how an installed agent runs that installs no version:
        # its model, how many jobs it takes at once, or its Descriptor bound
        # again from its own package. The record names the package already
        # running, so a reader can tell which version was reconfigured.
        doc = {
            "record": "v1", "role": "deployment-manager", "act": "reconfigure",
            "change": act,
            "instructed_by": res.get("instructed_by", "the owner"),
            **({"package": {"name": res["package"], "version": res.get("version"),
                            **({"url": res["url"]} if res.get("url") else {}),
                            **({"sha256": res["sha256"]} if res.get("sha256") else {})}}
               if res.get("package") else {}),
            "target": target_part(res),
            **({"agent": {"key": res["agent_key"], "handle": res.get("handle")}} if res.get("agent_key") else {}),
            **({"was": res["was"]} if "was" in res else {}),
            **({"now": res["now"]} if "now" in res else {}),
            **({"descriptor": descriptor_part(res["descriptor"])} if res.get("descriptor") else {}),
            **observed(res, "credential", "ledger"),
            **({"checks": [smoke_check({"smoke": res["check"]}, now)]} if isinstance(res.get("check"), dict) else {}),
            "produced_at": now, "by": dm_key, "signatures": [],
        }
    elif act == "alongside" and res.get("ok"):
        # Another version of an installed agent, beside the current one, under
        # the same subject (Common Agent 12.7, Install alongside). No subject
        # was minted and nothing was bound: the bound Descriptor stays the
        # current version's, so the record carries neither.
        doc = {
            "record": "v1", "role": "deployment-manager", "act": "alongside",
            "instructed_by": res.get("instructed_by", "the owner"),
            "package": {"name": res["package"], "version": res["version"],
                        "url": res["url"], "sha256": res["sha256"]},
            "current_package": {"name": res["package"], "version": res.get("current_version")},
            **observed(res, "image_digest"),
            "target": target_part(res),
            **cloud_part(res),
            **({"agent": {"key": res["agent_key"], "handle": res.get("handle")}} if res.get("agent_key") else {}),
            # How a job reaches this version: by naming it in its run context.
            "reached_by": f"a job whose run config names version {res['version']}",
            **({"job": res["job"]} if res.get("job") else {}),
            **({"environment": res["environment"]} if res.get("environment") else {}),
            **placed_part(res),
            "checks": [smoke_check(res, now)],
            "produced_at": now, "by": dm_key, "signatures": [],
        }
    elif act == "retire-version" and res.get("ok"):
        was = res.get("was") or {}
        doc = {
            "record": "v1", "role": "deployment-manager", "act": "retire-version",
            "instructed_by": res.get("instructed_by", "the owner"),
            "package": {"name": res.get("package") or was.get("package"), "version": res["version"],
                        **({"sha256": was["sha256"]} if was.get("sha256") else {})},
            "current_package": {"name": res.get("package") or was.get("package"), "version": res.get("current_version")},
            **({"agent": {"key": res["agent_key"], "handle": res.get("handle")}} if res.get("agent_key") else {}),
            "target": target_part(res),
            **cloud_part(res),
            "removed": list(res.get("removed") or []),
            "remaining": res.get("remaining", []),
            "produced_at": now, "by": dm_key, "signatures": [],
        }
    elif act == "remove":
        was = res.get("was") or {}
        doc = {
            "record": "v1", "role": "deployment-manager", "act": "remove",
            "instructed_by": res.get("instructed_by", "the owner"),
            "agent": {"key": was.get("agent_key"), "handle": was.get("handle")},
            "target": {"host": res.get("host", "agent-fleet"), "harness": was.get("harness") or was.get("framework")},
            **cloud_part(res),
            "removed": ["pm2 processes", "brain script", "ledger", "unix user and home", "work directories",
                        "the placed environment file"],
            "credentials_removed": list(res.get("credentials_removed") or []),
            "remaining": res.get("remaining", []),
            "produced_at": now, "by": dm_key, "signatures": [],
        }
    elif not res.get("ok"):
        # A refusal: the procedure stopped at a step. §11.3 rule 1 says a
        # refusal record carries `refused` with the reason in place of checks.
        doc = {
            "record": "v1", "role": "deployment-manager", "act": "refuse",
            "instructed_by": res.get("instructed_by", "the owner"),
            **({"package": {"name": res["package"], **({"version": res["version"]} if res.get("version") else {})}}
               if res.get("package") else {}),
            **({"agent": {"key": res["agent_key"], "handle": res.get("handle")}} if res.get("agent_key") else {}),
            "target": target_part(res),
            **cloud_part(res),
            "refused": {"step": res.get("step"), "reason": res.get("error"), "state": res.get("state"),
                        **({"attempted": act} if act else {})},
            # A new install the watch took back out: it was placed, the node
            # did not stay well, and the agent was paused on its node.
            **({"outcome": f"rolled back: {res.get('error')}; {res.get('state')}", "watch": res.get("watch")}
               if res.get("rolled_back") else {}),
            "produced_at": now, "by": dm_key, "signatures": [],
        }
    else:
        raise SystemExit(f"cannot record act {act!r}")

    message = tag + "\n" + canonical({k: v for k, v in doc.items() if k != "signatures"})
    sig = sign(identity_path, message)
    if sig:
        doc["signatures"] = [{"tag": tag, "by": dm_key, "sig": sig, "alg": "ed25519"}]
    else:
        doc["signatures"] = []
        doc["_unsigned"] = f"record is faithful but unsigned ({SIGN_FAILURE})"
    return doc


def file_piece(job_dir, doc):
    """The signed record under the job folder's out/, listed in pieces.json,
    so a reply to a run carries the act's record as a file the next phase can
    read. The recorder runs as the deployment manager's own user, so what it
    writes is the adapter's to collect."""
    name = (doc.get("package") or {}).get("name") or doc.get("subject", {}).get("name") or "agent"
    act = doc.get("act") or "act"
    out_dir = os.path.join(job_dir, "out")
    os.makedirs(out_dir, exist_ok=True)
    rel = f"out/{name}-{act}.json"
    with open(os.path.join(job_dir, rel), "w", encoding="utf-8") as f:
        json.dump(doc, f, indent=2)
    entries = [{
        "name": f"{act} record", "step": act, "path": rel, "media_type": "application/json",
        "produced_from": ["the instruction"],
        "about": (f"The signed record of this {act}: what was done, to which package and version, "
                  "with every secret named and never carried."),
    }]
    with open(os.path.join(job_dir, "pieces.json"), "w", encoding="utf-8") as f:
        json.dump(entries, f, indent=2)
        f.write("\n")
    return [rel]


def main():
    # argv: <identity.json of the deployment manager> [its identity public key] [--job <job folder>]
    # The record is signed by the deployment manager's OWN identity, which is
    # who is attesting the act; `by` is that same identity's public key.
    argv = sys.argv[1:]
    job_dir = None
    if "--job" in argv:
        i = argv.index("--job")
        job_dir = argv[i + 1] if i + 1 < len(argv) else None
        argv = argv[:i] + argv[i + 2:]
    res = json.load(sys.stdin)
    identity_path = argv[0] if len(argv) > 0 else None
    dm_key = argv[1] if len(argv) > 1 else "deployment-manager"
    if identity_path and dm_key == "deployment-manager":
        try:
            dm_key = json.load(open(identity_path)).get("public_key", dm_key)
        except Exception:  # noqa: BLE001
            pass
    doc = build(res, identity_path, dm_key)
    # stdout stays the record itself, byte for byte what was signed; the
    # piece is written beside it and said on stderr.
    if job_dir and os.path.isdir(job_dir):
        for rel in file_piece(job_dir, doc):
            print(f"filed {rel} under {job_dir}", file=sys.stderr)
    json.dump(doc, sys.stdout, indent=2)


if __name__ == "__main__":
    main()
