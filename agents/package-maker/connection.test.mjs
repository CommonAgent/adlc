// The shared connection contract (shared/connection.mjs), in both modes, with
// fetch faked and a temporary host store: the platform's lookup before every
// token and key, the customer's own store read by name and never the
// platform, the key-file path signed here, the refusal codes, and that no
// value, token or body ever reaches a refusal. The harness wrote these tests.
//
//   node --test fleet-manager/agentbuilder/connection.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createVerify, generateKeyPairSync } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectionEnv, connectionFor, METADATA_TOKEN, modeOf, Refusal } from "./shared/connection.mjs";

const SA = "am-1a2b3c4d@example-grants-dev.iam.gserviceaccount.com";
const OWN = "ya29.OWN-METADATA-TOKEN-xyz";
const MINTED = "ya29.MINTED-FOR-CALLER-abc";
const PLATFORM = "amt_PLATFORM-SECRET-123";
const KEY_VALUE = "sk_live_THE-CALLERS-KEY-999";
const AMBIENT = "ya29.AMBIENT-GCLOUD-TOKEN-777";
const SENDER = "U" + "C".repeat(55);
const SECRET = "projects/example-grants-dev/secrets/cg-acme-key-1";

const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => (typeof body === "string" ? body : JSON.stringify(body)) });

const IDENTITY = { id: "cg_1", provider: "google-analytics", grant: "identity", access: "read", property: "123456789", service_account: SA, secret: null, state: "works" };
const KEYGRANT = { id: "cg_2", provider: "acme", grant: "key", access: "read", property: null, service_account: null, secret: SECRET, state: "works" };

function fakes({ resolve = { status: 200, body: { grant: IDENTITY } }, metadata = true, iam = 200, secret = 200, jwt = 200 } = {}) {
  const seen = [];
  const fetchImpl = async (url, opts = {}) => {
    const u = String(url);
    let body = null;
    if (typeof opts.body === "string") { try { body = JSON.parse(opts.body); } catch { body = opts.body; } }
    seen.push({ url: u, opts, body });
    if (u.endsWith("/caller-grants/resolve")) return reply(resolve.status, resolve.body);
    if (u === METADATA_TOKEN) {
      if (!metadata) throw Object.assign(new Error("getaddrinfo ENOTFOUND metadata.google.internal"), { name: "TypeError" });
      return reply(200, { access_token: OWN, expires_in: 3599 });
    }
    if (u.includes("iamcredentials.googleapis.com")) return iam === 200 ? reply(200, { accessToken: MINTED, expireTime: "x" }) : reply(iam, { error: { message: `detail ${OWN}` } });
    if (u.startsWith("https://secretmanager.googleapis.com/")) {
      return secret === 200 ? reply(200, { name: "x", payload: { data: Buffer.from(KEY_VALUE).toString("base64") } }) : reply(secret, { error: { message: `no ${KEY_VALUE}` } });
    }
    if (u === "https://oauth2.googleapis.com/token") return jwt === 200 ? reply(200, { access_token: MINTED, expires_in: 3599 }) : reply(jwt, { error: "invalid_grant", detail: MINTED });
    return reply(404, {});
  };
  return { fetchImpl, seen };
}

const hosted = (extra = {}) => ({
  MESH_ACCOUNT: "acc_platform", MESH_API_TOKEN: PLATFORM, MESH_API_BASE: "https://dev.example.test/",
  MESH_SELF_HANDLE: "web-analytics.platform@agentmesh.ai", MESH_SENDER: SENDER, ...extra,
});
const store = (files = {}, extra = {}) => {
  const dir = mkdtempSync(join(tmpdir(), "mesh-store-"));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, `${name}.secret`), content);
  return { dir, env: { MESH_KEY_STORE: `host:${dir}`, ...extra } };
};
const GA = { input: "property", provider: "google-analytics", grant: "identity", what: "Google Analytics" };
const ACME = { input: "account", provider: "acme", grant: "key", what: "Acme" };
const SCOPES = ["https://www.googleapis.com/auth/analytics.readonly"];

