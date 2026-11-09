# Runtime verbs

How a lifecycle service hands a finished product to the runtime an
organization brings, and asks it to roll back, reconfigure or retire it.
Added with lifecycle API 0.4.4. The service does not run the product: the
runtime does, and the run plan says who holds each stage after Package.

## The command

A runtime is one command. The service runs it with two more words at the end:

```
<runtime command> <package> <run plan>
```

- `<package>` is the product's package, such as an Agent Package `.tar.gz`.
- `<run plan>` is a JSON file: for Deploy and each later stage, its role, its
  holder, the holder's settings for that stage, and the interface the holder
  meets (the stage's `hands_back` in stages.json).

What to do with them is in the environment:

| Variable | Value |
|---|---|
| `PRODUCT_FACTORY_VERB` | `install`, `rollback`, `reconfigure` or `retire` |
| `PRODUCT_FACTORY_PRODUCT` | the product's name |
| `PRODUCT_FACTORY_VERSION` | the version the two files are; for `rollback`, the version to go back to |
| `PRODUCT_FACTORY_FROM_VERSION` | the version running now (`rollback`, `reconfigure`, `retire`) |

The variables are named for Product Factory, the first service that sends
them; another service sends the same names.

| Verb | The two files | The runtime |
|---|---|---|
| `install` | the new version's package and run plan | installs it; it is the one running |
| `rollback` | the earlier version's own package and run plan | puts that version back; it is the one running |
| `reconfigure` | the running version's package, and a new run plan | keeps the same version and takes the new run plan |
| `retire` | the running version's package and run plan | removes the install and keeps a record; nothing runs |

## The answer

The runtime prints one JSON object, the last one on its output:

```json
{ "ok": true, "verb": "rollback", "said": "Rolled word-counter back to 0.1.0.", "handle": "folder:/srv/word-counter-0.1.0", "cannot_undo": ["The folder of 0.2.0 is left in place."] }
```

- `ok`: false, or a non-zero exit, is a refusal; `said` says why, in words.
- `verb`: the verb it did. A runtime that answers without it is taken to have
  installed what it was given.
- `said`: what it did, in words.
- `handle`: where the product can be reached, when there is one.
- `cannot_undo`: side effects it could not undo, each in words, shown with
  Rollback's result.

## A runtime that knows only install

The two last words are always a package and a run plan, so a runtime written
before the verbs keeps working and is safe to ask:

- for `rollback` it installs the earlier version's own package and run plan,
  which is the rollback; the service says the runtime did not name the verb,
  so the person checks which version answers;
- for `reconfigure` it installs the running version again with the new run
  plan, which is the change;
- for `retire` it installs the running version again, changing nothing. The
  service does not take that as retired: it says, in words, that the product
  still runs there and must be retired by hand.

## The reference runtime

Product Factory's `runtimes/folder.mjs` is the smallest runtime: it copies the
package and run plan into a folder per version, keeps which version runs and
every verb it took in `<folder>/<name>.runtime.json`, and on `retire` removes
each installed version's files and keeps that record.
