# How each change is answered

Every difference `scripts/compare.mjs` finds, and the answer it gives a dependent the difference reaches. Offerings are matched by id, and inputs and outputs by name, the way a canvas saves a line (`<offering>.<in|out>.<name>`), so a renamed one is one removed and one added.

## Offerings

| Difference | Answer | Reaches |
|---|---|---|
| An offering removed (or its id changed) | breaking | a dependent that uses it, or whose use is not known |
| An offering added | compatible | every dependent |
| An offering's name or its words changed, its id the same | words only | nobody |
| `how.cost` lower (none, metered, unbounded) | compatible | its users |
| `how.cost` higher, or no longer stated | breaking | its users |
| `how.control`, `how.intelligence` or `how.contract` changed | change of behavior | its users |
| Its steps changed | change of behavior | its users |
| `how` stated as something other than an object, and changed | breaking, because it could not be told | its users |

## Inputs

| Difference | Answer | Reaches |
|---|---|---|
| A required input added | breaking | every user of the offering |
| An optional input added | compatible | every user of the offering |
| An input removed | breaking | a dependent that sends it, or whose sending is not known |
| Optional made required | breaking, for a dependent whose canvas does not send it as well; compatible for one whose canvas already sends it | every user of the offering |
| Required made optional | compatible | senders |
| Its kind now takes everything the old one took | compatible | senders |
| Its kind changed any other way | breaking | senders |
| `max_bytes` lower, or added | breaking | senders |
| `max_bytes` higher, or taken off | compatible | senders |
| `when` changed | breaking | senders |
| `one_of` changed | breaking, for a dependent whose canvas does not send it as well | every user of the offering |
| Only its `about`, `description`, `label`, `example`, `given_by`, `widget`, `parts` or `link` changed | words only | nobody |
| Anything else about it changed | breaking, because it could not be told | senders |

## Outputs

| Difference | Answer | Reaches |
|---|---|---|
| An output removed | breaking | a dependent that reads it, or whose reading is not known |
| An output added | compatible | its users |
| Its kind changed | answered for each reader, below | readers |
| `when` changed | breaking | readers |
| `max_bytes` higher, or taken off | breaking, because a reader that takes less refuses one and that could not be told | readers |
| `max_bytes` lower | compatible | readers |
| `working` changed | breaking: what a reader gets back changed | readers |
| Anything else about it changed | breaking, because it could not be told | readers |

An output whose kind changed, for each reader, by the platform's rule for whether a line fits (`scripts/kinds.mjs`, from ports.ts):

| The reader's input | Answer |
|---|---|
| takes the new kind and took the old one | change of behavior: the line still fits, but what arrives is labelled differently |
| takes the new kind and did not take the old one | compatible: the line now fits |
| took the old kind and does not take the new one | breaking: the line no longer fits |
| takes neither | breaking, because it could not be told |
| is not known, and the new kind is a narrower spelling of the old one (`application/<name>+json` for `application/json`) | change of behavior: any input that took the old kind takes the new one |
| is not known, and it is not | breaking, because it could not be told |

## The agent as a whole

| Difference | Answer | Reaches |
|---|---|---|
| A refusal added, taken out or reworded | breaking | every dependent that orders it |
| A system added or removed, its access changed, or whether what it sends leaves the platform | breaking | every dependent that orders it |
| What it records changed | breaking | every dependent that orders it |
| When it hands a decision to a person changed | change of behavior | every dependent |
| The declaration's format, or a member these rules do not name, changed | breaking, because it could not be told | every dependent that orders it |
| The words saying what it does changed | words only | nobody |
| Only the version changed, or the change was only given in words | change of behavior | every dependent |

## The runtime requirements, when both are given

| Difference | Answer | Reaches |
|---|---|---|
| The price lower, or now free, covering the same | compatible | every dependent that orders it |
| The price changed any other way | breaking | every dependent that orders it |
| `job_seconds` lower, or added | breaking | every dependent that orders it |
| `job_seconds` higher, or taken off | compatible | every dependent that orders it |
| A ceiling added, lowered, or changed in any way other than a higher `suggested` | breaking | every dependent that orders it |
| A ceiling's `suggested` raised, nothing else changed, or the ceiling taken off | compatible | every dependent that orders it |
| A setting changed, the model's above all | change of behavior | every dependent |
| What it is installed or started with changed (runtimes, binaries, dependencies, the run command) | change of behavior | every dependent |
| The systems it is bound to, or the directories it keeps things in, changed | breaking: how it handles data changed | every dependent that orders it |
| Any other member, or the format, changed | breaking, because it could not be told | every dependent that orders it |

An agent given as one that may take what this one hands back orders nothing, so it is reached only by the outputs it reads and by a change of behavior.
