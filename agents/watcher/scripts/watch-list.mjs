// Which agents to watch, and over which days to read the spend.
//
// The owner names the agents to watch. The watcher never lists an account's
// agents on its own (agentroles.ai/watcher.html: listing them is the more
// sensitive read by a distance), so the list is a setting the install places,
// WATCH_AGENTS, one handle after another, separated by commas, spaces or new
// lines. A message may narrow a watch to some of the agents on that list with
// lines of their own, `agent: <handle>`; an agent a message names that is not
// on the list is not watched, and the reply says so, because a message must
// not be able to point the watcher at agents its owner did not name.
//
// The spend window is the days a message names as `from: YYYY-MM-DD` and
// `to: YYYY-MM-DD`; without them the platform's own default window is read.
//
//   needs: node >= 22
//   import { watchList, windowOf } from "./watch-list.mjs"

const trim = (s) => String(s ?? "").trim();

/** A handle as the mesh spells one: name, a dot, and an owner address. */
export const HANDLE = /^[a-z0-9][a-z0-9._-]*\.[^\s@.]+@[a-z0-9.-]+\.[a-z]{2,}$/i;

/** The handles a setting names, in order, each once. */
export function namesIn(setting = "") {
  const out = [];
  for (const raw of String(setting ?? "").split(/[\s,;]+/)) {
    const h = trim(raw).replace(/^[`'"<]+|[`'">.]+$/g, "");
    if (!h) continue;
    if (!out.some((x) => x.toLowerCase() === h.toLowerCase())) out.push(h);
  }
  return out;
}

const LINE = (name) => new RegExp(`^\\s*(?:[-*]\\s*)?${name}\\s*[:=]\\s*(.+?)\\s*$`, "gim");

/** The agents a message names, as `agent: <handle>` lines, each once. */
export function agentsInMessage(text = "") {
  const out = [];
  for (const m of String(text ?? "").matchAll(LINE("agent"))) {
    for (const h of namesIn(m[1])) if (!out.some((x) => x.toLowerCase() === h.toLowerCase())) out.push(h);
  }
  return out;
}

/**
 * The agents this watch covers.
 *   setting  WATCH_AGENTS as the install placed it
 *   text     the message
 * Returns { agents, refused, malformed, narrowed }: `agents` in the setting's
 * order; `refused` the names a message gave that are not on the list;
 * `malformed` the names on the list that are not handles.
 */
export function watchList({ setting = "", text = "" } = {}) {
  const listed = namesIn(setting);
  const malformed = listed.filter((h) => !HANDLE.test(h));
  const valid = listed.filter((h) => HANDLE.test(h));
  const asked = agentsInMessage(text);
  if (!asked.length) return { agents: valid, refused: [], malformed, narrowed: false };
  const on = (h) => valid.find((v) => v.toLowerCase() === h.toLowerCase());
  return {
    agents: valid.filter((v) => asked.some((a) => a.toLowerCase() === v.toLowerCase())),
    refused: asked.filter((a) => !on(a)),
    malformed,
    narrowed: true,
  };
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The spend window a message names, or nulls for the platform's default. */
export function windowOf(text = "") {
  const one = (name) => {
    const m = LINE(name).exec(String(text ?? ""));
    const v = m ? trim(m[1]).replace(/[`'".]+$/g, "") : "";
    return v || null;
  };
  const from = one("from");
  const to = one("to");
  const bad = [from, to].filter((d) => d !== null && !DAY.test(d));
  return { from: from && DAY.test(from) ? from : null, to: to && DAY.test(to) ? to : null, bad };
}
