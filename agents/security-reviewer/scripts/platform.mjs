// What the platform an agent is installed on holds it to, so a review says
// which of its bounds are enforced and which rest on the package's own code.
//
// Each line says what is enforced and where, as AgentMesh is on 2026-10-27:
// the package maker (agents/package-maker/build.py), the deployment manager
// (agents/deployment-manager/install.py, steps.py), and the services (the
// kill switch, the account's spending limit, the allowance). Where a bound is
// declared and nothing enforces it, the line says so, because a review that
// calls a bound enforced when it is not is the review that lets the harm
// through. references/what-the-platform-holds-it-to.md says the same in prose
// with the places each is enforced. A review never claims a bound this file
// does not list.
//
//   needs: node >= 22
//   import { PLATFORM } from "./platform.mjs"

export const PLATFORM = {
  /** The reserved system names an account can bind (agents/package-maker/system-names.json). */
  reservedSystems: [
    "database", "files", "agent-memory", "sign-in", "mail", "text-reasoning", "image-reading",
    "speech-to-text", "text-to-speech", "api-gateway", "mcp-gateway", "draft-host", "activity-record",
    "calendar", "chat", "payments",
  ],
  /** The three access words a system is declared at (agents/package-maker/build.py ACCESS). */
  access: ["read", "write", "trigger"],
  /** The nine authority words an offering may state (Common Agent 6.11). */
  authority: ["reads-files", "writes-files", "reads-systems", "updates-systems", "triggers-systems", "runs-commands", "reaches-network", "sends-messages", "spends-money"],
  enforcement: {
    // Egress: no per-agent host allow-list is built yet. A host or Cloud Run
    // install records egress {policy: "open", enforced_by: "none"}; a platform
    // worker job runs under an observe rule that logs and allows; a tenant
    // agent in a customer's project is denied everything but the mesh.
    egress: "nothing on a fleet host or Cloud Run today (the deployment record says egress open, enforced by none); a platform worker job's traffic is logged and allowed; a tenant agent in a customer's project is denied everything but the mesh. Until an allow-list is enforced, this package's own programs are what hold it",
    credentials: "the package maker and the deployment manager: a credential is a NAME, a value anywhere in the package or the instruction is refused, and the install places it from the owner's store into the one variable the package names",
    access: "the credential the owner binds: a read credential cannot write. Where the product behind it grants more, only this package's own programs hold it to the access it declared",
    leaves: "nothing: whether a caller's material leaves for a system is what the descriptor tells a caller, and nothing checks what a request carries",
    ceilings: "the deployment manager, which refuses an install whose instruction gives no ceiling for a spending system and places the number as a CEILING_ variable; the package's own programs count against it, and nothing on the platform meters it",
    runtimeCeiling: "the package's own programs, which read the number the install placed as a CEILING_ variable and stop calling at it; nothing on the platform meters it, and a program that ignores the variable spends without a bound",
    ownerLimit: "the account: its monthly spending limit refuses a hold past it, and the agent's allowance (Common Agent EXT-8) refuses or asks the owner when a ceiling is spent",
    trial: "the allowance written at install from the trial ceiling, which the node holds",
    jobSeconds: "the host, which stops a job that runs past its job_seconds",
    killSwitch: "the kill switch: a pause or terminate cuts the agent's credential doors and its transport, the supervisor starts no new work and ends what is running, and brokered access lapses within ten minutes. A container in a customer's own cloud is not taken down, and a placed model key is not revoked",
  },
  /** When nothing else covers a fetch to an address the program is handed. */
  browserNote: "drives a browser and routes none of its requests, so every address the pages pull in (fonts, scripts, analytics) is loaded, not only the pages it was asked for",
};
