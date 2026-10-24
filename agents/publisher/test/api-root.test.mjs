// 0.2.3: MESH_API_BASE is the platform's origin, as the deployment manager sets
// it; the API is under /v1 there (technical debt 271). A value set by hand with
// /v1 is read as it stands, and none gives the default.
// Run: node --test test/api-root.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { API_DEFAULT, apiRootOf } from "../scripts/place.mjs";

test("the API root is the origin plus /v1, a /v1 already there kept, none the default", () => {
  assert.equal(apiRootOf("https://app.test"), "https://app.test/v1");
  assert.equal(apiRootOf("https://app.test/"), "https://app.test/v1");
  assert.equal(apiRootOf("https://api.test/v1/"), "https://api.test/v1");
  assert.equal(apiRootOf(undefined), API_DEFAULT);
});
