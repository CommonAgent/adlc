// ESM face of env/load.cjs (see that file for the rules). One implementation,
// so a CommonJS reader (ecosystem.config.cjs) and an ESM or TypeScript reader
// can never disagree about which file was read or what a null means.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const impl = require("./load.cjs");

export const envName = impl.envName;
export const load = impl.load;
export const find = impl.find;
export const get = impl.get;
export const getOptional = impl.getOptional;
