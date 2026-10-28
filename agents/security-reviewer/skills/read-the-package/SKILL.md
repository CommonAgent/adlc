---
name: read-the-package
description: the first step of a review, reading what a package declares it will reach, spend and refuse
---

# Read the package

Part of security-reviewer, the first step of Review a package.

## What it does

Unpacks the package in memory (`scripts/tar.mjs`; a link or a path that climbs out of the archive is reported and not read) and reads what it declares (`scripts/read-package.mjs`): each system at its access with its reason, from the descriptor; its kind, the NAME of its credential, the variable it is placed in, its settings and what it spends, from the runtime requirements; and the ceilings, binaries, folders, dependencies, refusals and programs. It reads every file for what looks like a credential with the publisher's list (`scripts/secrets.mjs`), and reports a match by file and line, never its bytes. It writes `<records>/<job id>/declared.json`.

## When it comes back empty

No descriptor and no runtime requirements means there is no package to review, and the job stops and says what it needs.

## Scripts

- scripts/read-package.mjs
- scripts/tar.mjs
- scripts/secrets.mjs
