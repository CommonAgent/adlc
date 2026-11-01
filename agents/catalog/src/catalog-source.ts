/**
 * Source: the catalog agent's answer to "what fits these steps?"
 *
 * The catalog role (https://agentroles.ai/catalog.html) holds the Source stage
 * of the lifecycle (https://agenticdevelopment.ai/stages.html). It is given
 * the steps of a plan, each with what it takes, what it hands back and what
 * kind of work it is, and it answers every step with one of three things: an
 * agent and the offering that does the step, a solution, or "build one" with
 * the reason nothing listed fits. Platform services plan P7 item 5 and the
 * SDLC revision plan's B4.
 *
 * The contract, and where each part is kept here:
 *   - every step gets an answer (answerSteps maps every step, and a step whose
 *     search failed is still answered, with the failure as its reason);
 *   - "build one" is an answer, and a poor fit is never offered in its place:
 *     a listing must match the step's words closely (CLOSE_MATCH) AND declare
 *     an offering whose inputs and outputs fit the step's (fitOffering);
 *   - a fit is checked against what is declared, never against a name or a
 *     description that sounds right;
 *   - it answers only from what is listed: candidates come only from the
 *     catalog's search, and the offerings only from each one's descriptor;
 *   - it hires nothing and starts nothing (refusesToAct).
 *
 * Deterministic on purpose: no model anywhere, so idle cost is nothing and a
 * use costs a few catalog searches and descriptor reads. Everything that
 * reaches outside is handed in (SourceDeps), so the same code answers on the
 * mesh (catalog-agent.ts) and under the role's conformance check.
 */

import { isClose } from "./find-shape.js";

export const SOURCE_OFFERING = "source";
export const SOURCE_REQUEST_FORMAT = "source-steps-v1";
export const SOURCE_ANSWER_FORMAT = "source-answers-v1";

/** The limits a request is held to. Over a limit the whole request is refused with the reason; nothing is trimmed. */
export const SOURCE_LIMITS = { steps: 20, title: 200, does: 600, kind: 120, ports: 16, name: 120 } as const;

/** How many of a step's closest listings have their offerings read. */
const READ_AT_MOST = 8;
/** How many listings one search returns. */
const PAGE = 10;
/** How many steps are searched at once. */
const AT_ONCE = 4;
/** What a declared name matching the step's own adds to a fit's rank. */
const NAME_BONUS = 4;

export interface SourcePort {
  name: string;
  /** A kind as the step or the offering says it: a word (url, text, document) or a media type. */
  kind: string | null;
  required?: boolean;
}

export interface SourceStep {
  id: string;
  title: string;
  does?: string;
  /** What kind of work it is, in a few words. */
  kind?: string;
  takes: SourcePort[];
  gives: SourcePort[];
  /**
   * A step read from a process document whose handoffs say no type: what it
   * hands back is named by the document's own keys, which no listing shares,
   * so an output of no stated kind stands for it on handing back something
   * at all. Its words must still match closely and what it takes must fit.
   */
  untyped?: boolean;
}

export interface SourceRequest {
  steps: SourceStep[];
  /** "agentmesh": only AgentMesh's own agents (.platform@ and .demo@). */
  only: "agentmesh" | null;
  /** Handles the asker wants left out (itself, say). */
  exclude: string[];
}

export interface Offering {
  id: string;
  name: string;
  inputs: Array<{ name: string; kind: string | null; required: boolean }>;
  outputs: Array<{ name: string; kind: string | null }>;
}

export interface FoundAgent { kind: "agent"; handle: string | null; key: string | null; name: string; score: number }
export interface FoundSolution { kind: "solution"; id: string; name: string; page: string | null; score: number; publisher?: string | null }

export interface SourceDeps {
  /** One catalog search by words: agents and solutions, each with its relevance (0 to 100). */
  search(words: string): Promise<{ agents: FoundAgent[]; solutions: FoundSolution[] }>;
  /** The offerings an agent's descriptor declares (the registry), or null when it has none to read. */
  offerings(key: string): Promise<Offering[] | null>;
  /** What a solution takes at Start and hands back at its End, or null when that cannot be read. */
  solution(id: string): Promise<{ takes: SourcePort[]; gives: SourcePort[] } | null>;
  /** This agent's own handle, never offered as an answer. */
  self?: string;
  /** The process documents a step may be answered with (sourceProcess): each one's id, version, name and goal. */
  processes?(): Promise<ListedProcess[]>;
}

/** A process document that exists, as sourceProcess reads it: a step whose words restate its goal is that process. */
export interface ListedProcess {
  id: string;
  version: string;
  name: string;
  goal: string;
}

export type StepAnswer =
  | {
      step: string;
      answer: "agent";
      agent: { handle: string; key: string; name: string; offering: string; offering_name: string; takes: Record<string, string>; gives: Record<string, string> };
      why: string;
      relevance: number;
      considered: number;
    }
  | {
      step: string;
      answer: "solution";
      solution: { id: string; name: string; page: string | null; takes: Record<string, string>; gives: Record<string, string> };
      why: string;
      relevance: number;
      considered: number;
    }
  | { step: string; answer: "build one"; why: string; considered: number };

export type SourceOutcome =
  | { result: "sourced"; format: typeof SOURCE_ANSWER_FORMAT; answers: StepAnswer[]; summary: string }
  | { result: "refused"; why: string };

// ── kinds ───────────────────────────────────────────────────────────────────

export type KindClass = "any" | "url" | "text" | "html" | "document" | "json" | "image" | "audio" | "video" | "archive";

