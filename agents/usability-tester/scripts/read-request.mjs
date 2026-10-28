// What the test was asked for, and what came with it.
//
// The message names the agent, on a line of its own or anywhere in it:
//   agent: <handle>                 required (a bare handle is read as it)
//   offering: <id>                  optional: test that offering only
//   change: <words>                 optional: the change to ask for; without
//                                   it, the one in the run config's
//                                   `change_request` setting
// and, where a person who ran the agent adds their judgment:
//   understood: yes | no            they understood what it does
//   could use: yes | no             they could use the result
//   did the job: yes | no           it did the job they had
//   note: <words>                   anything else they want said
//
// Attached files are known by what they hold:
//   - examples: a JSON object from an offering's id to an example,
//     `{inputs, good_result}`, used for an offering whose Descriptor declares
//     none (the report says where each example came from);
//   - a package (.tar.gz): the files an example names in the package;
//   - any other file, found by its digest when an example names it.
//
//   needs: node >= 22
//   import { fromText, readFiles } from "./read-request.mjs"
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename } from "node:path";
import { readPackage } from "./tar.mjs";

const trim = (s) => String(s ?? "").trim();
const HANDLE = /\b([a-z0-9][a-z0-9-]*\.[a-z0-9-]+@[a-z0-9.-]+\.[a-z]{2,})\b/i;

const line = (t, k) => {
  const m = new RegExp(`^\\s*(?:[-*]\\s*)?${k}\\s*:\\s*(.+?)\\s*$`, "im").exec(t);
  return m ? m[1].trim() : "";
};
const yesNo = (v) => (/^(yes|y|true)$/i.test(trim(v)) ? true : /^(no|n|false)$/i.test(trim(v)) ? false : null);

/** The message's asks. */
export function fromText(text = "") {
  const t = String(text);
  let handle = line(t, "agent") || line(t, "handle");
  const m = HANDLE.exec(handle) ?? HANDLE.exec(t);
  handle = m ? m[1] : "";
  const judgment = {
    understood: yesNo(line(t, "understood")),
    could_use: yesNo(line(t, "could use") || line(t, "could_use")),
    did_the_job: yesNo(line(t, "did the job") || line(t, "did_the_job")),
    note: line(t, "note"),
  };
  const judged = judgment.understood !== null || judgment.could_use !== null || judgment.did_the_job !== null || Boolean(judgment.note);
  return {
    handle: handle.toLowerCase(),
    offering: line(t, "offering").replace(/[.,;]+$/, "").toLowerCase(),
    change: line(t, "change"),
    judgment: judged ? judgment : null,
  };
}

/** The labelled lines a message holds: which parts of a request it says again. */
export function labelled(text = "") {
  return ["agent", "offering", "change", "understood", "could use", "did the job", "note"].filter((k) => line(String(text), k) !== "");
}

const isGzip = (b) => b.length > 2 && b[0] === 0x1f && b[1] === 0x8b;

/** Sort the attached files by what they hold. */
export function readFiles(files = []) {
  const got = { examples: {}, attached: [], unread: [] };
  for (const f of files) {
    const path = trim(f.path);
    let name = basename(path);
    // A file forwarded through a run carries one staged prefix per hop.
    while (/^\d+-[A-Za-z0-9_-]{8}-/.test(name)) name = name.replace(/^\d+-[A-Za-z0-9_-]{8}-/, "");
    if (!path || !existsSync(path) || !statSync(path).isFile()) { got.unread.push({ name, why: "the file was not there to read" }); continue; }
    const bytes = readFileSync(path);
    if (isGzip(bytes)) {
      try {
        const pkg = readPackage(bytes);
        for (const [p, b] of pkg.files) got.attached.push({ name: p, bytes: b, from: name });
      } catch (e) { got.unread.push({ name, why: e.message }); }
      continue;
    }
    let doc = null;
    try { doc = JSON.parse(bytes.toString("utf8")); } catch { doc = null; }
    const ex = doc && typeof doc === "object" && !Array.isArray(doc) ? (doc.examples && typeof doc.examples === "object" ? doc.examples : doc) : null;
    if (ex && Object.values(ex).length && Object.values(ex).every((v) => v && typeof v === "object" && v.inputs && typeof v.inputs === "object")) {
      Object.assign(got.examples, ex);
      continue;
    }
    got.attached.push({ name, bytes, from: name });
  }
  return got;
}
