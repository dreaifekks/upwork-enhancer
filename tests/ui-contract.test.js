const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");

test("popup exposes quick operations without API key input", () => {
  const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
  const popup = readFileSync(manifest.action.default_popup, "utf8");
  const popupCss = readFileSync("src/popup/popup.css", "utf8");

  assert.equal(manifest.action.default_popup, "src/popup/popup.html");
  assert.match(popup, /id="language"/);
  assert.match(popup, /id="theme"/);
  assert.match(popup, /id="openProfile"/);
  assert.match(popup, /id="importProfile"/);
  assert.match(popup, /id="testAi"/);
  assert.match(popup, /id="openOptions"/);
  assert.match(popupCss, /height:\s*600px/);
  assert.doesNotMatch(popupCss, /100vh/);
  assert.doesNotMatch(popup, /apiKey|API key|type="password"/i);
});

test("options page supports profile URL workflow and AI testing", () => {
  const options = readFileSync("src/options/options.html", "utf8");

  assert.match(options, /name="profileUrl"/);
  assert.match(options, /name="theme"/);
  assert.match(options, /id="openProfile"/);
  assert.match(options, /id="importProfile"/);
  assert.match(options, /id="testAi"/);
  assert.match(options, /name="apiKey"/);
});

test("content script handles invalidated extension runtime messages", () => {
  const contentScript = readFileSync("src/content/upworkContentScript.js", "utf8");

  assert.match(contentScript, /try\s*{\s*runtime\.sendMessage/s);
  assert.match(contentScript, /catch \(error\)\s*{\s*resolve\(\{ ok: false/s);
  assert.match(contentScript, /safeRuntimeLastError/);
});

test("content script supports anchored detail panel and theme classes", () => {
  const contentScript = readFileSync("src/content/upworkContentScript.js", "utf8");
  const css = readFileSync("src/content/upworkContentScript.css", "utf8");

  assert.match(contentScript, /function positionSidebar/);
  assert.match(contentScript, /function detailPlacement/);
  assert.match(contentScript, /findInlineReviewAnchor/);
  assert.match(contentScript, /findMainContentRect/);
  assert.match(contentScript, /mergeRects/);
  assert.match(contentScript, /availableRight/);
  assert.match(contentScript, /AI_ANALYZE_STREAM/);
  assert.match(contentScript, /AI_ANALYZE_STREAM_EVENT/);
  assert.match(contentScript, /renderAiState/);
  assert.match(contentScript, /uwe-theme-dark/);
  assert.match(contentScript, /uwe-score-help/);
  assert.match(css, /uwe-sidebar--inline/);
  assert.match(css, /uwe-sidebar--floating-left/);
  assert.match(css, /uwe-score-tip/);
  assert.match(css, /@media \(max-width: 980px\)/);
});
