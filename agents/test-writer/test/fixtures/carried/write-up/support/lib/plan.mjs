// The plan: which agreement a word belongs to.
import { agreementOf } from "./agreements.mjs";

export const planFor = (word) => (word ? agreementOf(word) : null);
