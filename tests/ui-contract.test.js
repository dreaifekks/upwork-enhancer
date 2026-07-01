const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");

test("popup exposes quick operations without API key input", () => {
  const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
  const popup = readFileSync(manifest.action.default_popup, "utf8");

  assert.equal(manifest.action.default_popup, "src/popup/popup.html");
  assert.match(popup, /id="language"/);
  assert.match(popup, /id="openProfile"/);
  assert.match(popup, /id="importProfile"/);
  assert.match(popup, /id="testAi"/);
  assert.match(popup, /id="openOptions"/);
  assert.doesNotMatch(popup, /apiKey|API key|type="password"/i);
});

test("options page supports profile URL workflow and AI testing", () => {
  const options = readFileSync("src/options/options.html", "utf8");

  assert.match(options, /name="profileUrl"/);
  assert.match(options, /id="openProfile"/);
  assert.match(options, /id="importProfile"/);
  assert.match(options, /id="testAi"/);
  assert.match(options, /name="apiKey"/);
});
