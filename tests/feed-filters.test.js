const test = require("node:test");
const assert = require("node:assert/strict");

const memory = require("../src/content/feedFilterMemory.js");

test("feed filter labels drop the live result count", () => {
  assert.equal(memory.stripCount("Payment verified (80)"), "Payment verified");
  assert.equal(memory.stripCount("$1,000 to $5,000 (8)"), "$1,000 to $5,000");
  assert.equal(memory.stripCount("  10+ hires  (1,032) "), "10+ hires");
  assert.equal(memory.stripCount("Hourly"), "Hourly");
});

test("empty feed filter state does not trigger a restore", () => {
  assert.equal(memory.hasState(null), false);
  assert.equal(memory.hasState({ checked: [], inputs: {} }), false);
  assert.equal(memory.hasState({ checked: ["clientInfo::Payment verified"] }), true);
  assert.equal(memory.hasState({ checked: [], inputs: { "fixed-price-min-input": "100" } }), true);
});
