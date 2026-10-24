/**
 * The Documenter — the platform's agent for the AgentDoc.
 *
 * An AgentDoc is assembled, never authored (Common Agent spec §9). Until this
 * agent the platform assembled one at request time and nobody stood behind
 * it. The Documenter assembles the document from the records the platform
 * holds about an agent — its stored descriptor, the evaluator's record, its
 * registration, the registrar's card — signs the result with its own key,
 * and names every record it read by digest. The signature is what turns
 * "nothing here was typed" from a promise into a checkable claim.
 *
 * Deterministic on purpose (docs/platform-agents.md): no model anywhere. The
 * document is a function of the records; the same records give the same
 * document. It re-documents an agent on its own when any record changes, and
 * it answers two requests: `document` (do it now for one agent) and
 * `changes` (which records differ from the last signed document).
 *
 * Identity follows the catalog agent's pattern exactly: generated once,
 * sealed at rest under the platform's key, stable for ever. Registration
 * rides the agent's own connection.
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import type { JetStreamClient, KV } from "nats";
import { encodeUser } from "nats-jwt";
import { canonicalJSON, nkeys } from "../platform-shared/sdk.js";
import { ensureKvBucket, snapshotKvBucket } from "../platform-shared/kv.js";
import { loadAtRestKey, seal, open, type AtRestKey, type Sealed } from "../platform-shared/at-rest.js";
import { agentCredential } from "../platform-shared/core-credentials.js";
import { AgentMesh } from "../platform-shared/sdk.js";
import { bindOwnDescriptor, documenterDescriptor, fileOwnDescriptor, storefrontOf } from "./house-descriptors.js";
import { agentConnectRetry } from "../platform-shared/agent-connect-retry.js";

export const DOCUMENTER_AGENT_NAME = "Documenter";
export const DOCUMENTER_AGENT_HANDLE = "documenter.system@agentmesh.ai";
export const SIGNED_AGENTDOC_TAG = "agentdoc-signed-v1";
/** How often the documenter looks for records that changed. */
const POLL_MS = 5 * 60_000;

interface DocumenterSecrets { seed: string }
interface StoredIdentity { agentKey: string; createdAt: string; keyId: string; sealed: Sealed }

/** One record the documenter read, and its digest at the time. */
export interface ReadRecord {
  /** "descriptor", "eval-record", "registration", "registrar-card". */
  source: string;
  digest: string;
}

/** The signed document: the assembled AgentDoc, the records it came from,
 *  who assembled it and when, and the signature over all of that. */
export interface SignedAgentDoc {
  format: typeof SIGNED_AGENTDOC_TAG;
  subject: string;
  doc: Record<string, unknown>;
  read: ReadRecord[];
  by: string;
  at: string;
  sig: string;
}

/** What the assembler hands back for one agent. */
export interface Assembled {
  doc: Record<string, unknown>;
  read: ReadRecord[];
}

// ── pure parts ─────────────────────────────────────────────────────────────

