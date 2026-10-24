/**
 * Source (api/catalog-source.ts): the catalog agent answers every step of a
 * plan with an agent, a solution, or "build one", by what each listing
 * declares. The cases are the catalog role's conformance cases
 * (https://agentroles.ai/catalog.html, section 4), plus the limits and the
 * kinds.
 */
import { describe, expect, it } from "vitest";
import {
  answerStep,
  canGo,
  fitOffering,
  kindClass,
  readSourceRequest,
  refusesToAct,
  source,
  SOURCE_LIMITS,
  type FoundAgent,
  type FoundSolution,
  type Offering,
  type SourceDeps,
} from "../src/catalog-source.js";

const AGENTS: Record<string, { found: FoundAgent; words: RegExp; offerings: Offering[] }> = {
  transcriber: {
    found: { kind: "agent", handle: "transcriber.platform@agentmesh.ai", key: "KTRANS", name: "Transcriber", score: 0 },
    words: /transcri/i,
    offerings: [{ id: "transcribe", name: "Transcribe", inputs: [{ name: "address", kind: "url", required: true }], outputs: [{ name: "transcript", kind: "text/vtt" }] }],
  },
  quiz: {
    found: { kind: "agent", handle: "quiz-maker.platform@agentmesh.ai", key: "KQUIZ", name: "Quiz maker", score: 0 },
    words: /quiz/i,
    offerings: [{ id: "make-a-quiz", name: "Make a quiz", inputs: [{ name: "notes", kind: "text", required: false }, { name: "run-context", kind: "application/vnd.agentmesh.run-context+json", required: true }], outputs: [{ name: "quiz page", kind: "text/html" }] }],
  },
  // Sounds right for the mail step, and takes an address list as JSON rather than words.
  mailer: {
    found: { kind: "agent", handle: "mailer.platform@agentmesh.ai", key: "KMAIL", name: "Mailer", score: 0 },
    words: /mail/i,
    offerings: [{ id: "send", name: "Send", inputs: [{ name: "recipients", kind: "application/json", required: true }], outputs: [{ name: "receipt", kind: "application/json" }] }],
  },
  outsider: {
    found: { kind: "agent", handle: "transcriber.someone@example.com", key: "KOUT", name: "Someone's transcriber", score: 0 },
    words: /transcri/i,
    offerings: [{ id: "t", name: "T", inputs: [{ name: "address", kind: "url", required: true }], outputs: [{ name: "transcript", kind: "text" }] }],
  },
};
const SOLUTION: FoundSolution = { kind: "solution", id: "sol_deck", name: "Video from a slide deck", page: "https://catalog.example/s/sol_deck", score: 0, publisher: "AgentMesh" };

function deps(over: Partial<SourceDeps> = {}): SourceDeps & { searches: string[] } {
  const searches: string[] = [];
  return {
    searches,
    self: "catalog.platform@agentmesh.ai",
    search: async (words) => {
      searches.push(words);
      const agents = Object.values(AGENTS).map((a) => ({ ...a.found, score: a.words.test(words) ? 88 : 42 }));
      const solutions = [{ ...SOLUTION, score: /deck/i.test(words) ? 90 : 40 }];
      return { agents, solutions };
    },
    offerings: async (key) => Object.values(AGENTS).find((a) => a.found.key === key)?.offerings ?? null,
    solution: async (id) => (id === "sol_deck" ? { takes: [{ name: "pptx deck", kind: "application/vnd.openxmlformats-officedocument.presentationml.presentation", required: false }], gives: [{ name: "video", kind: "video/mp4" }] } : null),
    ...over,
  };
}

const STEPS = [
  { id: "s1", title: "Transcribe the podcast episode", kind: "transcription", takes: [{ name: "episode address", kind: "url" }], gives: [{ name: "transcript", kind: "text" }] },
  { id: "s2", title: "Turn the slide deck into a video", takes: [{ name: "deck", kind: "document" }], gives: [{ name: "video", kind: "video" }] },
  { id: "s3", title: "Email the quiz to my team", takes: [{ name: "quiz page", kind: "text/html" }, { name: "who", kind: "text" }], gives: [{ name: "receipt", kind: "text" }] },
];

