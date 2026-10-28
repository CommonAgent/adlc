# spec-writer 0.5.4: the draft step never runs to the job's time limit

Date: 2026-10-28.

## Why

On dev, three of four live runs of spec-writer hit the job's 10-minute limit
and delivered nothing. Measured against the same request (lifecycle plan
item 4, "an agent that writes a one-page product announcement"): two of three
answers from the text-reasoning service were not valid JSON (one closed the
`jobs` list early), each call took one to two minutes, and draft.mjs exited 1
on an answer it could not read, with no budget on its calls and no word to
the harness about what to do next.

## What changed

- The answer is read for the JSON object inside it: the whole answer, a
  fenced block anywhere, or a balanced `{...}` in prose (braces inside
  strings do not count).
- An answer with no readable object is asked for once more, with a "JSON
  only" reminder, and never a third time. The most a job calls is the two
  goes for findings plus that one reminder.
- A Gemini call asks for JSON mode (`responseMimeType: application/json`).
- The whole step runs inside `DRAFT_SECONDS` (240 by default). No call starts
  with less than a minute left, and each call is cut at what remains.
- A draft already in hand stands, with its findings, when a later call fails
  or time runs out (`stopped` in the output says why).
- With no usable draft, draft.mjs prints `{ok: false, code: 4, reply}` and
  exits 4. write-a-spec's SKILL.md says to print that reply and stop, and to
  run draft.mjs once per message.

## Tests

164 pass (11 new in test/draft-json.test.mjs). Live, against the dev
text-reasoning key and the same request: three of three runs drafted, in
174 to 239 seconds, each with two calls (the second for findings). The package
maker builds it with no format, option or standing-asset finding.

## Who held each step

The harness (Claude Code) wrote the change; packaging, the deploy request and
the update go through the package maker, the platform account's deploy queue
and the deployment manager, on dev.
