#!/usr/bin/env python3
"""Acting inside a CUSTOMER's own Google Cloud project.

An owner can ask for their agent to run in their own project rather than on
our machines. They make a service account there, grant this deployer's service
account `roles/iam.serviceAccountTokenCreator` on it, and hand back the pair.
Every call this deployer then makes for that instruction runs under
`--impersonate-service-account`, which mints a token good for an hour: nothing
long-lived ever crosses, the customer wrote the permissions, and they revoke by
removing one IAM binding without telling us first.

TWO HOPS AND NOT ONE, which is the whole of what `flag` builds. The identity
this host holds is its project's DEFAULT COMPUTE service account: shared by
everything else on the box, usually carrying Editor on the project, and exactly
the kind of account this file refuses when a CUSTOMER offers one (see
SERVICE_ACCOUNT_RE below, and say the same sentence back to ourselves). So the
chain is

    this host's machine identity -> our deployer service account -> theirs

and the middle account is the one named on the published permission page and in
every `grant_to` this platform answers. It holds no role in our own project; it
exists to be impersonated onward and to be a principal a customer can grant to
without granting to our estate.


NOT A SERVICE ACCOUNT KEY, even where one is offered. A key is a long-lived
secret that outlives the arrangement and cannot be taken back without our
help, and refusing one is most of the point of this route.

NOT Workload Identity Federation either. WIF gives an identity inside Google
Cloud to a workload OUTSIDE it, and this deployer is already a Google Cloud
workload, so impersonation is the direct path. WIF is the right answer the day
a customer is on AWS or Azure, and that is a different thing to build.

WHAT THIS FILE IS. Plain functions: no root, no network, no side effect. The
guard that refuses a mixed-up pairing, the flag that carries the
impersonation, the reading of what a failed call meant, and the shape of one
line of the action log. steps.py owns the calls; this owns what is true about
them. Keeping it apart means the guard can be exercised without a cloud, which
is the only way the case that matters will ever be tested.
"""
import re

# The one provider this route knows. Named rather than assumed, because the
# instruction carries the word and an instruction naming another cloud has to
# be refused rather than quietly treated as this one.
PROVIDERS = ("gcp",)

# A Google Cloud project id. The SAME rule image.PROJECT_RE applies, spelled
# again here so this file can refuse an instruction on its own before anything
# else has looked at it. test_cloud.py asserts the two patterns are identical,
# because one rule with two spellings drifts and the half that drifts is
# whichever one nobody is reading that day.
PROJECT_RE = re.compile(r"^[a-z][a-z0-9-]{4,28}[a-z0-9]$")

# A service account the customer made in their own project. The project is the
# capture group, and reading it out of the address is the whole of the guard
# below.
#
# DELIBERATELY NOT the google-managed accounts. Neither
# `<number>-compute@developer.gserviceaccount.com` nor
# `<project>@appspot.gserviceaccount.com` carries the project where this reads
# it, and neither is an account somebody made for us on purpose: a grant on the
# default compute account is a grant on whatever else already runs in that
# project, which is the opposite of what a customer thinks they are agreeing to.
SERVICE_ACCOUNT_RE = re.compile(
    r"^[a-z][a-z0-9-]{4,28}[a-z0-9]@([a-z][a-z0-9-]{4,28}[a-z0-9])\.iam\.gserviceaccount\.com$")


def project_of(service_account):
    """Which project a service account belongs to, read out of its own
    address, or None where the address is not one of these."""
    m = SERVICE_ACCOUNT_RE.match(str(service_account or ""))
    return m.group(1) if m else None


