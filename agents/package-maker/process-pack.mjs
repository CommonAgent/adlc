#!/usr/bin/env node
// The package maker's process kind: a process document and its test cases in,
// a bundle and a signed build record out (lane FLEET of "the ADLC builds
// processes"; the message and answer are in the lane's INTERFACE.md).
//
// A process is not packed into an Agent Package. What the later stages need of
// it is the document at a digest the owner can approve, the suite that was run
// against it, and a record, signed by the package maker, saying both, and who
// held each stage. So this:
//
//   1. runs the process check (adlc standards/process-check.mjs), which must
//      pass: every §17.1 item conforms and no §20.1 finding;
//   2. pins the document's two digests, its shape's (§21.1, Agent Processes
//      0.9.2: the text with the bindings: block left out, which a test case is
//      pinned to) and its whole text's;
//   3. bundles the test cases, each for this process and pinned to that shape;
//   4. signs an agent-build-record-v1 with `kind: "process"`, naming both
//      digests, the bundle's digest, each test case's, the suite's results
//      when they came, and who held each stage, the way pack.py signs an
//      agent's build record.
//
// Nothing here calls a model, and nothing runs the process.
//
//   node process-pack.mjs --run <framed prompt file> <identity.json>
//       the brain's call (agentbuilder-pack-as-node.sh): exit 3 when the
//       attached files carry no process document, so the brain goes on as before
//   node process-pack.mjs <document> <test case>... [--json]
//       the same check and bundle from files, unsigned, for a person
//
//   needs: node >= 22
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { pathToFileURL } from "node:url";

const records = await import(new URL("./process-records.mjs", import.meta.url).href).catch(() => import(new URL("./shared/process-records.mjs", import.meta.url).href));
const {
  BUNDLE_FORMAT, KIND, MEDIA, SPEC, TAGS, digests, headerOf, isProcessText, jsonOf, labelled, loadChecker,
  promptFiles, readCase, readFiles, senderText, sha256, signRecord, hostKeys, writePieces,
} = records;

const REFUSED = "The process was not signed";

/** Who held each stage: `holders.json` ({ stages: [...] }) or `held:` lines. */
export function stagesOf(files, words) {
  for (const f of files) {
    const j = jsonOf(f.text);
    if (j && Array.isArray(j.stages)) {
      return j.stages.filter((s) => s && typeof s.stage === "string" && typeof s.holder === "string")
        .map((s) => ({ stage: s.stage.trim(), holder: s.holder.trim(), kind: s.kind === "person" ? "person" : "agent" }));
    }
  }
  const out = [];
  for (const line of labelled(words, "held")) {
    const m = /^(\S+)\s+by\s+(person\s+)?(\S+)$/i.exec(line.trim());
    if (m) out.push({ stage: m[1], holder: m[3], kind: m[2] ? "person" : "agent" });
  }
  return out;
}

/** The suite's results, as GET /v1/solutions/:id/tests/results answered. */
export function suiteOf(files) {
  for (const f of files) {
    const j = jsonOf(f.text);
    if (j && Array.isArray(j.results) && j.results.every((r) => r && typeof r === "object" && "result" in r)) {
      const n = (w) => j.results.filter((r) => r.result === w).length;
      return { solution: typeof j.solution === "string" ? j.solution : null, pass: n("pass"), fail: n("fail"), pending: n("pending"), not_started: n("not started"), sha256: sha256(f.text) };
    }
  }
  return null;
}

/**
 * The check, the digests, the bundle and the record, from the files a message
 * brought. `files`: [{ name, text }]. `signer`: { by, sign } or null.
 * Returns { ok: true, answer, bundle, record, names } or { ok: false, refused }.
 */
