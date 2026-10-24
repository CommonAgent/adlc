/**
 * The Catalog agent — the mesh-native door to the catalog.
 *
 * Until this agent, the catalog was reachable only over HTTP, so an agent on
 * the mesh could not ask "who can do X?" without leaving the mesh. This
 * agent takes that question as an ordinary request and answers with listings
 * from the catalog store, and it publishes one stream feed, `listings`, that
 * carries newly listed agents as they arrive — the follow-worthy feed.
 *
 * Deterministic on purpose (docs/platform-agents.md): no model anywhere.
 * A search is a database query through the catalog's own /search door, and
 * the answer is only ever what the store holds. A conversational layer, if
 * one ever ships, re-scores the `screened` item first.
 *
 * Identity follows the announcer's pattern exactly: generated once, sealed
 * at rest under the platform's key, stable for ever — the feed subject
 * embeds it. Registration and the feed ride the agent's OWN connection
 * (unlike the announcer, this agent answers requests, so it needs one).
 */

import { readFileSync } from "node:fs";
import type { JetStreamClient, KV } from "nats";
import { encodeUser } from "nats-jwt";
import { nkeys } from "../platform-shared/sdk.js";
import { ensureKvBucket } from "../platform-shared/kv.js";
import { loadAtRestKey, seal, open, type AtRestKey, type Sealed } from "../platform-shared/at-rest.js";
import { agentCredential } from "../platform-shared/core-credentials.js";
import { AgentMesh } from "../platform-shared/sdk.js";
import { amEnv } from "../platform-shared/am-env.js";
import { findAnswerLine, findRequest, matchWord, shapeProcess, shapeSolution, type CatalogProcess, type CatalogSolution } from "./find-shape.js";
import { bindOwnDescriptor, catalogDescriptor, fileOwnDescriptor, storefrontOf } from "./house-descriptors.js";
import { offeringsOfDescriptor, source, SOURCE_OFFERING, type FoundAgent, type FoundSolution, type SourceDeps, type SourceOutcome, type SourcePort } from "./catalog-source.js";
import { agentConnectRetry } from "../platform-shared/agent-connect-retry.js";

export const CATALOG_TOPIC = "listings";
export const CATALOG_AGENT_NAME = "Mesh catalog";
export const CATALOG_AGENT_HANDLE = "catalog.system@agentmesh.ai";

/** How often the poller looks for new listings. */
const POLL_MS = 5 * 60_000;
/** How soon a failed start is tried again, the first three times. */
const QUICK_RETRY_MS = 20_000;

interface CatalogAgentSecrets {
  seed: string;
}

interface StoredIdentity {
  agentKey: string;
  createdAt: string;
  keyId: string;
  sealed: Sealed;
}

/** The poller's watermark: which recent listings have already been
 *  broadcast. URNs rather than a timestamp, so two listings sharing a
 *  first_seen second cannot slip through or double-publish. */
interface Watermark {
  urns: string[];
  at: string;
}

interface RecentListing {
  urn: string;
  display_name: string;
  description: string | null;
  handle: string | null;
  agent_id: string | null;
  source: string;
  first_seen_at: string;
}

export class CatalogAgentStore {
  constructor(
    private kv: KV,
    private atRest: AtRestKey | null,
  ) {}

  static async create(js: JetStreamClient): Promise<CatalogAgentStore> {
    const kv = await ensureKvBucket(js, "mesh_catalog_agent", { history: 1 });
    return new CatalogAgentStore(kv, loadAtRestKey());
  }

  get enabled(): boolean {
    return !!this.atRest;
  }

  /** The one identity, create-first so two booting processes cannot mint
   *  two keys — the same contract as the announcer's, for the same reasons
   *  plus subject stability. */
  async ensureIdentity(): Promise<{ agentKey: string }> {
    if (!this.atRest) throw new Error("the catalog agent is not configured on this instance (no at-rest key)");
    const existing = await this.read<StoredIdentity>("catalog_agent_identity");
    if (existing) return { agentKey: existing.agentKey };
    const kp = nkeys.createUser();
    const rec: StoredIdentity = {
      agentKey: kp.getPublicKey(),
      createdAt: new Date().toISOString(),
      keyId: this.atRest.id,
      sealed: seal(this.atRest, { seed: new TextDecoder().decode(kp.getSeed()) } satisfies CatalogAgentSecrets),
    };
    try {
      await this.kv.create("catalog_agent_identity", JSON.stringify(rec));
    } catch {
      // Lost the race: the winner's identity is the identity.
      const winner = await this.read<StoredIdentity>("catalog_agent_identity");
      if (winner) return { agentKey: winner.agentKey };
      throw new Error("catalog agent identity could not be created");
    }
    return { agentKey: rec.agentKey };
  }

