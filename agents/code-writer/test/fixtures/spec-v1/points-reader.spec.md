# points-reader 1.0.0: the spec

Reads a pasted list of titles, each followed by a line giving its points.

## F1 Read the points

- F1.R1 (pattern, test): The agent shall recognize a points line only by the pattern `^(\d+) points?$`.
- F1.R2 (limit, test): The agent shall read at most 30 items from one list.
- F1.R3 (wording, test): The agent shall end its reply with the words "Read by points-reader."

Acceptance:

- F1.A1: Scenario: two titles with their points
- F1.A2: Scenario: a list longer than the limit

## F2 Refuse a list with no points

- F2.R1 (refusal, test): The agent shall refuse a list with no points line with the words "No points lines were found."
- F2.A1: Scenario: a list with no points

## Interfaces kept exactly

- I1 function readPoints in scripts/read.mjs: async readPoints(text, { limit })
- I2 file out/points.json, in its JSON Schema
- I3 command node scripts/read.mjs --job --records
