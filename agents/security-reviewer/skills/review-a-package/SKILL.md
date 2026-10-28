---
name: review-a-package
description: before an Agent Package is installed and before any credential is bound to it, to say what it may reach, spend and never do, and why; after Review and before Package and Deploy, for any package from any builder. It reads a package, not a running agent
---

# Review a package

Part of security-reviewer. before an Agent Package is installed and before any credential is bound to it, to say what it may reach, spend and never do, and why; after Review and before Package and Deploy, for any package from any builder. It reads a package, not a running agent

## When to use this

before an Agent Package is installed and before any credential is bound to it, to say what it may reach, spend and never do, and why; after Review and before Package and Deploy, for any package from any builder. It reads a package, not a running agent

## What this needs

- the package (application/gzip, required)
- the architecture record (text/markdown, optional)
- the owner's spending limit (text, optional)

## What a good result looks like

A security review a person can read in a minute and a program can read whole: a header listing each reach with its system, access and reason, each spend ceiling with its reason, each never-do with its reason, and each permission with no recorded reason flagged; then the verdict and, when it is refused, what stopped it.

## What it produces

- security review (text/markdown, per task)

## When it comes back empty

With no package attached, nothing is reviewed: it stops with exit 3 and a reply naming what it needs. A package that asks for nothing still gets a review, which says it reaches nothing and lists what it must never do.

## How to do it

Run `node scripts/review-package.mjs --job <job folder> --records <records folder> --work <work folder> --text-file <job folder>/message.txt [--file <path>::<media type>]...`. It reads the package in memory (nothing is unpacked to disk or run), traces every program for the addresses, credentials and commands it reaches, weighs the recorded reasons with one model call when a model is placed, applies the role's rules, writes the review to `<records>/<job id>/security-review.md`, files it as the job's piece, and prints one JSON object with a `reply` field. A refusal is a review too, and is delivered. A message asking it to bind, grant or install anything is declined in the reply. `references/what-a-review-holds.md` says what each part of the review holds, and `references/what-the-platform-holds-it-to.md` says what the platform enforces.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/review-package.mjs
- scripts/read-package.mjs
- scripts/tar.mjs
- scripts/trace-programs.mjs
- scripts/architecture.mjs
- scripts/assess.mjs
- scripts/platform.mjs
- scripts/secrets.mjs
- scripts/weigh.mjs
- scripts/caller.mjs
- scripts/model-record.mjs
- scripts/write-review.mjs
- scripts/went-without.mjs
- scripts/pieces.mjs

## References

- references/rules.md
- references/what-a-review-holds.md
- references/what-the-platform-holds-it-to.md