def refusal(grant, project=None):
    """What is wrong with this instruction's cloud block, in a sentence, or
    None where there is nothing wrong with it. Read BEFORE any call is made.

    THE CONFUSED DEPUTY, WHICH IS HOW THIS PATTERN IS USUALLY BROKEN. In AWS
    the guard is an external id. Google binds the grant to this deployer's
    specific service account principal, so a stranger cannot ride it, and the
    residual risk is entirely ours: one deployer service account holds grants
    from many customers at once, so a bug that crossed two instructions would
    act in one customer's project with another customer's account. The shape
    that bug takes is a service account and a project that disagree.

    A service account belongs to exactly one project and says which in its own
    address, so the pairing can be checked here with no call to anybody, for
    free, every time. It is checked BEFORE the first call rather than after it,
    because after the first call the wrong thing has already happened in
    somebody's account and no refusal undoes it.

    `project` is the project id the instruction itself carried, where it
    carried one. With a grant in play the project every call names IS the
    grant's, so an instruction naming a different one is the same disagreement
    read from the other side and is refused the same way.
    """
    if not isinstance(grant, dict):
        return (f"cloud must be an object naming the provider, the project and the service account to "
                f"impersonate, and this instruction carries {type(grant).__name__}. Nothing was called.")
    provider = grant.get("provider")
    if provider not in PROVIDERS:
        return (f"cloud.provider says {provider!r}, and the only cloud this deployer can act in on a "
                f"customer's behalf is {', '.join(PROVIDERS)}. Nothing was called.")
    theirs = grant.get("project")
    if not (isinstance(theirs, str) and PROJECT_RE.match(theirs)):
        return f"cloud.project says {theirs!r}, which is not a Google Cloud project id. Nothing was called."
    account = grant.get("impersonate")
    owner = project_of(account)
    if owner is None:
        return (f"cloud.impersonate says {account!r}. This route impersonates a service account the customer "
                f"made in their own project, spelled <name>@{theirs}.iam.gserviceaccount.com; a google-managed "
                f"account is not one, because a grant on it is a grant on whatever else runs there. Nothing "
                f"was called.")
    if owner != theirs:
        return (f"cloud.impersonate names {account}, which belongs to project {owner}, and cloud.project asks "
                f"this deployer to act in {theirs}. A service account belongs to one project, so this pairing "
                f"names two and one of them is a mistake. Nothing was called and nothing will be until the "
                f"grant record names one project.")
    if project and project != theirs:
        return (f"this instruction would act in project {project} while its cloud grant is for {theirs}. "
                f"Nothing was called: a deploy that took the project from one place and the credentials from "
                f"another is the mixed-up context this guard exists for.")
    runner = grant.get("runs_as")
    if runner is not None and project_of(runner) != theirs:
        return (f"cloud.runs_as says {runner!r}, and the account the agent's container runs as has to be one "
                f"the customer made in {theirs}, spelled <name>@{theirs}.iam.gserviceaccount.com. Leave it "
                f"out and the container runs as the account they granted. Nothing was called.")
    return None


def runs_as(grant):
    """Which account the customer's container itself runs as.

    THE ACCOUNT THEY GRANTED, unless they asked for two. One account is one
    thing to audit, and a deployer that can read the secrets it placed is the
    ordinary arrangement; a reviewer who will not have that can split it in
    two, giving the deploy account everything except the power to read a secret
    value and a second account only that, which the container runs as. The
    published permissions page offers exactly that choice, so this reads the
    second account where the instruction names one and changes nothing where it
    does not.
    """
    return (grant or {}).get("runs_as") or (grant or {}).get("impersonate")


def deployer_refusal(deployer):
    """What is wrong with the identity THIS deployer would act through, in a
    sentence, or None. About OUR side, where `refusal` above is about theirs,
    and read at the same moment: before anything is called.

    A HOST THAT DOES NOT KNOW ITS OWN DEPLOYER ACCOUNT MAY NOT CALL. Without
    the chain the flag names only the customer's account, so the impersonation
    would be attempted by this machine's own identity -- the default compute
    service account -- and would only ever work if a customer had granted THAT,
    which is the grant this route exists to avoid asking for. The failure would
    read as a revocation, every customer at once, and the fix would be here.
    So it is refused, loudly, with the variable named.
    """
    # Matched as it arrives. steps.py trims and lowercases the variable once,
    # where it reads it, so there is one normalisation and not two spellings of
    # one; anything that reaches here unnormalised did not come from there.
    if not isinstance(deployer, str) or not SERVICE_ACCOUNT_RE.match(deployer):
        return (f"this host does not name the service account customers grant to, so nothing can be called "
                f"in anybody's project: MESH_CLOUD_DEPLOYER_SA says {deployer!r}. It is the middle of the "
                f"chain -- this machine becomes it, and it becomes the customer's account -- and without it "
                f"the impersonation would be attempted by this machine's own identity, which is the default "
                f"compute account and is not a thing any customer has granted. Nothing was called.")
    return None


