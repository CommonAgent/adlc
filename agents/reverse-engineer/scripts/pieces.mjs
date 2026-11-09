// Fill a job folder with the as-built record: out/as-built/record.json, one
// file per part, the schemas found and derived under out/as-built/schemas/,
// and pieces.json, the list the adapter reads when the reply is sent, one
// entry per piece with the step that made it. The adapter signs the job
// manifest from that list.
//
//   needs: node >= 22
//   import { plan, fill } from "./pieces.mjs"
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const DIR = "out/as-built";

/** Each part's piece: its name (the declared output), kind and step. */
export const PIECE = {
  "behaviors.json": { name: "behaviors", media_type: "application/vnd.agentmesh.as-built-behaviors+json", step: "draft-from-the-code" },
  "architecture.json": { name: "architecture as built", media_type: "application/vnd.agentmesh.as-built-architecture+json", step: "draft-from-the-code" },
  "interfaces.json": { name: "interfaces", media_type: "application/vnd.agentmesh.as-built-interfaces+json", step: "draft-from-the-code" },
  "sbom.cdx.json": { name: "dependencies", media_type: "application/vnd.cyclonedx+json", step: "list-the-dependencies" },
  "tests-and-gaps.json": { name: "existing tests and gaps", media_type: "application/vnd.agentmesh.as-built-tests-and-gaps+json", step: "check-the-evidence" },
};
export const RECORD_PIECE = { name: "as-built record", media_type: "application/vnd.agentmesh.as-built-record+json", step: "write-the-record" };

/** What to list and what to write. Pure. */
export function plan({ record, docs, schemaFiles = [] }) {
  if (!record) throw new Error("there is no record to file");
  const entries = [{ ...RECORD_PIECE, path: `${DIR}/record.json`, produced_from: ["codebase"], text: `${JSON.stringify(record, null, 2)}\n` }];
  for (const d of docs) {
    const p = PIECE[d.file];
    entries.push({ name: p.name, step: p.step, path: `${DIR}/${d.file}`, media_type: p.media_type, produced_from: ["codebase"], text: d.text });
  }
  for (const s of schemaFiles) {
    const openapi = s.format === "openapi";
    entries.push({
      name: `${openapi ? "openapi" : "json schema"} (${s.file})`, step: s.derived && !(s.read_by_rule && !s.drafted) ? "draft-from-the-code" : "read-the-codebase",
      path: `${DIR}/${s.file}`, media_type: openapi ? "application/vnd.oai.openapi+json" : "application/schema+json",
      produced_from: ["codebase"], text: s.text,
    });
  }
  return { entries };
}

/** Write the pieces and the list. */
export function fill(jobDir, { entries }) {
  const listed = entries.map((e) => {
    const { text, ...rest } = e;
    const dest = join(jobDir, rest.path);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, text);
    return rest;
  });
  writeFileSync(join(jobDir, "pieces.json"), `${JSON.stringify(listed, null, 2)}\n`);
  return listed;
}
