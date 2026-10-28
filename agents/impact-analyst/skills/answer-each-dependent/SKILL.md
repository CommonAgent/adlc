---
name: answer-each-dependent
description: Once the differences are listed.
---

# Answer each dependent

Part of impact-analyst. Once the differences are listed.

## When to use this

Once the differences are listed.

## What a good result looks like

Every dependent in the list, in its order, then every solution given that the list did not name, then every agent given, each with where it was found, what it uses (the lines its canvas draws, the inputs it declares, or the offerings it was seen using), its answer and the reason. An output whose kind changed is answered for each reader by the platform's rule for whether a line fits. The worst answer a dependent gets is its answer. A solution whose canvas was not seen is named under Not read.

## When it comes back empty

A list with no dependents gives no answers, and the report says the change touches no dependent the platform knows of.

## How to do it

`answerAll` in scripts/answer.mjs, with `useFromCanvas`, `useFromPorts` and `answerKind`; kinds through scripts/kinds.mjs.

## Scripts

Run these from this skill's folder; each one says what it needs at the top.

- scripts/answer.mjs
- scripts/kinds.mjs

## References

- references/how-each-change-is-answered.md
