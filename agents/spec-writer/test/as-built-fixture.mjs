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
