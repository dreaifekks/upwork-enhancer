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
  assert.match(popup, /class="popup-body"/);
  assert.match(popupCss, /\.popup-body\s*\{[\s\S]*overflow-y:\s*auto/);
  assert.match(
    popup,
    /<footer class="popup-footer">[\s\S]*id="status"[\s\S]*id="save"[\s\S]*<\/footer>/
  );
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

test("options page explains each settings group once", () => {
  const options = readFileSync("src/options/options.html", "utf8");
  const { MESSAGES } = require("../src/shared/i18n.js");
  const headings = Array.from(
    options.matchAll(/<h2 data-i18n="([^"]+)"/g),
    (match) => match[1]
  );

  assert.deepEqual(headings, [
    "options.sectionProfile",
    "options.sectionMatching",
    "options.sectionBudget",
    "options.sectionRisk",
    "options.weights",
    "options.thresholds",
    "options.ai",
    "options.sectionAppearance"
  ]);
  Array.from(options.matchAll(/data-i18n="([^"]+)"/g), (match) => match[1]).forEach(
    (key) => {
      assert.ok(MESSAGES.en[key], `missing en message for ${key}`);
      assert.ok(MESSAGES.zh[key], `missing zh message for ${key}`);
    }
  );
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

test("job card strip leads with one verdict and flags only what needs attention", () => {
  const contentScript = readFileSync("src/content/upworkContentScript.js", "utf8");
  const css = readFileSync("src/content/upworkContentScript.css", "utf8");

  assert.match(contentScript, /function verdictBadge\(result\)/);
  assert.match(
    contentScript,
    /panel\.className = `uwe-card-panel uwe-card-panel--\$\{result\.recommendedAction\}`/
  );
  assert.match(contentScript, /class="uwe-badge uwe-badge--verdict uwe-score-help"/);
  assert.match(contentScript, /if \(context === "job"\) return "";/);
  assert.match(
    contentScript,
    /tone === "weak" \|\| \(metric === "risk" && tone === "fair"\)/
  );
  assert.doesNotMatch(contentScript, /uwe-badge--overall/);
  assert.match(css, /\.uwe-card-panel\s*\{[^}]*background:\s*var\(--uwe-capsule-fill\)/);
  assert.match(css, /\.uwe-card-panel\s*\{[^}]*width:\s*fit-content/);
  assert.match(css, /\.uwe-badge--verdict\s*\{[^}]*background:\s*var\(--uwe-tone-solid\)/);
  assert.match(css, /\.uwe-flag\s*\{[^}]*background:\s*var\(--uwe-tone-mark\)/);
  ["apply", "watch", "maybe", "pass"].forEach((action) => {
    assert.match(css, new RegExp(`\\.uwe-card-panel--${action},`));
  });
});

test("recommended actions share one accent at graded strength", () => {
  const css = readFileSync("src/content/upworkContentScript.css", "utf8");
  const verdictTone = (action) => {
    const match = css.match(
      new RegExp(`\\.uwe-card-panel--${action},[^{]*\\{([^}]*)\\}`)
    );
    assert.ok(match, `missing verdict tone for ${action}`);
    return match[1];
  };

  assert.match(verdictTone("apply"), /--uwe-tone-solid:\s*var\(--uwe-accent-solid\)/);
  assert.match(verdictTone("watch"), /--uwe-tone-solid:\s*var\(--uwe-accent-strong\)/);
  assert.match(verdictTone("maybe"), /--uwe-tone-solid:\s*var\(--uwe-accent-soft\)/);
  assert.match(verdictTone("pass"), /--uwe-tone-solid:\s*transparent/);
  ["apply", "watch", "maybe"].forEach((action) => {
    assert.match(verdictTone(action), /--uwe-tone-mark:\s*var\(--uwe-accent-mark\)/);
  });
  assert.doesNotMatch(verdictTone("pass"), /--uwe-accent/);
  // Only the fill carries the accent; the score and label stay in plain ink.
  ["watch", "maybe"].forEach((action) => {
    assert.match(verdictTone(action), /--uwe-tone-on-solid:\s*var\(--uwe-ink\)/);
  });
  // Tabular digits look loose in Upwork's typeface; scores use proportional figures.
  assert.doesNotMatch(css, /tabular-nums/);
  // Blue and amber verdict colours are gone; amber and red remain for warnings only.
  assert.doesNotMatch(css, /--uwe-info-/);
  assert.doesNotMatch(css, /--uwe-warn-solid/);
  assert.match(css, /\.uwe-tone--fair\s*\{[^}]*--uwe-warn-mark/);
  assert.match(css, /\.uwe-tone--weak\s*\{[^}]*--uwe-bad-mark/);
  assert.match(
    css,
    /\.uwe-choice\[aria-pressed="true"\]\s*\{[^}]*border-color:\s*var\(--uwe-accent\)/
  );
});

test("injected UI inherits the host typeface and keeps forced themes readable", () => {
  const contentScript = readFileSync("src/content/upworkContentScript.js", "utf8");
  const css = readFileSync("src/content/upworkContentScript.css", "utf8");

  assert.match(css, /font-family:\s*inherit/);
  assert.doesNotMatch(css, /font-family:[^;]*Inter/);
  assert.match(contentScript, /"uwe-surface-solid",\s*theme === settings\.theme && theme !== detectPageTheme\(\)/);
  assert.match(css, /\.uwe-surface-solid\s*\{[^}]*background:\s*var\(--uwe-surface\)/);
});

test("detail review header summarizes verdict, reason, and sub-scores", () => {
  const contentScript = readFileSync("src/content/upworkContentScript.js", "utf8");
  const css = readFileSync("src/content/upworkContentScript.css", "utf8");

  assert.match(contentScript, /class="uwe-verdict__reason"/);
  assert.match(
    contentScript,
    /<div class="uwe-sidebar__compact">\$\{metricBadges\(result\)\}<\/div>/
  );
  assert.match(contentScript, /function reasonColumns\(result\)/);
  assert.match(contentScript, /data-uwe-toggle-label/);
  assert.match(contentScript, /new ResizeObserver/);
  assert.match(contentScript, /"uwe-sidebar--narrow", width < SIDEBAR_NARROW_WIDTH/);
  assert.match(
    css,
    /\.uwe-sidebar--collapsed \.uwe-sidebar__caption,\s*\.uwe-sidebar:not\(\.uwe-sidebar--collapsed\) \.uwe-sidebar__compact,\s*\.uwe-sidebar--collapsed \.uwe-sidebar__body\s*\{\s*display:\s*none/
  );
  assert.match(css, /\.uwe-sidebar--narrow \.uwe-breakdown/);
  assert.match(css, /\.uwe-sidebar \[hidden\]\s*\{\s*display:\s*none !important/);
});

test("score tips stay inside the panel they belong to", () => {
  const contentScript = readFileSync("src/content/upworkContentScript.js", "utf8");
  const css = readFileSync("src/content/upworkContentScript.css", "utf8");

  assert.match(contentScript, /function positionScoreTip\(trigger\)/);
  assert.match(contentScript, /--uwe-tip-shift/);
  assert.match(css, /left:\s*var\(--uwe-tip-shift, 0px\)/);
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
