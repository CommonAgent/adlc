// What the reverse engineer declines when a message asks for it.
//
// Its refusals are things its program never does: it does not judge whether
// the code is right, it writes no tests, and it changes no code. When a
// message asks for one of those, the reply says no, names the rule, and says
// who does that work instead. The record is still written when the job was
// given what it needs, because describing the code is the job and the
// request for more does not cancel it.
//
// The `name: value` lines a request sends (repository:, commit:, may run:)
// are the request's own and are never judged.
//
//   needs: node >= 22
//   (no command line; describe.mjs calls declinesFor)

export const RULES = [
  {
    id: "judging",
    why: "I describe what the code does and never say whether it is right, wrong, wanted or a bug. The person decides at Requirements, where each behavior in the record is approved, flagged as a bug for the backlog, or dropped",
    test: /\b(is (this|that|it) (a )?bug|(is|are) (this|that|it|these|those|they) (right|wrong|correct|intended|ok|okay|fine|wanted)|which (behaviou?rs|ones) (to|should (we|i)) (keep|drop)|should (we|i) (keep|drop)|(judge|grade|rate|assess|evaluate) (the |this |its )?(code|quality|codebase)|review (the |this )?code|what('s| is) wrong|find (the )?bugs)\b/i,
  },
  {
    id: "writing-tests",
    why: "I write no tests. Test writes the characterization tests from this record, so the tests that pin the code are not written by the one who described it",
    test: /\b((write|add|create|generate|make) (me )?(some |the |a |new |more |unit |characteri[sz]ation |missing )*tests?|tests? for (the )?(uncovered|untested|missing))\b/i,
  },
  {
    id: "changing-code",
    why: "I change nothing in the codebase; I only read it, and run its own tests when allowed",
    test: /\b((fix|refactor|rewrite|patch|edit|change|modify|clean up) (the |this |that )?(code|codebase|bug|bugs|file|files|function)|open a (pull request|pr))\b/i,
  },
];

/** Every rule the message asks the reverse engineer to break, in order. */
export function declinesFor(text = "") {
  const words = String(text ?? "")
    .split(/\r?\n/)
    .filter((l) => !/^\s*[a-z][a-z' -]{0,40}:\s/i.test(l))
    .join("\n");
  return RULES.filter((r) => r.test.test(words)).map((r) => ({ id: r.id, why: r.why }));
}

/** The words a reply opens with for the rules declined, or "". */
export function declineText(declined = []) {
  return declined.map((d) => `I will not do that part: ${d.why}.`).join(" ");
}
