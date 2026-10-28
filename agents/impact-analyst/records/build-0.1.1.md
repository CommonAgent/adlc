# impact-analyst 0.1.1: the report names no attached file

Date: 2026-10-27.

## Why

The first run on dev (Site reader 2.4.1 to 2.5.0) gave the same answers as the
same files on a laptop, but not the same bytes. The host hands a job its
attached files under names of its own (`0-EFU6M1xw-site-reader-2.4.1.descriptor.json`),
and 0.1.0 put the file names into the report, in the sentence saying which
declaration runs today and in the note about a file sent under another kind.
Two runs over the same change could then give two reports, which the role
forbids.

## What changed

- The running version is named by its agent_version, never by its file.
- A file sent under another kind is noted by its kinds alone, and the notes
  are counted.
- The runtime requirements are paired in words that name no file.
- Files that could not be read are still named, in the reply and in
  went-without.json, where the person needs the name to send it again.

## Tests

45 pass, and run.test.mjs now checks that no attached file's name is in the
report.

## Who held each step

As for 0.1.0: the harness wrote the change and its test at the owner's
instruction; packing, the deploy request and the install go through the
package maker, the platform account's deploy queue and the deployment
manager, on dev only.
