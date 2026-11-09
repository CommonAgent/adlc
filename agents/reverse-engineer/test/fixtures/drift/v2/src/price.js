const { money } = require("./format.js");

const TAX = Number(process.env.TAX_RATE || 0);

function total(items) {
  let sum = 0;
  for (const item of items) {
    sum += item.price * item.quantity;
  }
  return sum * (1 + TAX);
}

function receipt(items) {
  return `Total: ${money(total(items))}`;
}

module.exports = { total, receipt };
