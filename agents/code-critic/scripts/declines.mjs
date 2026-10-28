// What the code critic declines when a message asks for it.
//
// Each of the agent's refusals is something its program never does; this file
// makes the critic say so when a message asks for one, before anything is
// read or reviewed, instead of answering as if the words were not there. A
// message that only asks for a review (the job's name, `where to look:` and
// the other `name: value` lines a page sends, or words asking for a review)
// is never declined here.
//
// A decline names the rule it rests on, in the words of the agent's own
// refusals, and starts nothing: no file is read and no model is asked.
//
//   needs: node >= 22
//   (no command line; job.mjs calls declineFor)

const RULES = [
  { id: "changing-the-code", why: "it reports findings and nothing else: it writes no patch, edits no file of the package and suggests no replacement code, and the change is for whoever owns the code",
    test: /\b(changing the code under review|(fix|patch|rewrite|edit|change) (the|this|that|my) (code|change|script|scripts|package|file|bug)s?\b|write (a|the) (patch|fix)|suggest (a |the )?(replacement|fix))/i },
  { id: "opening-a-pull-request", why: "what becomes of a finding is a person's act, taken where they keep their code; it opens no pull request and commits or pushes nothing",
    test: /\b(open(ing)? a pull request|open a pr|commit(ting)? (it|this|the|anything)|push(ing)? (it|this|the|anything)|merge (it|this|the))\b/i },
  { id: "grading", why: "there is no score, no approval and no verdict on the work as a whole",
    test: /\b(grad(e|ing) the change|score (it|this|the change)|give (it|this) a (grade|score|rating)|approve (it|this|the change)|lgtm|sign off on)\b/i },
  { id: "finding-without-a-place", why: "every finding names a file and a line in it, a claim and a consequence, and one that does not is dropped",
    test: /\b(deliver(ing)? a finding without a place|findings? without (a )?(place|file|line))\b/i },
  { id: "deciding-access", why: "whether a package may reach a system, and at what access, is the security reviewer's call",
    test: /\b(deciding what the agent may be given|(grant|allow|approve) (the )?access|decide (the |its )?access)\b/i },
  { id: "deciding-a-finding", why: "accepting or rejecting a finding is the person's, and it does not argue with an answer",
    test: /\b(deciding a finding|(accept|reject|close|dismiss) (the |this |that |a )?findings?)\b/i },
  { id: "running-the-package", why: "nothing given is executed, installed or imported; every check reads the files as text",
    test: /\b(running the package under review|(run|execute|install|import) (the|this|my) (package|scripts?|code|tests?))\b/i },
  { id: "naming-a-model", why: "the model is the one the install configured, and this package names none of its own",
    test: /\b(naming a model|(use|pick|choose|switch to) (a |the |another )?model)\b/i },
  { id: "credential", why: "a credential is named, never carried; one written into a message is left out of every record and every line of the reply",
    test: /\b(accepting a credential|(here is|use) (my|the|this) (api )?(key|token|password|credential))\b/i },
  { id: "asking-a-third-time", why: "the model is asked once, and again only when its answer could not be read",
    test: /\b(asking a third time|ask (the model )?(again|a third time) until)\b/i },
];

/** The rule a message asks the critic to break, or null. `name: value` lines
 *  a page sends (where to look, the earlier findings) are the request's own
 *  and are not judged. */
export function declineFor(text = "") {
  const words = String(text ?? "")
    .split(/\r?\n/)
    .filter((l) => !/^\s*[a-z][a-z' -]{0,40}:\s/i.test(l))
    .join("\n");
  for (const r of RULES) if (r.test.test(words)) return { id: r.id, why: r.why };
  return null;
}

/** The reply to a declined request: it says it will not, why, and that
 *  nothing was reviewed. */
export function declineReply(d) {
  return `I will not do that: ${d.why}. Nothing was read or reviewed.`;
}

export { RULES };
