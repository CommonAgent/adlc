// The agreements, read from the table of words.
import { TABLE } from "./words/table.mjs";

export const agreementOf = (word) => TABLE[word] ?? null;
