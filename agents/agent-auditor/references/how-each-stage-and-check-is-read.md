# How each stage record and each check is read

The rules are in `rules.md`. This file says where each record is found, what
counts as signed and bound to the package digest, and what each
registered test runs.

## Which package is audited

- `package_digest: sha256:<hex>` in the message: that digest.
- `version: <x.y.z>`: the package the deploy queue filed for that version
  (the deployed request first), or an attached package of that version.
- Neither: the version the agent's stored Descriptor states on dev.

When no package is on record for the version (an agent registered without a
package, such as one coded on the mesh itself), the report says so in its
header (`package_digest: none`), fails the stage records that need one, and is
not filed, because the platform keeps reports by package digest.

## Stage records

Holders are `references/stage-holders.json`, resolved to keys through each
handle's storefront (`GET /a/<handle>`) on dev and prod. They name who
usually signs; they are not required. Signed means a signature verifies, by
whoever made the record, by the family's rule (Ed25519 over the record's
tag, a newline, and the canonical JSON without `signatures`), under one of
those keys.

| Stage | Record | Found in | Bound when |
|---|---|---|---|
| Requirements, Architecture, Design, Impact, Test, Review, Security review | a signed delivery manifest (`job-manifest-v1`): one the stage's usual holder signed, or one the message names for the stage (`<stage>: <file name>`) | attached to the audit | the manifest names the package digest, or the package's signed build record names the manifest, or one of its pieces is a file in the package |
| Code | the code writer's delivery manifests | attached | every script in the package is a piece of a verified manifest signed by a code writer, by its bytes (the package maker's `provenance.mjs` rule) |
| Release | `agent-build-record-v1`, signed (usually by the package maker) | the deploy queue (`GET /v1/operator/audit/stage-records`) or attached | its `package.sha256` is the digest |
| Deploy | the registry's stored Descriptor, signed by the agent's own key (`descriptor-statement-v1`), and its registration | `GET /v1/agents/<key>/descriptor` | the deployment record for this package names its digest; failing that, it states the audited version |
| Deploy | `agent-deployment-record-v1` (act deploy, update or alongside), signed (usually by the deployment manager) | the deploy queue or attached | its `package.sha256` is the digest |
| Conformance | `agent-eval-record-v1`, signed (usually by the conformance checker) | `GET /v1/agents/<key>/eval-record` or attached | it names the package digest, or the image the deployment record started |
| Docs | the AgentDoc | `GET /a/<handle>/agentdoc.json` | the Descriptor it was read from states the audited version |

A record bound to another digest is **stale**. A record with no signature, or one whose
signature does not verify, is **unsigned**. A record that verifies under any
key counts as signed. A records-folder note (`records/build-<version>.md`) is a
person's account and carries no signature; it is never a stage's record.

## Registered checks

| `check` | What runs |
|---|---|
| `registered` | the storefront: the handle resolves, and the card's handle is the one audited |
| `descriptor-signed` | the registry's bytes: their digest is the door's, the agent's page read the same digest, and the signature verifies under the subject, which is the registered key |
| `descriptor-floor` | the minimal Descriptor's members (Common Agent 4.9, 6.2), as the platform's frozen verifier holds them |
| `descriptor-matches-package` | the package's `agent-descriptor.json` against the served one, member by member, setting aside the members the deployment record says the deploy bound |
| `descriptor-person-members` | `name`, `summary`, `will_not`, and `given_by` on every input |
| `package-maker-format-rules` | the package maker's own `build.py` over the package (`format_rules`); failing that, the `format_rules` in the signed build record for this digest; failing that, its rule 1 read off the Descriptor |
| `no-model-literals` | AgentMesh's `check-no-model-literals` rule (`scripts/models.mjs`, a copy) over the package's code, skills, runtime requirements and Descriptor |
| `delivered-formats` | each declared output's kind (words a person reads are `text/markdown`), and each delivered piece attached, by the test writer's `checkDelivered` rule (`scripts/formats.mjs`, a copy) |
| `revisions-declared` | every offering's `revisions` policy, present with `included` and a price |
| `can-use-declared` | the package maker's `standing_rules` when its build.py runs here; otherwise, the same three rules over the Descriptor: each `can_use` schema on `standards/standing-asset-schemas.json`, each with `without`, and person-facing output with a `can_use` |
| `standing-assets-cited` | an agent with no `can_use` passes; otherwise the attached run records must cite `{schema, version_digest, layer}` for each declared kind |
| `versions-dev-prod` | dev serves the audited version; prod, where it serves the agent, runs no newer version |
| `stage-record:<stage>` | the stage's line above: present, signed and bound (for `docs`, present and naming the version). At `level: info` the result is shown as on file or not on file, and never counted |

Any other `check` name is reported as not checked.