async function refused(promise, check) {
  await assert.rejects(promise, (e) => {
    assert.ok(e instanceof Refusal, `not a Refusal: ${e?.name}`);
    assert.match(e.message, /^I cannot /);
    assert.ok(e.message.length < 600, `${e.message.length} characters`);
    for (const secret of [OWN, MINTED, PLATFORM, KEY_VALUE, AMBIENT, "PRIVATE KEY"]) assert.ok(!e.message.includes(secret), `${secret} in ${e.message}`);
    check?.(e);
    return true;
  });
}

test("the mode: MESH_CONNECTIONS, else platform with a token, else store with a store, else a refusal naming both", async () => {
  assert.equal(modeOf({ MESH_API_TOKEN: "x" }), "platform");
  assert.equal(modeOf({ MESH_KEY_STORE: "host" }), "store");
  assert.equal(modeOf({ MESH_API_TOKEN: "x", MESH_KEY_STORE: "host" }), "platform");
  assert.equal(modeOf({ MESH_API_TOKEN: "x", MESH_CONNECTIONS: "store" }), "store");
  await refused(connectionFor({ ...GA, env: {}, fetch: fakes().fetchImpl }), (e) => {
    assert.equal(e.code, "SETUP");
    assert.match(e.message, /MESH_API_TOKEN/);
    assert.match(e.message, /MESH_KEY_STORE/);
  });
  await refused(connectionFor({ ...GA, env: { MESH_CONNECTIONS: "cloud" }, fetch: fakes().fetchImpl }), (e) => assert.equal(e.code, "SETUP"));
  await refused(connectionFor({ ...GA, grant: "oauth", env: hosted(), fetch: fakes().fetchImpl }), (e) => assert.equal(e.code, "SETUP"));
  assert.equal(connectionEnv("property"), "MESH_CONNECTION_PROPERTY");
  assert.equal(connectionEnv("ga-property.v2"), "MESH_CONNECTION_GA_PROPERTY_V2");
});

test("platform, identity: a first lookup with no use, then every token preceded by a lookup that says use token, then a five-minute token for the asked scopes", async () => {
  const { fetchImpl, seen } = fakes();
  const c = await connectionFor({ ...GA, text: "run r-20261022-20e5 phase traffic-report: here is work", env: hosted(), fetch: fetchImpl });
  assert.deepEqual({ where: c.where, grant: c.grant, provider: c.provider, id: c.id, property: c.property, address: c.address, state: c.state }, { where: "platform", grant: "identity", provider: "google-analytics", id: "cg_1", property: "123456789", address: SA, state: "works" });
  const r = seen.find((s) => s.url.endsWith("/resolve"));
  assert.equal(r.url, "https://dev.example.test/v1/accounts/acc_platform/caller-grants/resolve");
  assert.equal(r.opts.headers.authorization, `Bearer ${PLATFORM}`);
  // The first lookup names the address and property and records no use.
  assert.deepEqual(r.body, { agent_handle: "web-analytics.platform@agentmesh.ai", input: "property", sender: SENDER, run: "r-20261022-20e5" });
  assert.equal(await c.token(SCOPES), MINTED);
  const iam = seen.find((s) => s.url.includes("iamcredentials"));
  assert.equal(iam.opts.headers.authorization, `Bearer ${OWN}`);
  assert.deepEqual(iam.body, { scope: SCOPES, lifetime: "300s" });
  await c.token(SCOPES);
  const lookups = seen.filter((s) => s.url.endsWith("/resolve"));
  assert.deepEqual(lookups.map((s) => s.body.use ?? null), [null, "token", "token"]);
  // Order: a lookup of its own before each mint.
  const order = seen.map((s) => (s.url.endsWith("/resolve") ? "R" : s.url.includes("iamcredentials") ? "T" : s.url === METADATA_TOKEN ? "M" : "?")).join("");
  assert.equal(order, "RRMTRMT");
  await refused(c.key(), (e) => assert.equal(e.code, "SETUP"));
  await refused(c.token([]), (e) => assert.equal(e.step, "scopes"));
});

