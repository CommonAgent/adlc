// The small as-built record the spec tests share (test/fixtures/as-built), and
// a model's fill for it. Not a test file: the tests import it.
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const AT = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "as-built");

/** Every file of the record, the schemas last. */
export const RECORD_FILES = [...readdirSync(AT).filter((f) => f.endsWith(".json")).map((f) => join(AT, f)), ...readdirSync(join(AT, "schemas")).map((f) => join(AT, "schemas", f))];

/** The gathering record of a request with the record attached, as asked.mjs
 *  writes it. */
export const askedWith = (said, extra = []) => ({
  said,
  attached: [...RECORD_FILES.map((p) => ({ name: p.split(/[\/]/).pop(), path: p, kind: "data", media_type: "application/json", text: readFileSync(p, "utf8") })), ...extra],
});

/** A fill that writes a scenario for every feature, from its requirements. */
export function fillFor(seed, { skip = [] } = {}) {
  const features = {};
  for (const f of seed.features) {
    if (skip.includes(f.id)) continue;
    features[f.id] = {
      shall: Object.fromEntries(f.requirements.map((r) => [r.id, r.shall.replace("The agent shall", "The agent shall always")])),
      acceptance: [{ gherkin: `Scenario: ${f.name}\n  Given the agent is asked\n  When it does ${f.name}\n  Then it does what ${f.id} requires`, checks: f.requirements.map((r) => r.id) }],
    };
  }
  return { purpose: "Reads the next tides for a harbor, for a sailor planning a day.", users: [{ who: "a sailor", wants: "the next tides" }], features, notes: "wrote the scenarios" };
}

// The same tide reader as the reverse engineer 0.3.0 writes it up
// (test/fixtures/as-built-v3): its interfaces add constants with their values,
// declarations (each name and value the agent declares to the platform, with
// where), the flags a command requires and the allowed values of a file's
// fields; and strings.json lists every string a person reads and every
// pattern, by file and line. The behaviors and tests are the 0.2.0
// fixture's; its architecture names the run-config setting how_many.
const V3 = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "as-built-v3");
export const RECORD_V3_FILES = [
  ...["behaviors.json", "tests-and-gaps.json"].map((f) => join(AT, f)),
  join(V3, "architecture.json"), join(V3, "interfaces.json"), join(V3, "strings.json"),
  ...readdirSync(join(V3, "schemas")).map((f) => join(V3, "schemas", f)),
];
export const askedWithV3 = (said, extra = []) => ({
  said,
  attached: [...RECORD_V3_FILES.map((p) => ({ name: p.split(/[\/]/).pop(), path: p, kind: "data", media_type: "application/json", text: readFileSync(p, "utf8") })), ...extra],
});

/** The keys a prose prompt asks for, as prosePrompt lists them. */
export const keysAsked = (prompt) => {
  const at = prompt.indexOf("--- WHAT YOU WRITE ---\n");
  if (at < 0) return [];
  const block = prompt.slice(at + 23).split("\n\n")[0];
  return block.split("\n").map((l) => /^- (\S.*?)(?: \(name the host [^)]*\))?$/.exec(l)?.[1]).filter(Boolean);
};

/** A stand-in model's prose for every key a prompt asks for: each sentence
 *  long enough for the check, refusals as acts, abouts that sketch their
 *  piece, and needs that name the host the prompt gives. `tag` marks the
 *  words so a test can tell one answer from another. */
export function proseFor(prompt, { tag = "" } = {}) {
  const out = { jobs: {}, systems: {}, notes: "wrote the prose" };
  const hosts = Object.fromEntries([...prompt.matchAll(/^- system:(.+)\.needs \(name the host ([^)]+)\)$/gm)].map((m) => [m[1], m[2]]));
  for (const key of keysAsked(prompt)) {
    if (key === "description") { out.description = `Reads the next tides for a harbor and hands them back${tag}.`; continue; }
    if (key === "refuses") {
      out.refuses = [
        "Reading a harbor that is not four capital letters, because the tide service answers nothing useful for it.",
        "Writing tides the service did not give, because an invented tide could put a boat on the rocks.",
        "Keeping any harbor a person asked about after the job, because nobody asked for a history.",
        "Calling any service other than the tide service, because nothing else was granted to it.",
      ];
      continue;
    }
    const s = /^system:(.+)\.needs$/.exec(key);
    if (s) { out.systems[s[1]] = `reads the tide table${hosts[s[1]] ? ` at ${hosts[s[1]]}` : ""}${tag}`; continue; }
    const m = /^job:([^.]+)\.(?:(inputs|outputs):(.+)\.about|([a-z]+))$/.exec(key);
    if (!m) continue;
    const j = (out.jobs[m[1]] ??= {});
    if (m[2]) {
      (j[m[2]] ??= {})[m[3]] = m[2] === "inputs" ? `Which harbor? Its four-letter code, such as BRST${tag}.`
        : /report/.test(m[3]) ? `Markdown: a header \`harbor, read_at\`, then \`## Tides\` with one line per tide${tag}.` : `What the job hands back, in the shape the spec's schema gives it${tag}.`;
      continue;
    }
    j[m[4]] = {
      does: `Reads the tide table for a harbor and writes the next tides${tag}.`,
      when: `when somebody wants the next tides for a harbor${tag}`,
      good: `A tides file that holds the harbor and the next tides in order, each with its time and height, and nothing invented${tag}.`,
      empty: `When the tide service does not answer, nothing is written and the reply says so plainly${tag}.`,
      instructions: `Run the script the command names; the exact words, patterns and numbers are in the spec (spec.json)${tag}.`,
    }[m[4]];
  }
  return out;
}
