---
schema: https://schemas.agentmesh.ai/architecture-standard/v1
name: Architecture standard
owner: agentmesh.ai
layer: publisher
approved_by: null
approved_at: null
---

# The architecture standard

This is the standard the Architecture stage holds an agent to, the first part
of stage 02 of the Agent Development Lifecycle
(https://agenticdevelopment.ai/stages.html), held by the solution architect
role (https://agentroles.ai/solution-architect.html). The solution architect
applies it to write the architecture record. The Design stage, held by the
spec writer for an agent and the solution planner for a solution, designs
within the record and is held to the same standard. Where a rule here and a
message disagree, the rule governs and the reply says so.

The architect decides by applying these rules, and asks the person only where
the rules leave a real choice. A rule applied is a decision with its reason,
written in the record. A choice the rules leave open is a question, never a
guess.

## 1. What the architecture record says

Seven things, as the role defines them, and nothing a later stage owns.

1. **The systems.** Each system the agent reaches, in plain system words:
   `database`, `files`, `text-reasoning`, `mail`. These are the names the
   package's runtime requirements carry in `systems[]` (Common Agent 12.4),
   and the package maker builds a package whose system names equal the
   record's. A system is never named by its product, an address or an
   account: "Supabase" is a product bound to `database`, not a system.
2. **The bindings.** For each system, the product bound to it in each
   environment the agent will run in, spelled the way the deploy into it
   spells it: `dev`, `test`, `production` (Common Agent 8.3). Each binding
   says whether the organization chose it (`customer`) or a platform default
   filled it (`platform`), as the deployment record's `provided_by` does.
3. **The dependencies.** The other agents and services the agent depends on,
   each named, with why.
4. **The kind.** What the agent's inside is made of: skills a harness reads
   (`plugin-on-harness`), code that answers on the network by itself
   (`mesh-coded`), or somebody else's program in a container
   (`third-party-framework`). The default is `plugin-on-harness` with its
   work in scripts: a program that calls a model at named points (rule 6).
5. **The limits.** What the agent may spend, how quickly it must answer, what
   data it may hold or move and where, and which parties it trusts and on
   what terms.
6. **The decisions.** Every choice the record makes, in the manner of an
   architecture decision record: what was decided, why, the options weighed,
   and what follows. A decision without a reason is not delivered.
7. **The egress.** For each environment, what the agent may reach on the
   network beyond the derived set (its systems, the network, the registrar,
   the model it is given and the hosts its workspace kinds are reached at),
   each further destination named by what it is and why, or a statement that
   it needs none; and whether that environment's target enforces an allowlist
   or runs the agent `open`.

The record designs nothing. The statement of the job belongs to Requirements,
the steps to Design, the agent that does a step to Source.

## 2. Bindings: the organization's stack first

"The organization's stack" is the stack section of the organization record
(AgentMesh docs/account-stack.md): one binding per system, each with a
product, who provides it, and a row per environment. The platform's defaults
are the House Stack, published as the system vocabulary at
`/v1/stack/vocabulary`. The architect binds each system in each environment
in this order, the role's rule ("the organization's own choice is the binding
wherever it made one, a platform default fills each binding it left open")
walked the way the deploy's resolver walks it:

1. the organization's own binding for that environment;
2. the organization's production binding, where the environment has none and
   the organization said production may stand in;
3. the House Stack's product, where the House Stack covers the system, marked
   as a platform default;
4. otherwise a question naming the system and the environment.

The role and the AgentMesh deploy disagree in one place, and the record says
so rather than hiding it. Where the organization bound a system in one
environment and not another, the role fills the other with a default, and the
deploy's resolver refuses a test or production deploy there until the
organization binds it (AgentMesh docs/account-stack.md, section 3, step 7).
The record follows the role, and that binding's decision says what a deploy
there needs first.

A binding names a product. It never carries a credential, an address, a key
store or an account identifier: those are what an install needs, and the
owner's instruction supplies them at Deploy (Common Agent 12.6 rule 3).

## 3. Models are bound systems

A model is a system like any other, stated by the capability the agent needs
and bound to a product per environment.

- The system is named by capability: `text-reasoning` for text,
  `image-reading` for pictures, `speech-to-text` and `text-to-speech` for
  speech, each with access `trigger`.
- The record says the capability the work needs in plain words: text, vision,
  long context, speech. It names the product bound in each environment (the
  provider), never a model or a version.
- No model name goes into code, a skill, an instruction, a setting's default
  or the record. The scripts read which model from configuration,
  `AGENT_MODEL` or `TEXT_MODEL`, through the caller, and refuse in words when
  it is empty. The install places the value from the binding, and a run
  config may change it for one job.

Why: models are retired on somebody else's schedule. An agent shipped with a
model's name written into a script answered 404 the day that model went, and
the fix was a rebuild. A model named only in configuration is a setting
changed.

## 4. What passes between steps and agents

Readable formats by default.

- Content that a person reviews, or that one step or agent hands another, is
  Markdown: `text/markdown`, with a light convention. A short header carries
  the few structured fields, then fixed headings carry the rest, and the
  convention is sketched where the piece is declared.
- JSON only for exact typed data that code consumes and a person never reads:
  identifiers, coordinates, timings, numeric series. Then the kind says what
  the data is, `application/vnd.<org>.<name>+json` or another registered
  `+json` type. Never a bare `application/json`.
- Every kind is specific: a media type, a vendor kind, or one of the value
  kinds `text`, `identifier`, `url` and `document` where nothing more is
  known.
- Each input says who gives it: a `person`, an `agent`, or `either`.

## 5. Addresses and settings

- **Addresses are never settings.** An address the caller gives is an input
  of kind `url`. An address of a product somebody binds comes with the
  binding at install. A keyless public read keeps its address as a constant
  in the script. None of them is a setting a person types.
- **Settings are declared with defaults.** A value that shapes the work is a
  setting the agent declares, with its default, whether it is a preference
  (the closest layer wins) or a rule (the tightest layer wins), and whether a
  sender who does not own the agent may set it for one job (AgentMesh
  docs/run-config-plan.md). A setting nobody declared cannot be set.

## 6. The kind and the `how`

The default is a program that calls a model at named points: each step
declares `how` as control `script`, intelligence `none` or `called`, and
contract `full`. A model in control has to earn it (control `model`,
intelligence `open`, contract `ends`), and the record gives the reason when
it does. A harness reading skills is the default carrier; code that answers
on the network itself, or a container, is chosen with its reason.

## 7. Commitments are asked, never filled

A spending limit, a product that neither the organization chose nor the
platform offers, access to a system the statement does not call for, and a
network destination beyond the derived set are commitments somebody would be
held to. The architect asks for each and fills none of them in. A step of the
design that needs a system the record does not name comes back to the
architect as a question, and the record is revised before the design goes
on; the system is never added on the designer's word alone.

## 8. Done

The Architecture part is done when every system is named and bound in each
environment the agent will run in, every decision has a reason, every kind
of output a person reads has its standing assets decided (section 10), and
every step of the design uses only systems the record named. The architect checks
the first two before it delivers, and says the record is not finished while
a question is open. The third is checked when the design comes back: the
spec writer's draft declares exactly the record's systems, and a step that
needs another goes back as a question.

## 9. The record's form

The record is a Markdown document for the person, with a structured header
for the bindings, so the next stage and a test can read the bindings without
parsing prose. The header is front matter: `record`, `statement`,
`environments`, `kind`, `done`, `questions`, `systems`, `standing_assets`
(the schemas section 10 decided, or `none`), and `bindings`, one line per
system and environment. The body quotes the statement it answers under
`## Statement`, then carries the fixed headings `## Systems`, `## Bindings`,
`## Dependencies`, `## Kind`, `## Limits`, `## Egress`, `## Formats`,
`## Standing assets`, `## Settings`, `## Decisions` and `## Questions`, in
that order. The header is written from the same facts as the body, never by
hand.

## 10. Standing assets

A standing asset is the organization's shared material that many agents
read: its brand profile, its style guide, its glossary, its media templates
(standards/README.md). The record decides, for each kind of output a person
reads, which standing assets apply, each with its reason, or says "none,
because" and the reason. The Design then declares exactly those as
`can_use` entries, each saying what the agent reads, what it does with it,
and what it does `without` it.

- **Which outputs.** An output a person reads, watches or hears: one whose
  kind is `text/markdown`, `text/html`, an image, a video or audio
  (`person_facing_kinds` in standards/standing-asset-schemas.json).
- **The house rule.** Written copy (`text/markdown`, `text/html`) reads the
  style guide, for the voice, and the brand profile, for how the
  organization's name is written and the words it never says. Visual output
  (`text/html`, images, video) reads the brand profile, for the look. Media
  (video, audio) reads the media templates. A glossary is added where the
  work uses the organization's own terms. The rule, its reasons and the
  fields each kind reads are written as data in
  standards/standing-asset-schemas.json (`outputs`), and the record applies
  them.
- **None, because.** An agent with no output a person reads declares none,
  and the record says so with that reason. An agent whose person-facing
  output should read none says why, in the person's words, as the answer to
  `standing-assets: none, because ...`.
- **Only known kinds.** A standing asset is named by a schema on the list in
  standards/standing-asset-schemas.json. The package maker refuses any other.
- **Whose library.** Work content (brand, style, templates) comes from the
  requester's library, under the requester's grant; build standards come
  from the operator's.
- **No secrets.** A standing asset is never a credential and never an
  address the agent is told to reach; it is handed to the job.
