# code-writer 0.3.3: the local check passes in a fresh clone

Date: 2026-10-30.

A hand-off pushes the build folder to a branch of somebody's repository, and the coding agent runs `node .adlc/check.mjs` in its own clone. In a fresh Windows `git clone` of AgentMesh-Dev-Test/handoff-proof, branch adlc/word-tally-0.1.0, the 0.3.2 check broke the fence before a line was written: every pinned text file "changed" (core.autocrlf had checked them out with CRLF, so the sha256 digests differed), every file under .git/ "added", and README.md, the repository's own file from before the hand-off, "added".

check.mjs now:

- never walks .git (the fence's listing and the copies the blanking runs in both skip it), and handoff.mjs's lock never lists it;
- compares a pinned file byte for byte first and, only when that fails and the file holds no NUL byte, again with CRLF read as LF; a binary file stays byte for byte, and a real change under CRLF is still a change;
- treats a file git held in the parent of the commit that added build.lock.json as the repository's own: not judged while unchanged against that parent's blob (CRLF read as LF again), a broken fence when changed or removed, the same rule the service's gate keeps by `repoFiles`. Without git, outside a clone, in a clone of depth 1 or when the hand-off is the root commit, no file is the repository's own and every file outside the lock and scripts/ is judged as before.

A new file outside scripts/ and test/ is still refused, and so is a changed pinned file.

No `.gitattributes` is shipped in the build folder. The folder lands at the repository's root, where a `.gitattributes` would govern the customer's whole repository and could collide with one they already keep; the CRLF-tolerant compare covers checkouts without it.

## Proof

- test/check-clone.test.mjs, five tests, written first and failing: .git is never walked; CRLF against an LF digest holds, a binary file and a real change do not; the repository's own files may stay as they were and nothing else; repoFilesAt reads git's parent of the lock's commit; and as a process, a clone made with core.autocrlf=true passes when only scripts/ changed, and still refuses an added file and a changed README.md.
- code-writer 129 of 130 (1 skipped: no saved example deliveries); spec-writer 195 of 196 (1 skipped).
- A fresh Windows clone of handoff-proof adlc/word-tally-0.1.0: the shipped 0.3.2 check names all twelve pinned text files, every file under .git/ and README.md; this check, run against the same clone, passes the fence and goes on to the suite.

## Who held the step

The harness (Claude Code), tests first, then check.mjs and one line of handoff.mjs.
