function discount(amount, percent) {
  if (percent < 0 || percent > 100) {
    throw new RangeError("percent must be from 0 to 100");
  }
  return amount * (1 - percent / 100);
}

module.exports = { discount };
