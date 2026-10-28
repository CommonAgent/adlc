// Reading the request decides what the person actually asked for, before
// anything else is spent on it.
//
// The description comes from a request file, found by a name containing
// "request" or by its shape (a JSON object with a description), or, with no
// file, from the plain message. The earlier plan rides along as `earlier_plan`
// (what the platform sends) or `plan` (what older callers send), with the
// change beside it. A first line of `run <run id> phase <phase>: stop that` is
// a stop notice: it is answered with one sentence and nothing else is read,
// so a file behind it is never opened. Nothing here touches a file system or
// a network; the message and the files are plain values, { name, text }.
//
//   needs: node >= 22
//   (no command line; plan.mjs calls readRequest)

export const DESCRIPTION_MAX = 2000;
export const CHANGE_MAX = 500;

const STOP = /^run\s+(\S+)\s+phase\s+(.+?):\s*stop that$/;

const refuse = (why) => ({ ok: false, reply: `I cannot read this request: ${why}.` });
const isObject = (x) => x !== null && typeof x === "object" && !Array.isArray(x);

/** The stop notice on the first line of the message, or null. */
function stopNotice(text) {
  const first = String(text ?? "").split(/\r?\n/, 1)[0].trim();
  const m = STOP.exec(first);
  return m ? { run: m[1], phase: m[2].trim() } : null;
}

/** The request file among the files: named for a request, else shaped like
 *  one. Returns { file, body } or { refusal }. A file named for a request
 *  that is not JSON is a refusal; any other file that is not JSON is simply
 *  not the request. */
function findRequest(files) {
  const named = files.filter((f) => /request/i.test(String(f?.name ?? "")));
  for (const f of named) {
    try {
      const body = JSON.parse(String(f.text ?? ""));
      if (isObject(body)) return { body };
      return { refusal: refuse("the request file is not a JSON object") };
    } catch {
      return { refusal: refuse("the request file is not JSON") };
    }
  }
  for (const f of files) {
    try {
      const body = JSON.parse(String(f?.text ?? ""));
      if (isObject(body) && "description" in body) return { body };
    } catch { /* not a request file */ }
  }
  return {};
}

/** The description in a message's words. A page names the job on the first
 *  line ("Make a plan") and gives each input as a `name: value` line, so the
 *  job's name is not part of the description, and a `what you want done:`
 *  line starts it; anything after that line is the description too. Any
 *  other message is read whole. */
export function wordsOf(text) {
  const lines = String(text ?? "").split(/\r?\n/);
  while (lines.length && !lines[0].trim()) lines.shift();
  if (lines.length && /^make a plan[.:]?$/i.test(lines[0].trim())) lines.shift();
  const at = lines.findIndex((l) => /^\s*what you want done\s*:/i.test(l));
  if (at < 0) return lines.join("\n");
  return [lines[at].replace(/^\s*what you want done\s*:\s*/i, ""), ...lines.slice(at + 1)].join("\n");
}

/** Read the description, and any earlier plan and change.
 *  { text, files: [{ name, text }] } in; { ok: true, description, earlier,
 *  change } or { ok: false, reply, stopped? } out. */
export function readRequest({ text = "", files = [] } = {}) {
  const stop = stopNotice(text);
  if (stop) {
    return { ok: false, stopped: true, reply: `Stopped as asked: run ${stop.run} at phase ${stop.phase}, and nothing was read or planned.` };
  }

  const { body, refusal } = findRequest(Array.isArray(files) ? files : []);
  if (refusal) return refusal;

  let description = wordsOf(text);
  let earlier = null;
  let change = "";
  if (body) {
    if ("description" in body) {
      if (typeof body.description !== "string") return refuse("the description is not text");
      description = body.description;
    }
    const plan = body.earlier_plan ?? body.plan;
    earlier = isObject(plan) ? plan : null;
    if (typeof body.change === "string") change = body.change.trim();
  }

  description = description.trim();
  if (!description) return refuse("the description is empty");
  if (description.length > DESCRIPTION_MAX) {
    return refuse(`the description is over ${DESCRIPTION_MAX} characters (it has ${description.length})`);
  }
  if (change.length > CHANGE_MAX) {
    return refuse(`the change is over ${CHANGE_MAX} characters (it has ${change.length})`);
  }
  return { ok: true, description, earlier, change };
}
