# spec-writer 0.10.0: the agent's files are written from the spec by code

Date: 2026-11-09.

## Why

In the round trip on hn-reader the spec was carried across exactly and its
revisions were exact edits, but the Design part was a fresh model draft every
time. Asked to rename one output, it renamed the offering, its step and its
skill folder too; asked to undo that, it also flipped the output's name back.
The build could never pass, because the agent's files disagreed with the
spec. This build holds three rules:

1. code copies facts, and the model only describes;
2. each output is checked by code against the stage before;
3. a change is an edit: only what was named changes, checked by code.

## What changed (from 0.9.0)

- The spec carries the new facts of the reverse engineer 0.3.0 (spec-v1
  1.1.0), by code (scripts/seed.mjs): interfaces of kind constant and
  declaration, kept with their value (and a declaration with declared_in);
  a command's required_flags; a file's allowed values; a declared run-config
  setting's default, min, max and allowed values, so only a default nobody
  declared is asked; and strings.json (as-built-strings-v1), every entry of
  which lands byte for byte in some requirement's exact: a wording or pattern
  requirement under the feature whose behavior's evidence covers its line
  (the narrowest), else under the feature anchored to its file, else a
  constraint, and none for a behavior the person dropped. A string some
  requirement there already carries is not added twice.
- scripts/spec-check.mjs finds each of them lost: a string no exact carries,
  a kept value that is not the record's, a required flag or the allowed
  values missing. On a revision an interface the words name is the person's
  to change. The spec as Markdown shows each value, where it is declared, the
  flags required and the allowed values.
- scripts/revise.mjs: a declared value is named by a sentence that renames it,
  as a whole word, and a piece's name opens only that feature's pieces
  (F3.pieces), never its offering, name or requirements; "rename" alone no
  longer opens the agent's name. A revision whose words name nothing in the
  spec returns it byte for byte, with no model and no fit (scripts/spec.mjs).
- scripts/structure.mjs (new) writes every structural field of the agent's
  files from the spec: offering ids, step ids and skill folders (declarations,
  else the features' offerings as slugs), each input's and output's name,
  kind and schema (declarations, else the spec's pieces and file interfaces,
  a schema without any address), labels the spec keeps, run-config settings,
  systems with their address settings, run commands in the packaged form with
  the flags the command interface keeps (a file flag in per_file, and a
  required flag the host has nothing for said as a finding), scripts,
  runtimes, records and price; then it puts every kept declaration at its
  place. It also holds the prose keys, what a revision's words name, the
  carry of earlier prose, and the check that every other prose field is byte
  for byte.
- scripts/declared.mjs (new): where a declaration points (a file and a path),
  and declarationProblems, every kept declaration whose value is not at its
  place in the files. The product's own name and version are the spec's
  product.
- scripts/draft.mjs designFromSpec (new) is the Design the job runs: the
  structure by code, the model asked only for prose, by key, and only the
  keys it may write (all on a first Design; on a revision the ones the words
  name and any new ones); what a change of prose can settle goes back once;
  then code names each host in its service's needs and writes no address
  outside a setting's default. A revision starts from the files sent back, or
  else the newest draft an earlier job wrote. blanks.json says what the
  Design wrote (design: mode, prose_written, and on a revision what the words
  named and which structure changed). askForSpec stays exported, and the job
  no longer calls it.
- The descriptor and manifest are 0.10.0; write-a-spec and draft-the-spec
  carry structure.mjs and declared.mjs (draft-the-spec also files.mjs and the
  manifest schema it reads). The README, rules, reference and skills say the
  structure is code's and the words are the model's. standards-pins.json
  already pins spec.schema.json 1.1.0.
- Tests, model-free on a small synthetic record (test/fixtures/as-built-v3,
  the tide reader with constants, declarations, required flags, allowed
  values and strings.json): test/seed-v3.test.mjs and
  test/structure.test.mjs, including the round trip's case (a revision
  renaming one output leaves the offering, steps, skill folders and run
  command as they were, with and without declarations), the package maker's
  own build of the files, and words about the files alone leaving the spec
  byte for byte. test/design.test.mjs runs its whole job through the new
  Design.

## On the round trip's own write-up and spec

Run locally with no model, over the reverse engineer's write-up of hn-reader
(a 0.2.0 record: no declarations and no strings.json yet) and the spec the
round trip handed on (read only):

- Seeded from the write-up: 12 features, 96 requirements, 27 interfaces, all
  kept, 2 constraints; the check finds nothing lost.
- The files' structure from the spec: one offering, read-the-stories, named
  after F10's offering since the spec keeps no declaration; outputs read,
  stories and pieces, their kinds application/vnd.agentmesh.read+json, the
  spec's application/vnd.agentmesh.stories+json and
  application/vnd.agentmesh.pieces+json, the stories schema without the
  address the spec keeps; no inputs, since the spec names none (the original
  declared run-context, which a 0.3.0 record will carry); the command node
  {home}/{package}/skills/read-the-stories/scripts/read-top-stories.mjs with
  --job, --records, --text-file and --work, and --file once per attached file
  (the round trip's own files ran skills/read-top-stories/... under the slug
  read-the-stories, and put {file_path} in the command); the five modules as
  scripts; the systems hacker-news-firebase-api, with
  HACKER_NEWS_FIREBASE_API_ADDRESS defaulting to its address, and
  arbitrary-urls-supplied-by-the-stories, which fetches what it is handed;
  the setting count (default 10, 1 to 30, step 1, label Count); node; free.
  With a stand-in writing the prose, the files have no findings and the
  package maker takes them.
- The round trip's rename, replayed: "Rename the output stories to
  top-stories", with a stand-in that also changes F10's offering and the
  command interface. The spec changes F10's pieces only; both other edits
  are dropped and said. The files: the offering, its skill folder and the
  whole runtime requirements file are byte for byte as before; the output is
  top-stories, its about the only prose written; the package maker takes
  them.

The whole job (asked.mjs, draft.mjs, builds.mjs, ask.mjs, pieces.mjs) was
also run through its commands on the v3 fixture against a stand-in model on
localhost, first as a new request and then as "changes: Rename the output
tides to next-tides.": the second job's descriptor changed only that output,
its runtime requirements file was byte for byte the first's, and the builder
took both.

315 tests, 314 pass, 1 skipped. Written by the harness (Claude Code)
directly; no model was run.
