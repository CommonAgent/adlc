// What the watcher declines when a message asks for it.
//
// Each of the agent's refusals is something its program never does; this file
// makes the watcher say so when a message asks for one, before any watch is
// opened, instead of running a watch as if the words were not there. A message
// that is only a watch request (the job's name, `agent:`, `from:` and `to:`
// lines, or words asking for a watch) is never declined here.
//
// A decline names the rule it rests on, in the words of the agent's own
// refusals, and starts nothing: no agent is asked and nothing is read.
//
//   needs: node >= 22
//   (no command line; watch.mjs calls declineFor)

const RULES = [
  { id: "unnamed-agent", why: "it watches only the agents its owner named in the install's WATCH_AGENTS setting; a message may narrow a watch and never adds an agent, and it never lists an account's agents on its own",
    test: /\b(owner did not name|not (on|in) (the|its|my|your) (watch )?list|(list|watch) (all|every) (of )?(the )?account'?s agents|every agent (in|on|of) the account|add (an? )?(agent|handle) to (the|its|your) (watch )?list)\b/i },
  { id: "silence-as-news", why: "an agent that does not answer within the wait is reported as not answering, never as fine",
    test: /\b(silence as (no|good) news|reading silence|treat (silence|no answer|no reply) as|silent agents? (as|are) (fine|ok|healthy|well))\b/i },
  { id: "presence-as-answer", why: "presence is reported as presence, and an agent is answering only when it answered the question sent to it",
    test: /\b(process being up an answer|(being|is) up (as|counts as|for) an answer|presence (as|for|counts as) an answer|count (it|them|presence) as answering)\b/i },
  { id: "figure-not-on-record", why: "every amount is the spend report's own and every count is a count of readings; it states no figure the platform's records do not carry",
    test: /\bstat(e|ing) a figure\b|\b(estimate|make up|invent|fill in|guess)\b[^.\n]{0,40}\b(figure|amount|spend|number|total|limit|cost)s?\b/i },
  { id: "spending", why: "it reads with a key that can only read, and never spends, buys credits or changes a budget",
    test: /\b(spend(ing)? (money|credits)|buy(ing)? credits|purchase credits|top up|(change|raise|lower|set|changing) (a|the|its|their|an?) budget|spending, buying)\b/i },
  { id: "changing-watched", why: "it sends each agent one status question a watch and nothing else; it never pauses, restarts, stops or fixes an agent, and never answers for one",
    test: /\b(chang(e|ing) anything it watches|(pause|restart|stop|fix|kill|redeploy|update|remove) (the |an? |any |every |each )?(agent|agents|watched agents?)|answer for (it|them|an agent))\b/i },
  { id: "guessing-cause", why: "an alert says what was seen and where; what happened is the incident recorder's record and what to do about it is a person's decision",
    test: /\b(guess(ing)? (a|the) cause|root cause|why (it|they|the agent) (failed|broke|went quiet))\b/i },
  { id: "alarm-elsewhere", why: "it raises an alarm only to the incident recorder the install names",
    test: /\b(rais(e|ing) an alarm to anyone|(send|raise|post) (the |an? )?(alarms?|alerts?) to (?!the incident recorder))\b/i },
  { id: "same-failure-twice", why: "an alert raised and still open is reported as still open, and only a new reason raises it again",
    test: /\b(rais(e|ing) the same failure twice|raise (it|the same (alert|alarm|failure)) again)\b/i },
  { id: "calling-a-model", why: "it calls no model; every line of its report comes from the platform's records and the agents' own answers",
    test: /\b(call(ing)? a model|use a model|ask (a|the) model|(use|call) (an? )?(llm|language model))\b/i },
];

/** The rule a message asks the watcher to break, or null. Only the words of
 *  the message are read; `agent:`, `from:` and `to:` lines are the watch
 *  request's own and are not judged. */
export function declineFor(text = "") {
  const words = String(text ?? "")
    .split(/\r?\n/)
    .filter((l) => !/^\s*(agent|from|to)\s*:/i.test(l))
    .join("\n");
  for (const r of RULES) if (r.test.test(words)) return { id: r.id, why: r.why };
  return null;
}

/** The reply to a declined request: it says it will not, why, and that
 *  nothing was started. */
export function declineReply(d) {
  return `I will not do that: ${d.why}. No watch was opened and no agent was asked.`;
}

export { RULES };
