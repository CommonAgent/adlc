/**
 * How the front doors that answer "find me something that does this" word
 * the catalog's answer: the hosted MCP connector's find_agent here, the
 * adapter's find_agent in mesh-adapter.mjs (the same words, kept in step by
 * services/__tests__/unit/find-shape.test.ts reading both).
 *
 * Three lists, each result saying what it is (2026-10-05):
 *  - solutions: several agents wired together that do a whole job. A person
 *    starts one in the app (Use this, then the Start form); the answer says
 *    so, because no MCP tool starts a solution and a model left to guess
 *    would offer to.
 *  - agents: single agents (or the MCP servers, skills and plugins the
 *    catalog also lists), reached by sending it a message.
 *  - processes: business processes, which are abstract descriptions of how
 *    work is done. Nothing runs one as such, it is never offered as
 *    something to start, and it is never a stand-in for a solution.
 */

export interface CatalogSolution {
  id?: string;
  name?: string;
  does?: string;
  publisher?: string | null;
  made_of?: { agents?: string[]; steps?: Array<{ name?: string }> };
  asks_for?: Array<{ name?: string; label?: string; required?: boolean }>;
  variations?: string[];
  url?: string;
  score?: number;
}

export interface CatalogProcess {
  name?: string;
  department?: string;
  description?: string;
  url?: string;
  score?: number;
}

export const PROCESS_NOTE =
  "An abstract description of how this work is done, not something that runs. It cannot be started. No solution in the catalog says it implements this process.";

export function shapeSolution(s: CatalogSolution): Record<string, unknown> {
  const asks = (s.asks_for ?? []).map((f) => (f.required ? `${f.label ?? f.name} (required)` : `${f.label ?? f.name}`));
  return {
    kind: "solution",
    name: s.name,
    what_it_does: s.does,
    ...(s.publisher ? { from: s.publisher } : {}),
    made_of: {
      agents: s.made_of?.agents ?? [],
      steps: (s.made_of?.steps ?? []).map((x) => x.name),
    },
    ...(asks.length ? { you_give_it: asks } : {}),
    ...(s.variations?.length ? { ready_variations: s.variations } : {}),
    page: s.url,
    how_to_use: `Open ${s.url} and press Use this to add it to your organization, then start a run from its Start form${asks.length ? ` (it asks for ${asks.join(", ")})` : ""}. This tool cannot start it for you.`,
    relevance: s.score,
    match: matchWord(s.score),
  };
}

export function shapeProcess(p: CatalogProcess, catalogBase: string): Record<string, unknown> {
  return {
    kind: "business process (abstract)",
    name: p.name,
    ...(p.department ? { department: p.department } : {}),
    what_it_describes: p.description,
    page: /^https?:/.test(p.url ?? "") ? p.url : `${catalogBase}${p.url ?? ""}`,
    note: PROCESS_NOTE,
    relevance: p.score,
  };
}

/** The one line a find answer leads with. */
/** `solutions` and `agents` are the relevances of what came back; `processes` a count. */
export function findAnswerLine(solutions: Array<number | undefined>, agents: Array<number | undefined>, processes: number): string {
  const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
  const closeS = solutions.filter(isClose).length, closeA = agents.filter(isClose).length;
  const procLine = processes
    ? `${n(processes, "abstract business process is", "abstract business processes are")} listed for reference only; nothing runs ${processes === 1 ? "it" : "them"}.`
    : "";
  if (!closeS && !closeA) {
    const loose = solutions.length + agents.length;
    return [
      "Nothing in the catalog clearly does this.",
      loose ? `${n(loose, "listing below matches", "listings below match")} only loosely; check one before relying on it.` : "",
      procLine,
    ].filter(Boolean).join(" ");
  }
  return [
    closeS ? `${n(closeS, "solution matches", "solutions match")} closely (a solution does the whole job and is started by a person in the app).` : "No solution matches closely.",
    closeA ? `${n(closeA, "listing matches", "listings match")} closely under agents (an agent does one part; send it a message).` : "",
    procLine,
  ].filter(Boolean).join(" ");
}

/** A relevance at or above this is a close match; below it, loose. The
 *  catalog keeps nothing under 50 (search.ts MIN_MATCH), so loose is 50-59:
 *  an embedder that calls it related, or a minority of the request's words. */
export const CLOSE_MATCH = 60;
export const isClose = (relevance: number | undefined | null): boolean => (relevance ?? 0) >= CLOSE_MATCH;
export const matchWord = (relevance: number | undefined | null): "close" | "loose" => (isClose(relevance) ? "close" : "loose");

/** The catalog request a find door sends: solutions and processes as well as
 *  agents, unless the caller narrowed by a declaration only agents make
 *  (every such filter fails closed, so solutions would all drop out). */
export function findRequest(query: string, limit: number, filter?: Record<string, string[]>): Record<string, unknown> {
  const narrowed = !!filter && Object.keys(filter).length > 0;
  return {
    query: { text: query, ...(narrowed ? { filter } : {}) },
    pageSize: limit,
    ...(narrowed ? {} : { include: ["offerings", "solutions", "reference"], referenceKind: "process" }),
  };
}