const DOCUMENT_TYPES = /^(document|file|application\/(pdf|msword|rtf|epub\+zip|vnd\.(openxmlformats|ms-|oasis|apple)[^\s]*))$/;

/** The class a kind falls in: a step's word or an offering's media type, read the same way. */
export function kindClass(kind: string | null | undefined): KindClass {
  const k = String(kind ?? "").split(";")[0]!.trim().toLowerCase();
  if (!k || k === "*/*" || k === "any") return "any";
  if (k === "url" || k === "text/uri-list" || k === "link" || k === "address") return "url";
  if (k === "text/html" || k === "html") return "html";
  if (k === "json" || k === "application/json" || /^application\/[a-z0-9.+-]*\+json$/.test(k)) return "json";
  if (k === "image" || k.startsWith("image/")) return "image";
  if (k === "audio" || k.startsWith("audio/")) return "audio";
  if (k === "video" || k.startsWith("video/")) return "video";
  if (k === "archive" || k === "application/zip" || k === "application/gzip" || k === "application/x-tar") return "archive";
  if (DOCUMENT_TYPES.test(k)) return "document";
  // Words in any form: plain text, markdown, a transcript, subtitles, a name, a number.
  if (["text", "identifier", "string", "number", "integer", "words"].includes(k) || k.startsWith("text/") || k === "application/x-subrip") return "text";
  return "document";
}

/**
 * Whether something of one kind can go where another is wanted. The same
 * class always can; a page (html) is words, so it may go where words are
 * taken; a web address may go where a document is taken, since a document
 * input takes the address of one. Nothing else crosses: JSON is not words
 * here, because an offering that takes JSON reads a shape.
 */
export function canGo(from: string | null | undefined, into: string | null | undefined): boolean {
  const a = kindClass(from);
  const b = kindClass(into);
  if (a === "any" || b === "any" || a === b) return true;
  if (b === "text" && a === "html") return true;
  // A "document" input takes a file of any kind, or the address of one.
  if (b === "document" && ["url", "audio", "video", "image", "archive"].includes(a)) return true;
  return false;
}

const norm = (s: string): string => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const SMALL = new Set(["the", "and", "for", "from", "with", "into", "its", "this", "that", "your", "text", "file", "data"]);
const tokens = (s: string): Set<string> => new Set(norm(s).split(" ").filter((w) => w.length >= 3 && !SMALL.has(w)));
/** Whether two declared names say the same thing: the same name, or a word of substance in common ("quiz" and "quiz page"). */
export function sameName(a: string, b: string): boolean {
  if (norm(a) === norm(b)) return true;
  const tb = tokens(b);
  return [...tokens(a)].some((w) => tb.has(w));
}
const RUN_CONTEXT = /run-context/i;

// ── the fit ─────────────────────────────────────────────────────────────────

export type Fit =
  | { ok: true; takes: Record<string, string>; gives: Record<string, string>; named: number }
  | { ok: false; why: string };

/** The same kind as written, word or media type, before any class is read into it. */
const sameKind = (a: string | null | undefined, b: string | null | undefined): boolean =>
  String(a ?? "").split(";")[0]!.trim().toLowerCase() === String(b ?? "").split(";")[0]!.trim().toLowerCase();

/** The kind in words, for a reason a person reads. */
export function kindWords(kind: string | null | undefined): string {
  switch (kindClass(kind)) {
    case "url": return "a web address";
    case "html": return "a web page";
    case "document": return "a document";
    case "json": return "structured data";
    case "image": return "an image";
    case "audio": return "a recording";
    case "video": return "a video";
    case "archive": return "a bundle of files";
    case "any": return "anything";
    default: return "text";
  }
}

/**
 * Whether one declared offering does a step: it takes what the step takes
 * (every required take has an input it can go into, and every input the
 * offering requires is filled by one of them) and hands back what the step
 * hands back (every give has an output that can stand for it). An input the
 * platform fills itself (the run context) is not the step's to give. A
 * declared name matching the step's own is preferred over a kind alone.
 */
export function fitOffering(o: Offering, step: SourceStep): Fit {
  const inputs = o.inputs.filter((i) => !RUN_CONTEXT.test(i.name) && !RUN_CONTEXT.test(i.kind ?? ""));
  const used = new Set<string>();
  const takes: Record<string, string> = {};
  let named = 0;
  for (const t of step.takes) {
    const free = inputs.filter((i) => !used.has(i.name) && canGo(t.kind, i.kind));
    const pick = free.find((i) => sameName(i.name, t.name)) ?? free.find((i) => sameKind(i.kind, t.kind)) ?? free.find((i) => kindClass(i.kind) === kindClass(t.kind)) ?? free[0];
    if (!pick) {
      if (t.required === false) continue;
      return { ok: false, why: `it does not take the ${t.name} (${kindWords(t.kind)})` };
    }
    if (sameName(pick.name, t.name)) named++;
    used.add(pick.name);
    takes[t.name] = pick.name;
  }
  const unfilled = inputs.filter((i) => i.required && !used.has(i.name));
  if (unfilled.length) {
    const i = unfilled[0]!;
    return { ok: false, why: `it needs the ${i.name} (${kindWords(i.kind)}), and this step does not provide it` };
  }
  const gives: Record<string, string> = {};
  const taken = new Set<string>();
  for (const g of step.gives) {
    const free = o.outputs.filter((x) => !taken.has(x.name) && canGo(x.kind, g.kind));
    const byName = free.find((x) => sameName(x.name, g.name));
    // Words are what almost every offering hands back, so words count as the
    // step's only when the names agree; a more particular kind (a page, a
    // recording, structured data) may stand on its kind. Dev proof,
    // 2026-10-06: "Email the quiz to the team" was answered with the quiz
    // maker, whose concept list is words.
    const loose = ["text", "any"].includes(kindClass(g.kind)) && !(step.untyped && !g.kind);
    const pick = byName ?? (loose ? undefined : free.find((x) => sameKind(x.kind, g.kind)) ?? free.find((x) => kindClass(x.kind) === kindClass(g.kind)) ?? free[0]);
    if (!pick) return { ok: false, why: `it does not produce the ${g.name} (${kindWords(g.kind)})` };
    if (byName) named++;
    taken.add(pick.name);
    gives[g.name] = pick.name;
  }
  return { ok: true, takes, gives, named };
}

