// A call to the platform that waits out a "not now" and asks again.
//
// The platform's limiter answers 429 when a minute is busy, and a gateway
// answers 502 or 503 while a service restarts. Neither says anything about
// the agent being audited, so neither may become a finding: the item 5 sweep
// (2026-10-28) turned a busy minute into "the registry holds no Descriptor"
// for agents that had one. Each such answer is waited out and asked again:
// for as long as the platform asks (Retry-After in seconds, else
// retry_after_ms in its body, plus half a second), else 2, 4, 8, ... seconds,
// never more than a minute at a time, and at most TRIES times in all. The
// last answer is then handed back as it is, so a read that really failed is
// still said as failed, and never filled in.
//
//   needs: node >= 22
//   import { fetchRetrying, waitFor } from "./retry.mjs"

export const RETRY_CODES = new Set([429, 502, 503]);
export const ONLY_429 = new Set([429]);
export const TRIES = 8;
export const WAIT_CAP_MS = 60_000;

export const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** How long to wait before asking again, in milliseconds. */
export async function waitFor(r, attempt) {
  const header = typeof r?.headers?.get === "function" ? r.headers.get("retry-after") : null;
  if (header && /^\s*\d+(\.\d+)?\s*$/.test(String(header))) return Math.min(WAIT_CAP_MS, Math.round(Number(header) * 1000));
  try {
    const text = typeof r?.text === "function" ? await r.text() : "";
    const ms = JSON.parse(text)?.retry_after_ms;
    if (typeof ms === "number" && Number.isFinite(ms) && ms >= 0) return Math.min(WAIT_CAP_MS, ms + 500);
  } catch { /* no body to read */ }
  return Math.min(WAIT_CAP_MS, 2000 * 2 ** (attempt - 1));
}

/**
 * fetch, asking again after a 429, 502 or 503. `init` is the fetch init
 * without a signal: each try gets its own timeout. A thrown error (no answer
 * at all) is not asked again here; the caller says it. A call that files
 * something new passes `codes: ONLY_429`: a 502 or 503 may come after the
 * write landed, and asking again could file it twice.
 */
export async function fetchRetrying(url, init = {}, { fetchImpl = globalThis.fetch, timeoutMs = 30_000, sleep = realSleep, tries = TRIES, onWait = null, codes = RETRY_CODES } = {}) {
  for (let attempt = 1; ; attempt++) {
    const r = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    if (!codes.has(r.status) || attempt >= tries) return r;
    const ms = await waitFor(r, attempt);
    if (onWait) onWait({ url, status: r.status, attempt, ms });
    await sleep(ms);
  }
}
