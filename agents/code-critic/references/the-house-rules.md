# The house rules

The architecture rules agents here keep breaking, and how a review holds a
package to them. A program (scripts/house-rules.mjs) checks what can be seen
in the text; the model is told what the program found and looks for the rest.
Each rule names the finding's `rule` id.

## 1. No model named in code (`model-in-code`)

A model is a bound system, `text-reasoning` (or `image-reading`,
`speech-to-text`, `text-to-speech`) with access `trigger`. The scripts read
which model from configuration, `TEXT_MODEL` or `AGENT_MODEL`, through the
shared caller, so the install chooses it and a run config can change it. No
script, skill or declaration names a model or a version, not as a default,
not in an instruction, not in a sentence.

Why: models are retired on somebody else's schedule. Brand reader shipped
with `gemini-2.5-flash` written into `scripts/choose-roles.mjs`; the model
began to answer 404, nothing the install set could change it, and no profile
got a primary or an accent color until the package was rebuilt.

The program finds: a model's name in a code line of a script (comments are
history and are not read), in a SKILL.md, or in a declaration; and a script
that calls a model's endpoint without reading `TEXT_MODEL` or `AGENT_MODEL`.

## 2. No address where a bound system belongs (`hard-coded-address`)

A system the package reaches is declared in agent-runtime-requirements.json,
and its address is what the install places: dev, a customer's account and
prod each bind their own. An address written into a script reaches the same
place in every environment, and moving the system means a new version.

A keyless public read the package exists to make (a public site, a public
API) is declared as a system with no credential, and its address may stay in
the script. What is never right is an address that changes with the
environment (the platform's own `app.`, `api.` and other hosts under
agentmesh.ai, dev among them, or a deployed service's own host) written into
the code, or any address used as the value of a setting when the setting is
missing, because that is exactly the case nobody notices.

The program finds both. The model providers' endpoints inside the shared
caller are that binding's wire and are not findings.

## 3. Every delivered piece matches its declared kind (`kind-mismatch`)

Every input and output is declared with a kind, chosen for whoever reads it.
Content passed between agents, or reviewed by a person, is `text/markdown`
with a light convention (a short header, then fixed headings, sketched in
the piece's `about`). JSON is only for exact typed data code consumes, under
a specific kind such as `application/vnd.agentmesh.<name>+json`. A bare
`application/json` says nothing about what is inside.

The program finds: a bare `application/json` in the descriptor (one finding
for all of them), a literal piece entry in a script whose `media_type` is not
its declared kind, and a piece filed under an extension that is not its
media type.

## 4. No undeclared outputs (`undeclared-output`)

A piece a job delivers is declared as one of its outputs, by name (or as one
of several files under one output, "<output> (<file>)"). A piece nobody was
told to expect is shown by the App without a kind it can trust, and a buyer
reading the descriptor does not know it is sent.

The program finds a literal piece entry whose name no output declares. A
name built at run time is not seen.

## 5. Refusals and records match what the code does (`claims-match-code`)

What the declarations say about the package is what the package does. The
records an owner is told about are the records written. The credentials a
script reads are the ones its systems bind. A step declared as no model calls
none, and one declared as calling a model calls one. The `how` of every job is
a program calling a model at named points (control script, intelligence none
or called, contract full); a method handed to a model to improvise (control
model, contract full) and a program that hands the work to a model to find
its own way (intelligence open) are the two shapes that failed.

The program finds: a declared record no script writes, a record a script
writes that is not declared, a credential read that no system binds, and a
`how` the scripts do not bear out. Whether each refusal is enforced is the
model's to read: find the code that would have to refuse, and say whether it
does.

## A declaration is part of the change (`declaration-change`)

With a diff, an access of write, admin or trigger added to a declaration is
a finding, said more strongly when no script in the change uses it. Whether
the package may have that access is the security reviewer's call; the
finding is so the change is not missed.

## Everything else (`general`)

Ordinary code quality, held to the same shape: a place, a claim, a
consequence. A script that does not do what its skill says. An error caught
and dropped, so a failure reads as success. A test that cannot fail. A path
from a message used unchecked. A promise in the account that the code does
not keep.
