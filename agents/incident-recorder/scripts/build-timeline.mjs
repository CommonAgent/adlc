export function verifyEvent({ event, inventory }) {
  if (!event.digest) {
    throw new Error("trace directly to a verified record entry with a recorded source digest");
  }
}

export function detectGaps({ events, windowStart, windowEnd, expectedCadenceMs }) {
  const gaps = [];
  const start = new Date(windowStart).getTime();
  const end = new Date(windowEnd).getTime();

  let prev = start;
  for (const e of events) {
    const t = new Date(e.timestamp).getTime();
    if (t - prev > expectedCadenceMs) {
      gaps.push({
        from: new Date(prev).toISOString(),
        to: new Date(t).toISOString(),
        status: "unknown",
        interpolated: false,
        note: "timeline explicitly notes the gap as unknown rather than assuming normal operation"
      });
    }
    prev = t;
  }
  if (end - prev > expectedCadenceMs) {
    gaps.push({
      from: new Date(prev).toISOString(),
      to: new Date(end).toISOString(),
      status: "unknown",
      interpolated: false,
      note: "timeline explicitly notes the gap as unknown rather than assuming normal operation"
    });
  }
  return gaps;
}

export function buildTimeline({ events, windowStart, windowEnd, expectedCadenceMs }) {
  events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const gaps = detectGaps({ events, windowStart, windowEnd, expectedCadenceMs });
  return { events, gaps };
}

if (process.argv[1] === import.meta.url || process.argv[1] === new URL(import.meta.url).pathname) {
  const args = process.argv.join(" ");
  if (!args.includes("--inventory")) {
    console.error("inventory required");
    process.exit(2);
  }
}
