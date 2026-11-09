const { test } = require("node:test");
const assert = require("node:assert");
const { total } = require("../src/price.js");

test("adds up price times quantity", () => {
  assert.strictEqual(total([{ price: 2, quantity: 3 }]), 6);
});
