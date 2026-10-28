# What a finding is

One thing wrong with the change, said so that a person can answer it by a
change or a reason.

- **Place.** A file of the package, by its path in the package
  (`scripts/choose-roles.mjs`, `agent-descriptor.json`), and a line in it, as
  the review numbered it. A finding that names no place is not a finding: a
  person cannot go and look, and cannot tell when it has been answered.
- **Claim.** What is wrong, stated so it can be checked: "the script calls
  gemini-2.5-flash by name", not "the model handling could be better". One
  or two sentences.
- **Consequence.** What happens because of it, and to whom: "the job fails
  on every install the day that model is retired, and changing the model
  means a new version". One or two sentences. A claim with no consequence is
  a preference.
- **Rule.** Which house rule it breaks (references/the-house-rules.md), or
  `general`.

A finding is not a fix. It says what is wrong and why it matters, and how
it is put right is for whoever owns the code. It never carries replacement
code.

A finding is not a grade. "The code is clean", "well structured overall",
"7 out of 10" name nothing a person can answer, and they are dropped.

A finding is about the change. With a diff, a line the diff did not touch is
outside the change and is listed apart. The declarations are always part of
it.

Most consequential first. A finding that makes every install fail comes
before one that makes a log line misleading.
