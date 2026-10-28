// Inputs are only the material a job is about; options are settings, and
// every setting says all a page needs to draw it as a choice (the audit
// checklist's options-are-settings and settings-declared-fully).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inputIs, optionProblems, settingMissing } from "../scripts/options.mjs";
import { checkDraft } from "../scripts/check-spec.mjs";
import { agentFilesOf } from "../scripts/files.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const fixture = (n) => JSON.parse(readFileSync(join(HERE, "fixtures", n), "utf8"));

test("Explainer maker's options declared as inputs are each found, and its palette is library material", () => {
  const found = optionProblems(fixture("explainer-maker.spec.json"));
  const of = (name) => found.filter((f) => f.includes(`input ${JSON.stringify(name)}`));
  for (const n of ["target length", "voice", "how it sounds", "pace"]) {
    assert.ok(of(n).some((f) => /^options-are-settings: .* only shapes how the job runs/.test(f)), n);
  }
  assert.ok(of("palette").some((f) => /brand or library material; declare it as a can_use standing asset/.test(f)));
  assert.equal(of("brief").length, 0, "the brief is the material the job is about");
  assert.equal(of("customer web address").length, 0);
});

test("the same agent with its options as settings, fully declared, and its palette in can_use, is clean", () => {
  const spec = fixture("explainer-maker-settings.spec.json");
  assert.deepEqual(optionProblems(spec), []);
  assert.deepEqual(checkDraft(spec).filter((f) => /^(options-are-settings|settings-declared-fully)/.test(f)), []);
});

test("a setting that does not say all it should is named with what it lacks", () => {
  assert.deepEqual(settingMissing({ name: "tone", kind: "preference", default: "warm", job_may_set: true }),
    ["label", "about", "allowed (its natural set of choices)"]);
  assert.deepEqual(settingMissing({ name: "tone", label: "Tone", about: "x", default: "warm", allowed: ["warm", "dry"], value_labels: { warm: "Warm" } }),
    ['value_labels for "dry"']);
  assert.deepEqual(settingMissing({ name: "pace", label: "Pace", about: "x", default: 2 }), ["min", "max", "step"]);
  assert.deepEqual(settingMissing({ name: "audience", label: "Audience", about: "x", default: "everyone" }), [],
    "a free value with no natural set of choices needs no allowed list");
  assert.ok(settingMissing({ name: "model", kind: "rule", label: "Model", about: "x", default: "m1" }).includes("allowed (its natural set of choices)"));
});

test("a file a person gives is material, even when its name sounds like an option", () => {
  assert.equal(inputIs("style notes", "text/markdown"), null);
  assert.equal(inputIs("tone", "text"), "option");
  assert.equal(inputIs("brand colours", "application/vnd.agentmesh.brand+json"), "library");
});

test("the agent's files carry a setting's label, about, value labels and range as the builder writes them", () => {
  const files = agentFilesOf(fixture("explainer-maker-settings.spec.json"));
  const desc = JSON.parse(files["agent-descriptor.json"]);
  const [length, , pace] = desc.run_config.settings;
  assert.deepEqual(Object.keys(length), ["name", "kind", "default", "allowed", "label", "about", "value_labels", "job_may_set"]);
  assert.equal(length.value_labels["90 seconds"], "A minute and a half");
  assert.deepEqual([pace.min, pace.max, pace.step], [1.5, 3.5, 0.5]);
});
