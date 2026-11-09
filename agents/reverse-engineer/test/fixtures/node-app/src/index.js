// Greets people by name.
const STYLE = process.env.GREETING_STYLE || "plain";

function greet(name) {
  if (typeof name !== "string") {
    throw new TypeError("name must be a string");
  }
  if (name.trim() === "") {
    return "Hello, stranger!";
  }
  const words = STYLE === "loud" ? `HELLO, ${name.toUpperCase()}` : `Hello, ${name}`;
  return `${words}!`;
}

function farewell(name) {
  return `Goodbye, ${name}`;
}

function unusedHelper(x) {
  return x * 2;
}

module.exports = { greet, farewell };
