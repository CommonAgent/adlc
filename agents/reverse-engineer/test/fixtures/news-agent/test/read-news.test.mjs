import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeFeed } from "../../shared/fake-feed.mjs";
import { FORMAT, readTop } from "../scripts/read-news.mjs";

test("reads the top items, the article first", async () => {
  const items = await readTop(2, fakeFeed());
  assert.equal(items[0].text_from, "article");
  assert.equal(FORMAT, "news-top-v1");
});