export function digestOf(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** The bytes the signature covers: everything but the signature itself,
 *  in canonical form, under the tag. */
function signedBytes(rec: Omit<SignedAgentDoc, "sig">): Uint8Array {
  return new TextEncoder().encode(`${SIGNED_AGENTDOC_TAG}\n${canonicalJSON(rec)}`);
}

/** Sign an assembly as the documenter. */
export function signAgentDoc(subject: string, a: Assembled, seed: string, at = new Date().toISOString()): SignedAgentDoc {
  const kp = nkeys.fromSeed(new TextEncoder().encode(seed));
  const body: Omit<SignedAgentDoc, "sig"> = { format: SIGNED_AGENTDOC_TAG, subject, doc: a.doc, read: a.read, by: kp.getPublicKey(), at };
  const sig = Buffer.from(kp.sign(signedBytes(body))).toString("base64");
  return { ...body, sig };
}

/** True when the signature is the documenter's over exactly this content. */
export function verifyAgentDoc(rec: SignedAgentDoc): boolean {
  try {
    const { sig, ...body } = rec;
    if (body.format !== SIGNED_AGENTDOC_TAG) return false;
    const kp = nkeys.fromPublic(body.by);
    return kp.verify(signedBytes(body), Buffer.from(sig, "base64"));
  } catch {
    return false;
  }
}

/** The records that differ between a signed document and what is on file
 *  now: added, gone, or changed by digest. Empty means the document stands. */
export function changedRecords(existing: Pick<SignedAgentDoc, "read"> | null, now: ReadRecord[]): string[] {
  if (!existing) return now.map((r) => r.source);
  const before = new Map(existing.read.map((r) => [r.source, r.digest]));
  const after = new Map(now.map((r) => [r.source, r.digest]));
  const out: string[] = [];
  for (const [s, d] of after) if (before.get(s) !== d) out.push(s);
  for (const s of before.keys()) if (!after.has(s)) out.push(s);
  return out;
}

/** The agent a request names. A structured request says it outright; a
 *  chat message may arrive inside the SDK's provenance frame, whose header
 *  names the SENDER's key first, so only the sender's own words (between
 *  the frame's markers) are read, and the last key in them wins. */
export function subjectIn(input: unknown): string | null {
  const agent = (input as { agent?: unknown } | null)?.agent;
  if (typeof agent === "string" && /^U[A-Z2-7]{55}$/.test(agent.trim())) return agent.trim();
  let text = typeof input === "string" ? input : String((input as { text?: unknown } | null)?.text ?? "");
  const begin = text.indexOf("--- BEGIN SENDER MESSAGE ---");
  const end = text.indexOf("--- END SENDER MESSAGE ---");
  if (begin !== -1 && end > begin) text = text.slice(begin + "--- BEGIN SENDER MESSAGE ---".length, end);
  const keys = text.match(/U[A-Z2-7]{55}/g);
  return keys?.length ? keys[keys.length - 1]! : null;
}

// ── the store ──────────────────────────────────────────────────────────────

export class DocumenterStore {
  constructor(
    private kv: KV,
    private docs: KV,
    private atRest: AtRestKey | null,
    private js: JetStreamClient | null,
  ) {}

  static async create(js: JetStreamClient): Promise<DocumenterStore> {
    const kv = await ensureKvBucket(js, "mesh_documenter", { history: 1 });
    const docs = await ensureKvBucket(js, "mesh_agentdocs", { history: 1 });
    return new DocumenterStore(kv, docs, loadAtRestKey(), js);
  }

  get enabled(): boolean {
    return !!this.atRest;
  }

  /** The one identity, create-first so two booting processes cannot mint two keys. */
  async ensureIdentity(): Promise<{ agentKey: string }> {
    if (!this.atRest) throw new Error("the documenter is not configured on this instance (no at-rest key)");
    const existing = await this.read<StoredIdentity>("documenter_identity");
    if (existing) return { agentKey: existing.agentKey };
    const kp = nkeys.createUser();
    const rec: StoredIdentity = {
      agentKey: kp.getPublicKey(),
      createdAt: new Date().toISOString(),
      keyId: this.atRest.id,
      sealed: seal(this.atRest, { seed: new TextDecoder().decode(kp.getSeed()) } satisfies DocumenterSecrets),
    };
    try {
      await this.kv.create("documenter_identity", JSON.stringify(rec));
    } catch {
      const winner = await this.read<StoredIdentity>("documenter_identity");
      if (winner) return { agentKey: winner.agentKey };
      throw new Error("documenter identity could not be created");
    }
    return { agentKey: rec.agentKey };
  }

  async unsealIdentity(): Promise<{ agentKey: string; seed: string } | null> {
    if (!this.atRest) return null;
    const rec = await this.read<StoredIdentity>("documenter_identity");
    if (!rec) return null;
    if (rec.keyId !== this.atRest.id) {
      throw new Error(`documenter identity was sealed under key ${rec.keyId}, but this instance holds ${this.atRest.id}`);
    }
    const secrets = open<DocumenterSecrets>(this.atRest, rec.sealed);
    if (nkeys.fromSeed(new TextEncoder().encode(secrets.seed)).getPublicKey() !== rec.agentKey) {
      throw new Error("documenter identity record is inconsistent: seed does not match agentKey");
    }
    return { agentKey: rec.agentKey, seed: secrets.seed };
  }

  /** The signed document on file for a subject, verified; null when none
   *  or when the signature does not hold (a bad record is no record). */
  async doc(subject: string): Promise<SignedAgentDoc | null> {
    try {
      const e = await this.docs.get(subject);
      if (!e || e.operation !== "PUT" || !e.value.length) return null;
      const rec = JSON.parse(e.string()) as SignedAgentDoc;
      return verifyAgentDoc(rec) ? rec : null;
    } catch {
      return null;
    }
  }

  async putDoc(rec: SignedAgentDoc): Promise<void> {
    await this.docs.put(rec.subject, JSON.stringify(rec));
  }

  async dropDoc(subject: string): Promise<void> {
    try { await this.docs.purge(subject); } catch { /* already gone */ }
  }

  /** Every subject with a signed document. */
  async subjects(): Promise<string[]> {
    if (!this.js) return [];
    const snap = await snapshotKvBucket(this.js, this.docs);
    return [...snap.entries.keys()];
  }

  private async read<T>(key: string): Promise<T | null> {
    try {
      const e = await this.kv.get(key);
      return e && e.operation === "PUT" && e.value.length ? (JSON.parse(e.string()) as T) : null;
    } catch {
      return null;
    }
  }
}

// ── the agent ──────────────────────────────────────────────────────────────

export interface DocumenterDeps {
  /** WebSocket endpoint for the agent's own connection; null disables it. */
  wsUrl: string | null;
  /** Assemble one agent's document from the records on file; null when the
   *  subject has no descriptor (an AgentDoc with no sources is no claim). */
  assemble(subject: string): Promise<Assembled | null>;
  /** Every agent that has a stored descriptor: the documenter's subjects. */
  subjects(): Promise<string[]>;
}

export class DocumenterAgent {
  private mesh: AgentMesh | null = null;
  private starting: Promise<void> | null = null;
  private started = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private store: DocumenterStore,
    private deps: DocumenterDeps,
  ) {}

  get enabled(): boolean {
    return this.store.enabled && !!this.deps.wsUrl;
  }

  async agentKey(): Promise<string | null> {
    if (!this.enabled) return null;
    return (await this.store.ensureIdentity()).agentKey;
  }

  async status(): Promise<{ configured: boolean; agent: string | null; registered: boolean }> {
    return { configured: this.enabled, agent: await this.agentKey().catch(() => null), registered: this.started };
  }

  /** Document one agent now: assemble, sign, store. Returns the signed
   *  document, or null when there is nothing to assemble from. Idempotent:
   *  unchanged records leave the document on file as it is. */
  async document(subject: string, force = false): Promise<{ doc: SignedAgentDoc | null; changed: string[] }> {
    const a = await this.deps.assemble(subject);
    if (!a) {
      await this.store.dropDoc(subject);
      return { doc: null, changed: [] };
    }
    const existing = await this.store.doc(subject);
    const changed = changedRecords(existing, a.read);
    if (existing && !changed.length && !force) return { doc: existing, changed: [] };
    const unsealed = await this.store.unsealIdentity();
    if (!unsealed) throw new Error("the documenter has no identity to sign with");
    const rec = signAgentDoc(subject, a, unsealed.seed);
    await this.store.putDoc(rec);
    return { doc: rec, changed };
  }

  /** Which records differ from the last signed document, without signing. */
  async changes(subject: string): Promise<{ documented: boolean; changed: string[] }> {
    const a = await this.deps.assemble(subject);
    const existing = await this.store.doc(subject);
    if (!a) return { documented: !!existing, changed: existing ? ["descriptor"] : [] };
    return { documented: !!existing, changed: changedRecords(existing, a.read) };
  }

  /** Every subject, documented where a record changed. */
  async sweep(): Promise<{ looked: number; written: number }> {
    let written = 0;
    const subjects = await this.deps.subjects();
    for (const s of subjects) {
      try {
        const r = await this.document(s);
        if (r.changed.length) written += 1;
      } catch { /* one subject's failure is not the sweep's */ }
    }
    return { looked: subjects.length, written };
  }

  async start(): Promise<void> {
    if (this.started || !this.enabled) return;
    if (this.starting) return this.starting;
    this.starting = this.connect()
      .catch((err) => {
        console.error(`[documenter] did not start (the mesh runs fine without it): ${(err as Error).message}`);
        if (!this.retryTimer) {
          this.retryTimer = setTimeout(() => { this.retryTimer = null; void this.start(); }, POLL_MS);
          this.retryTimer.unref?.();
        }
      })
      .finally(() => { this.starting = null; });
    return this.starting;
  }

  private async connect(): Promise<void> {
    const unsealed = await (async () => { await this.store.ensureIdentity(); return this.store.unsealIdentity(); })();
    if (!unsealed) return;
    const jwt = await this.mint(unsealed.agentKey);
    // requireNamed: false: the platform enforces the naming rule for its own agents
    // (MESH_REQUIRE_NAMES, docs/no-anonymous-agents-plan.md item 6), not the SDK.
    const mesh = await AgentMesh.connect(this.deps.wsUrl!, { requireNamed: false, connectRetry: agentConnectRetry("documenter"), jwt, nkeySeed: unsealed.seed });
    await mesh.register({
      name: DOCUMENTER_AGENT_NAME,
      description:
        "Assembles and signs each agent's AgentDoc from the records the platform holds about it: its " +
        "descriptor, the evaluator's record, its registration and the registrar's card. It writes no " +
        "words of its own and runs no model. Ask it to document an agent now (offering `document`) or " +
        "which records changed since the last document (offering `changes`).",
      capabilities: ["documentation"],
      interaction: "service",
      offerings: [
        {
          id: "document",
          name: "Document an agent",
          description: "Assemble and sign the AgentDoc for one agent, now.",
          input_schema: { type: "object", properties: { agent: { type: "string", description: "the agent's key" } }, required: ["agent"] },
          output_schema: { type: "object", properties: { documented: { type: "boolean" }, changed: { type: "array" }, at: { type: "string" } } },
        },
        {
          id: "changes",
          name: "What changed",
          description: "Which records about an agent differ from its last signed AgentDoc.",
          input_schema: { type: "object", properties: { agent: { type: "string" } }, required: ["agent"] },
          output_schema: { type: "object", properties: { documented: { type: "boolean" }, changed: { type: "array" } } },
        },
      ],
      provider: { name: "AgentMesh" },
      // Its storefront, so the listing gate lets it be listed under .platform@.
      public: storefrontOf(documenterDescriptor()),
    });
    const subjectOf = (input: unknown): string | null => subjectIn(input);
    mesh.onRequest("document", async (input) => {
      const subject = subjectOf(input);
      if (!subject) return { ok: false, error: "say which agent: { agent: \"U…\" }" };
      const r = await this.document(subject, true);
      return r.doc
        ? { ok: true, documented: true, subject, changed: r.changed, at: r.doc.at, read: r.doc.read }
        : { ok: true, documented: false, subject, note: "this agent has no stored descriptor, so there is nothing to assemble from" };
    });
    mesh.onRequest("changes", async (input) => {
      const subject = subjectOf(input);
      if (!subject) return { ok: false, error: "say which agent: { agent: \"U…\" }" };
      return { ok: true, subject, ...(await this.changes(subject)) };
    });
    mesh.onRequest("chat", async (input) => {
      const subject = subjectOf(input);
      if (!subject) return { ok: true, text: "I assemble and sign each agent's AgentDoc from the records on file. Send me an agent's key and I document it, or ask what changed." };
      const r = await this.document(subject, true);
      return { ok: true, text: r.doc ? `Documented ${subject.slice(0, 12)}… at ${r.doc.at}, from ${r.doc.read.map((x) => x.source).join(", ")}.` : `${subject.slice(0, 12)}… has no stored descriptor; nothing to assemble from.` };
    });
    this.mesh = mesh;
    this.started = true;
    console.log(`[documenter] registered as ${unsealed.agentKey.slice(0, 12)}… (${DOCUMENTER_AGENT_NAME})`);
    // Its own descriptor, so it has an AgentDoc of its own (SDLC plan A3).
    void fileOwnDescriptor(mesh, bindOwnDescriptor(documenterDescriptor(), unsealed.agentKey, unsealed.seed, DOCUMENTER_AGENT_HANDLE), "documenter");

    // The sweep: document what changed, every few minutes. The tick doubles
    // as the health check, the same as the catalog agent's poller.
    void this.sweep().then((r) => { if (r.written) console.log(`[documenter] documented ${r.written} of ${r.looked} agents`); }).catch(() => {});
    this.timer = setInterval(() => {
      void this.sweep()
        .then((r) => { if (r.written) console.log(`[documenter] documented ${r.written} of ${r.looked} agents`); })
        .catch(() => { void this.recycle(); });
    }, POLL_MS);
    this.timer.unref?.();
  }

  private async recycle(): Promise<void> {
    await this.stop();
    await this.start();
  }

  private mint(agentKey: string): Promise<string> {
    // The core signs it with the platform's signing key, which the platform no
    // longer reads (step 10a; platform-shared/core-credentials.ts).
    return agentCredential(agentKey, "documenter");
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    await this.mesh?.close().catch(() => {});
    this.mesh = null;
    this.started = false;
  }
}