// ── reading the request ─────────────────────────────────────────────────────

const ACTS = /\b(hire|hiring|engage|book|start|run|call|invoke|build|deploy|install|wire)\b/i;

/**
 * A request to act rather than to find: hire or call an agent, start or wire
 * it, start a build. The catalog does none of these; whoever asked decides.
 */
export function refusesToAct(input: unknown): string | null {
  const b = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const act = typeof b.act === "string" ? b.act : "";
  const words = typeof input === "string" ? input : typeof b.text === "string" ? b.text : "";
  const steps = Array.isArray(b.steps) || /"steps"\s*:/.test(words);
  if ((act && ACTS.test(act)) || (!steps && ACTS.test(words))) {
    return "I only look things up in the catalog. I do not hire, contact or start an agent, add one to a plan, or start a build. You decide what to do with my answers.";
  }
  return null;
}

const s = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

function readPorts(v: unknown, at: string, problems: string[], gives: boolean): SourcePort[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) { problems.push(`${at} must be a list`); return []; }
  if (v.length > SOURCE_LIMITS.ports) { problems.push(`${at} has ${v.length} entries, and a step may have at most ${SOURCE_LIMITS.ports}`); return []; }
  const out: SourcePort[] = [];
  v.forEach((p, i) => {
    const o = (p && typeof p === "object" ? p : {}) as Record<string, unknown>;
    const name = s(o.name);
    if (!name) { problems.push(`${at}[${i}] needs a name`); return; }
    if (name.length > SOURCE_LIMITS.name) { problems.push(`${at}[${i}].name is over ${SOURCE_LIMITS.name} characters`); return; }
    out.push({ name, kind: s(o.kind) || null, ...(gives ? {} : { required: o.required !== false }) });
  });
  return out;
}

/** The request in this input, or the problems with it in words. Over a limit is a problem, never trimmed. */
export function readSourceRequest(input: unknown): { ok: true; request: SourceRequest } | { ok: false; problems: string[] } {
  let body: unknown = input;
  if (typeof input === "string") body = { text: input };
  const b0 = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  // The steps may come as an object, or as its JSON in the message's words.
  let b = b0;
  if (!Array.isArray(b0.steps) && typeof b0.text === "string") {
    try {
      const parsed = JSON.parse(b0.text);
      if (parsed && typeof parsed === "object") b = parsed as Record<string, unknown>;
    } catch {
      return { ok: false, problems: [`send the steps of a plan as ${SOURCE_REQUEST_FORMAT}: { "source": "v1", "steps": [{ "id", "title", "does", "kind", "takes": [{ "name", "kind", "required" }], "gives": [{ "name", "kind" }] }] }`] };
    }
  }
  const problems: string[] = [];
  const raw = b.steps;
  if (!Array.isArray(raw) || !raw.length) return { ok: false, problems: ["there are no steps to answer"] };
  if (raw.length > SOURCE_LIMITS.steps) return { ok: false, problems: [`there are ${raw.length} steps, and one request may hold at most ${SOURCE_LIMITS.steps}; send them in parts`] };
  const steps: SourceStep[] = [];
  const ids = new Set<string>();
  raw.forEach((x, i) => {
    const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
    const at = `steps[${i}]`;
    const id = s(o.id) || `s${i + 1}`;
    if (ids.has(id)) problems.push(`${at}.id ${id} is used twice`);
    ids.add(id);
    const title = s(o.title);
    if (!title) problems.push(`${at} needs a title`);
    if (title.length > SOURCE_LIMITS.title) problems.push(`${at}.title is over ${SOURCE_LIMITS.title} characters`);
    const does = s(o.does);
    if (does.length > SOURCE_LIMITS.does) problems.push(`${at}.does is over ${SOURCE_LIMITS.does} characters`);
    const kind = s(o.kind);
    if (kind.length > SOURCE_LIMITS.kind) problems.push(`${at}.kind is over ${SOURCE_LIMITS.kind} characters`);
    const takes = readPorts(o.takes, `${at}.takes`, problems, false);
    const gives = readPorts(o.gives, `${at}.gives`, problems, true);
    steps.push({ id, title, ...(does ? { does } : {}), ...(kind ? { kind } : {}), takes, gives });
  });
  if (problems.length) return { ok: false, problems };
  const exclude = (Array.isArray(b.exclude) ? b.exclude : []).filter((h): h is string => typeof h === "string").map((h) => h.trim().toLowerCase()).filter(Boolean);
  return { ok: true, request: { steps, only: b.only === "agentmesh" ? "agentmesh" : null, exclude } };
}

/** AgentMesh's own agents: .platform@ and .demo@ (the Build page plans only these). */
export const isAgentMeshHandle = (h: string | null | undefined): boolean =>
  typeof h === "string" && /^[a-z0-9][a-z0-9-]*\.(platform|demo)@agentmesh\.ai$/.test(h.trim().toLowerCase());

// ── answering ───────────────────────────────────────────────────────────────