test("platform, key: the lookup says use key, then the one secret it names is read and decoded", async () => {
  const { fetchImpl, seen } = fakes({ resolve: { status: 200, body: { grant: KEYGRANT } } });
  const c = await connectionFor({ ...ACME, env: hosted(), fetch: fetchImpl });
  assert.equal(c.address, null);
  assert.equal(seen.find((s) => s.url.endsWith("/resolve")).body.use, undefined);
  assert.equal(await c.key(), KEY_VALUE);
  assert.equal(seen.filter((s) => s.url.endsWith("/resolve"))[1].body.use, "key");
  const sm = seen.find((s) => s.url.startsWith("https://secretmanager"));
  assert.equal(sm.url, `https://secretmanager.googleapis.com/v1/${SECRET}/versions/latest:access`);
  assert.equal(sm.opts.headers.authorization, `Bearer ${OWN}`);
  await c.key();
  assert.equal(seen.filter((s) => s.url.endsWith("/resolve")).length, 3);
  await refused(c.token(SCOPES));
  for (const [status, code] of [[403, "STORE_DENIED"], [404, "NO_CONNECTION"], [500, null]]) {
    const d = await connectionFor({ ...ACME, env: hosted(), fetch: fakes({ resolve: { status: 200, body: { grant: KEYGRANT } }, secret: status }).fetchImpl });
    await refused(d.key(), (e) => { assert.equal(e.status, status); assert.equal(e.code, code); });
  }
});

test("platform refusals: no connection, whose task, any other status, and a grant of the wrong kind", async () => {
  await refused(connectionFor({ ...GA, env: hosted(), fetch: fakes({ resolve: { status: 404, body: { code: "NO_CONNECTION", error: "x" } } }).fetchImpl }), (e) => {
    assert.equal(e.code, "NO_CONNECTION");
    assert.match(e.message, /Settings, Data connections/);
  });
  await refused(connectionFor({ ...GA, env: hosted(), fetch: fakes({ resolve: { status: 403, body: { code: "NO_RUN" } } }).fetchImpl }), (e) => {
    assert.equal(e.code, "NO_RUN");
    assert.match(e.message, /could not confirm whose task it is/);
  });
  await refused(connectionFor({ ...GA, env: hosted(), fetch: fakes({ resolve: { status: 500, body: { error: `boom ${PLATFORM}` } } }).fetchImpl }), (e) => {
    assert.equal(e.status, 500);
    assert.equal(e.message, "I cannot read Google Analytics: the connection lookup answered 500. Nothing was read; try again in a few minutes.");
  });
  await refused(connectionFor({ ...GA, env: hosted(), fetch: fakes({ resolve: { status: 200, body: { grant: KEYGRANT } } }).fetchImpl }), (e) => assert.equal(e.code, "WRONG_GRANT"));
  await refused(connectionFor({ ...GA, env: hosted({ MESH_SENDER: "" }), fetch: fakes().fetchImpl }), (e) => assert.equal(e.step, "envelope"));
  const iam = await connectionFor({ ...GA, env: hosted(), fetch: fakes({ iam: 403 }).fetchImpl });
  await refused(iam.token(SCOPES), (e) => { assert.equal(e.step, "generateAccessToken"); assert.equal(e.status, 403); });
});

