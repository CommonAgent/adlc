/**
 * Source for a process document (api/catalog-source.ts, sourceProcess): the
 * catalog agent answers each step of an Agent Processes document with an
 * agent and the offering that does it, a process the step becomes a
 * `runs process` phase of, or "build one" with the reason, and fills the
 * document's roster from the answers (the ADLC builds processes, step
 * find-the-holders of agentmesh/new-process).
 */
import { describe, expect, it } from "vitest";
import { bindRoster, readProcessSteps, source, sourceProcess, type FoundAgent, type ListedProcess, type Offering, type SourceDeps } from "../src/catalog-source.js";

const DOC = `PROCESS: explore a topic         id: research/explore-a-topic   v1
owner: head of research          effective: 2026-11-01
trigger: a person asks for a topic to be explored
         carries: topic - the words or a link to explore, required
concurrency: runs may overlap - each run reads its own topic
goal: cards on the topic, approved by the editor and posted to the
      team's page
phases:
  write-the-cards   - runs write-cards: five cards on the topic, each with
                      a source
                      owner: card-writer
                      after: trigger        automation: autonomous
  approve-the-cards - human: the editor approves the cards, asks for
                      changes, or rejects them
                      owner: editor (person)
                      after: write-the-cards   automation: never
  build-a-reviewer  - harness: a running agent whose package was made
                      from a spec the owner approved and whose
                      conformance was checked by an agent that did not
                      build it
                      owner: whoever starts the run
                      after: approve-the-cards   automation: autonomous
  post-the-cards    - harness: the approved cards posted to the team's
                      page
                      owner: page-poster
                      after: build-a-reviewer   automation: autonomous
handoffs:
  write-the-cards -> approve-the-cards [cards]: the five cards
  approve-the-cards -> post-the-cards [approved-cards]: the cards as
    approved
deviations:
  approve-the-cards -> write-the-cards [changes]: the editor says what
    is wrong, and the cards are written again
bindings:
  roster: card-writer and page-poster are agents; editor (person) is the
      head of research
  systems: the team's page (write)
  data: the topic
measures:
  quality gate: no card is posted without the editor's approval
`;

const CARDS: FoundAgent = { kind: "agent", handle: "card-writer.platform@agentmesh.ai", key: "KCARDS", name: "Card writer", score: 0 };
const OFFERINGS: Record<string, Offering[]> = {
  // Declares write-cards, the job the phase runs.
  KCARDS: [{ id: "write-cards", name: "Write cards", inputs: [{ name: "topic", kind: "text", required: true }], outputs: [{ name: "cards", kind: "application/json" }] }],
};
const NEW_AGENT: ListedProcess = {
  id: "agentmesh/new-agent", version: "v3", name: "make a new agent",
  goal: "a running agent whose package was made from a spec the owner approved, designed within an architecture record, whose scripts pass a suite written before them, and whose conformance was checked by an agent that did not build it",
};

function deps(over: Partial<SourceDeps> = {}): SourceDeps {
  return {
    self: "catalog.platform@agentmesh.ai",
    // The card writer is only a loose match by words; what it declares is what counts.
    search: async (words) => ({ agents: [{ ...CARDS, score: /card/i.test(words) ? 55 : 20 }], solutions: [] }),
    offerings: async (key) => OFFERINGS[key] ?? null,
    solution: async () => null,
    processes: async () => [NEW_AGENT, { id: "research/explore-a-topic", version: "v1", name: "explore a topic", goal: "cards on the topic, approved by the editor and posted to the team's page" }],
    ...over,
  };
}

describe("Source for a process document", () => {
  it("reads the document's steps: the phases an agent or a process does, and the people's", () => {
    const r = readProcessSteps(DOC);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.id).toBe("research/explore-a-topic");
    expect(r.steps.map((s) => [s.id, s.offering ?? null])).toEqual([["write-the-cards", "write-cards"], ["build-a-reviewer", null], ["post-the-cards", null]]);
    expect(r.steps[0]!.takes.map((t) => t.name)).toEqual(["topic"]);
    expect(r.steps[2]!.takes.map((t) => t.name)).toEqual(["approved-cards"]);
    expect(r.people).toEqual([{ step: "approve-the-cards", owner: "editor (person)" }]);
  });

  it("answers each step with an agent and its offering, a process, or build one, and fills the roster", async () => {
    const out = await sourceProcess({ source: "v1", process: DOC }, deps());
    expect(out.result).toBe("sourced");
    if (out.result !== "sourced") return;
    expect(out.format).toBe("source-process-answers-v1");
    const [a1, a2, a3] = out.answers;
    expect(a1).toMatchObject({ step: "write-the-cards", answer: "agent", agent: { handle: "card-writer.platform@agentmesh.ai", key: "KCARDS", offering: "write-cards" } });
    expect(a1!.why).toMatch(/declares write-cards, the job this step runs/);
    expect(a2).toMatchObject({ step: "build-a-reviewer", answer: "process", process: { id: "agentmesh/new-agent", version: "v3" }, phase_line: "runs process agentmesh/new-agent v3" });
    expect(a3).toMatchObject({ step: "post-the-cards", answer: "build one", takes: ["approved-cards"], gives: [] });
    expect(a3!.why).toMatch(/new agent needs to be built/);
    expect(out.roster).toEqual({ "write-the-cards": "card-writer.platform@agentmesh.ai", "approve-the-cards": "editor (person)", "build-a-reviewer": "agentmesh/new-agent v3" });
    expect(out.people).toEqual([{ step: "approve-the-cards", owner: "editor (person)" }]);
    expect(out.document).toMatch(/^ {2}roster: write-the-cards: card-writer\.platform@agentmesh\.ai,/m);
    expect(out.document).toMatch(/post-the-cards: <build one>/);
    expect(out.summary).toBe("Of 3 steps, 1 step has an agent in the catalog, 1 step is a process that exists and 1 step needs a new agent built.");
    // Never the document's own process, and nothing outside the document's lines changed.
    expect(out.answers.some((a) => a.answer === "process" && a.process.id === "research/explore-a-topic")).toBe(false);
    expect(out.document.replace(/\n {2}roster:[\s\S]*?(?=\n {2}systems:)/, "")).toBe(DOC.replace(/\n {2}roster:[\s\S]*?(?=\n {2}systems:)/, ""));
  });

  it("is what source answers when it is sent a process document, in the message's words too, and it still refuses to act", async () => {
    const out = await source({ text: DOC }, deps());
    expect(out.result === "sourced" && out.format).toBe("source-process-answers-v1");
    expect((await source({ act: "hire", process: DOC }, deps())).result).toBe("refused");
  });

  it("answers build one, never a near miss, when an agent that sounds right does not declare the job", async () => {
    const out = await sourceProcess({ process: DOC }, deps({ offerings: async () => [{ id: "write-posts", name: "Write posts", inputs: [{ name: "brief", kind: "application/json", required: true }], outputs: [{ name: "post", kind: "text/html" }] }] }));
    if (out.result !== "sourced") throw new Error(JSON.stringify(out));
    expect(out.answers[0]).toMatchObject({ step: "write-the-cards", answer: "build one" });
  });

  it("refuses a document it cannot read, saying what is wrong", async () => {
    const out = await sourceProcess({ process: "PROCESS: nothing\n" }, deps());
    expect(out.result).toBe("refused");
  });

  it("writes a roster into any document's bindings", () => {
    expect(bindRoster(DOC, "a: b")).toMatch(/^bindings:\n {2}roster: a: b\n {2}systems:/m);
  });
});