const list = (xs: string[]): string => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const lowerFirst = (x: string): string => (x ? x[0]!.toLowerCase() + x.slice(1) : x);

function foundWhy(name: string, offeringName: string, step: SourceStep, takes: Record<string, string>, gives: Record<string, string>): string {
  const t = Object.keys(takes);
  const g = Object.keys(gives);
  const parts = [t.length ? `takes the ${list(t)}` : "", g.length ? `hands back the ${list(g)}` : ""].filter(Boolean);
  return `${name} does this with "${offeringName}", which ${parts.length ? parts.join(" and ") : `does ${lowerFirst(step.title)}`}.`;
}

function solutionWhy(name: string, takes: Record<string, string>, gives: Record<string, string>): string {
  const t = Object.keys(takes);
  const g = Object.keys(gives);
  const parts = [t.length ? `takes the ${list(t)}` : "", g.length ? `hands back the ${list(g)}` : ""].filter(Boolean);
  return `${name}, a solution in the catalog, does this whole step.${parts.length ? ` It ${parts.join(" and ")}.` : ""}`;
}

/** Answer one step. Never throws: a failed search is a "build one" that says the catalog could not be searched. */
export async function answerStep(step: SourceStep, req: SourceRequest, deps: SourceDeps): Promise<StepAnswer> {
  if (!step.takes.length && !step.gives.length) {
    return { step: step.id, answer: "build one", why: "This step does not say what goes into it or what comes out of it, so nothing listed can be checked against it. Change the plan to say what goes in and comes out, or build a new agent for it.", considered: 0 };
  }
  const words = [step.title, step.kind].filter(Boolean).join(". ");
  const longer = [step.title, step.does, step.kind].filter(Boolean).join(". ");
  let agents: FoundAgent[] = [];
  let solutions: FoundSolution[] = [];
  try {
    // Two searches, the title and the title with what it does, each listing
    // kept at its better relevance: the catalog's ranking dilutes a long query.
    const runs = await Promise.all([deps.search(words), ...(longer !== words ? [deps.search(longer)] : [])]);
    const best = new Map<string, FoundAgent | FoundSolution>();
    for (const r of runs) {
      for (const x of [...r.agents, ...r.solutions]) {
        const k = x.kind === "agent" ? `a:${x.key ?? x.handle}` : `s:${x.id}`;
        const was = best.get(k);
        if (!was || x.score > was.score) best.set(k, x);
      }
    }
    agents = [...best.values()].filter((x): x is FoundAgent => x.kind === "agent");
    solutions = [...best.values()].filter((x): x is FoundSolution => x.kind === "solution");
  } catch (err) {
    return { step: step.id, answer: "build one", why: `The catalog could not be searched, so nothing listed was checked for this step. Make the plan again in a minute. The catalog said: ${(err as Error).message}.`, considered: 0 };
  }
  const self = (deps.self ?? "").toLowerCase();
  agents = agents.filter((a) => {
    const h = (a.handle ?? "").toLowerCase();
    if (!a.key || !h) return false;
    if (h === self || req.exclude.includes(h)) return false;
    return req.only === "agentmesh" ? isAgentMeshHandle(h) : true;
  });
  // A solution is AgentMesh's when the catalog lists it under AgentMesh as its publisher.
  if (req.only === "agentmesh") solutions = solutions.filter((x) => (x.publisher ?? "").trim().toLowerCase() === "agentmesh");
  const considered = agents.length + solutions.length;
  const close = agents.filter((a) => isClose(a.score)).sort((x, y) => y.score - x.score).slice(0, READ_AT_MOST); // cut-ok: the closest eight are read; the rest are counted in considered and named in no answer
  const misses: Array<{ name: string; why: string }> = [];
  let best: { a: FoundAgent; o: Offering; fit: Extract<Fit, { ok: true }>; rank: number } | null = null;
  for (const a of close) {
    const offerings = await deps.offerings(a.key!).catch(() => null);
    if (!offerings?.length) { misses.push({ name: a.name, why: "its listing does not say what it takes and hands back, so it could not be checked" }); continue; }
    let firstMiss: string | null = null;
    for (const o of offerings) {
      const fit = fitOffering(o, step);
      if (!fit.ok) { firstMiss ??= fit.why; continue; }
      const rank = a.score + NAME_BONUS * fit.named;
      if (!best || rank > best.rank) best = { a, o, fit, rank };
    }
    if (firstMiss && !(best && best.a === a)) misses.push({ name: a.name, why: firstMiss });
  }
  if (best) {
    return {
      step: step.id,
      answer: "agent",
      agent: { handle: best.a.handle!, key: best.a.key!, name: best.a.name, offering: best.o.id, offering_name: best.o.name || best.o.id, takes: best.fit.takes, gives: best.fit.gives },
      why: foundWhy(best.a.name, best.o.name || best.o.id, step, best.fit.takes, best.fit.gives),
      relevance: best.a.score,
      considered,
    };
  }
  for (const sol of solutions.filter((x) => isClose(x.score)).sort((x, y) => y.score - x.score)) {
    const shape = await deps.solution(sol.id).catch(() => null);
    if (!shape) { misses.push({ name: sol.name, why: "what it takes and hands back could not be read" }); continue; }
    const fit = fitOffering({ id: sol.id, name: sol.name, inputs: shape.takes.map((t) => ({ name: t.name, kind: t.kind, required: t.required === true })), outputs: shape.gives }, step);
    if (!fit.ok) { misses.push({ name: sol.name, why: fit.why }); continue; }
    return {
      step: step.id,
      answer: "solution",
      solution: { id: sol.id, name: sol.name, page: sol.page, takes: fit.takes, gives: fit.gives },
      why: solutionWhy(sol.name, fit.takes, fit.gives),
      relevance: sol.score,
      considered,
    };
  }
  return { step: step.id, answer: "build one", why: buildOneWhy(misses, agents, solutions), considered };
}

