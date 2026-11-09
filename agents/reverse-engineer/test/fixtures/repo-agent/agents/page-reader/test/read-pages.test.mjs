import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fakePages } from "../../../shared/fake-pages.mjs";
import { VERSION, readPages } from "../scripts/read-pages.mjs";

test("reads each page and says where its text is", () => {
  const pages = readPages(fakePages(), 3);
  assert.deepEqual(pages.map((p) => p.from), ["heading", "body", "none"]);
  assert.equal(VERSION, "page-reader-v1");
  assert.ok(readFileSync(new URL("./fixtures/sample.txt", import.meta.url), "utf8").length);
});
