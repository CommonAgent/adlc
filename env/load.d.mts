/** Types for env/load.mjs. The shape of an environment file is env/prod.json. */
export type AgentMeshEnv = Readonly<Record<string, unknown>> & { readonly name: string };

/** The environment's name: AGENTMESH_ENV, default "prod". */
export function envName(env?: Record<string, string | undefined>): string;
/** The whole environment file, frozen. Throws when it cannot be found. */
export function load(name?: string): AgentMeshEnv;
/** The whole environment file, frozen, or null when there is none. A broken file still throws. */
export function find(name?: string): AgentMeshEnv | null;
/** The value at a dotted path. Throws when it is missing or null. */
export function get<T = string>(dotted: string, name?: string): T;
/** The value at a dotted path, or `fallback` when the environment leaves it null. */
export function getOptional<T = string>(dotted: string, fallback?: T, name?: string): T;