describe("Source: the role's cases", () => {
  it("answers every step: the agent and its offering, the solution, and build one with a reason", async () => {
    const out = await source({ source: "v1", steps: STEPS, only: "agentmesh" }, deps());
    expect(out.result).toBe("sourced");
    if (out.result !== "sourced") return;
    expect(out.answers.map((a) => a.step)).toEqual(["s1", "s2", "s3"]);
    const [a1, a2, a3] = out.answers;
    expect(a1).toMatchObject({ answer: "agent", agent: { handle: "transcriber.platform@agentmesh.ai", key: "KTRANS", offering: "transcribe", takes: { "episode address": "address" }, gives: { transcript: "transcript" } } });
    expect(a2).toMatchObject({ answer: "solution", solution: { id: "sol_deck", page: "https://catalog.example/s/sol_deck" } });
    expect(a3!.answer).toBe("build one");
    // The decoy sounds right and takes structured data, not words: named with what it lacks.
    expect(a3!.why).toMatch(/^Nothing listed fits this step, so a new agent needs to be built\. /);
    expect(a3!.why).toMatch(/Mailer sounds right for this step, but it does not take the quiz page \(a web page\)/);
    expect(a3!.why).toMatch(/Quiz maker sounds right for this step, but it does not take the who \(text\)/);
    expect(out.summary).toBe("Of 3 steps, 1 step has an agent in the catalog, 1 step has a solution and 1 step needs a new agent built.");
  });

  it("names nothing it does not list, leaves out other publishers when asked, and never answers with itself", async () => {
    const d = deps({ self: "transcriber.platform@agentmesh.ai" });
    const out = await source({ steps: [STEPS[0]], only: "agentmesh" }, d);
    if (out.result !== "sourced") throw new Error("not sourced");
    // Itself and the outsider are left out, so nothing fits.
    expect(out.answers[0]!.answer).toBe("build one");
    const open = await source({ steps: [STEPS[0]] }, deps());
    if (open.result !== "sourced") throw new Error("not sourced");
    expect(open.answers[0]).toMatchObject({ answer: "agent" });
  });

  it("declines to hire, call or start anything, and to start a build", async () => {
    for (const ask of [
      { act: "hire", agent: "transcriber.platform@agentmesh.ai" },
      { text: "Hire transcriber.platform@agentmesh.ai for step s1 and start it now." },
      "Please start a build for step s3.",
    ]) {
      const out = await source(ask, deps());
      expect(out).toMatchObject({ result: "refused", why: expect.stringMatching(/I do not hire, contact or start an agent/) });
    }
    expect(refusesToAct({ text: JSON.stringify({ steps: STEPS }) })).toBeNull();
  });

  it("does not take a listing that only sounds right: a loose match is never offered", async () => {
    const loose = deps({ search: async () => ({ agents: [{ ...AGENTS.transcriber!.found, score: 55 }], solutions: [] }) });
    const a = await answerStep({ ...STEPS[0]!, takes: STEPS[0]!.takes.map((t) => ({ ...t, required: true })) }, { steps: [], only: null, exclude: [] }, loose);
    expect(a).toMatchObject({ answer: "build one", why: "Nothing listed does this, so a new agent needs to be built. The closest listing, Transcriber, is only a loose match." });
  });

  it("says when the catalog could not be searched, as an answer for the step", async () => {
    const down = deps({ search: async () => { throw new Error("the catalog answered 503"); } });
    const out = await source({ steps: STEPS }, down);
    if (out.result !== "sourced") throw new Error("not sourced");
    expect(out.answers.every((a) => a.answer === "build one" && a.why === "The catalog could not be searched, so nothing listed was checked for this step. Make the plan again in a minute. The catalog said: the catalog answered 503.")).toBe(true);
  });
});

