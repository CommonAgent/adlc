// Standing assets and library declarations: scripts/can-use.mjs.
//
// What is worth pinning: standing assets declared in can_use must reference known
// schemas; a standing asset missing a without explanation is flagged; standing assets
// not decided by an architecture record are removed; house rules provide default reads,
// does, and without fields for standard assets like brand and style guide; and a record
// specifying none clears can_use.
//
// Nothing here touches a network.
// Run: node --test test/can-use.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canUseProblems,
  cleanCanUse,
  houseRuleFor,
  knownSchemas,
  withoutFor,
} from "../scripts/can-use.mjs";

const BRAND = "https://schemas.agentmesh.ai/brand/v1";
const STYLE = "https://schemas.agentmesh.ai/style-guide/v1";

test("knownSchemas lists the standard standing asset schemas", () => {
  const schemas = knownSchemas();
  assert.ok(Array.isArray(schemas));
  assert.ok(schemas.includes(BRAND));
  assert.ok(schemas.includes(STYLE));
});

test("a standing asset must use a known standing asset schema", () => {
  const unknown = [{ schema: "https://unknown.example/v1", reads: ["item"], required: false, does: "uses item", without: "skips" }];
  const problems = canUseProblems(unknown);
  assert.ok(problems.some((p) => /not a known kind of standing asset/.test(p)));

  const known = [{ schema: BRAND, reads: ["name"], required: false, does: "uses brand", without: "uses plain name" }];
  assert.deepEqual(canUseProblems(known), []);
});

test("a standing asset requires a without clause explaining the fallback", () => {
  const missing = [{ schema: BRAND, reads: ["name"], required: false, does: "uses brand", without: "" }];
  const problems = canUseProblems(missing);
  assert.ok(problems.some((p) => /without says what the agent does when none is given/.test(p)));
});

test("house rules supply default values for brand and style guide standing assets", () => {
  const brandRule = houseRuleFor(BRAND);
  assert.equal(brandRule.schema, BRAND);
  assert.ok(Array.isArray(brandRule.reads));
  assert.equal(brandRule.required, false);
  assert.ok(brandRule.does.length > 0);
  assert.ok(brandRule.without.length > 0);
});

test("withoutFor provides a non-empty fallback sentence for known standing assets", () => {
  assert.ok(withoutFor(BRAND).length > 10);
  assert.ok(withoutFor(STYLE).length > 10);
});

test("cleanCanUse trims standing assets not decided by the architecture record and fills empty without", () => {
  const architecture = { standing_assets: [BRAND] };
  const input = [
    { schema: BRAND, reads: ["name"], does: "applies brand", without: "" },
    { schema: STYLE, reads: ["voice"], does: "applies voice", without: "neutral" },
  ];
  const cleaned = cleanCanUse(input, architecture);
  assert.equal(cleaned.length, 1);
  assert.equal(cleaned[0].schema, BRAND);
  assert.ok(cleaned[0].without.length > 0, "empty without must be filled");
});

test("cleanCanUse returns undefined when architecture record specifies none", () => {
  const architecture = { standing_assets: [] };
  const input = [{ schema: BRAND, reads: ["name"], does: "applies brand", without: "skips" }];
  const cleaned = cleanCanUse(input, architecture);
  assert.equal(cleaned, undefined);
});