test("store, host: a key read by its name, raw or as JSON with a property; the name and property from the env; the platform is never called", async () => {
  const { fetchImpl, seen } = fakes();
  const s = store({ "acme-key": `${KEY_VALUE}\n` });
  // MESH_API_TOKEN is set, but MESH_CONNECTIONS says store: nothing goes to the platform.
  const c = await connectionFor({ ...ACME, env: { ...s.env, MESH_CONNECTIONS: "store", MESH_API_TOKEN: PLATFORM, MESH_ACCOUNT: "acc" }, fetch: fetchImpl });
  assert.deepEqual({ where: c.where, id: c.id, name: c.name, property: c.property, address: c.address }, { where: "own-store", id: null, name: "acme-key", property: null, address: null });
  assert.equal(await c.key(), KEY_VALUE);
  assert.equal(seen.length, 0);
  const t = store({ "my-acme": JSON.stringify({ key: KEY_VALUE, property: "workspace-1" }) });
  const d = await connectionFor({ ...ACME, env: { ...t.env, MESH_CONNECTION_ACCOUNT: "my-acme" }, fetch: fetchImpl });
  assert.equal(d.name, "my-acme");
  assert.equal(d.property, "workspace-1");
  assert.equal(await d.key(), KEY_VALUE);
  const u = store({ "acme-key": KEY_VALUE });
  assert.equal((await connectionFor({ ...ACME, env: { ...u.env, MESH_CONNECTION_ACCOUNT_PROPERTY: "ws-2" }, fetch: fetchImpl })).property, "ws-2");
  // MESH_KEY_STORE=host reads MESH_CREDENTIALS_DIR.
  const v = store({ "acme-key": KEY_VALUE });
  assert.equal(await (await connectionFor({ ...ACME, env: { MESH_KEY_STORE: "host", MESH_CREDENTIALS_DIR: v.dir }, fetch: fetchImpl })).key(), KEY_VALUE);
  assert.equal(seen.length, 0);
  // Missing: NO_CONNECTION, naming the name and the env name to change it.
  await refused(connectionFor({ ...ACME, env: store().env, fetch: fetchImpl }), (e) => {
    assert.equal(e.code, "NO_CONNECTION");
    assert.equal(e.step, "store");
    assert.match(e.message, /no credential named acme-key/);
    assert.match(e.message, /MESH_CONNECTION_ACCOUNT/);
  });
  await refused(connectionFor({ ...ACME, env: { ...s.env, MESH_CONNECTION_ACCOUNT: "../etc/passwd" }, fetch: fetchImpl }), (e) => assert.equal(e.code, "SETUP"));
});

test("store, identity as an address to act as: the ambient token from the metadata server, else GOOGLE_OAUTH_ACCESS_TOKEN", async () => {
  const s = store({ "google-analytics-identity": JSON.stringify({ service_account: SA, property: "properties/558314827" }) });
  const viaMeta = fakes();
  const c = await connectionFor({ ...GA, env: s.env, fetch: viaMeta.fetchImpl });
  assert.deepEqual({ where: c.where, address: c.address, property: c.property, state: c.state }, { where: "own-store", address: SA, property: "properties/558314827", state: "unchecked" });
  assert.equal(await c.token(SCOPES), MINTED);
  assert.equal(viaMeta.seen.find((x) => x.url.includes("iamcredentials")).opts.headers.authorization, `Bearer ${OWN}`);
  const noMeta = fakes({ metadata: false });
  const d = await connectionFor({ ...GA, env: { ...s.env, GOOGLE_OAUTH_ACCESS_TOKEN: AMBIENT }, fetch: noMeta.fetchImpl });
  assert.equal(await d.token(SCOPES), MINTED);
  const iam = noMeta.seen.find((x) => x.url.includes("iamcredentials"));
  assert.equal(iam.opts.headers.authorization, `Bearer ${AMBIENT}`);
  assert.deepEqual(iam.body, { scope: SCOPES, lifetime: "300s" });
  assert.ok(!noMeta.seen.some((x) => x.url.includes("/caller-grants/")));
  const none = await connectionFor({ ...GA, env: s.env, fetch: fakes({ metadata: false }).fetchImpl });
  await refused(none.token(SCOPES), (e) => { assert.equal(e.step, "ambient"); assert.match(e.message, /GOOGLE_OAUTH_ACCESS_TOKEN/); });
});

