// The three input cases every role check runs (Common Agent 4.7.1,
// docs/input-handling-plan.md): a plain sentence asking for an offering's
// work, a structured request with one required input missing, and nonsense.
// Each must be answered with the standard INPUT_NOT_UNDERSTOOD reply (or, for
// the sentence, "I read this as ...") within the window.
//
// Made from the agent's own descriptor, so nobody writes cases by hand and a
// declaration that changes changes its cases. Pure: no network here.

export const INPUT_CASE_WINDOW_MS = 12_000;
export const NONSENSE = "zxqv blorp 7 ~~ qq vrrm";

const TEXT_KINDS = new Set(["text", "document", "identifier"]);

/** The offerings the cases apply to: those with an input beyond free text
 *  that the offering needs (required, or a one_of group). An offering whose
 *  inputs are all optional needs nothing and answers every message itself. */
export function checkableOfferings(descriptor) {
  const offerings = Array.isArray(descriptor?.offerings) ? descriptor.offerings : [];
  return offerings.filter((o) => {
    // Only a fixed program is owed the standard reply (Common Agent 4.7.1): an
    // offering a model controls reads words itself.
    if (o?.how?.control !== "script") return false;
    const inputs = Array.isArray(o?.inputs) ? o.inputs.filter((i) => i && !i.external && i.via === undefined) : [];
    // Words alone satisfy a text input, so a required text input, or a group
    // with a text member, never makes a message not fit.
    const required = inputs.filter((i) => i.required === true);
    if (required.some((i) => !TEXT_KINDS.has(String(i.kind)))) return true;
    const groups = new Map();
    for (const i of inputs) if (typeof i.one_of === "string") groups.set(i.one_of, [...(groups.get(i.one_of) ?? []), i]);
    return [...groups.values()].some((g) => g.every((i) => !TEXT_KINDS.has(String(i.kind))));
  });
}

/** Whether every offering is a fixed program. Where one is not, a message
 *  that names no offering is the model's to read, so only the case that names
 *  the offering (the plain sentence) applies. */
export function allScripted(descriptor) {
  const offerings = Array.isArray(descriptor?.offerings) ? descriptor.offerings : [];
  return offerings.length > 0 && offerings.every((o) => o?.how?.control === "script");
}

function placeholder(kind) {
  if (kind === "url") return "https://example.com/page";
  if (kind === "application/json" || String(kind).endsWith("+json")) return { example: true };
  if (kind === "number") return 1;
  return "example";
}

/** The three cases for one offering. */
export function inputCases(offering, { mixed = false } = {}) {
  const inputs = (offering.inputs ?? []).filter((i) => i && !i.external && i.via === undefined);
  const needed = inputs.filter((i) => i.required === true || typeof i.one_of === "string");
  const title = offering.name || offering.id;
  // The near miss: every needed input named in a structured request but the
  // first one that is more than free text, which is left out. Where that is
  // the only needed input, the request carries a misspelling of it instead.
  const drop = needed.find((i) => !TEXT_KINDS.has(String(i.kind))) ?? needed[0];
  const nearFields = {};
  for (const i of needed) {
    if (i === drop) continue;
    if (i.one_of && drop?.one_of === i.one_of) continue; // leaving a group's only member out means leaving the group out
    nearFields[i.name] = placeholder(i.kind);
  }
  // A misspelt name keeps a value that is not an address, or the words would
  // hold one and a url input would be present anyway.
  if (!Object.keys(nearFields).length && drop) nearFields[`${drop.name}_x`] = drop.kind === "url" ? "example" : placeholder(drop.kind);
  const cases = [
    { id: "plain-sentence", offering: offering.id, text: `Please ${title.charAt(0).toLowerCase()}${title.slice(1)} for me.`, accept: ["INPUT_NOT_UNDERSTOOD", "READ_AS"] },
    { id: "near-miss", offering: offering.id, text: JSON.stringify(nearFields), missing: drop?.name ?? null, accept: ["INPUT_NOT_UNDERSTOOD"] },
    { id: "nonsense", offering: offering.id, text: NONSENSE, accept: ["INPUT_NOT_UNDERSTOOD"] },
  ];
  return mixed ? cases.slice(0, 1) : cases;
}

/** What an answer was: the standard reply, a converted request's note, or neither. */
export function classifyAnswer(msg) {
  const code = msg?.error?.code ?? msg?.payload?.error?.code ?? null;
  if (code === "INPUT_NOT_UNDERSTOOD") return "INPUT_NOT_UNDERSTOOD";
  const text = String(msg?.text ?? "");
  if (/could not use this message/.test(text)) return "INPUT_NOT_UNDERSTOOD";
  if (/^I read this as: /.test(text.replace(/^\[[^\]]*\]\s*/, "").trim())) return "READ_AS";
  return "OTHER";
}

/** A case's verdict from what came back and when. */
export function judgeCase(c, answer, ms, windowMs = INPUT_CASE_WINDOW_MS) {
  if (!answer) return { id: c.id, offering: c.offering, pass: false, why: `no answer within ${Math.round(windowMs / 1000)} s` };
  const kind = classifyAnswer(answer);
  if (!c.accept.includes(kind)) return { id: c.id, offering: c.offering, pass: false, ms, why: `answered, but not with the standard reply (${kind})` };
  if (ms > windowMs) return { id: c.id, offering: c.offering, pass: false, ms, why: `answered in ${Math.round(ms / 1000)} s, over the window` };
  const missing = answer?.error?.details?.missing;
  if (c.id === "near-miss" && kind === "INPUT_NOT_UNDERSTOOD" && c.missing && Array.isArray(missing)
      && !missing.some((m) => String(m) === c.missing || String(m).includes(c.missing))) {
    return { id: c.id, offering: c.offering, pass: false, ms, why: `the reply did not name ${c.missing} as missing` };
  }
  return { id: c.id, offering: c.offering, pass: true, ms, kind };
}
