# watcher 0.1.1: an install file the deployment manager installs

Date: 2026-10-28.

## Why

0.1.0 was filed on dev and refused at the deployment manager's emit step: the
install file carried what reads as an account identifier, because the purpose
of the INCIDENT_RECORDER setting named the incident recorder's handle as an
example. A subject is minted at install and never baked into a package, and an
install file carries no handle and no address (Common Agent 12.6 rule 3). The
handle is placed at install, as the setting's value, which is where it was
always meant to come from. Nothing was installed.

## What changed

- The setting's purpose says "the incident recorder's handle" and names none.
- A test holds the install file to the image emitter's own check
  (`forbiddenIn` in agents/image/emit-image.mjs): no address, no account
  identifier, nothing that reads as a credential.
- The version is 0.1.1, since 0.1.0 was packed and filed.

## Tests

35 pass.

## Who held each step

The harness (Claude Code) wrote the change and the test; packaging, the
deploy request and the install go through the package maker, the platform
account's deploy queue and the deployment manager, on dev.