def flag(grant, deployer=None):
    """The gcloud flag that carries the impersonation, or nothing at all.

    A LIST AND NEVER A STRING, so the absent case is the empty list and a call
    made with no grant is byte for byte the call this deployer made before any
    of this existed. That sameness is a promise, and test_steps.py keeps it.

    The flag goes immediately after the program name. gcloud reads it wherever
    it appears, but every other position is somewhere among a subcommand's
    positional arguments, and `builds submit <context>` is exactly the shape
    where a flag in the middle eventually means something else.

    THE ORDER OF THE CHAIN IS OURS FIRST AND THEIRS LAST, and it is the one
    thing here worth verifying rather than reasoning about, because a chain
    written backwards either fails in a way that reads like a revocation or, if
    both bindings happen to exist, works as the wrong identity.

    Verified two ways on 2026-09-12 rather than taken from the documentation,
    which is contradictory on exactly this point. gcloud's own help says "when
    --impersonate-service-account=SERVICE_ACCOUNT_1,SERVICE_ACCOUNT_2 ...
    SERVICE_ACCOUNT_1 is the impersonated service account and SERVICE_ACCOUNT_2
    is the delegate", which is backwards from the permission direction stated
    two sentences earlier in the same paragraph. The code settles it:
    googlecloudsdk/core/credentials/store.py ParseImpersonationAccounts returns
    `service_account_ids[-1]` as the target principal and `[:-1]` as the
    delegates. And a read-only run of

        gcloud --impersonate-service-account=<ours>,<a name that does not exist>
               iam service-accounts list --project=<our own project>

    answered: "All API calls will be executed as [<the last one>] ...
    Impersonation is used to impersonate <the last one> via delegate chain:
    <ours>". The LAST account is the identity acted as; everything before it is
    a hop on the way there.
    """
    if not grant:
        return []
    if not deployer:
        # Unreachable through any instruction: enter_cloud refuses a host with
        # no deployer account before this is ever asked for. Raised rather than
        # returned so that if the guard is ever bypassed the act stops here, at
        # a procedure that has called nothing, instead of producing a flag that
        # would run this machine's own identity inside a customer's project.
        raise ValueError("no deployer service account: refusing to build an impersonation flag without "
                         "the chain, because the flag without it impersonates from this machine's own "
                         "identity")
    return [f"--impersonate-service-account={deployer},{grant['impersonate']}"]


# -- what a failed call MEANT, which is not what it said -------------------
#
# A customer removing the IAM binding is exercising a right. It needs no
# incident, no page and no retry. A 503 out of Google is an outage and needs
# exactly the retry the revocation must not get. Collapsing the two means
# retrying a revocation forever, which is how a vendor becomes a nuisance and
# how an account team hears what we did from the customer instead of from us.
#
# Read off stderr, because that is what there is: gcloud returns 1 for all of
# these and the words are the only thing that separates them.

# The impersonation itself was refused: the binding is gone.
REVOKED_MARKERS = (
    "failed to impersonate",
    "unable to impersonate",
    "iam.serviceaccounts.getaccesstoken",
    "serviceaccounttokencreator",
    "error creating a target credential",
    "unable to acquire impersonated credentials",
)
# The blunter revocation: the account itself is no longer there. Read only
# where the message names THAT account, because a not-found about a job is a
# job that was never created and says nothing about the grant.
GONE_MARKERS = ("does not exist", "not_found", "unknown service account", "was not found")
# Nobody was reachable. An outage, ours or theirs, and the same instruction can
# be sent again unchanged.
UNREACHABLE_MARKERS = (
    "503", "500", "service unavailable", "internal error", "backend error",
    "deadline exceeded", "temporarily unavailable", "try again later",
    "connection reset", "connection aborted", "connection refused",
    "network is unreachable", "could not reach", "unable to reach",
    "429", "too many requests", "rate limit",
)
# The impersonation WORKED and the call was then refused inside their project:
# a role that account has not been given, or an API that project has not
# enabled. The grant is intact, and a retry fails the same way until they
# change something, so it is neither a revocation nor an outage.
DENIED_MARKERS = (
    "permission denied", "permission_denied", "does not have permission",
    "caller does not have permission", "403", "forbidden",
    "has not been used in project", "service_disabled", "is disabled",
    "required permission",
)


def outcome_of(grant, returncode, stderr="", timed_out=False):
    """One word for what happened to one call: ok, revoked, unreachable,
    denied or failed. Most specific first, because a revocation also reads as
    a permission error and would be swallowed by the general case if the
    general case were asked first."""
    if returncode == 0:
        return "ok"
    low = (stderr or "").lower()
    account = str((grant or {}).get("impersonate") or "").lower()
    if any(m in low for m in REVOKED_MARKERS):
        return "revoked"
    if account and account in low and any(m in low for m in GONE_MARKERS):
        return "revoked"
    if timed_out or any(m in low for m in UNREACHABLE_MARKERS):
        return "unreachable"
    if any(m in low for m in DENIED_MARKERS):
        return "denied"
    return "failed"