/** Why nothing listed fits, naming the nearest listings and what each lacks. */
export function buildOneWhy(misses: Array<{ name: string; why: string }>, agents: FoundAgent[], solutions: FoundSolution[]): string {
  if (misses.length) {
    const shown = misses.slice(0, 2).map((m) => `${m.name} sounds right for this step, but ${m.why}`); // cut-ok: the two closest misses are named; the rest are counted in considered
    return `Nothing listed fits this step, so a new agent needs to be built. ${shown.join(". ")}.`;
  }
  const nearest = [...agents, ...solutions].sort((x, y) => y.score - x.score)[0];
  if (nearest) return `Nothing listed does this, so a new agent needs to be built. The closest listing, ${nearest.name}, is only a loose match.`;
  return "Nothing listed does this, so a new agent needs to be built.";
}

/** Answer every step of a request, a few at a time, in the order given. */
export async function answerSteps(req: SourceRequest, deps: SourceDeps): Promise<StepAnswer[]> {
  const out: StepAnswer[] = new Array(req.steps.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < req.steps.length) {
      const i = next++;
      out[i] = await answerStep(req.steps[i]!, req, deps);
    }
  };
  await Promise.all(Array.from({ length: Math.min(AT_ONCE, req.steps.length) }, worker));
  return out;
}

/** One sentence over the answers. */
export function summaryOf(answers: StepAnswer[]): string {
  const n = (k: number, one: string, many: string): string => `${k} ${k === 1 ? one : many}`;
  const a = answers.filter((x) => x.answer === "agent").length;
  const sol = answers.filter((x) => x.answer === "solution").length;
  const b = answers.filter((x) => x.answer === "build one").length;
  const parts = [a ? `${n(a, "step has an agent", "steps have an agent")} in the catalog` : "", sol ? `${n(sol, "step has a solution", "steps have a solution")}` : "", b ? `${n(b, "step needs", "steps need")} a new agent built` : ""].filter(Boolean);
  return `Of ${n(answers.length, "step", "steps")}, ${list(parts)}.`;
}

/** The whole exchange: a refusal to act, a request that cannot be read, or every step answered. */
export async function source(input: unknown, deps: SourceDeps): Promise<SourceOutcome | ProcessSourceOutcome> {
  // A process document is answered step by step (sourceProcess). Its words
  // name acts (run, build, install), so it is read before them; a request
  // that says to act is still refused there.
  if (processTextOf(input) !== null) return sourceProcess(input, deps);
  const act = refusesToAct(input);
  if (act) return { result: "refused", why: act };
  const read = readSourceRequest(input);
  if (!read.ok) return { result: "refused", why: `I cannot answer this request: ${read.problems.join("; ")}.` };
  const answers = await answerSteps(read.request, deps);
  return { result: "sourced", format: SOURCE_ANSWER_FORMAT, answers, summary: summaryOf(answers) };
}

/** An offering list from a descriptor (or a registered manifest), as the fit reads it. */
export function offeringsOfDescriptor(descriptor: unknown): Offering[] {
  const d = descriptor as { offerings?: unknown } | null;
  const out: Offering[] = [];
  for (const o of Array.isArray(d?.offerings) ? (d!.offerings as Array<Record<string, unknown>>) : []) {
    if (!o || typeof o.id !== "string") continue;
    const kindOf = (p: Record<string, unknown>): string | null =>
      typeof p.media_type === "string" ? p.media_type : typeof p.kind === "string" ? p.kind : null;
    const ports = (v: unknown): Array<Record<string, unknown>> => (Array.isArray(v) ? (v as Array<Record<string, unknown>>) : []).filter((p) => p && typeof p.name === "string");
    out.push({
      id: o.id,
      name: typeof o.name === "string" ? o.name : o.id,
      inputs: ports(o.inputs).map((p) => ({ name: p.name as string, kind: kindOf(p), required: p.required === true })),
      outputs: ports(o.outputs).map((p) => ({ name: p.name as string, kind: kindOf(p) })),
    });
  }
  return out;
}

// ── a process document (the ADLC builds processes: find-the-holders) ────────

export const SOURCE_PROCESS_ANSWER_FORMAT = "source-process-answers-v1";

/** One step of a process document, as Source answers it: a phase an agent or a process does. */
export interface ProcessStep extends SourceStep {
  /** The job the phase says it runs (`runs <offering>`), when it names one. */
  offering?: string;
  owner: string;
  /** The process a `runs process <id> v<n>` phase already runs. */
  runsProcess?: { id: string; version: string };
}

export type ProcessStepAnswer =
  | Extract<StepAnswer, { answer: "agent" }>
  | { step: string; answer: "process"; process: { id: string; version: string; name: string }; phase_line: string; why: string; considered: number }
  | { step: string; answer: "build one"; why: string; takes: string[]; gives: string[]; considered: number };

export type ProcessSourceOutcome =
  | {
      result: "sourced";
      format: typeof SOURCE_PROCESS_ANSWER_FORMAT;
      process: { id: string; version: string };
      answers: ProcessStepAnswer[];
      /** The phases a person holds, as the document names them; nothing to source. */
      people: Array<{ step: string; owner: string }>;
      /** Each phase's holder: an agent's handle, a process's id and version, or the person. */
      roster: Record<string, string>;
      /** The document with its roster: line filled from the answers. */
      document: string;
      summary: string;
    }
  | { result: "refused"; why: string };

