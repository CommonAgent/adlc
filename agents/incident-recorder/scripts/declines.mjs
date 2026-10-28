// What the incident recorder declines when a message asks for it.
//
// Each of the agent's refusals is something its program never does; this file
// makes the recorder say so when a message asks for one, before any record is
// read, instead of answering as if the words were not there. A message that
// only asks for an incident to be recorded (the job's name, and the
// `agent handle:`, `failure time:` and other `name: value` lines a page
// sends) is never declined here.
//
// A decline names the rule it rests on, in the words of the agent's own
// refusals, and starts nothing: no record is read and nothing is written.
//
//   needs: node >= 22
//   (no command line; record-incident.mjs calls declineFor)

const RULES = [
  { id: "guessing-a-cause", why: "it records only verifiable facts and explicit gaps, so no guess at a root cause or an agent's intent enters the record",
    test: /\b(guess(ing)? (a|the) cause|root cause|why (it|the agent|they) (failed|broke|went quiet)|what caused)\b/i },
  { id: "proposing-a-fix", why: "it records what happened, never how to solve it",
    test: /\b(propos(e|ing) a (fix|remediation)|(suggest|recommend|propose) (a |the )?(fix|remediation|solution)|how (to|do i|should we) fix)\b/i },
  { id: "contacting-the-agent", why: "it never sends a ping, a signal or a message to the agent being recorded; it reads only the records it was handed",
    test: /\b(contact(ing)? the agent|(ping|message|restart|wake|signal) (the|that|this) agent|ask the agent)\b/i },
  { id: "reaching-outside", why: "it reaches no remote service or network endpoint; it reads only the records it was given",
    test: /\b(reaching systems or services outside|(fetch|download|pull|query|call) (the |its |more )?(logs?|records?|api|endpoint|service|metrics)( from)?|look (it )?up online)\b/i },
  { id: "interpolating", why: "where records are missing, the timeline says the gap is unknown rather than assuming normal operation",
    test: /\b(interpolat(e|ing)|fill (in )?(the )?gaps?|assume (it|the agent) (was )?(fine|working|normal)|across (the )?gaps)\b/i },
  { id: "unverified-fact", why: "every event in the timeline traces to a verified record entry with its source digest",
    test: /\b(accept(ing)? an unverified fact|(add|include|record) (this|my|an?) (fact|event|note) (that is )?(not|un)verified|take my word|add (it|this) without (a )?(record|source))\b/i },
];

/** The rule a message asks the recorder to break, or null. `name: value`
 *  lines a page sends (agent handle, failure time, records) are the request's
 *  own and are not judged. */
export function declineFor(text = "") {
  const words = String(text ?? "")
    .split(/\r?\n/)
    .filter((l) => !/^\s*[a-z][a-z' -]{0,40}:\s/i.test(l))
    .join("\n");
  for (const r of RULES) if (r.test.test(words)) return { id: r.id, why: r.why };
  return null;
}

/** The reply to a declined request: it says it will not, why, and that
 *  nothing was recorded. */
export function declineReply(d) {
  return `I will not do that: ${d.why}. No record was read and no incident was recorded.`;
}

export { RULES };
