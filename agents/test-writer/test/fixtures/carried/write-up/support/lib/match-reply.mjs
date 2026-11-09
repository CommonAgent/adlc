// The shared matcher: a reply is matched by the plan.
import { planFor } from "./plan.mjs";

export function matchReply(text) {
  return planFor(String(text ?? "").trim().toLowerCase());
}