  async unsealIdentity(): Promise<{ agentKey: string; seed: string } | null> {
    if (!this.atRest) return null;
    const rec = await this.read<StoredIdentity>("catalog_agent_identity");
    if (!rec) return null;
    if (rec.keyId !== this.atRest.id) {
      throw new Error(
        `catalog agent identity was sealed under key ${rec.keyId}, but this instance holds ` +
          `${this.atRest.id} — restore the original HOSTED_AGENT_KEY_FILE`,
      );
    }
    const secrets = open<CatalogAgentSecrets>(this.atRest, rec.sealed);
    if (nkeys.fromSeed(new TextEncoder().encode(secrets.seed)).getPublicKey() !== rec.agentKey) {
      throw new Error("catalog agent identity record is inconsistent: seed does not match agentKey");
    }
    return { agentKey: rec.agentKey, seed: secrets.seed };
  }

  async watermark(): Promise<Watermark | null> {
    return this.read<Watermark>("listings_watermark");
  }

  async setWatermark(w: Watermark): Promise<void> {
    await this.kv.put("listings_watermark", JSON.stringify(w));
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

export interface CatalogAgentOptions {
  /** WebSocket endpoint for the agent's own connection; null disables the
   *  whole agent (it cannot answer or publish without one). */
  wsUrl: string | null;
  /** The catalog's HTTP base (CATALOG_URL); null disables — a catalog
   *  agent on a deployment with no catalog would be an empty promise. */
  catalogUrl: string | null;
  /** An agent's descriptor as the registry holds it, for Source's fit
   *  check (catalog-source.ts); null when it holds none. Absent: no offering
   *  can be read, so every Source answer is "build one" and says why. */
  descriptorOf?: (key: string) => Promise<unknown | null>;
  /** What a listed solution takes at Start and hands back at its End. */
  solutionShape?: (id: string) => Promise<{ takes: SourcePort[]; gives: SourcePort[] } | null>;
}

/**
 * The question in a request: `query`, else `text`, else the string itself.
 * Only the sender's own words when the text arrives inside a provenance frame
 * (the SDK's fence, on by default elsewhere): the frame's words are not the
 * question, and searching them returned the same demo agent for everything.
 */
export function questionOf(input: unknown): string {
  const raw = typeof input === "string" ? input : (input as { query?: string; text?: string })?.query ?? (input as { text?: string })?.text ?? "";
  const s = String(raw);
  const m = /--- BEGIN SENDER MESSAGE ---\n([\s\S]*?)\n--- END SENDER MESSAGE ---/.exec(s.replace(/\r\n?/g, "\n"));
  // The fence puts one space before a line holding a run of dashes or equals
  // signs (fenceSenderText); that space is the fence's, not the sender's.
  return (m ? m[1]!.replace(/^ (?=.*(?:-{3,}|={3,}))/gm, "") : s).trim();
}

export class CatalogAgent {
  private mesh: AgentMesh | null = null;
  private starting: Promise<void> | null = null;
  private started = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private failedStarts = 0;

  constructor(
    private store: CatalogAgentStore,
    private opts: CatalogAgentOptions,
  ) {}

  get enabled(): boolean {
    return this.store.enabled && !!this.opts.wsUrl && !!this.opts.catalogUrl;
  }

  async agentKey(): Promise<string | null> {
    if (!this.enabled) return null;
    return (await this.store.ensureIdentity()).agentKey;
  }

  async status(): Promise<{ configured: boolean; agent: string | null; registered: boolean }> {
    return {
      configured: this.enabled,
      agent: await this.agentKey().catch(() => null),
      registered: this.started,
    };
  }

  /** One deterministic search against the catalog's own door. The contract
   *  (docs/platform-agents.md item 4): the answer is what the store holds,
   *  never invented; an unreachable catalog is a named failure, not an
   *  empty result. */
  async search(query: string, limit: number): Promise<{
    total: number;
    answer: string;
    solutions?: Array<Record<string, unknown>>;
    agents: Array<{
      kind: string;
      name: string | undefined;
      handle: string | null;
      agent_id: string | null;
      what_it_does: string | undefined;
      relevance: number | undefined;
      match: "close" | "loose";
    }>;
    processes?: Array<Record<string, unknown>>;
  }> {
    const base = this.opts.catalogUrl!;
    // Solutions and business processes as well as agents, worded the way
    // every find door words them (find-shape.ts).
    const r = await fetch(`${base}/search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(findRequest(query, Math.min(20, Math.max(1, limit)))),
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) throw new Error(`the catalog answered ${r.status}`);
    const found = (await r.json()) as {
      totalSize?: number;
      results?: Array<{
        kind?: string;
        displayName?: string;
        handle?: string;
        data?: { handle?: string; agent_id?: string };
        description?: string;
        score?: number;
      }>;
      solutions?: CatalogSolution[];
      reference?: CatalogProcess[];
    };
    const publicCatalog = (process.env.CATALOG_PUBLIC_URL || amEnv("urls.catalog")).replace(/\/+$/, "");
    const solutions = (found.solutions ?? []).map(shapeSolution);
    // cut-ok: the three nearest abstract processes are a pointer; the catalog's Processes page lists them all
    const processes = (found.reference ?? []).slice(0, 3).map((p) => shapeProcess(p, publicCatalog));
    const agents = found.results ?? [];
    return {
      total: found.totalSize ?? 0,
      answer: findAnswerLine((found.solutions ?? []).map((s) => s.score), agents.map((a) => a.score), processes.length),
      ...(solutions.length ? { solutions } : {}),
      agents: agents.map((rr) => ({
        kind: rr.kind ?? "agent",
        name: rr.displayName,
        handle: rr.data?.handle ?? rr.handle ?? null,
        agent_id: rr.data?.agent_id ?? null,
        what_it_does: rr.description,
        relevance: rr.score,
        match: matchWord(rr.score),
      })),
      ...(processes.length ? { processes } : {}),
    };
  }

  /** What Source reaches: the catalog's own search door, the registry's
   *  descriptors, and the solutions store, all read-only. */
  sourceDeps(): SourceDeps {
    const base = this.opts.catalogUrl!;
    return {
      self: CATALOG_AGENT_HANDLE,
      search: async (words) => {
        const r = await fetch(`${base}/search`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(findRequest(words, 10)),
          signal: AbortSignal.timeout(15_000),
        });
        if (!r.ok) throw new Error(`the catalog answered ${r.status}`);
        const found = (await r.json()) as {
          results?: Array<{ kind?: string; displayName?: string; handle?: string; data?: { handle?: string; agent_id?: string }; score?: number }>;
          solutions?: Array<CatalogSolution & { id?: string }>;
        };
        const agents: FoundAgent[] = (found.results ?? [])
          .filter((x) => (x.kind ?? "agent") === "agent")
          .map((x) => ({ kind: "agent", handle: x.data?.handle ?? x.handle ?? null, key: x.data?.agent_id ?? null, name: x.displayName ?? x.data?.handle ?? "an agent", score: x.score ?? 0 }));
        const solutions: FoundSolution[] = (found.solutions ?? [])
          .filter((x) => typeof x.id === "string")
          .map((x) => ({ kind: "solution", id: x.id!, name: x.name ?? "a solution", page: x.url ?? null, score: x.score ?? 0, publisher: x.publisher ?? null }));
        return { agents, solutions };
      },
      offerings: async (key) => {
        const d = this.opts.descriptorOf ? await this.opts.descriptorOf(key) : null;
        const out = d ? offeringsOfDescriptor(d) : [];
        return out.length ? out : null;
      },
      solution: async (id) => (this.opts.solutionShape ? this.opts.solutionShape(id) : null),
    };
  }

  /** Source: every step of a plan answered with an agent, a solution, or "build one" (catalog-source.ts). */
  async answerSource(input: unknown): Promise<SourceOutcome> {
    return source(input, this.sourceDeps());
  }

  /** Connect, register, and start the listings poller. Idempotent and
   *  best-effort: the platform runs fine without it (fails absent). A
   *  failed start retries itself — the first deploy proved why: one boot
   *  connect timed out and the agent stayed dead until the next deploy,
   *  which is absence without the "for at most a poll interval" promise. */
  async start(): Promise<void> {
    if (this.started || !this.enabled) return;
    if (this.starting) return this.starting;
    this.starting = this.connect()
      .catch((err) => {
        console.error(`[catalog-agent] did not start (the mesh runs fine without it): ${(err as Error).message}`);
        if (!this.retryTimer) {
          // The first tries come soon: at boot the registry in this same
          // process may not answer yet, and until the agent is on the mesh
          // the Build page cannot ask it about any step (dev, 2026-10-06:
          // both deploys of P7 item 5 lost the first registration).
          this.failedStarts++;
          this.retryTimer = setTimeout(() => {
            this.retryTimer = null;
            void this.start();
          }, this.failedStarts <= 3 ? QUICK_RETRY_MS : POLL_MS);
          this.retryTimer.unref?.();
        }
      })
      .finally(() => {
        this.starting = null;
      });
    return this.starting;
  }

  private async connect(): Promise<void> {
    const unsealed = await (async () => {
      await this.store.ensureIdentity();
      return this.store.unsealIdentity();
    })();
    if (!unsealed) return;
    const jwt = await this.mint(unsealed.agentKey);
    // requireNamed: false: the platform enforces the naming rule for its own agents
    // (MESH_REQUIRE_NAMES, docs/no-anonymous-agents-plan.md item 6), not the SDK.
    // fenceInbound: false, as the evaluator, practice and transform agents do:
    // nothing here is a model, and the question is the search. With the frame
    // on, every query the catalog saw was the provenance frame's own words
    // ("sender", "no registered name") around the question, so on 2026-10-05
    // "Sam's agent (guard demo)" came back as a close match for every request.
    const mesh = await AgentMesh.connect(this.opts.wsUrl!, { requireNamed: false, connectRetry: agentConnectRetry("catalog-agent"),
      jwt,
      nkeySeed: unsealed.seed,
      fenceInbound: false,
    });
    mesh.declareFeed(CATALOG_TOPIC, "stream");
    await mesh.register({
      name: CATALOG_AGENT_NAME,
      description:
        "The mesh-native door to the catalog, and the holder of the Source stage. Ask it who can do something " +
        "(offering `search`) and it answers with the solutions and agents the catalog store holds for it, each " +
        "saying which it is, and any business processes that describe the work. Send it the steps of a plan " +
        `(offering \`${SOURCE_OFFERING}\`) and it answers each step with an agent and its offering, a solution, ` +
        "or \"build one\" with the reason, checking what each listing declares it takes and hands back. " +
        "Deterministic, with no model: the answer is only ever what the catalog holds. Its " +
        `"${CATALOG_TOPIC}" feed broadcasts newly listed agents as they arrive.`,
      capabilities: ["search", "discovery", "source"],
      interaction: "service",
      offerings: [
        {
          id: "search",
          name: "Search the catalog",
          description: "What do you need done? Answers with matching listings from the catalog.",
          input_schema: {
            type: "object",
            properties: {
              query: { type: "string", description: "what you need, in plain words" },
              limit: { type: "number", description: "how many listings (default 8, at most 20)" },
            },
            required: ["query"],
          },
          output_schema: {
            type: "object",
            properties: {
              total: { type: "number" },
              answer: { type: "string" },
              solutions: { type: "array" },
              agents: { type: "array" },
              processes: { type: "array" },
            },
          },
        },
        {
          id: SOURCE_OFFERING,
          name: "What fits these steps?",
          description:
            "Takes the steps of a plan, each with what it takes, what it hands back and what kind of work it is. " +
            "Answers every step with an agent and the offering that does it, a solution, or \"build one\" with the reason nothing listed fits.",
          input_schema: {
            type: "object",
            properties: {
              source: { type: "string", description: "v1" },
              steps: { type: "array", description: "each { id, title, does, kind, takes: [{ name, kind, required }], gives: [{ name, kind }] }, at most 20" },
              only: { type: "string", description: "agentmesh to answer only with AgentMesh's own agents and solutions" },
              exclude: { type: "array", description: "handles to leave out" },
            },
            required: ["steps"],
          },
          output_schema: {
            type: "object",
            properties: {
              result: { type: "string", description: "sourced, or refused with why" },
              format: { type: "string" },
              answers: { type: "array", description: "one per step: agent, solution or build one, with why" },
              summary: { type: "string" },
              why: { type: "string" },
            },
          },
        },
      ],
      provider: { name: "AgentMesh" },
      // Its storefront, so the listing gate lets it be listed under .platform@.
      public: storefrontOf(catalogDescriptor()),
    });
    const answer = async (input: unknown) => {
      const q = questionOf(input);
      const limit = Number((input as { limit?: number })?.limit ?? 8) || 8;
      if (!q) return { ok: false, error: "say what you need: { query: \"…\" }" };
      const found = await this.search(q, limit);
      return { ok: true, ...found };
    };
    mesh.onRequest("search", answer);
    mesh.onRequest("chat", answer);
    // Source (catalog-source.ts): never throws; a search that fails is a
    // "build one" that says so, and a request it cannot read is refused in words.
    mesh.onRequest(SOURCE_OFFERING, (input: unknown) => this.answerSource(input));
    this.mesh = mesh;
    this.started = true;
    this.failedStarts = 0;
    console.log(`[catalog-agent] registered as ${unsealed.agentKey.slice(0, 12)}… (${CATALOG_AGENT_NAME})`);
    // Its own descriptor, so it has an AgentDoc (SDLC plan A3).
    void fileOwnDescriptor(mesh, bindOwnDescriptor(catalogDescriptor(), unsealed.agentKey, unsealed.seed, CATALOG_AGENT_HANDLE), "catalog-agent");

    // The listings poller. First run on a fresh store sets the watermark
    // WITHOUT publishing — a new deployment must not broadcast the whole
    // recent page as if it just arrived. The tick doubles as the health
    // check: the minted credential expires daily, and a dead connection
    // recycles into a fresh mint-and-connect, so the agent is absent for
    // at most one poll interval rather than until the next deploy.
    await this.pollListings(true).catch(() => {});
    this.timer = setInterval(() => {
      void this.pollListings(false).catch(() => {
        void this.recycle();
      });
    }, POLL_MS);
    this.timer.unref?.();
  }

  private async recycle(): Promise<void> {
    await this.stop();
    await this.start();
  }

  private async pollListings(first: boolean): Promise<void> {
    if (!this.mesh) return;
    // A catalog blip is not a broken agent: swallow it here so only a dead
    // MESH connection (a publish that throws below) reaches the recycler.
    let listings: RecentListing[];
    try {
      const r = await fetch(`${this.opts.catalogUrl}/recent?limit=20`, { signal: AbortSignal.timeout(10_000) });
      if (!r.ok) return;
      const body = (await r.json()) as { listings?: RecentListing[] };
      if (!Array.isArray(body.listings)) return;
      listings = body.listings;
    } catch {
      return;
    }
    const seen = new Set((await this.store.watermark())?.urns ?? []);
    const fresh = listings.filter((l) => !seen.has(l.urn));
    if (!first) {
      // Oldest first, so followers read arrivals in arrival order.
      for (const l of [...fresh].reverse()) {
        this.mesh.publishFeed(CATALOG_TOPIC, {
          urn: l.urn,
          name: l.display_name,
          handle: l.handle,
          agent_id: l.agent_id,
          what_it_does: l.description,
          listed_at: l.first_seen_at,
        }, { kind: "stream" });
      }
      if (fresh.length) console.log(`[catalog-agent] broadcast ${fresh.length} new listing${fresh.length === 1 ? "" : "s"}`);
    }
    if (fresh.length || first) {
      await this.store.setWatermark({ urns: listings.map((l) => l.urn), at: new Date().toISOString() });
    }
  }

  /** Same mint as the announcer's: a durable-agent credential bound to the
   *  agent's own key, short-lived, seed never leaving the process. */
  private mint(agentKey: string): Promise<string> {
    // The core signs it with the platform's signing key, which the platform no
    // longer reads (step 10a; platform-shared/core-credentials.ts).
    return agentCredential(agentKey, "catalog");
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
