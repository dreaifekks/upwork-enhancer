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
  assert.match(popupCss, /overflow-x:\s*hidden/);
  assert.match(popupCss, /#status\s*\{[\s\S]*white-space:\s*normal/);
  assert.match(popupCss, /#status\s*\{[\s\S]*overflow-wrap:\s*anywhere/);
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
  assert.match(readFileSync("src/options/options.js", "utf8"), /validateThresholdOrder/);
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
  assert.match(contentScript, /runtimeErrorMessage/);
  assert.match(contentScript, /extension context invalidated/i);
  assert.match(contentScript, /sidebar\.extensionReloaded/);
  assert.match(contentScript, /sidebar\.aiError/);
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

test("content script supports proposal question templates", () => {
  const defaults = readFileSync("src/shared/defaultSettings.js", "utf8");
  const parser = readFileSync("src/content/upworkParser.js", "utf8");
  const contentScript = readFileSync("src/content/upworkContentScript.js", "utf8");
  const background = readFileSync("src/background/serviceWorker.js", "utf8");
  const css = readFileSync("src/content/upworkContentScript.css", "utf8");

  assert.match(defaults, /QUESTION_TEMPLATES_STORAGE_KEY/);
  assert.match(parser, /function parseProposalQuestions/);
  assert.match(parser, /proposalQuestions:\s*parseProposalQuestions/);
  assert.match(contentScript, /GET_QUESTION_TEMPLATES/);
  assert.match(contentScript, /SAVE_QUESTION_TEMPLATE/);
  assert.match(contentScript, /DELETE_QUESTION_TEMPLATE/);
  assert.match(contentScript, /AI_GENERATE_QUESTION_ANSWER/);
  assert.match(contentScript, /data-uwe-ai-answer/);
  assert.match(contentScript, /fillQuestionAnswersFromAiText/);
  assert.match(contentScript, /bestQuestionTemplateMatch/);
  assert.match(contentScript, /proposalQuestionAnswerTemplates/);
  assert.match(contentScript, /class="uwe-question-details"/);
  assert.match(contentScript, /sidebar\.questionCollapsedHint/);
  assert.match(background, /case "SAVE_QUESTION_TEMPLATE"/);
  assert.match(background, /case "AI_GENERATE_QUESTION_ANSWER"/);
  assert.match(background, /proposalQuestions/);
  assert.match(background, /buildQuestionAnswerPrompt/);
  assert.match(css, /uwe-question-panel/);
  assert.match(css, /uwe-question-collapsed-hint/);
  assert.match(css, /uwe-question-details\[open\]/);
  assert.match(css, /uwe-template-manager/);
});

test("profile parser can persist a public freelancer profile URL", () => {
  const parser = readFileSync("src/content/upworkParser.js", "utf8");

  assert.match(parser, /function profileUrlFromDocument/);
  assert.match(parser, /a\[href\*="\/freelancers\/~"\]/);
  assert.match(parser, /https:\/\/www\.upwork\.com/);
  assert.match(parser, /profileUrl:\s*profileUrlFromDocument\(doc\)/);
});

test("detail parser accepts saved preview h4 titles without section headings", () => {
  const parser = readFileSync("src/content/upworkParser.js", "utf8");

  assert.match(parser, /function isDetailLikeUrl/);
  assert.match(parser, /function detailRootFromCurrentJobId/);
  assert.match(parser, /function findDetailRootNode/);
  assert.match(parser, /detailRootFromCurrentJobId\(doc\)/);
  assert.match(parser, /function firstDetailTitle/);
  assert.match(parser, /function isSectionHeading/);
  assert.match(parser, /isDetailLikeUrl\(currentUrl\)/);
  assert.match(parser, /Skills and Expertise/);
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
    /renderDetailSidebar\(\)\.catch\(\(\) => null\);\s*scheduleListRender\(\);/
  );
  assert.match(contentScript, /requestIdleCallback/);
  assert.doesNotMatch(contentScript, /setInterval\(/);
  assert.match(contentScript, /detailDraftCache/);
  assert.match(contentScript, /captureSidebarDraft/);
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
  assert.match(contentScript, /UWE\.findDetailRootNode && UWE\.findDetailRootNode\(document\)/);
  assert.match(contentScript, /placement === "inline" && !anchor/);
  assert.match(contentScript, /document\.querySelector\("\.uwe-sidebar"\)\?\.remove\(\);/);
  assert.doesNotMatch(contentScript, /placement = "floating-left"/);
  assert.match(contentScript, /return isSummaryLikeElement\(element, text\);/);
  assert.match(contentScript, /ensureInlineSidebarAnchored\(sidebar, placement\);/);
  assert.doesNotMatch(contentScript, /titleBlock\.nextElementSibling/);
});
