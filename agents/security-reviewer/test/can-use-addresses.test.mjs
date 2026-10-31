// A handed address that a standing asset carries (Common Agent 0.40.2, 12.6
// rule 2): where a can_use entry's reads names a member that holds an address,
// such as a brand profile's logo.mark.href, a program that reads that member
// and calls the address it holds has made a declared reach.
//
// What is worth pinning: the member read by its path as a string or by a
// property chain passes; a can_use entry whose reads names no address member
// excuses nothing; a program that never names the declared member is not
// excused by another program's can_use entry; and a program that also writes
// down an address nothing covers is still refused.
// Nothing here touches a real network or model.
// Run: node --test test/can-use-addresses.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { filesOf, frontMatter, host, run, smallPackage, tarGz } from "./helpers.mjs";
import { checkDelivered } from "./delivered-formats.test.mjs";
import { matchReaches, tracePrograms } from "../scripts/trace-programs.mjs";

const LIMIT = "spending limit: 10 USD per month\n";
const BRAND = {
  schema: "https://schemas.example.org/brand/v1",
  reads: ["name", "palette.accent", "logo.mark.href", "logo.mark.media_type"],
  required: false,
  does: "Puts the brand's name and mark on the title card.",
  without: "The title card carries no brand name or mark.",
};
const SCRIPT = "skills/read-the-weather/scripts/read.mjs";

const withBrand = (lines, canUse = [BRAND]) => smallPackage((pkg) => {
  pkg.descriptor.can_use = canUse;
  pkg.descriptor.systems = [];
  pkg.requirements.systems = [];
  pkg.programs[SCRIPT] = lines.join("\n");
  return pkg;
});

const review = (p, name) => {
  const r = run(host(), { message: LIMIT, files: [{ name, bytes: tarGz(filesOf(p)) }] });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(checkDelivered(r.jobDir), []);
  return frontMatter(r.review);
};

test("a program reading a can_use address member by its path and fetching it passes as a declared reach", () => {
  const p = withBrand([
    'const read = (profile, path) => path.split(".").reduce((v, k) => v?.[k], profile);',
    'export async function mark(profile) {',
    '  const href = read(profile, "logo.mark.href");',
    '  const res = await fetch(href);',
    '  return res.arrayBuffer();',
    '}',
  ]);
  const files = new Map(Object.entries(filesOf(p)).map(([k, v]) => [k, Buffer.from(v)]));
  const { traced } = tracePrograms(files, [SCRIPT]);
  const matched = matchReaches({ traced, systems: [], canUse: [BRAND] });
  assert.equal(matched.unmatchedOpen.length, 0);
  assert.match(matched.openFetches[0].by, /logo\.mark\.href/);

  const fm = review(p, "brand-path.tar.gz");
  assert.equal(fm.verdict, "passed", JSON.stringify(fm.refused_for));
  assert.deepEqual(fm.refused_for, []);
});

test("a program reading a can_use address member by a property chain and fetching it passes", () => {
  const p = withBrand([
    'export async function mark(profile) {',
    '  const res = await fetch(profile?.logo?.mark?.href);',
    '  return res.arrayBuffer();',
    '}',
  ]);
  const fm = review(p, "brand-chain.tar.gz");
  assert.equal(fm.verdict, "passed", JSON.stringify(fm.refused_for));
});

test("a can_use entry whose reads names no address member excuses no handed fetch", () => {
  const p = withBrand([
    'export async function mark(profile) {',
    '  const accent = profile.palette.accent;',
    '  const res = await fetch(profile.anywhere);',
    '  return [accent, await res.text()];',
    '}',
  ], [{ ...BRAND, reads: ["name", "palette.accent"] }]);
  const fm = review(p, "brand-no-address.tar.gz");
  assert.equal(fm.verdict, "refused");
  assert.ok(fm.refused_for.some((x) => x.includes("read.mjs:3")), JSON.stringify(fm.refused_for));
});

test("a program that does not name the declared address member is not excused by the entry", () => {
  const p = withBrand([
    'export async function other(dest) {',
    '  const res = await fetch(dest);',
    '  return res.text();',
    '}',
  ]);
  const fm = review(p, "brand-unnamed.tar.gz");
  assert.equal(fm.verdict, "refused");
  assert.ok(fm.refused_for.some((x) => x.includes("read.mjs:2")), JSON.stringify(fm.refused_for));
});

test("a program that names the address member but also writes down an address nothing covers is still refused", () => {
  const p = withBrand([
    'const FALLBACK = "https://marks.undeclared-vendor.net/default.svg";',
    'export async function mark(profile) {',
    '  const res = await fetch(profile?.logo?.mark?.href ?? FALLBACK);',
    '  return res.arrayBuffer();',
    '}',
  ]);
  const fm = review(p, "brand-stray.tar.gz");
  assert.equal(fm.verdict, "refused");
  assert.ok(fm.refused_for.some((x) => x.includes("undeclared-vendor.net")), JSON.stringify(fm.refused_for));
});