describe("Source: the request", () => {
  it("refuses more steps than the limit, and a step over a limit, with the reason and nothing trimmed", () => {
    const many = Array.from({ length: SOURCE_LIMITS.steps + 1 }, (_, i) => ({ ...STEPS[0], id: `s${i + 1}` }));
    expect(readSourceRequest({ steps: many })).toEqual({ ok: false, problems: [`there are 21 steps, and one request may hold at most 20; send them in parts`] });
    const long = readSourceRequest({ steps: [{ ...STEPS[0], title: "x".repeat(SOURCE_LIMITS.title + 1) }] });
    expect(long).toEqual({ ok: false, problems: ["steps[0].title is over 200 characters"] });
  });

  it("reads the steps from the message's words, and says what to send when there are none", () => {
    const read = readSourceRequest({ text: JSON.stringify({ source: "v1", steps: STEPS, exclude: ["X.platform@agentmesh.ai"] }) });
    expect(read).toMatchObject({ ok: true, request: { only: null, exclude: ["x.platform@agentmesh.ai"] } });
    expect(readSourceRequest({ text: "what fits?" })).toMatchObject({ ok: false, problems: [expect.stringMatching(/^send the steps of a plan as source-steps-v1/)] });
    expect(readSourceRequest({ steps: [] })).toEqual({ ok: false, problems: ["there are no steps to answer"] });
  });

  it("answers a step that declares nothing it takes or gives with build one, saying why", async () => {
    const a = await answerStep({ id: "s9", title: "Do the thing", takes: [], gives: [] }, { steps: [], only: null, exclude: [] }, deps());
    expect(a).toMatchObject({ answer: "build one", why: expect.stringMatching(/does not say what goes into it or what comes out of it/) });
  });
});

describe("Source: the fit", () => {
  it("reads a step's words and an offering's media types as the same kinds", () => {
    expect(kindClass("text/vtt")).toBe("text");
    expect(kindClass("identifier")).toBe("text");
    expect(kindClass("application/vnd.agentmesh.deck-rip+json")).toBe("json");
    expect(kindClass("application/pdf")).toBe("document");
    expect(kindClass("text/uri-list")).toBe("url");
    expect(canGo("text/html", "text")).toBe(true);
    expect(canGo("text", "text/html")).toBe(false);
    expect(canGo("url", "document")).toBe(true);
    expect(canGo("text", "application/json")).toBe(false);
  });

  it("prefers a declared name to a kind, and leaves the run context to the platform", () => {
    const fit = fitOffering(AGENTS.quiz!.offerings[0]!, { id: "s", title: "Make a quiz", takes: [{ name: "notes", kind: "text" }], gives: [{ name: "page", kind: "text/html" }] });
    expect(fit).toEqual({ ok: true, takes: { notes: "notes" }, gives: { page: "quiz page" }, named: 2 });
  });

  it("dev proof, 2026-10-06: words handed back count only when the names agree, so a quiz maker is not a mailer", () => {
    const quizMaker: Offering = {
      id: "make-a-quiz", name: "Make a quiz",
      inputs: [{ name: "transcript", kind: "text/vtt", required: false }, { name: "notes", kind: "text", required: false }, { name: "beat script", kind: "text", required: false }],
      outputs: [{ name: "concept list", kind: "text" }, { name: "quiz", kind: "application/json" }, { name: "quiz page", kind: "text/html" }],
    };
    const email = { id: "s5", title: "Email quiz to team", takes: [{ name: "quiz", kind: "text" }, { name: "recipient", kind: "text" }], gives: [{ name: "delivery_status", kind: "text" }] };
    expect(fitOffering(quizMaker, email)).toEqual({ ok: false, why: "it does not produce the delivery_status (text)" });
    // The quiz step itself still fits, by the name it hands back.
    const quiz = { id: "s4", title: "Generate quiz from brief", takes: [{ name: "brief", kind: "text" }], gives: [{ name: "quiz", kind: "text" }] };
    expect(fitOffering(quizMaker, quiz)).toMatchObject({ ok: true, gives: { quiz: "quiz page" }, takes: { brief: "notes" } });
  });

  it("dev proof, 2026-10-06: a recording goes where a document is taken", () => {
    const transcribe: Offering = { id: "transcribe", name: "Transcribe a recording", inputs: [{ name: "address", kind: "url", required: false }, { name: "recording", kind: "document", required: false }], outputs: [{ name: "transcript", kind: "text/vtt" }] };
    expect(fitOffering(transcribe, { id: "s2", title: "Transcribe audio to text", takes: [{ name: "audio_content", kind: "audio" }], gives: [{ name: "transcript", kind: "text" }] }))
      .toEqual({ ok: true, takes: { audio_content: "recording" }, gives: { transcript: "transcript" }, named: 1 });
  });

  it("refuses an offering whose required input the step does not give", () => {
    const fit = fitOffering(AGENTS.mailer!.offerings[0]!, { id: "s", title: "Mail it", takes: [], gives: [{ name: "receipt", kind: "application/json" }] });
    expect(fit).toEqual({ ok: false, why: "it needs the recipients (structured data), and this step does not provide it" });
  });
});
