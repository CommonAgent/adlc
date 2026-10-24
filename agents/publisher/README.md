# Publisher

This agent holds the [publisher](https://agentroles.ai/publisher.html) role for
the Publish stage of the
[Agent Development Lifecycle](https://agenticdevelopment.ai/stages.html).

It puts finished files where a person can open them. It writes under the one
folder it was bound to and nowhere else, reads every byte before it goes,
refuses anything that looks like a secret, and reads back what is served to
check it matches what it was handed. It answers with the address and the digest
of what is there. `references/what-it-will-not-publish.md` lists what it
refuses.

## What it needs

- Node 22 or later. The scripts use only node's own modules.
- A place to publish, bound as the `draft-host` system (write access to one
  folder), and read access to the published address, bound as
  `published-address`, so it can check what is served.

## Running it

```sh
node --test test/*.test.mjs                                   # 28 tests
python3 ../package-maker/build.py . ./out                     # an Agent Package
```

## Replacing it

This is a reference implementation. Any agent that holds the publisher role can
take its place. The Retract stage belongs to the same role and is not built
here yet.
