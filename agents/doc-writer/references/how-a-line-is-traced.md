# How a line is traced

Every line of the documentation that says something ends with one of three
marks. The check (scripts/check-docs.mjs) reads them; a person can read them
the same way.

## `[S<n>: <place>]`: a place in a source

`S<n>` is a source listed under Sources at the end, with its file name, what
it is and its sha256. The place is where in it the line came from:

- a JSON path, such as `does`, `offerings[0].inputs[2]` or
  `sections.identity`;
- a JSON path and a line, such as `refusals/3`: the fourth non-blank line of
  that string, counted from 0;
- `.`: the whole source, for a verdict or a run record;
- `L1`, or `L1-L40`: lines of a text record, counted from 1;
- `json L1-L40`: lines of a JSON record laid out with two-space indentation.

The line passes when one template in scripts/templates.mjs, filled from that
place, gives exactly that line, list marker aside. An example's opening line
passes when the block under it is exactly the lines its mark names.

## `[S<n>: <place> absent]`: a silence

The source says nothing at that place: it is missing, or empty. The line is
always "The <source> says nothing about <what>.", and it passes only when the
place really is missing or empty.

## `[given]`: what the job had

A line about the job's own inventory: that no AgentDoc was given, that a job
has no record to show, that a file could not be read or was left out, or that
a record was not quoted because it looks like it holds a credential. It passes
only when the inventory bears it out.

## Example

```
- **audience** (text, optional). [S1: offerings[0].inputs[6]]
```

S1 is the agent descriptor. At `offerings[0].inputs[6]` it says
`{"name": "audience", "kind": "text", "required": false}`, and the `input`
template gives `**audience** (text, optional).` from it. Change any word of
the line and no template gives it, and the check refuses the documentation.
