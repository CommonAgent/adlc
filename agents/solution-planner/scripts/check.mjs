// Checking the plan is where nothing is believed on the model's word.
//
// 0.3.0, the Source stage: the solution planner names no agent. Every step
// leaves here marked new, with a null agent and offering and a short
// lower-case hyphenated new_agent; an agent or offering the model wrote
// anyway is removed and recorded with why, because the catalog agent answers
// each step at Source. Every step's needs are read: what kind of work it is,
// its takes and its gives, each named once with a kind from KINDS (an unknown
// kind becomes text, and the change is recorded). The outputs are the gives.
// Every input line is checked against the step's takes, the Start fields and
// the earlier steps' gives; a line that fails is dropped and a sentence goes
// in missing, and a required take with no line is listed in missing too. The
// schedule is validated. The build figures are not counted here, since what
// needs building is known only after Source: to_build_usd is 0, ready_minutes
// is 1, and new_agent_usd carries the price of one new agent for the platform
// to count with. The run figures are clamped. A refused plan keeps its
// sentence and offers no steps. Plain values in, plain values out.
//
//   needs: node >= 22
//   (no command line; plan.mjs calls checkPlan)

export const NEW_AGENT_USD_DEFAULT = 1.5;
/** The kinds a take or a give may be, as the spec names them. */
export const KINDS = ["url", "text", "document", "identifier", "application/json", "text/html", "image", "audio", "video"];
const REPEATS = ["day", "weekday", "week", "month"];

const isObject = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const text = (x) => (typeof x === "string" ? x : "");
const strings = (x) => (Array.isArray(x) ? x.filter((s) => typeof s === "string" && s.trim()) : []);
const clamp = (n, lo, hi, fallback) => (Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback);

