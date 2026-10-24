// The two shared scripts that reach a bound product, held to the promises they
// make to every package that carries them.
//
// What matters, in order:
//   1. A binding that cannot work refuses in words, before any call is made. An
//      agent that fires a request at nothing and reports a network error has
//      told its owner nothing about what is actually wrong.
//   2. The key never appears in an answer. What comes back is whether it
//      worked and what the product said.
//   3. A missing row and a missing object are not failures. Absent is an
//      answer, and a script that treats it as an error makes every caller
//      write the same wrong branch.
//
// Every test hands in a fake fetch. Nothing here touches a network.

import { test } from "node:test";
import assert from "node:assert/strict";
import * as store from "../scripts/store.mjs";
import * as files from "../scripts/files.mjs";

const bound = {
  DATABASE_PRODUCT: "supabase",
  DATABASE_ADDRESS: "https://acme.supabase.co",
  DATABASE_KEY: "sb-secret",
  SUPABASE_SCHEMA: "agents",
};

const answering = (status, body, seen = []) => {
  const f = async (url, init) => {
    seen.push({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
      arrayBuffer: async () => new TextEncoder().encode(String(body)).buffer,
    };
  };
  f.seen = seen;
  return f;
};

test("a database bound to nothing refuses before it calls anything", async () => {
  const seen = [];
  const out = await store.get("notes", "1", { env: {}, fetchImpl: answering(200, [], seen) });
  assert.equal(out.ok, false);
  assert.match(out.said, /no database product is bound/);
  assert.equal(seen.length, 0, "nothing was called");
});

test("a database bound to the platform's own store says it is not built yet", async () => {
  const out = await store.get("notes", "1", { env: { DATABASE_PRODUCT: "platform" }, fetchImpl: answering(200, []) });
  assert.equal(out.ok, false);
  assert.match(out.said, /not built yet/);
});

test("a database bound to a product this script does not speak says which", async () => {
  const out = await store.get("notes", "1", { env: { DATABASE_PRODUCT: "firestore" }, fetchImpl: answering(200, []) });
  assert.equal(out.ok, false);
  assert.match(out.said, /firestore/);
});

test("the product is read off the address when the deploy did not name one", () => {
  assert.equal(store.productOf({ DATABASE_ADDRESS: "https://acme.supabase.co" }), "supabase");
  assert.equal(store.productOf({}), "");
});

test("writing a row upserts on its id, in the schema the deploy bound", async () => {
  const seen = [];
  const out = await store.put("notes", "n1", { text: "hello" }, { env: bound, fetchImpl: answering(200, [{ id: "n1" }], seen) });
  assert.equal(out.ok, true);
  assert.match(seen[0].url, /\/rest\/v1\/notes$/);
  assert.equal(seen[0].init.headers["content-profile"], "agents");
  assert.match(seen[0].init.headers.prefer, /merge-duplicates/);
  assert.deepEqual(JSON.parse(seen[0].init.body), [{ text: "hello", id: "n1" }]);
});

test("a row that is not there is an answer, not a failure", async () => {
  const out = await store.get("notes", "n404", { env: bound, fetchImpl: answering(200, []) });
  assert.equal(out.ok, true);
  assert.equal(out.row, null);
});

test("the product's own words come back on a refusal, and the key does not", async () => {
  const out = await store.get("notes", "n1", { env: bound, fetchImpl: answering(401, "invalid api key") });
  assert.equal(out.ok, false);
  assert.match(out.said, /401: invalid api key/);
  assert.ok(!JSON.stringify(out).includes("sb-secret"), "no key in the answer");
});

test("a list is an exact match per field with a capped limit", async () => {
  const seen = [];
  await store.list("notes", { owner: "jeff" }, { env: bound, fetchImpl: answering(200, [], seen), limit: 9000 });
  assert.match(seen[0].url, /owner=eq\.jeff/);
  assert.match(seen[0].url, /limit=1000/);
});

test("a bucket bound to S3 says why no package can reach it", async () => {
  const out = await files.put("a.txt", new Uint8Array(), "text/plain", {
    env: { FILES_PRODUCT: "s3", FILES_ADDRESS: "b", FILES_KEY: "k" },
    fetchImpl: answering(200, ""),
  });
  assert.equal(out.ok, false);
  assert.match(out.said, /signed request/);
});

test("an object is written under the prefix the deploy bound", async () => {
  const seen = [];
  const out = await files.put("notes/a.txt", new Uint8Array([1]), "text/plain", {
    env: { FILES_PRODUCT: "google-cloud-storage", FILES_ADDRESS: "gs://acme-agents/", FILES_KEY: "ya29.token", FILES_PREFIX: "agents/one" },
    fetchImpl: answering(200, "{}", seen),
  });
  assert.equal(out.ok, true);
  assert.equal(out.name, "agents/one/notes/a.txt");
  assert.match(seen[0].url, /b\/acme-agents\/o/);
});

test("an object that is not there is an answer, not a failure", async () => {
  const out = await files.get("gone.txt", {
    env: { FILES_PRODUCT: "google-cloud-storage", FILES_ADDRESS: "acme-agents", FILES_KEY: "ya29.token" },
    fetchImpl: answering(404, "not found"),
  });
  assert.equal(out.ok, true);
  assert.equal(out.bytes, null);
});

test("a network that is not there is reported as the product's words, not as a crash", async () => {
  const throwing = async () => {
    throw new Error("getaddrinfo ENOTFOUND acme.supabase.co");
  };
  const out = await store.get("notes", "n1", { env: bound, fetchImpl: throwing });
  assert.equal(out.ok, false);
  assert.match(out.said, /ENOTFOUND/);
});
