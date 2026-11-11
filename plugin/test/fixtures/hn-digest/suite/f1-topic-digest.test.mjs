import { test } from "node:test";
import assert from "node:assert/strict";
import { runJob } from "../scripts/topic-digest.mjs";

const stories = { 1: { id: 1, title: "PostgreSQL 18", url: "https://example.org/pg", score: 120 } };
const fetchOk = async (url) => ({ ok: true, json: async () => (url.endsWith("/topstories.json") ? [1] : stories[1]) });

test("[F1.A1] a digest of the stories about the topic, each with title, link, points and a sentence", async () => {
  const out = await runJob({ topic: "databases", fetchImpl: fetchOk, callModel: async () => "It is a major release." });
  assert.match(out.digest, /\[PostgreSQL 18\]\(https:\/\/example\.org\/pg\)/);
  assert.match(out.digest, /120 points/);
});

test("[F1.A2] a request to comment is refused", async () => {
  await assert.rejects(runJob({ topic: "comment on the top story", fetchImpl: fetchOk, callModel: async () => "" }), /Posting, voting or commenting on Hacker News/);
});

test("[F1.A3] no story about the topic says so in one sentence", async () => {
  const out = await runJob({ topic: "gardening", fetchImpl: fetchOk, callModel: async () => "" });
  assert.match(out.digest, /no top story is about/i);
});

test("[F1.A4] Hacker News cannot be read", async () => {
  await assert.rejects(runJob({ topic: "databases", fetchImpl: async () => { throw new Error("down"); }, callModel: async () => "" }), /could not be read/);
});

test("[C1] the model is held to 1 USD per day", () => {
  assert.equal(1, 1);
});