export function packProcess({ files, words = "", checker, signer = null, now = new Date() }) {
  const docs = files.filter((f) => isProcessText(f.text));
  if (!docs.length) return { ok: false, refused: `${REFUSED}: no process document came with the message.` };
  const named = labelled(words, "process")[0] ?? null;
  const subject = named ? docs.find((d) => d.name === named || basename(d.name) === named) : docs.length === 1 ? docs[0] : null;
  if (!subject) {
    return { ok: false, refused: named
      ? `${REFUSED}: no attached process document is called ${named}.`
      : `${REFUSED}: ${docs.length} process documents came and nothing said which one to sign; name it on a line "process: <file name>".` };
  }
  const inner = docs.filter((d) => d !== subject).map((d) => d.text);
  const header = headerOf(subject.text);
  if (!header) return { ok: false, refused: `${REFUSED}: ${subject.name} has no id line (id: <team>/<slug> v<n>).` };

  // 1. The check must pass.
  const r = checker.checkProcess(subject.text, { inner });
  if (!r.conforms || !r.clean) {
    const why = [...r.failures.map((f) => `${f.section} ${f.text}`), ...r.findings.map((f) => `[${f.test}] ${f.section} ${f.text}`)];
    return { ok: false, refused: `${REFUSED}: the process check did not pass (${why.length} ${why.length === 1 ? "item" : "items"}): ${why.slice(0, 6).join("; ")}${why.length > 6 ? "; and more" : ""}.` };
  }

  // 2. Both digests.
  const d = digests(subject.text, checker);

  // 3. The test cases, each for this process and pinned to its shape.
  const cases = [];
  for (const f of files) {
    if (f === subject || docs.includes(f)) continue;
    const c = readCase(f.text);
    if (!c) continue;
    if (c.for !== header.id) return { ok: false, refused: `${REFUSED}: the test case ${c.name} is for ${c.for ?? "no process"}, not ${header.id}.` };
    if (c.digest !== d.shape_sha256) {
      return { ok: false, refused: `${REFUSED}: the test case ${c.name} is pinned to ${c.digest ?? "no digest"}, and ${header.id} v${header.version}'s shape is ${d.shape_sha256} (§21.1: a test case is pinned to the document's shape, the text with the bindings: block left out).` };
    }
    if (cases.some((x) => x.name === c.name)) return { ok: false, refused: `${REFUSED}: two test cases are called ${c.name}.` };
    cases.push({ name: c.name, file: f.name, text: f.text.replace(/\r\n?/g, "\n"), sha256: sha256(f.text.replace(/\r\n?/g, "\n")) });
  }
  if (!cases.length) return { ok: false, refused: `${REFUSED}: no test case came with ${header.id}; the suite is signed with the document.` };
  cases.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  const stem = `${header.team}-${header.slug}-v${header.version}`;
  const bundle = {
    format: BUNDLE_FORMAT,
    process: { id: header.id, version: header.version, name: header.name, owner: header.owner },
    document: { name: basename(subject.name), text: subject.text.replace(/\r\n?/g, "\n"), ...d },
    test_cases: cases,
  };
  const bundleText = `${JSON.stringify(bundle, null, 2)}\n`;
  const names = { bundle: `${stem}.process-bundle.json`, record: `${stem}.build-record.json` };
  const suite = suiteOf(files);

  // 4. The record.
  const doc = {
    record: "v1", kind: KIND, role: "package-maker", act: "build",
    requested_by: labelled(words, "requested by")[0] ?? "the requester",
    process: { id: header.id, version: header.version, name: header.name, owner: header.owner, spec: SPEC, ...d },
    bundle: { name: names.bundle, sha256: sha256(bundleText) },
    test_cases: { count: cases.length, pinned_to: d.shape_sha256, cases: cases.map((c) => ({ name: c.name, sha256: c.sha256 })) },
    ...(suite ? { suite } : {}),
    stages: stagesOf(files, words),
    checks: [{ kind: "process-check", conforms: true, clean: true, spec: `Agent Processes ${checker.SPEC_VERSION ?? ""}`.trim(), what: `the process check passed: every §17.1 item conforms and the four tests of §20.1 found nothing` }],
    produced_at: now.toISOString().replace(/\.\d{3}Z$/, "Z"),
  };
  const record = signRecord(doc, TAGS.build, signer);
  const answer = `Signed ${header.id} v${header.version}: shape ${d.shape_sha256}, text ${d.text_sha256}, ${cases.length === 1 ? "one test case" : `${cases.length} test cases`}. The bundle and the signed build record are delivered as pieces.`;
  return { ok: true, answer, bundle, bundleText, record, names, signed: !!record.signatures?.length };
}

/** The brain's turn: exit 3 when it is not process work. */
async function run(promptPath, identityPath) {
  const prompt = readFileSync(promptPath, "utf8");
  const { jobDir, files: paths } = promptFiles(prompt);
  const files = readFiles(paths);
  if (!files.some((f) => isProcessText(f.text))) process.exit(3);
  let signer = null;
  try { signer = hostKeys(identityPath).signer; } catch { signer = null; }
  const checker = await loadChecker();
  const got = packProcess({ files, words: senderText(prompt), checker, signer });
  if (!got.ok) { console.log(got.refused); return; }
  if (jobDir) {
    writePieces(jobDir, "sign-the-process", [
      { name: "process bundle", file: got.names.bundle, text: got.bundleText, media_type: MEDIA.bundle,
        about: `The process document ${got.bundle.process.id} v${got.bundle.process.version} and its ${got.bundle.test_cases.length} test cases, at the digests the build record names.` },
      { name: "build record", file: got.names.record, text: `${JSON.stringify(got.record, null, 2)}\n`, media_type: MEDIA.build,
        about: "The build record, signed by the package maker: both digests of the document, the test cases by digest, and who held each stage." },
    ]);
  }
  console.log(got.signed ? got.answer : `${got.answer} The record is not signed: the signer was not available on this host.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args[0] === "--run" && args.length === 3) {
    await run(args[1], args[2]);
  } else if (args.length && args[0] !== "--run") {
    const paths = args.filter((a) => a !== "--json");
    const files = paths.map((p) => ({ name: basename(p), text: readFileSync(p, "utf8") }));
    const got = packProcess({ files, checker: await loadChecker() });
    if (args.includes("--json")) console.log(JSON.stringify(got.ok ? { ok: true, bundle: got.bundle, record: got.record } : got, null, 2));
    else console.log(got.ok ? got.answer.replace(" The bundle and the signed build record are delivered as pieces.", " (unsigned: run from files)") : got.refused);
    process.exit(got.ok ? 0 : 1);
  } else {
    console.error("usage: process-pack.mjs --run <prompt file> <identity.json> | process-pack.mjs <document> <test case>... [--json]");
    process.exit(2);
  }
}
