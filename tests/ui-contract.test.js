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
  assert.match(popup, /data-tag-editor="preferredSkills"/);
  assert.match(popup, /data-tag-editor="avoidedSkills"/);
  assert.doesNotMatch(popup, /<textarea id="preferredSkills"/);
  assert.match(popupCss, /--tag-editor-rows:\s*3/);
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
  assert.match(options, /name="offPlatformPhrases"/);
  assert.match(options, /data-tag-editor="preferredSkills"/);
  assert.match(options, /data-tag-editor="preferredProjectTypes"/);
  assert.doesNotMatch(options, /<textarea name="preferredSkills"/);
  assert.doesNotMatch(options, /<textarea name="preferredProjectTypes"/);
  assert.match(readFileSync("src/options/options.css", "utf8"), /--tag-editor-rows:\s*3/);
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
  assert.match(contentScript, /function detailPlacement\(\)\s*{\s*return "inline";\s*}/);
  assert.match(contentScript, /findInlineReviewAnchor/);
  assert.match(contentScript, /findMainContentRect/);
  assert.match(contentScript, /mergeRects/);
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

test("detail scores are available to matching list cards", () => {
  const contentScript = readFileSync("src/content/upworkContentScript.js", "utf8");

  assert.match(contentScript, /detailScoreCache/);
  assert.match(contentScript, /function cacheDetailScore/);
  assert.match(contentScript, /function cachedDetailScoreForJob/);
  assert.match(contentScript, /data-uwe-score-source/);
  assert.match(contentScript, /cacheDetailScore\(job, result\)/);
  assert.match(
    contentScript,
    /await renderDetailSidebar\(\);\s*renderListBadges\(\);/
  );
});

test("detail review reuses stable markup between data refreshes", () => {
  const contentScript = readFileSync("src/content/upworkContentScript.js", "utf8");

  assert.match(
    contentScript,
    /signature === lastSidebarSignature &&\s*sidebar\.querySelector\("\.uwe-sidebar__body"\)/
  );
  assert.doesNotMatch(
    contentScript,
    /signature === lastSidebarSignature[\s\S]{0,240}sidebar\.contains\(document\.activeElement\)/
  );
});

test("inline detail review only anchors to summary content", () => {
  const contentScript = readFileSync("src/content/upworkContentScript.js", "utf8");

  assert.match(contentScript, /function placeSidebar\(sidebar, placement, anchor\)/);
  assert.match(contentScript, /function ensureInlineSidebarAnchored\(sidebar, placement\)/);
  assert.match(contentScript, /placement === "inline" && !anchor && !existingSidebar/);
  assert.match(contentScript, /return isSummaryLikeElement\(element, text\);/);
  assert.match(contentScript, /ensureInlineSidebarAnchored\(sidebar, placement\);/);
  assert.doesNotMatch(contentScript, /titleBlock\.nextElementSibling/);
});
