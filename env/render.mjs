#!/usr/bin/env node
// Renders a host configuration template for one environment.
//
//   node env/render.mjs deploy/hosts/mesh/Caddyfile.tmpl > /tmp/Caddyfile
//   AGENTMESH_ENV=dev node env/render.mjs deploy/hosts/mesh/Caddyfile.tmpl
//
// A template is the live file with each environment value written as
// {{dotted.path}} (a path into env/<name>.json, e.g. {{hosts.api}}), and each
// secret written as {{secret:NAME}}. Secrets are never rendered: a template
// that names one is refused unless --allow-secret-placeholders is given, and
// then the placeholder is left in place for the installer to fill on the host
// from Secret Manager. Values that are lists render space-separated.
//
// Refuses an unknown or null path (env/load.cjs's rule), so a dev render with
// an address Terraform has not produced yet stops here, not on the host.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { get } = require("./load.cjs");

const args = process.argv.slice(2);
const allowSecrets = args.includes("--allow-secret-placeholders");
const file = args.find((a) => !a.startsWith("--"));
if (!file) {
  process.stderr.write("usage: node env/render.mjs <template> [--allow-secret-placeholders]\n");
  process.exit(2);
}

const text = readFileSync(file, "utf8");
let failed = false;
const out = text.replace(/\{\{\s*([a-zA-Z0-9_:./-]+)\s*\}\}/g, (whole, key) => {
  if (key.startsWith("secret:")) {
    if (!allowSecrets) {
      process.stderr.write(`render: ${file} names ${key}; pass --allow-secret-placeholders to leave it for the host installer\n`);
      failed = true;
    }
    return whole;
  }
  try {
    const v = get(key);
    return Array.isArray(v) ? v.join(" ") : String(v);
  } catch (e) {
    process.stderr.write(`render: ${e.message}\n`);
    failed = true;
    return whole;
  }
});
if (failed) process.exit(1);
process.stdout.write(out);