test("store, identity as a service account key file: an RS256 JWT signed here and exchanged for the asked scopes", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" });
  const file = { type: "service_account", project_id: "p", private_key_id: "kid123", private_key: pem, client_email: SA, token_uri: "https://oauth2.googleapis.com/token" };
  const s = store({ "google-analytics-identity": JSON.stringify(file) }, { MESH_CONNECTION_PROPERTY_PROPERTY: "558314827" });
  const { fetchImpl, seen } = fakes();
  const c = await connectionFor({ ...GA, env: s.env, fetch: fetchImpl });
  assert.equal(c.address, SA);
  assert.equal(c.property, "558314827");
  assert.equal(await c.token(SCOPES), MINTED);
  assert.equal(seen.length, 1);
  const form = new URLSearchParams(seen[0].opts.body);
  assert.equal(form.get("grant_type"), "urn:ietf:params:oauth:grant-type:jwt-bearer");
  const [h, p, sig] = form.get("assertion").split(".");
  const dec = (x) => JSON.parse(Buffer.from(x, "base64url").toString("utf8"));
  assert.deepEqual(dec(h), { alg: "RS256", typ: "JWT", kid: "kid123" });
  const claims = dec(p);
  assert.deepEqual([claims.iss, claims.scope, claims.aud, claims.exp - claims.iat], [SA, SCOPES[0], "https://oauth2.googleapis.com/token", 300]);
  assert.ok(createVerify("RSA-SHA256").update(`${h}.${p}`).verify(publicKey, Buffer.from(sig, "base64url")));
  // Google refusing the assertion names the step and status, not its body.
  const bad = await connectionFor({ ...GA, env: s.env, fetch: fakes({ jwt: 400 }).fetchImpl });
  await refused(bad.token(SCOPES), (e) => { assert.equal(e.step, "jwt"); assert.equal(e.status, 400); });
  // A token_uri that is not Google's is refused before anything is signed or sent.
  const t = store({ "google-analytics-identity": JSON.stringify({ ...file, token_uri: "http://evil.example/token" }) });
  const f = fakes();
  await refused((await connectionFor({ ...GA, env: t.env, fetch: f.fetchImpl })).token(SCOPES), (e) => assert.equal(e.code, "BAD_CREDENTIAL"));
  assert.equal(f.seen.length, 0);
  // A broken private key refuses without repeating it.
  const k = store({ "google-analytics-identity": JSON.stringify({ ...file, private_key: ["-----BEGIN", "PRIVATE KEY-----\nnot a key\n-----END", "PRIVATE KEY-----\n"].join(" ") }) });
  await refused((await connectionFor({ ...GA, env: k.env, fetch: fakes().fetchImpl })).token(SCOPES), (e) => assert.equal(e.code, "BAD_CREDENTIAL"));
});

test("store, Google Secret Manager: the named secret's latest version with the ambient token; 404 is no connection", async () => {
  const { fetchImpl, seen } = fakes();
  const c = await connectionFor({ ...ACME, env: { MESH_KEY_STORE: "google-secret-manager:customer-proj-1" }, fetch: fetchImpl });
  assert.equal(await c.key(), KEY_VALUE);
  assert.equal(seen.find((s) => s.url.startsWith("https://secretmanager")).url, "https://secretmanager.googleapis.com/v1/projects/customer-proj-1/secrets/acme-key/versions/latest:access");
  assert.ok(!seen.some((s) => s.url.endsWith("/resolve")));
  await refused(connectionFor({ ...ACME, env: { MESH_KEY_STORE: "google-secret-manager:customer-proj-1" }, fetch: fakes({ secret: 404 }).fetchImpl }), (e) => {
    assert.equal(e.code, "NO_CONNECTION");
    assert.match(e.message, /your own store \(Google Secret Manager\) holds no credential named acme-key/);
    assert.ok(!e.message.includes("customer-proj-1"));
  });
  await refused(connectionFor({ ...ACME, env: { MESH_KEY_STORE: "google-secret-manager:customer-proj-1" }, fetch: fakes({ secret: 403 }).fetchImpl }), (e) => assert.equal(e.code, "STORE_DENIED"));
  await refused(connectionFor({ ...ACME, env: { MESH_KEY_STORE: "google-secret-manager:" }, fetch: fetchImpl }), (e) => assert.equal(e.code, "SETUP"));
});

