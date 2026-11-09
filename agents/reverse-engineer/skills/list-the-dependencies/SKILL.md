---
name: list-the-dependencies
description: After the codebase is read, to make the dependencies part of the record.
---

# List the dependencies

Part of reverse-engineer. After the codebase is read, to make the dependencies part of the record.

## When to use this

On every adoption. On drift, only when a manifest or lockfile changed.

## What a good result looks like

A CycloneDX 1.5 bill of materials made by rule, never by the model. From package-lock.json or npm-shrinkwrap.json: every installed package with its exact version, its integrity as a hash, development and optional packages marked, and what each depends on. From a package.json with no lockfile: the ranges it asks for, each marked as a range. From requirements.txt, go.mod and Cargo.lock: their packages. The same files give the same bytes. A lockfile it does not read is a gap. On drift: what was added, removed or moved to another version since the last record.

## When it comes back empty

A codebase with no manifest gets a bill of materials with no components, which says so.

## How to do it

`makeSbom` in scripts/sbom.mjs, and `componentChanges` for drift.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/sbom.mjs
- scripts/codebase.mjs
