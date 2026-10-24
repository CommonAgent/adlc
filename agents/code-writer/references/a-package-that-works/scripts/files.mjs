// Reaching the bucket a package declares, whichever product stands behind it.
//
// The same idea as store.mjs and for the same reasons: a package declares that
// it reaches `files`, the account says whether that is the platform's bucket,
// Google Cloud Storage or S3, and the installer binds an address and a key to
// the variables the install file names. This is the only thing in a package
// that touches either.
//
// What this does NOT do, deliberately:
//
//   - It does not sign an AWS request. Signing needs either a dependency or a
//     hundred lines of crypto in every package, and the house stack has
//     neither. An agent bound to S3 gets a refusal in words, and the account
//     binds a product this can reach or the deploy places a signed URL.
//   - It does not list a whole bucket. A package that needs to walk somebody's
//     storage is asking for a spec change, and that is not this file's to make.
//
// This is the same file in every package, and a test holds the copies equal.
//
//   needs: node >= 22
//   FILES_ADDRESS=<bucket or base URL> FILES_KEY=<the key's value>
//   FILES_PRODUCT=<platform|google-cloud-storage|s3> node files.mjs

const answer = (ok, extra = {}) => ({ ok, ...extra });

/** Which product stands behind this agent's files, from what the installer bound. */
export function productOf(env = process.env) {
  return String(env.FILES_PRODUCT ?? "").trim().toLowerCase();
}

export function settingsFrom(env = process.env) {
  return {
    product: productOf(env),
    bucket: String(env.FILES_ADDRESS ?? "").replace(/^gs:\/\//, "").replace(/\/+$/, ""),
    key: String(env.FILES_KEY ?? ""),
    prefix: String(env.FILES_PREFIX ?? "").replace(/^\/+|\/+$/g, ""),
  };
}

/** What is wrong with the binding, in one sentence, or null when it is usable. */
export function refusalFor(settings) {
  if (!settings.product) {
    return "no files product is bound: the deploy named none, so this agent does not know where to write";
  }
  if (settings.product === "s3") {
    return "a bucket bound to S3 needs a signed request, which no package can make; bind a product this script reaches or hand the job a signed URL";
  }
  if (settings.product === "platform") {
    return "the platform's own bucket is not bound by name yet, so a files binding to it cannot be reached from a package";
  }
  if (settings.product !== "google-cloud-storage") {
    return `${settings.product} is bound as files and this script speaks Google Cloud Storage only`;
  }
  if (!settings.bucket) return "the bucket is bound with no name";
  if (!settings.key) return "the bucket is bound with no key";
  return null;
}

/** Where a name lands, under the prefix the deploy bound, if it bound one. */
export function keyFor(settings, name) {
  const clean = String(name).replace(/^\/+/, "");
  return settings.prefix ? `${settings.prefix}/${clean}` : clean;
}

const authHeaders = (settings) => ({ authorization: `Bearer ${settings.key}` });

/**
 * Write one object. The key the deploy bound is used as an OAuth access token,
 * which is what a short-lived token from a service account looks like; a
 * long-lived JSON key cannot be used from here and is refused by the caller's
 * own probe rather than silently sent as a bearer.
 */
export async function put(name, bytes, contentType = "application/octet-stream", { env = process.env, fetchImpl = fetch } = {}) {
  const settings = settingsFrom(env);
  const refusal = refusalFor(settings);
  if (refusal) return answer(false, { said: refusal });
  const object = keyFor(settings, name);
  const url =
    `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(settings.bucket)}/o` +
    `?uploadType=media&name=${encodeURIComponent(object)}`;
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { ...authHeaders(settings), "content-type": contentType },
      body: bytes,
    });
    const text = await res.text().catch(() => "");
    if (!res.ok) return answer(false, { said: `${res.status}: ${text.slice(0, 200)}` });
    return answer(true, { name: object, address: `gs://${settings.bucket}/${object}` });
  } catch (err) {
    return answer(false, { said: err instanceof Error ? err.message : String(err) });
  }
}

/** Read one object back as bytes. A missing object is ok with nothing, not an error. */
export async function get(name, { env = process.env, fetchImpl = fetch } = {}) {
  const settings = settingsFrom(env);
  const refusal = refusalFor(settings);
  if (refusal) return answer(false, { said: refusal });
  const object = keyFor(settings, name);
  const url =
    `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(settings.bucket)}/o/` +
    `${encodeURIComponent(object)}?alt=media`;
  try {
    const res = await fetchImpl(url, { method: "GET", headers: authHeaders(settings) });
    if (res.status === 404) return answer(true, { bytes: null, name: object });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return answer(false, { said: `${res.status}: ${text.slice(0, 200)}` });
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    return answer(true, { bytes, name: object });
  } catch (err) {
    return answer(false, { said: err instanceof Error ? err.message : String(err) });
  }
}

/** Remove one object. Removing what is not there is not a failure. */
export async function remove(name, { env = process.env, fetchImpl = fetch } = {}) {
  const settings = settingsFrom(env);
  const refusal = refusalFor(settings);
  if (refusal) return answer(false, { said: refusal });
  const object = keyFor(settings, name);
  const url =
    `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(settings.bucket)}/o/${encodeURIComponent(object)}`;
  try {
    const res = await fetchImpl(url, { method: "DELETE", headers: authHeaders(settings) });
    if (res.ok || res.status === 404) return answer(true, { name: object });
    const text = await res.text().catch(() => "");
    return answer(false, { said: `${res.status}: ${text.slice(0, 200)}` });
  } catch (err) {
    return answer(false, { said: err instanceof Error ? err.message : String(err) });
  }
}
