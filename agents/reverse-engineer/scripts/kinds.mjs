// What counts as one behavior, and the fixed lists of kinds a behavior and a
// rule on a behavior may have. The prompt shows these words to the model, the
// record check holds every behavior to them, and references/the-as-built-record.md
// and rules.md say the same, so two runs on the same code give the same kinds
// and close to the same count.
//
//   needs: node >= 22
//   import { BEHAVIOR_KINDS, RULE_KINDS, GRANULARITY } from "./kinds.mjs"

/** The behavior kinds, in order of precedence: when more than one fits, the
 *  first in this list is the kind. */
export const BEHAVIOR_KINDS = [
  { kind: "entry", means: "starts a job: a command's main, a route or message handler, an offering's run; it reads the request and calls the rest" },
  { kind: "fetch", means: "calls a system outside the codebase (a network address, a database, another agent, a model) and gives back what it answered" },
  { kind: "write", means: "writes a file, a record or a message that outlives the call" },
  { kind: "state", means: "reads what an earlier job or run left behind (a prior job folder, a cache, a revision)" },
  { kind: "check", means: "decides whether to go on: recognizes a notice, validates input or settings, or refuses" },
  { kind: "parse", means: "reads structured values out of text or data it is handed, with no outside call" },
  { kind: "compute", means: "works out a value from values it is handed (a count, a price, a choice)" },
  { kind: "compose", means: "makes the words or the document it gives back (a reply sentence, a report, a greeting)" },
];
export const KIND_NAMES = BEHAVIOR_KINDS.map((k) => k.kind);

/** The kinds of rule a behavior states, each with its evidence. */
export const RULE_KINDS = [
  { kind: "order", means: "what is tried first and what next: a fallback order, a precedence, the order items are read or written in" },
  { kind: "limit", means: "a cap, a timeout, a size, a count or a number of retries" },
  { kind: "header", means: "a request header or another fixed field the code sends" },
  { kind: "default", means: "the value used when nothing says otherwise" },
];
export const RULE_NAMES = RULE_KINDS.map((k) => k.kind);

/** What counts as one behavior. */
export const GRANULARITY = [
  "One behavior per anchor. The anchors are: each exported function or class that another file of the codebase imports (a test counts), each export of the package's main module, and each file that starts as a command (its main block).",
  "A function used only inside its own file is part of the behavior of the anchor that calls it, never a behavior of its own.",
  "The branches, defaults, fallbacks, limits, quoted patterns and refusals of one anchor are fields of its one behavior (inputs, outputs, refusals, error_handling, quotes, rules), never behaviors of their own.",
  "Where the code has no anchors read by rule (another language, or one script), one behavior per public function, command, route or message handler, by the same rule.",
  "Code no anchor reaches is a gap of kind unreachable, never a behavior.",
];

/** The kinds as lines of words, for the prompt and the docs. */
export const kindLines = (list) => list.map((k) => `- ${k.kind}: ${k.means}`).join("\n");
