# Standards: the standing assets the Builders read

This folder holds the standing assets every Builder in this repository reads:
the rules the lifecycle holds an agent to, kept once, in one place, at a
version each Builder pins.

| File | Kind (schema) | Who reads it |
|---|---|---|
| [architecture-standard.md](architecture-standard.md) | `https://schemas.agentmesh.ai/architecture-standard/v1` | the solution architect, which applies it; the spec writer, which designs within it |
| [audit-checklist.md](audit-checklist.md) | `https://schemas.agentmesh.ai/audit-checklist/v1` | the auditor, which runs it over an agent version; the deployment manager and the catalog, which read its verdict |
| [standing-asset-schemas.json](standing-asset-schemas.json) | the list of known standing-asset kinds | the package maker, which refuses a `can_use` entry naming any other; the solution architect and the spec writer, which choose from it |

## What a standing asset is

A standing asset is a typed, versioned, non-secret document that an
organization owns and many agents read: a brand profile, a style guide, a
glossary, media templates, the organization's stack, the architecture
standard, the audit checklist. It is what a person means by the
organization's **Library**, one of the three things an agent draws on:

- **Setup**: what the agent is connected to, and with which keys, done once
  by the operator (install settings and system bindings). Secrets live only
  here.
- **Library**: the organization's shared material and defaults (standing
  assets the agent declares in `can_use`, and the default layers of its
  run-config settings).
- **This job**: what you give it, and your options for this run (its inputs
  and that run's run-config choices).

Every standing asset has:

- a **kind**, named by a schema URL with the version in it, such as
  `https://schemas.agentmesh.ai/brand/v1`;
- a **version**, the `sha256:` digest of its bytes;
- an **owner**: an organization, a team or a person;
- an **approval**: a person approves each version (`approved_by`,
  `approved_at`);
- a **layer**, and no secrets.

The Markdown standards here carry `schema`, `name`, `owner`, `layer`,
`approved_by` and `approved_at` in a header at the top. The version is not
written in the file, because it is the digest of the file.

## Layers

A standing asset can be given at five layers, widest first: **publisher**
(a family ships these defaults), **organization**, **team**, **person** and
**job**. A preference is taken from the closest layer that gives it. A rule
takes the tightest: a later layer may only narrow it. A republisher becomes a
publisher for its own buyers. These are the layers and semantics the
AgentMesh run-config resolver already applies to settings.

The standards in this folder are the publisher layer for the Builders
family. An organization may give its own, which the Builders read in their
place where the organization's rules are tighter.

## Across companies

Work content (a brand, a style guide, templates) comes from the
**requester's** library, under the requester's grant: an announcement written
for a customer is in the customer's voice. Build and check standards (the
architecture standard, the audit checklist) come from the **operator's**
library: the operator decides what its Builders hold an agent to.

## How an agent declares what it reads

An agent declares each kind of standing asset it reads as a `can_use` entry
in its Descriptor:

```json
{ "schema": "https://schemas.agentmesh.ai/style-guide/v1",
  "reads": ["voice", "words.avoid"],
  "required": false,
  "does": "writes the announcement in the organization's voice and avoids the words it lists",
  "without": "writes in a plain, neutral voice and says no style guide was given" }
```

`without` says what the agent does when no asset of that kind is given, and
every entry states it. Each run record cites `{schema, version_digest, layer}`
for every standing asset the run used, so anyone can tell which version of
the brand or the style guide a piece was made under.

In the lifecycle, the solution architect's record decides which standing
assets apply to each kind of output, with a reason, or says "none,
because…"; the spec writer declares exactly those as `can_use`; and the
package maker refuses a `can_use` entry whose schema is not in
[standing-asset-schemas.json](standing-asset-schemas.json) or that has no
`without`.

## How the Builders read these files

Each Builder that reads a file here pins it by digest in its own folder (the
solution architect and the spec writer in `standards-pins.json`, the package
maker in `build.py`'s `STANDING_SCHEMAS_PIN`), and its tests fail when the
file here no longer matches the pin. A change to a
standard is therefore a new version on purpose: the change is made here,
approved by a person, and each Builder re-pins, is tested and is released
with it. A Builder's package carries the bytes it pinned, so an agent built
or checked by it was held to exactly that version, and its records can cite
that digest.

## Changing a standard

Change the file here, in a pull request. Record the person who approved the
new version in its header. Re-pin every Builder that reads it (each Builder's
README says where its pins are), run their tests, and release them.
