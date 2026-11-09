#!/usr/bin/env node
const { greet } = require("../src/index.js");

const name = process.argv[2];
if (!name) {
  console.error("usage: greet <name>");
  process.exit(2);
}
console.log(greet(name));
