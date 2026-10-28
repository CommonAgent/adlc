// Run the package maker's own checks over the audited package.
//
// The package maker (CommonAgent/adlc agents/package-maker/build.py) holds
// the format, model and standing-asset rules as a package is built. Run over
// a package folder, it builds it again into a scratch folder and prints one
// JSON line with `format_rules` and, once its standing-asset rules are in,
// `standing_rules`. The auditor reads those, so the audit and the build can
// never hold the package to two different rules.
//
// It is told FORMAT_EXISTING=1, so a finding is printed as a warning rather
// than stopping the build: the auditor wants every finding, and the level is
// the checklist's to set, not the builder's.
//
// Where it is: PACKAGE_MAKER (the path to build.py), or beside this package in
// the repository (../package-maker/build.py), or on a fleet host
// (/opt/fleet/agentbuilder-build.py). It needs python3. Without either, the
// checks that read it say so and fall back as checks.mjs says.
//
//   needs: node >= 22, and python3 to run the package maker
//   import { runPackageMaker } from "./package-maker.mjs"
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const trim = (s) => String(s ?? "").trim();

export function findPackageMaker(env = process.env) {
  // A path the host sets is the only one tried: a host that names one meant it.
  if (trim(env.PACKAGE_MAKER)) return existsSync(resolve(env.PACKAGE_MAKER)) ? resolve(env.PACKAGE_MAKER) : null;
  const tries = [join(HERE, "..", "..", "package-maker", "build.py"), join(HERE, "..", "..", "..", "package-maker", "build.py"), "/opt/fleet/agentbuilder-build.py"].filter(Boolean);
  return tries.map((p) => resolve(p)).find((p) => existsSync(p)) ?? null;
}

/** {ran, how, format_rules, standing_rules, why}. */
export function runPackageMaker(pkg, { work, env = process.env } = {}) {
  if (!pkg) return { ran: false, why: "the package's bytes were not read" };
  const build = findPackageMaker(env);
  if (!build) return { ran: false, why: "the package maker's build.py is not on this host (PACKAGE_MAKER)" };
  const python = trim(env.PYTHON) || "python3";
  const root = mkdtempSync(join(work || HERE, "pm-"));
  try {
    const folder = join(root, pkg.root || "package");
    for (const [path, bytes] of pkg.files) {
      const at = join(folder, ...path.split("/"));
      mkdirSync(dirname(at), { recursive: true });
      writeFileSync(at, bytes);
    }
    const p = spawnSync(python, [build, folder, join(root, "out")], {
      encoding: "utf8", timeout: 120_000, env: { ...env, FORMAT_EXISTING: "1" },
    });
    if (p.error) return { ran: false, why: `the package maker could not be started (${trim(p.error.message)})` };
    const last = trim(p.stdout).split(/\r?\n/).pop();
    let out = null;
    try { out = JSON.parse(last); } catch { out = null; }
    if (!out) return { ran: false, why: `the package maker printed no result (${trim(p.stderr).split(/\r?\n/).pop() || `exit ${p.status}`})` };
    if (!out.ok) return { ran: true, ok: false, how: `build.py over the package, which refused it`, why: trim(out.error), format_rules: { findings: [trim(out.error)] }, standing_rules: null };
    return { ran: true, ok: true, how: "build.py over the package", format_rules: out.format_rules ?? null, standing_rules: out.standing_rules ?? null };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
