const { money } = require("./format.js");

function total(items) {
  let sum = 0;
  for (const item of items) {
    sum += item.price * item.quantity;
  }
  return sum;
}

function receipt(items) {
  return `Total: ${money(total(items))}`;
}

module.exports = { total, receipt };
