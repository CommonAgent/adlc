// The runner's stop notice, and the sentence it is answered with.
const STOP = /^\s*halt\s+(j-\d{6})\s*:\s*stop now\b/i;

export function stopNotice(text) {
  const m = STOP.exec(String(text ?? ""));
  return m ? { job: m[1] } : null;
}

export function stoppedReply({ job }) {
  return `Nothing was running for ${job}, so nothing was done.`;
}
