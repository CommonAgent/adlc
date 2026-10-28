# code-writer 0.2.4: released again so the registry serves the package's own Descriptor

Date: 2026-10-28.

## Why

0.2.3 was updated on dev before the platform stopped laying its 300-character
`does` over a bound Descriptor (AgentMesh 8cda3dcb3, live 15:12Z). The
registry kept serving that cut copy, so the audit's descriptor-matches-package
found the served Descriptor differing from the package's in `does`. A new
version, deployed through the deployment manager, is served as packaged.

## What changed

Only the version. The agent is 0.2.3's, byte for byte otherwise.

## Who held each step

The harness (Claude Code) wrote the change; packaging, the deploy request and
the update go through the package maker, the platform account's deploy queue
and the deployment manager, on dev.