/** A lower-case hyphenated name. */
function slug(s) {
  return String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/** A schedule that can run, normalized; otherwise null. */
function scheduleOf(s) {
  if (!isObject(s)) return null;
  if (!REPEATS.includes(s.repeat)) return null;
  if (typeof s.time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(s.time)) return null;
  const day = s.day ?? null;
  if (day !== null && typeof day !== "string" && !Number.isInteger(day)) return null;
  if (s.repeat === "month" && day !== null && !(Number(day) >= 1 && Number(day) <= 31)) return null;
  const zone = s.zone ?? null;
  if (zone !== null && typeof zone !== "string") return null;
  return { says: text(s.says), repeat: s.repeat, day, time: s.time, zone };
}

/** A kind from the list, or text with the change noted. */
function kindOf(raw, note) {
  const k = text(raw).trim().toLowerCase();
  if (KINDS.includes(k)) return k;
  note(k);
  return "text";
}

/** Read one step's needs: { kind, takes, gives }, each port named once. */
function needsOf(raw, id, kinds) {
  const n = isObject(raw) ? raw : {};
  const seen = new Set();
  const ports = (list, gives) => (Array.isArray(list) ? list : []).filter((p) => isObject(p) && text(p.name).trim()).flatMap((p) => {
    const name = text(p.name).trim();
    if (seen.has(`${gives}:${name}`)) return [];
    seen.add(`${gives}:${name}`);
    const kind = kindOf(p.kind, (was) => kinds.push({ step: id, name, was, why: `"${was || "nothing"}" is not one of the kinds, so it was read as text` }));
    return [gives ? { name, kind } : { name, kind, required: p.required !== false }];
  });
  return { kind: text(n.kind).trim(), takes: ports(n.takes, false), gives: ports(n.gives, true) };
}

/** Check a draft plan. { draft, newAgentUsd } in; { plan, changes: { unnamed, kinds, dropped } } out. */
export function checkPlan({ draft, newAgentUsd = NEW_AGENT_USD_DEFAULT } = {}) {
  const unit = Number.isFinite(newAgentUsd) && newAgentUsd >= 0 ? newAgentUsd : NEW_AGENT_USD_DEFAULT;
  const start = (Array.isArray(draft?.start) ? draft.start : []).filter((f) => isObject(f) && text(f.name));
  const refused = typeof draft?.refused === "string" && draft.refused.trim() ? draft.refused.trim() : null;

  const unnamed = [];
  const kinds = [];
  const dropped = [];
  const missing = strings(draft?.missing);
  const steps = [];

  const draftSteps = refused ? [] : (Array.isArray(draft?.steps) ? draft.steps.filter(isObject) : []);
  draftSteps.forEach((raw, index) => {
    const id = text(raw.id) || `s${index + 1}`;
    const title = text(raw.title);
    const agent = text(raw.agent) || null;
    const offering = text(raw.offering) || null;
    if (agent || offering) {
      unnamed.push({ step: id, title, agent, offering, why: "the solution planner names no agent; the catalog answers each step at Source" });
    }
    const needs = needsOf(raw.needs, id, kinds);
    if (!needs.takes.length && !needs.gives.length) {
      missing.push(`Step ${id} (${title}) says nothing about what it takes or hands back, so the catalog cannot check anything listed against it.`);
    }
    const given = isObject(raw.new_agent) ? raw.new_agent : {};
    const newAgent = {
      name: slug(given.name) || slug(raw.agent_name) || slug(title) || "new-agent",
      does: text(given.does).trim() || title || "Does this step",
    };

    const lines = (Array.isArray(raw.inputs) ? raw.inputs : []).filter((l) => isObject(l) && text(l.name));
    const kept = [];
    for (const line of lines) {
      const from = text(line.from);
      let why = "";
      const dot = from.indexOf(".");
      const where = dot > 0 ? from.slice(0, dot) : ""; // cut-ok: a split at a position, not a length
      const what = dot > 0 ? from.slice(dot + 1) : "";
      if (!needs.takes.some((t) => t.name === line.name)) {
        why = `${line.name} is not one of what this step takes`;
      } else if (!where || !what) {
        why = `"${from}" does not name a Start field or an earlier step's output`;
      } else if (where === "start") {
        if (!start.some((f) => f.name === what)) why = `there is no Start field named ${what}`;
      } else {
        const earlier = steps.find((e) => e.id === where);
        if (!earlier) why = `${where} is not an earlier step`;
        else if (!earlier.outputs.includes(what)) why = `${where} hands back nothing called ${what}`;
      }
      if (why) {
        dropped.push({ step: id, input: line.name, from, why });
        missing.push(`Step ${id} (${title}): the line into ${line.name} was left out because ${why}.`);
      } else if (!kept.some((k) => k.name === line.name)) {
        kept.push({ name: line.name, from });
      }
    }
    for (const t of needs.takes) {
      if (t.required && !kept.some((k) => k.name === t.name) && !dropped.some((d) => d.step === id && d.input === t.name)) {
        missing.push(`Step ${id} (${title}): it takes ${t.name}, and nothing wired gives it.`);
      }
    }

    steps.push({
      id,
      title,
      status: "new",
      agent: null,
      agent_name: newAgent.name,
      offering: null,
      new_agent: newAgent,
      needs,
      inputs: kept,
      outputs: needs.gives.map((g) => g.name),
    });
  });

  const est = isObject(draft?.estimate) ? draft.estimate : {};
  const plan = {
    format: "build-plan-v1",
    title: text(draft?.title),
    summary: text(draft?.summary),
    refused,
    start: start.map((f) => ({ name: f.name, kind: text(f.kind), value: text(f.value), says: text(f.says) })),
    steps,
    schedule: refused ? null : scheduleOf(draft?.schedule),
    estimate: {
      per_run_usd: clamp(Number(est.per_run_usd), 0, 5, 0),
      to_build_usd: 0,
      ready_minutes: 1,
      run_minutes: Math.round(clamp(Number(est.run_minutes), 1, 120, 1)),
      new_agent_usd: unit,
    },
    cannot: strings(draft?.cannot),
    missing,
    checked: { candidates: 0, demoted: 0 },
  };
  return { plan, changes: { unnamed, kinds, dropped } };
}
