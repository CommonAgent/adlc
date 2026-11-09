const { test } = require("node:test");
const assert = require("node:assert");
const { greet } = require("../src/index.js");

test("greets a person by name", () => {
  assert.strictEqual(greet("Ada"), "Hello, Ada!");
});

test("greets an empty name as a stranger", () => {
  assert.strictEqual(greet("  "), "Hello, stranger!");
});

test("refuses a name that is not a string", () => {
  assert.throws(() => greet(42), TypeError);
});
