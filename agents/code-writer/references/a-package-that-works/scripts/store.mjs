// Reaching the database a package declares, whichever product stands behind it.
//
// A package declares that it reaches `database`. The account says which product
// that is: the platform's own store, Supabase, or another the stack knows. The
// installer binds an address and a key to the variables the package's install
// file names, and this file is the only thing in a package that touches either.
//
// Why one shared script rather than a vendor client per package:
//
//   - A package that carried a vendor client would be bound to that vendor, and
//     the whole point of declaring `database` rather than `supabase` is that an
//     agent written for one account runs for another with a different product
//     behind the same name.
//   - The house stack has no dependency outside node, so there is no client to
//     carry anyway. Every product here speaks HTTP and JSON.
//   - A test hands in a fake `fetchImpl` and proves the decisions without a
//     network, the same way every other script in the house stack does.
//
// This is the same file in every package, and a test holds the copies equal.
//
//   needs: node >= 22
//   DATABASE_ADDRESS=<the product's address> DATABASE_KEY=<the key's value>
//   DATABASE_PRODUCT=<supabase|platform> node store.mjs

/** What a caller gets back from every call here. Never throws on a refusal. */
const answer = (ok, extra = {}) => ({ ok, ...extra });

/**
 * Which product stands behind this agent's database, from what the installer
 * bound. An agent whose environment names none is not an agent with a default:
 * guessing a product would be guessing where somebody's data goes.
 */
export function productOf(env = process.env) {
  const named = String(env.DATABASE_PRODUCT ?? "").trim().toLowerCase();
  if (named) return named;
  const address = String(env.DATABASE_ADDRESS ?? "");
  if (/\.supabase\.co/.test(address)) return "supabase";
  return "";
}

/** Everything this script needs, read once, so a caller can see what is missing. */
export function settingsFrom(env = process.env) {
  return {
    product: productOf(env),
    address: String(env.DATABASE_ADDRESS ?? "").replace(/\/+$/, ""),
    key: String(env.DATABASE_KEY ?? ""),
    schema: String(env.SUPABASE_SCHEMA ?? "public"),
  };
}

/** What is wrong with the binding, in one sentence, or null when it is usable. */
export function refusalFor(settings) {
  if (!settings.product) {
    return "no database product is bound: the deploy named none, so this agent does not know where to write";
  }
  if (settings.product === "platform") {
    return "the platform's own store is not built yet, so a database bound to it cannot be reached";
  }
  if (settings.product !== "supabase") {
    return `${settings.product} is bound as the database and this script speaks supabase only`;
  }
  if (!settings.address) return "the database is bound with no address";
  if (!settings.key) return "the database is bound with no key";
  return null;
}

const headers = (settings, extra = {}) => ({
  apikey: settings.key,
  authorization: `Bearer ${settings.key}`,
  "content-type": "application/json",
  "accept-profile": settings.schema,
  "content-profile": settings.schema,
  ...extra,
});

/**
 * One call, reduced to the two facts a caller acts on: did it work, and what
 * did the product say when it did not. The product's own words travel, because
 * "401: invalid api key" is more use than anything this could write.
 */
async function call(settings, path, init, fetchImpl) {
  let res;
  try {
    res = await fetchImpl(`${settings.address}/rest/v1/${path}`, init);
  } catch (err) {
    return answer(false, { said: err instanceof Error ? err.message : String(err) });
  }
  const text = await res.text().catch(() => "");
  if (!res.ok) return answer(false, { said: `${res.status}: ${text.slice(0, 200)}` });
  let rows = [];
  if (text) {
    try {
      rows = JSON.parse(text);
    } catch {
      return answer(false, { said: "the product answered with something that is not JSON" });
    }
  }
  return answer(true, { rows: Array.isArray(rows) ? rows : [rows] });
}

/**
 * Put one row. `id` is the row's own key and must be the table's primary key,
 * because this upserts on it: an agent that wrote a second copy of the same
 * record every time it ran would be a bug nobody noticed until the table was
 * large.
 */
export async function put(table, id, row, { env = process.env, fetchImpl = fetch } = {}) {
  const settings = settingsFrom(env);
  const refusal = refusalFor(settings);
  if (refusal) return answer(false, { said: refusal });
  return call(
    settings,
    `${encodeURIComponent(table)}`,
    {
      method: "POST",
      headers: headers(settings, { prefer: "resolution=merge-duplicates,return=representation" }),
      body: JSON.stringify([{ ...row, id }]),
    },
    fetchImpl,
  );
}

/** One row by its id, or ok with no row when there is none. Absent is not an error. */
export async function get(table, id, { env = process.env, fetchImpl = fetch } = {}) {
  const settings = settingsFrom(env);
  const refusal = refusalFor(settings);
  if (refusal) return answer(false, { said: refusal });
  const out = await call(
    settings,
    `${encodeURIComponent(table)}?id=eq.${encodeURIComponent(id)}&limit=1`,
    { method: "GET", headers: headers(settings) },
    fetchImpl,
  );
  if (!out.ok) return out;
  return answer(true, { row: out.rows[0] ?? null });
}

/**
 * Rows matching an exact match on each field given, newest first where the
 * table has a `created_at`. Deliberately small: anything richer belongs in the
 * product and not in a shared script every package carries.
 */
export async function list(table, where = {}, { env = process.env, fetchImpl = fetch, limit = 100 } = {}) {
  const settings = settingsFrom(env);
  const refusal = refusalFor(settings);
  if (refusal) return answer(false, { said: refusal });
  const query = Object.entries(where)
    .map(([k, v]) => `${encodeURIComponent(k)}=eq.${encodeURIComponent(String(v))}`)
    .concat([`limit=${Math.max(1, Math.min(Number(limit) || 100, 1000))}`])
    .join("&");
  return call(settings, `${encodeURIComponent(table)}?${query}`, { method: "GET", headers: headers(settings) }, fetchImpl);
}

/** Remove one row by id. Removing a row that is not there is not a failure. */
export async function remove(table, id, { env = process.env, fetchImpl = fetch } = {}) {
  const settings = settingsFrom(env);
  const refusal = refusalFor(settings);
  if (refusal) return answer(false, { said: refusal });
  return call(
    settings,
    `${encodeURIComponent(table)}?id=eq.${encodeURIComponent(id)}`,
    { method: "DELETE", headers: headers(settings) },
    fetchImpl,
  );
}

/**
 * Whether the bound database can be reached at all, for a job that wants to
 * say so in its own report rather than failing halfway through.
 */
export async function reachable({ env = process.env, fetchImpl = fetch } = {}) {
  const settings = settingsFrom(env);
  const refusal = refusalFor(settings);
  if (refusal) return answer(false, { said: refusal });
  return call(settings, "", { method: "GET", headers: headers(settings) }, fetchImpl);
}