/** The process document a request carries, or null when it carries none. */
export function processTextOf(input: unknown): string | null {
  const b = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const t = typeof input === "string" ? input : typeof b.process === "string" ? b.process : typeof b.text === "string" ? b.text : "";
  return /^\s*PROCESS:/m.test(t) ? t : null;
}

const PHASE_KEYS = ["owner", "after", "by", "not-before", "automation", "under", "every", "until"];
const ws = (x: string): string => x.replace(/\s+/g, " ").trim();

/** The document out of what was read: a Markdown page's fenced block that opens with PROCESS:, or the text as it is. */
function processDocumentText(text: string): string {
  const t = String(text ?? "").replace(/\r\n?/g, "\n");
  if (!/^```/m.test(t)) return t;
  for (const m of t.matchAll(/^```[^\n]*\n([\s\S]*?)^```/gm)) if (/^\s*PROCESS:/.test(m[1]!)) return m[1]!;
  return t;
}

/** The lines of one top-level part (`<key>:` at column 0), its own line first. */
function partOf(lines: string[], key: string): string[] {
  const at = lines.findIndex((l) => l.startsWith(`${key}:`));
  if (at < 0) return [];
  const out = [lines[at]!];
  for (let i = at + 1; i < lines.length && !/^\S/.test(lines[i]!); i++) out.push(lines[i]!);
  return out;
}

/** Entries by indent: a line at the shallowest indent opens one, deeper lines continue it. */
function entriesOf(lines: string[]): string[][] {
  const body = lines.filter((l) => l.trim());
  if (!body.length) return [];
  const base = Math.min(...body.map((l) => l.length - l.trimStart().length));
  const out: string[][] = [];
  for (const l of body) {
    if (l.length - l.trimStart().length === base || !out.length) out.push([l]);
    else out[out.length - 1]!.push(l);
  }
  return out;
}

/** The items the trigger carries (§5.4): name, what it is, whether required. */
export function carriedItems(text: string): Array<{ name: string; what: string; required: boolean }> {
  const lines = partOf(processDocumentText(text).split("\n"), "trigger").slice(1);
  const items: Array<{ name: string; what: string; required: boolean }> = [];
  let open: { indent: number; parts: string[] } | null = null;
  const close = (): void => {
    if (open) {
      const m = /^(\S+)\s+-\s+(.*?)(?:,\s*(required|optional))?\s*$/.exec(ws(open.parts.join(" ")));
      if (m) items.push({ name: m[1]!, what: m[2]!, required: m[3] === "required" });
    }
    open = null;
  };
  for (const l of lines) {
    const indent = l.length - l.trimStart().length;
    const t = l.trim();
    if (/^carries:/.test(t)) { close(); open = { indent, parts: [t.replace(/^carries:\s*/, "")] }; continue; }
    if (open && indent > open.indent && t) { open.parts.push(t); continue; }
    close();
  }
  close();
  return items;
}

/**
 * The steps of a process document Source answers: every phase but a
 * person's (`human:`), each with what it takes (the handoffs into it, and
 * the trigger's items when it comes after the trigger) and what it hands
 * back (the handoffs out of it), by the document's own keys.
 */
export function readProcessSteps(text: string): { ok: true; id: string; version: string; steps: ProcessStep[]; people: Array<{ step: string; owner: string }>; order: string[] } | { ok: false; problems: string[] } {
  const lines = processDocumentText(text).split("\n");
  const head = lines.slice(0, Math.max(1, lines.findIndex((l) => /^phases:/.test(l)))).join(" ");
  const idm = /(?:^|\s)id:\s*(\S+)\s+(v\d+)\b/.exec(head);
  const problems: string[] = [];
  if (!idm) problems.push("the document names no id and version (id: <team>/<slug> v<n>)");
  const handoffs: Array<{ from: string; to: string[]; key: string | null }> = [];
  for (const e of entriesOf(partOf(lines, "handoffs").slice(1))) {
    const m = /^(.+?)\s+->\s+(.+?)\s*(?:\[([^\]]*)\])?\s*:/.exec(ws(e.join(" ")));
    if (m) handoffs.push({ from: ws(m[1]!), to: m[2]!.split(/\s*\/\s*/).map(ws).filter(Boolean), key: m[3] ? ws(m[3]) : null });
  }
  const items = carriedItems(text);
  const steps: ProcessStep[] = [];
  const people: Array<{ step: string; owner: string }> = [];
  const order: string[] = [];
  for (const e of entriesOf(partOf(lines, "phases").slice(1))) {
    const m = /^\s*(\S+)\s+-\s+(.*)$/.exec(e[0]!);
    if (!m) continue;
    const name = m[1]!;
    order.push(name);
    const whole = ws([m[2]!, ...e.slice(1)].join(" "));
    const re = new RegExp(`(?:^|\\s)(${PHASE_KEYS.join("|")}):(?=\\s|$)`, "g");
    const found = [...whole.matchAll(re)];
    const what = ws(found.length ? whole.slice(0, found[0]!.index) : whole);
    const val = (k: string): string => {
      const i = found.findIndex((f) => f[1] === k);
      return i < 0 ? "" : ws(whole.slice(found[i]!.index! + found[i]![0].length, found[i + 1]?.index));
    };
    const owner = val("owner");
    if (/^human:/.test(what)) { people.push({ step: name, owner }); continue; }
    const words = what.replace(/^(harness|system|human):\s*/, "").replace(/^runs\s+process\s+\S+\s+v\d+\s*:\s*/, "").replace(/^(runs\s+\S+|convenes\s+\S+)\s*:\s*/, "");
    const proc = /^runs\s+process\s+(\S+)\s+(v\d+)/.exec(what);
    const offering = proc ? undefined : /^runs\s+([a-z0-9][a-z0-9.-]*)\s*:/.exec(what)?.[1];
    const after = val("after").split(/\s*\+\s*/).map((a) => a.replace(/\?$/, ""));
    const takes: SourcePort[] = handoffs.filter((h) => h.to.includes(name)).map((h) => ({ name: h.key ?? `${h.from}-to-${name}`, kind: null, required: true }));
    if (after.includes("trigger")) for (const i of items) takes.push({ name: i.name, kind: null, required: i.required });
    const gives: SourcePort[] = handoffs.filter((h) => h.from === name && h.key).map((h) => ({ name: h.key!, kind: null }));
    steps.push({
      id: name,
      title: words.slice(0, SOURCE_LIMITS.title),
      does: words.slice(0, SOURCE_LIMITS.does),
      kind: owner.slice(0, SOURCE_LIMITS.kind),
      takes: takes.slice(0, SOURCE_LIMITS.ports),
      gives: gives.slice(0, SOURCE_LIMITS.ports),
      untyped: true,
      owner,
      ...(offering ? { offering } : {}),
      ...(proc ? { runsProcess: { id: proc[1]!, version: proc[2]! } } : {}),
    });
  }
  if (!order.length) problems.push("the document has no phases");
  if (steps.length > SOURCE_LIMITS.steps) problems.push(`the document has ${steps.length} steps an agent does, and one request may hold at most ${SOURCE_LIMITS.steps}`);
  if (problems.length) return { ok: false, problems };
  return { ok: true, id: idm![1]!, version: idm![2]!, steps, people, order };
}

const MORE_SMALL = new Set(["was", "were", "are", "has", "have", "been", "not", "did", "does", "who", "whose", "which", "what", "when", "each", "every", "one", "them", "they", "their", "than", "then", "there", "where", "once", "only", "also"]);
const goalWords = (s: string): Set<string> => new Set([...tokens(s)].filter((w) => !MORE_SMALL.has(w)));

/** A process whose goal the step's words restate: at least four words of substance, and most of the step's. */
export function processFor(step: ProcessStep, processes: ListedProcess[], selfId: string): ListedProcess | null {
  const said = goalWords(`${step.title} ${step.does ?? ""}`);
  let best: { p: ListedProcess; share: number } | null = null;
  for (const p of processes) {
    if (p.id === selfId) continue;
    const goal = goalWords(`${p.name} ${p.goal}`);
    const shared = [...said].filter((w) => goal.has(w)).length;
    const share = said.size ? shared / said.size : 0;
    if (shared >= 4 && share >= 0.6 && (!best || share > best.share)) best = { p, share };
  }
  return best?.p ?? null;
}

/** Answer one step of a process document. Never throws. */
export async function answerProcessStep(step: ProcessStep, req: SourceRequest, deps: SourceDeps, processes: ListedProcess[], selfId: string): Promise<ProcessStepAnswer> {
  const names = (ps: SourcePort[]): string[] => ps.map((p) => p.name);
  const buildOne = (why: string, considered: number): ProcessStepAnswer => ({ step: step.id, answer: "build one", why, takes: names(step.takes), gives: names(step.gives), considered });
  const asProcess = (p: ListedProcess, why: string): ProcessStepAnswer => ({ step: step.id, answer: "process", process: { id: p.id, version: p.version, name: p.name }, phase_line: `runs process ${p.id} ${p.version}`, why, considered: processes.length });
  if (step.runsProcess) {
    const p = processes.find((x) => x.id === step.runsProcess!.id && x.version === step.runsProcess!.version);
    return p ? asProcess(p, `The step already runs ${p.id} ${p.version}, "${p.name}", which exists.`) : buildOne(`The step runs ${step.runsProcess.id} ${step.runsProcess.version}, and no such process is listed, so it cannot run until that process exists.`, processes.length);
  }
  // The job the phase says it runs: an agent that declares exactly that offering does it.
  if (step.offering) {
    const self = (deps.self ?? "").toLowerCase();
    const seen = new Map<string, FoundAgent>();
    try {
      const runs = await Promise.all([deps.search([step.offering.replace(/[-_.]+/g, " "), step.kind].filter(Boolean).join(". ")), deps.search(step.title)]);
      for (const r of runs) for (const a of r.agents) { const k = a.key ?? a.handle ?? ""; const was = seen.get(k); if (k && (!was || a.score > was.score)) seen.set(k, a); }
    } catch { /* read as nothing found; the general answer below says the catalog could not be searched */ }
    const agents = [...seen.values()].filter((a) => {
      const h = (a.handle ?? "").toLowerCase();
      if (!a.key || !h || h === self || req.exclude.includes(h)) return false;
      return req.only === "agentmesh" ? isAgentMeshHandle(h) : true;
    }).sort((x, y) => y.score - x.score).slice(0, READ_AT_MOST); // cut-ok: the closest eight are read, as for any step
    for (const a of agents) {
      const offerings = await deps.offerings(a.key!).catch(() => null);
      const o = offerings?.find((x) => x.id === step.offering);
      if (!o) continue;
      const fit = fitOffering(o, { ...step, gives: [] });
      if (!fit.ok) continue;
      const t = Object.keys(fit.takes);
      return {
        step: step.id,
        answer: "agent",
        agent: { handle: a.handle!, key: a.key!, name: a.name, offering: o.id, offering_name: o.name || o.id, takes: fit.takes, gives: {} },
        why: `${a.name} declares ${o.id}, the job this step runs${t.length ? `, and takes the ${list(t)}` : ""}.`,
        relevance: a.score,
        considered: agents.length,
      };
    }
  }
  const listed = processFor(step, processes, selfId);
  if (listed) return asProcess(listed, `The process ${listed.id} ${listed.version}, "${listed.name}", does this whole step: its goal is what this step says it makes.`);
  // Otherwise the step's words and what it takes, against what each listing declares; solutions are drawings, not processes with an id.
  const general = await answerStep(step, req, { ...deps, search: async (w) => ({ ...(await deps.search(w)), solutions: [] }) });
  if (general.answer === "agent") return general;
  return buildOne(general.why, general.considered);
}

/**
 * The document with its `roster:` binding replaced by `roster` (a bindings
 * block is made when there is none). Every other line is left as it was.
 */
export function bindRoster(text: string, roster: string): string {
  const lines = String(text).replace(/\r\n?/g, "\n").split("\n");
  const rosterLines: string[] = [];
  let line = "  roster:";
  // Wrapped between words, a blank <...> kept whole.
  for (const w of roster.match(/<[^>]*>|\S+/g) ?? []) {
    if (`${line} ${w}`.length > 76 && line !== "  roster:") { rosterLines.push(line); line = `      ${w}`; }
    else line = `${line} ${w}`;
  }
  rosterLines.push(line);
  const b = lines.findIndex((l) => /^bindings:/.test(l));
  if (b < 0) {
    const before = lines.findIndex((l) => /^(policy|measures|records|amendments|extensions):/.test(l));
    lines.splice(before < 0 ? lines.length : before, 0, "bindings:", ...rosterLines, "  systems: none of the phases reaches a system of its own", "  data: what the trigger carries", "");
    return lines.join("\n");
  }
  let end = b + 1;
  while (end < lines.length && !/^\S/.test(lines[end]!)) end++;
  const r = lines.findIndex((l, i) => i > b && i < end && /^\s+roster:/.test(l));
  if (r < 0) { lines.splice(b + 1, 0, ...rosterLines); return lines.join("\n"); }
  const indent = lines[r]!.length - lines[r]!.trimStart().length;
  let stop = r + 1;
  while (stop < end && lines[stop]!.trim() && lines[stop]!.length - lines[stop]!.trimStart().length > indent) stop++;
  lines.splice(r, stop - r, ...rosterLines);
  return lines.join("\n");
}

/** One sentence over a process's answers. */
export function processSummaryOf(answers: ProcessStepAnswer[]): string {
  const n = (k: number, one: string, many: string): string => `${k} ${k === 1 ? one : many}`;
  const a = answers.filter((x) => x.answer === "agent").length;
  const p = answers.filter((x) => x.answer === "process").length;
  const b = answers.filter((x) => x.answer === "build one").length;
  const parts = [a ? `${n(a, "step has an agent", "steps have an agent")} in the catalog` : "", p ? `${n(p, "step is a process", "steps are processes")} that exist${p === 1 ? "s" : ""}` : "", b ? `${n(b, "step needs", "steps need")} a new agent built` : ""].filter(Boolean);
  return answers.length ? `Of ${n(answers.length, "step", "steps")}, ${list(parts)}.` : "Every step of this process is a person's, so there is nothing to find.";
}

/**
 * Every step of a process document answered with an agent and its offering,
 * a process (the step becomes `runs process <id> v<n>`), or build one with
 * the reason; the people's phases named as the document names them; and the
 * roster filled from the answers. It hires nothing and starts nothing.
 */
export async function sourceProcess(input: unknown, deps: SourceDeps): Promise<ProcessSourceOutcome> {
  const b = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  if (typeof b.act === "string" && ACTS.test(b.act)) return { result: "refused", why: refusesToAct({ act: b.act }) ?? "I only look things up in the catalog." };
  const text = processTextOf(input);
  if (text === null) return { result: "refused", why: "I cannot answer this request: send the process document as process, the whole Agent Processes text." };
  const read = readProcessSteps(text);
  if (!read.ok) return { result: "refused", why: `I cannot answer this process: ${read.problems.join("; ")}.` };
  const exclude = (Array.isArray(b.exclude) ? b.exclude : []).filter((h): h is string => typeof h === "string").map((h) => h.trim().toLowerCase()).filter(Boolean);
  const req: SourceRequest = { steps: read.steps, only: b.only === "agentmesh" ? "agentmesh" : null, exclude };
  const processes = deps.processes ? await deps.processes().catch(() => []) : [];
  const answers: ProcessStepAnswer[] = new Array(read.steps.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < read.steps.length) {
      const i = next++;
      answers[i] = await answerProcessStep(read.steps[i]!, req, deps, processes, read.id);
    }
  };
  await Promise.all(Array.from({ length: Math.min(AT_ONCE, read.steps.length) }, worker));
  const roster: Record<string, string> = {};
  const line: string[] = [];
  for (const phase of read.order) {
    const person = read.people.find((p) => p.step === phase);
    const a = answers.find((x) => x.step === phase);
    const holder = person ? (/\(person\)/i.test(person.owner) ? person.owner : `${person.owner} (person)`)
      : a?.answer === "agent" ? a.agent.handle
      : a?.answer === "process" ? `${a.process.id} ${a.process.version}` : null;
    if (holder) roster[phase] = holder;
    line.push(`${phase}: ${holder ?? "<build one>"}`);
  }
  return {
    result: "sourced",
    format: SOURCE_PROCESS_ANSWER_FORMAT,
    process: { id: read.id, version: read.version },
    answers,
    people: read.people,
    roster,
    document: bindRoster(processDocumentText(text), line.join(", ")),
    summary: processSummaryOf(answers),
  };
}