def retryable(outcome):
    """Whether sending the same instruction again could work. True for an
    outage and for nothing else: a revocation retried is a vendor nagging a
    customer about a decision they already made, and a call refused for want
    of a role fails identically until somebody grants the role."""
    return outcome == "unreachable"


def state_of(outcome):
    """The grant record's own state this outcome observed, in the contract's
    vocabulary (pending, verified, revoked, unreachable), or None where this
    call observed nothing about the grant at all.

    ABSENT IS A STATEMENT, the same as everywhere else in these records. A
    call that never reached a token -- a bad argument, a refusal gcloud made
    before it authenticated anything -- says nothing about whether the binding
    is still there, and writing "verified" over a record somebody else keeps
    on the strength of it would be inventing an observation.

    `denied` maps to verified on purpose: a call refused by the target API is
    a call that was made, which means a token was minted, which means the
    grant is live.
    """
    return {"ok": "verified", "denied": "verified",
            "revoked": "revoked", "unreachable": "unreachable"}.get(outcome)


def explain(outcome, grant):
    """What a failed call means, in the words this deployer reports it with.
    Calm on purpose where it is a revocation: the customer did a supported
    thing, and the right answer is to stop, say so plainly, and say what would
    restore it."""
    project = (grant or {}).get("project") or "the customer's project"
    account = (grant or {}).get("impersonate") or "their service account"
    if outcome == "revoked":
        return (f"this deployer can no longer act in {project}: impersonating {account} was refused. That is "
                f"the grant being taken back, which is the customer's to do and needs no incident here, so "
                f"nothing was retried and nothing will be. Granting roles/iam.serviceAccountTokenCreator on "
                f"{account} to this deployer's service account again is what restores it.")
    if outcome == "unreachable":
        return (f"{project} could not be reached. This is an outage and not a refusal: as far as anything "
                f"here can tell the grant on {account} is still in place, and the same instruction can be "
                f"sent again unchanged.")
    if outcome == "denied":
        return (f"impersonating {account} worked, so the grant is in place, and the call was then refused "
                f"inside {project}. That is a role the account has not been given or an API the project has "
                f"not enabled; it is the customer's to change, and retrying without changing it fails the "
                f"same way.")
    return f"a call in {project} under {account} failed."


# -- the action log --------------------------------------------------------

def command_of(argv):
    """What a call WAS, for the log: the gcloud command, and nothing else.

    NAMES, NEVER VALUES, which is the rule the deployment record already
    follows. The leading words of a gcloud argument vector are the command and
    usually the name of the thing it acts on ("run jobs create watcher-worker",
    "secrets versions add fleet-gemini-api-key"); everything from the first
    argument carrying a flag, a path, an address or an equals sign onward is
    that call's data. A log that carried the data would be a second place a
    bucket path, an image reference and, one flag from now, a value lives, and
    this file is meant to be handed to the customer unedited.
    """
    words = []
    for a in argv:
        a = str(a)
        if a.startswith("-") or any(c in a for c in "/:@= "):
            break
        words.append(a)
    return " ".join(words)


def action(grant, argv, outcome, at, seconds, error="", act=None, agent=None):
    """One line of the action log: what we did inside their project, when,
    under which account, and how it went.

    WHY WE KEEP OUR OWN LIST. Their Cloud Audit Logs already show every one of
    these calls, so this proves nothing they could not already see. The point
    is that our list AGREES with theirs, and that it is offered rather than
    requested. An asymmetry about what a vendor did inside your account is the
    thing that ends this kind of arrangement, and the way to not have one is to
    publish the same list first.
    """
    return {
        "at": at,
        "project": grant["project"],
        "service_account": grant["impersonate"],
        "command": command_of(argv),
        "outcome": outcome,
        "seconds": round(float(seconds), 3),
        **({"act": act} if act else {}),
        **({"agent": agent} if agent else {}),
        # The error only where there was one, and gcloud's own words for it,
        # clipped. A customer comparing this against their own audit log needs
        # the sentence they will find at the other end.
        **({"error": str(error).strip()[:300]} if outcome != "ok" and str(error).strip() else {}),
    }