test("the reserved slots: AWS Secrets Manager and identities other than Google's are refused as not built", async () => {
  await refused(connectionFor({ ...ACME, env: { MESH_KEY_STORE: "aws-secrets-manager:us-east-1" }, fetch: fakes().fetchImpl }), (e) => { assert.equal(e.code, "NOT_BUILT"); assert.match(e.message, /not built yet/); });
  for (const cloud of ["aws", "azure"]) {
    const s = store({ "google-analytics-identity": JSON.stringify({ cloud, role_arn: "arn:aws:iam::1:role/x" }) });
    await refused(connectionFor({ ...GA, env: s.env, fetch: fakes().fetchImpl }), (e) => { assert.equal(e.code, "NOT_BUILT"); assert.match(e.message, new RegExp(`an identity for ${cloud} is not built yet`)); });
  }
});

test("a credential that is not what it should be is refused without repeating it", async () => {
  for (const content of [`not json ${KEY_VALUE}`, `{"type":"service_account","client_email":"x","private_key":"${KEY_VALUE}"}`, `{"service_account":"${KEY_VALUE}"}`, `{ broken json ${KEY_VALUE}`]) {
    const s = store({ "google-analytics-identity": content });
    await refused(connectionFor({ ...GA, env: s.env, fetch: fakes().fetchImpl }), (e) => assert.equal(e.code, "BAD_CREDENTIAL"));
  }
  await refused(connectionFor({ ...ACME, env: store({ "acme-key": "  \n" }).env, fetch: fakes().fetchImpl }), (e) => assert.equal(e.code, "BAD_CREDENTIAL"));
});

test("a JSON key credential without a key member is refused, not handed on whole; long names stay under 600 characters", async () => {
  await refused(connectionFor({ ...ACME, env: store({ "acme-key": JSON.stringify({ api_key: KEY_VALUE, property: "x" }) }).env, fetch: fakes().fetchImpl }), (e) => assert.equal(e.code, "BAD_CREDENTIAL"));
  const long = "n".repeat(128);
  const deep = mkdtempSync(join(tmpdir(), "x".repeat(150)));
  await refused(connectionFor({ ...ACME, input: "i".repeat(64), what: "W".repeat(60), env: { MESH_KEY_STORE: `host:${deep}`, [connectionEnv("i".repeat(64))]: long }, fetch: fakes().fetchImpl }), (e) => {
    assert.equal(e.code, "NO_CONNECTION");
    assert.ok(!e.message.includes(deep), "the folder is not named in a reply");
  });
  await refused(connectionFor({ ...ACME, env: { ...store().env, MESH_CONNECTION_ACCOUNT: "n".repeat(129) }, fetch: fakes().fetchImpl }), (e) => assert.equal(e.code, "SETUP"));
});

test("store, Secret Manager with an address to act as: the metadata server is asked once, then GOOGLE_OAUTH_ACCESS_TOKEN serves both reads", async () => {
  const { fetchImpl, seen } = fakes({ metadata: false });
  const sm = async (url, opts) => (String(url).startsWith("https://secretmanager") ? reply(200, { payload: { data: Buffer.from(JSON.stringify({ service_account: SA })).toString("base64") } }) : fetchImpl(url, opts));
  const c = await connectionFor({ ...GA, env: { MESH_KEY_STORE: "google-secret-manager:customer-proj-1", GOOGLE_OAUTH_ACCESS_TOKEN: AMBIENT }, fetch: sm });
  assert.equal(await c.token(SCOPES), MINTED);
  assert.equal(seen.filter((s) => s.url === METADATA_TOKEN).length, 1);
});
