Round two on code-writer 0.3.0. I started from the current 0.3.0 scripts (the prototype) and changed three places, one per finding.

F1: `lockProblems` in scripts/workspace.mjs now also refuses any file in the build folder archive that is outside scripts/ and that build.lock.json does not pin. It names each one ("<path> is outside scripts/ and not pinned by the lock"), and it runs before anything is unpacked, so nothing is taken into the workspace. Two things are not counted: the lock itself (it pins nothing of itself, as the answer to F5 says) and records/ (neither the lock nor the fence holds it). Say if records/ should be refused too.

F2: in scripts/check.mjs, a build folder with no workspace record now takes its baseline from the pinned files in build.lock.json, not from the folder as it stands. The one exception is build.lock.json, which is recorded as it is read because the lock does not pin itself. A file added outside scripts/ before the first run is therefore reported as added, and a pinned file changed before the first run is reported as changed.

F6: scripts/handoff.mjs writes the .adlc/ files read-only (0444), like the other pinned files.

F3, F4 and F5 are answered by reason in the document and I did not touch them.

How I checked: I ran the whole suite in a scratch copy of the workspace and got 69 of 72 passing, then 3 of 72 once the template was restored. I also ran the behaviours by hand: a build folder packed with an extra extra.txt and package.json is refused with exit 3, both named, and nothing is unpacked; a clean build folder unpacks; `node .adlc/check.mjs` in a folder with an extra file added before the first run stops with "extra.txt added"; a clean folder goes on to run round one; and the .adlc/ files come out mode 0444. I wrote no test, because the suite is the test-writer's. The new behaviours therefore have no kept test yet.

The suite does not pass in this container, so I am not delivering:
- Two tests in agent-files.test.mjs fail here: "the agent's files are sorted out of the attachments by content and preferred to a spec" and "as a process: the workspace holds the agent's files and no spec.json...". They call python3 and the sibling package-maker folder, and this container has neither. As you said, they pass in the repository.
- One test in handoff.test.mjs, "a whole hand-off job writes the build folder, packs it as gzip tar, and checks delivered format", also fails here, and this one was not in your note. It reads references/agents-md-template.md from the workspace, and the workspace step laid that file out empty (it stood in for the attached template, which is under prototype/ instead). I may not write outside scripts/, so I could not put the template there. With the real template copied into a scratch copy, that test passes.
