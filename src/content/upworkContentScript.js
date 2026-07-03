(function attachContentScript(root) {
  const CONTENT_SCRIPT_VERSION = "0.1.16";
  const UWE = root.UpworkEnhancer || {};
  const runtime =
    typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage
      ? chrome.runtime
      : null;

  let settings = UWE.publicSettings
    ? UWE.publicSettings(UWE.DEFAULT_SETTINGS)
    : UWE.DEFAULT_SETTINGS;
  let renderTimer = null;
  let currentUrl = window.location.href;
  let lastSidebarSignature = "";
  let aiAnalysisState = null;
  let questionTemplates = [];
  const detailScoreCache = new Map();
  const DETAIL_SCORE_CACHE_MAX = 30;
  const QUESTION_TEMPLATE_MATCH_THRESHOLD = 0.38;

  if (document.documentElement) {
    document.documentElement.setAttribute(
      "data-uwe-content-script-version",
      CONTENT_SCRIPT_VERSION
    );
  }

  function t(key, params) {
    return UWE.t(settings.language, key, params);
  }

  function localize(reason) {
    return UWE.localizeReason(settings.language, reason);
  }

  function currentTheme() {
    if (settings.theme === "light" || settings.theme === "dark") {
      return settings.theme;
    }
    return detectPageTheme();
  }

  function detectPageTheme() {
    const candidates = [
      document.body,
      document.querySelector("main"),
      document.querySelector("[role='main']"),
      document.documentElement
    ].filter(Boolean);

    for (const element of candidates) {
      const color = window.getComputedStyle(element).backgroundColor;
      const rgb = parseRgb(color);
      if (!rgb) continue;
      const luminance = relativeLuminance(rgb);
      if (luminance < 0.45) return "dark";
      if (luminance > 0.72) return "light";
    }

    return window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }

  function applyTheme(element) {
    if (!element || !element.classList) return;
    const theme = currentTheme();
    element.classList.toggle("uwe-theme-dark", theme === "dark");
    element.classList.toggle("uwe-theme-light", theme === "light");
    element.setAttribute("data-uwe-theme", theme);
  }

  function parseRgb(value) {
    const channels = String(value || "").match(/[\d.]+/g);
    if (!channels || channels.length < 3) return null;
    if (channels.length >= 4 && Number(channels[3]) === 0) return null;
    return [Number(channels[0]), Number(channels[1]), Number(channels[2])];
  }

  function relativeLuminance(rgb) {
    const [r, g, b] = rgb.map((value) => {
      const channel = Math.max(0, Math.min(255, value)) / 255;
      return channel <= 0.03928
        ? channel / 12.92
        : Math.pow((channel + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function sendMessage(message) {
    if (!runtime) {
      return Promise.resolve({
        ok: false,
        error: runtimeErrorMessage("runtime unavailable")
      });
    }
    return new Promise((resolve) => {
      try {
        runtime.sendMessage(message, (response) => {
          const lastError = safeRuntimeLastError();
          resolve(
            response ||
              (lastError
                ? { ok: false, error: lastError }
                : { ok: false, error: "empty response" })
          );
        });
      } catch (error) {
        resolve({ ok: false, error: runtimeErrorMessage(error) });
      }
    });
  }

  function safeRuntimeLastError() {
    try {
      const lastError =
        typeof chrome !== "undefined" &&
        chrome.runtime &&
        chrome.runtime.lastError;
      return lastError ? runtimeErrorMessage(lastError) : "";
    } catch (error) {
      return runtimeErrorMessage(error);
    }
  }

  function rawErrorMessage(error) {
    if (!error) return "";
    return error.message || String(error);
  }

  function runtimeErrorMessage(error) {
    const message = rawErrorMessage(error);
    if (/extension context invalidated/i.test(message)) {
      return t("sidebar.extensionReloaded");
    }
    return message;
  }

  function handleAiStreamEvent(message) {
    if (!aiAnalysisState || message.requestId !== aiAnalysisState.requestId) {
      return;
    }

    if (typeof message.delta === "string") {
      aiAnalysisState.text += message.delta;
    }
    if (
      typeof message.text === "string" &&
      (message.text || !aiAnalysisState.text)
    ) {
      aiAnalysisState.text = message.text;
    }
    if (message.error) {
      aiAnalysisState.status = "error";
      aiAnalysisState.error = String(message.error);
    } else if (message.done) {
      aiAnalysisState.status = "done";
      aiAnalysisState.error = "";
    }

    renderAiState(document.querySelector(".uwe-sidebar"));
  }

  if (runtime && runtime.onMessage) {
    runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message && message.type === "SETTINGS_UPDATED" && message.settings) {
        settings = message.settings;
        invalidateRenderedScores();
        scheduleRender();
        return false;
      }
      if (message && message.type === "AI_ANALYZE_STREAM_EVENT") {
        handleAiStreamEvent(message);
        return false;
      }
      if (message && message.type === "REQUEST_PROFILE_SNAPSHOT") {
        if (!UWE.isLikelyProfilePage || !UWE.isLikelyProfilePage(document)) {
          sendResponse({
            ok: false,
            error: "Open your Upwork freelancer profile page first."
          });
          return false;
        }
        sendResponse({
          ok: true,
          profile: UWE.parseFreelancerProfile(document)
        });
        return false;
      }
      return false;
    });
  }

  async function loadSettings() {
    const response = await sendMessage({ type: "GET_PUBLIC_SETTINGS" });
    if (response && response.ok && response.settings) {
      settings = response.settings;
    }
  }

  function score(job) {
    return UWE.scoreJob(job, settings);
  }

  function normalizedJobKey(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    return (UWE.extractJobIdFromUrl && UWE.extractJobIdFromUrl(raw)) || raw;
  }

  function detailCacheKeys(job, result) {
    return Array.from(
      new Set(
        [
          result && result.jobId,
          job && job.jobId,
          job && job.url,
          result && result.url
        ]
          .map(normalizedJobKey)
          .filter(Boolean)
      )
    );
  }

  function scoreSignature(result) {
    return JSON.stringify({
      jobId: result.jobId,
      overallScore: result.overallScore,
      recommendedAction: result.recommendedAction,
      matchScore: result.matchScore,
      clientQualityScore: result.clientQualityScore,
      competitionScore: result.competitionScore,
      riskScore: result.riskScore,
      riskLevel: result.riskLevel
    });
  }

  function cacheDetailScore(job, result) {
    const keys = detailCacheKeys(job, result);
    if (!keys.length) return;
    const entry = {
      job,
      result,
      signature: scoreSignature(result)
    };
    keys.forEach((key) => {
      detailScoreCache.delete(key);
      detailScoreCache.set(key, entry);
    });
    while (detailScoreCache.size > DETAIL_SCORE_CACHE_MAX) {
      detailScoreCache.delete(detailScoreCache.keys().next().value);
    }
  }

  function cachedDetailScoreForKey(value) {
    const key = normalizedJobKey(value);
    return key ? detailScoreCache.get(key) || null : null;
  }

  function cachedDetailScoreForJob(job) {
    if (!job || job.context !== "job") return null;
    const keys = detailCacheKeys(job, { jobId: job.jobId });
    for (const key of keys) {
      const entry = detailScoreCache.get(key);
      if (entry) return entry;
    }
    return null;
  }

  function badge(label, value, modifier, helpText) {
    const className = ["uwe-badge", modifier].filter(Boolean).join(" ");
    const helpClass = helpText ? " uwe-score-help" : "";
    const helpAttrs = helpText ? ' tabindex="0" role="button"' : "";
    const helpTip = helpText ? scoreTip(helpText) : "";
    return `<span class="${className}${helpClass}"${helpAttrs}><span>${escapeHtml(label)}</span><strong>${escapeHtml(
      value
    )}</strong>${helpTip}</span>`;
  }

  function contextBadge(job) {
    const knownContexts = new Set(["job", "history", "clientJob"]);
    const context = knownContexts.has(job.context) ? job.context : "job";
    const label = t(`context.${context}`);
    const title = cleanLabelTitle(job.title);
    const display = context !== "job" && title ? `${label}: ${title}` : label;
    const tooltip = title ? `${label}: ${title}` : label;
    return `<span class="uwe-badge uwe-badge--context" title="${escapeHtml(
      tooltip
    )}"><span>${escapeHtml(display)}</span></span>`;
  }

  function cleanLabelTitle(value) {
    const title = UWE.cleanText(value);
    return /^untitled job$/i.test(title) ? "" : title;
  }

  function scoreHelp(metric, result) {
    const weights = settings.weights || {};
    const thresholds = settings.thresholds || {};
    const params = {
      matchWeight: Math.round(Number(weights.match || 0) * 100),
      clientWeight: Math.round(Number(weights.clientQuality || 0) * 100),
      competitionWeight: Math.round(Number(weights.competition || 0) * 100),
      riskWeight: Math.round(Number(weights.risk || 0) * 100),
      applyThreshold: thresholds.apply,
      watchThreshold: thresholds.watch,
      passThreshold: thresholds.pass
    };
    const base = t(`scoreHelp.${metric}`, params);
    if (!result) return base;
    if (metric === "action") {
      return `${base} ${t("action." + result.recommendedAction)}.`;
    }
    if (metric === "overall") {
      return `${base} ${t("badge.overall")}: ${result.overallScore}. ${t(
        "action." + result.recommendedAction
      )}.`;
    }
    if (metric === "risk") {
      return `${base} ${t("badge.risk")}: ${result.riskScore} (${t(
        "risk." + result.riskLevel
      )}).`;
    }
    const key =
      metric === "client"
        ? "clientQualityScore"
        : metric === "competition"
          ? "competitionScore"
          : "matchScore";
    return `${base} ${t(`badge.${metric}`)}: ${result[key]}.`;
  }

  function scoreTip(text) {
    return `<span class="uwe-score-tip" role="tooltip">${escapeHtml(text)}</span>`;
  }

  function renderJobCard(card) {
    const previousText = card.getAttribute("data-uwe-text") || "";
    const nextText = UWE.cleanText(card.textContent).slice(0, 1200);
    const existing = findExistingCardPanel(card);
    const cachedExistingScore =
      existing && cachedDetailScoreForKey(existing.getAttribute("data-uwe-job-id"));
    const existingHasFreshDetailScore =
      cachedExistingScore &&
      existing.getAttribute("data-uwe-score-source") === "detail" &&
      existing.getAttribute("data-uwe-score-signature") === cachedExistingScore.signature;
    if (
      previousText === nextText &&
      existing &&
      (!cachedExistingScore || existingHasFreshDetailScore)
    ) {
      applyTheme(existing);
      return;
    }

    const job = UWE.parseJobCard(card);
    const cachedScore = cachedDetailScoreForJob(job);
    const result = cachedScore ? cachedScore.result : score(job);
    const panel = existing || document.createElement("div");
    panel.className = "uwe-card-panel";
    applyTheme(panel);
    panel.setAttribute("data-uwe-job-id", result.jobId || "");
    panel.setAttribute("data-uwe-score-source", cachedScore ? "detail" : "list");
    panel.setAttribute(
      "data-uwe-score-signature",
      cachedScore ? cachedScore.signature : scoreSignature(result)
    );
    panel.innerHTML = [
      contextBadge(job),
      badge(
        t("badge.overall"),
        String(result.overallScore),
        "uwe-badge--overall",
        scoreHelp("overall", result)
      ),
      badge(
        "",
        t(`action.${result.recommendedAction}`),
        `uwe-badge--${result.recommendedAction}`,
        scoreHelp("action", result)
      ),
      badge(t("badge.match"), String(result.matchScore), "", scoreHelp("match", result)),
      badge(
        t("badge.client"),
        String(result.clientQualityScore),
        "",
        scoreHelp("client", result)
      ),
      badge(
        t("badge.competition"),
        String(result.competitionScore),
        "",
        scoreHelp("competition", result)
      ),
      badge(
        t("badge.risk"),
        t(`risk.${result.riskLevel}`),
        `uwe-badge--risk-${result.riskLevel}`,
        scoreHelp("risk", result)
      )
    ].join("");

    if (!existing) {
      insertCardPanel(card, panel);
    }
    card.setAttribute("data-uwe-text", nextText);
  }

  function isAnchorTarget(card) {
    return Boolean(card && card.matches && card.matches("a[href*='/jobs/']"));
  }

  function findExistingCardPanel(card) {
    if (isAnchorTarget(card)) {
      const previous = card.previousElementSibling;
      return previous && previous.classList.contains("uwe-card-panel")
        ? previous
        : null;
    }
    return card.querySelector(":scope > .uwe-card-panel");
  }

  function insertCardPanel(card, panel) {
    if (isAnchorTarget(card) && card.parentElement) {
      card.parentElement.insertBefore(panel, card);
      return;
    }
    card.insertBefore(panel, card.firstChild);
  }

  function renderListBadges() {
    UWE.findJobCards(document).forEach(renderJobCard);
  }

  function invalidateRenderedScores() {
    detailScoreCache.clear();
    document.querySelectorAll("[data-uwe-text]").forEach((element) => {
      element.removeAttribute("data-uwe-text");
    });
    lastSidebarSignature = "";
  }

  function getSidebar(placement) {
    let sidebar = document.querySelector(".uwe-sidebar");
    if (!sidebar) {
      sidebar = document.createElement("aside");
      sidebar.className = "uwe-sidebar";
    }
    sidebar.classList.toggle("uwe-sidebar--inline", placement === "inline");
    sidebar.classList.toggle("uwe-sidebar--floating-left", placement === "floating-left");
    applyTheme(sidebar);
    return sidebar;
  }

  function placeSidebar(sidebar, placement, anchor) {
    if (placement !== "inline") {
      if (sidebar.parentElement !== document.body) {
        document.body.appendChild(sidebar);
      }
      return;
    }

    const parent = (anchor && anchor.parentElement) || findDetailRoot();
    if (!anchor || !parent) {
      return;
    }
    if (anchor !== sidebar) {
      parent.insertBefore(sidebar, anchor);
      return;
    }
    if (sidebar.parentElement !== parent) {
      parent.insertBefore(sidebar, parent.firstChild);
    }
  }

  function ensureInlineSidebarAnchored(sidebar, placement) {
    if (placement !== "inline") return true;
    const anchor = findInlineReviewAnchor();
    if (!anchor) return false;
    placeSidebar(sidebar, placement, anchor);
    return true;
  }

  function positionSidebar(sidebar) {
    if (!sidebar) return;
    if (sidebar.classList.contains("uwe-sidebar--inline")) {
      sidebar.style.width = "";
      sidebar.style.left = "";
      sidebar.style.right = "";
      sidebar.style.top = "";
      sidebar.style.bottom = "";
      sidebar.style.maxHeight = "";
      return;
    }
    if (window.innerWidth <= 980) {
      sidebar.style.width = "";
      sidebar.style.left = "";
      sidebar.style.right = "";
      sidebar.style.top = "";
      sidebar.style.bottom = "";
      sidebar.style.maxHeight = "";
      return;
    }

    const gap = 14;
    const margin = 22;
    const fallbackTop = 84;
    const mainRect = findMainContentRect();
    const maxWidth = 360;
    const minWidth = 260;
    const compactMinWidth = 180;
    const measuredWidth = sidebar.getBoundingClientRect().width || maxWidth;
    let sidebarWidth = Math.min(measuredWidth, maxWidth, window.innerWidth - margin * 2);
    let top = fallbackTop;
    let left = margin;

    if (mainRect) {
      top = clamp(mainRect.top, 70, Math.max(70, window.innerHeight - 180));
      const availableLeft = Math.max(0, mainRect.left - gap - margin);
      const availableRight = window.innerWidth - mainRect.right - gap - margin;
      if (availableLeft >= compactMinWidth) {
        sidebarWidth = Math.min(sidebarWidth, maxWidth, availableLeft);
        left = mainRect.left - sidebarWidth - gap;
      } else if (availableRight >= minWidth) {
        sidebarWidth = Math.min(sidebarWidth, maxWidth, availableRight);
        left = mainRect.right + gap;
      } else if (availableLeft > 0) {
        sidebarWidth = Math.min(sidebarWidth, availableLeft);
        left = mainRect.left - sidebarWidth - gap;
      } else {
        left = clamp(
          mainRect.left + gap,
          margin,
          window.innerWidth - sidebarWidth - margin
        );
      }
    }

    sidebar.style.width = `${Math.round(sidebarWidth)}px`;
    sidebar.style.left = `${Math.round(left)}px`;
    sidebar.style.right = "auto";
    sidebar.style.top = `${Math.round(top)}px`;
    sidebar.style.bottom = "auto";
    sidebar.style.maxHeight = `calc(100vh - ${Math.round(top + margin)}px)`;
  }

  function findDetailRoot() {
    return (
      (UWE.findDetailRootNode && UWE.findDetailRootNode(document)) ||
      document.querySelector(".air3-slider-job-details .job-details-content") ||
      document.querySelector(".air3-slider-job-details") ||
      document.querySelector("[data-test='job-details']") ||
      document.querySelector("[data-test*='job-detail']") ||
      document.querySelector("main") ||
      document.body
    );
  }

  function detailPlacement() {
    return "inline";
  }

  function findInlineReviewAnchor() {
    const rootNode = findDetailRoot();
    const candidates = Array.from(
      rootNode.querySelectorAll(
        ".air3-card-section, section, article, div, p"
      )
    )
      .filter((element) => {
        if (element.closest(".uwe-sidebar, .uwe-card-panel")) return false;
        const rect = element.getBoundingClientRect();
        if (rect.width < 260 || rect.height < 40) return false;
        const text = UWE.cleanText(element.textContent);
        if (text.length < 80 || text.length > 12000) return false;
        return isSummaryLikeElement(element, text);
      })
      .sort((a, b) => {
        const aSlider = a.closest(".air3-slider-job-details") ? 0 : 1;
        const bSlider = b.closest(".air3-slider-job-details") ? 0 : 1;
        if (aSlider !== bSlider) return aSlider - bSlider;
        const aSection = a.matches("section, .air3-card-section") ? 0 : 1;
        const bSection = b.matches("section, .air3-card-section") ? 0 : 1;
        if (aSection !== bSection) return aSection - bSection;
        return (
          UWE.cleanText(a.textContent).length - UWE.cleanText(b.textContent).length
        );
      });
    if (candidates[0]) {
      return (
        candidates[0].closest(".air3-card-section, section, article") ||
        candidates[0]
      );
    }

    return null;
  }

  function isSummaryLikeElement(element, text) {
    if (/^(Summary|Job Description)\b/i.test(text)) return true;
    const heading = Array.from(
      element.querySelectorAll("h1, h2, h3, h4, [role='heading']")
    )
      .map((item) => UWE.cleanText(item.textContent))
      .find(Boolean);
    if (/^(Summary|Job Description)\b/i.test(heading || "")) return true;

    let sibling = element.previousElementSibling;
    for (let index = 0; sibling && index < 3; index += 1) {
      const value = UWE.cleanText(sibling.textContent);
      if (/^(Summary|Job Description)\b/i.test(value)) return true;
      if (value.length > 80) break;
      sibling = sibling.previousElementSibling;
    }
    return false;
  }

  function findMainContentRect() {
    const title = findVisibleTitle();
    const rects = [];
    if (title) {
      const titleRect = title.getBoundingClientRect();
      rects.push(titleRect);
      let node = title.parentElement;
      while (node && node !== document.body) {
        const rect = node.getBoundingClientRect();
        if (
          rect.width >= Math.max(420, titleRect.width) &&
          rect.width <= 980 &&
          rect.left >= titleRect.left - 28 &&
          rect.left <= titleRect.left + 12 &&
          rect.height >= titleRect.height
        ) {
          rects.push(rect);
          break;
        }
        node = node.parentElement;
      }
    }
    const summary = findInlineReviewAnchor();
    if (summary) {
      rects.push(summary.getBoundingClientRect());
    }
    return rects.length ? mergeRects(rects) : null;
  }

  function mergeRects(rects) {
    const visibleRects = rects.filter(
      (rect) => rect && rect.width > 0 && rect.height > 0
    );
    if (!visibleRects.length) return null;
    const left = Math.min(...visibleRects.map((rect) => rect.left));
    const top = Math.min(...visibleRects.map((rect) => rect.top));
    const right = Math.max(...visibleRects.map((rect) => rect.right));
    const bottom = Math.max(...visibleRects.map((rect) => rect.bottom));
    return {
      left,
      top,
      right,
      bottom,
      width: right - left,
      height: bottom - top
    };
  }

  function findVisibleTitle() {
    const rootNode = findDetailRoot();
    const selector = "h1, h2, h3, h4, [data-test*='job-title']";
    return Array.from(rootNode.querySelectorAll(selector))
      .filter((element) => !element.closest(".uwe-sidebar, .uwe-card-panel"))
      .find((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 160 && rect.height > 18 && rect.bottom > 60;
      });
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  async function renderDetailSidebar() {
    if (!UWE.isLikelyDetailPage(document)) {
      document.querySelector(".uwe-sidebar")?.remove();
      lastSidebarSignature = "";
      return;
    }

    let placement = detailPlacement();
    let anchor = placement === "inline" ? findInlineReviewAnchor() : null;
    const existingSidebar = document.querySelector(".uwe-sidebar");
    if (placement === "inline" && !anchor && !existingSidebar) {
      placement = "floating-left";
      anchor = null;
    }
    const sidebar = getSidebar(placement);
    const job = UWE.parseJobDetail(document);
    const result = score(job);
    cacheDetailScore(job, result);
    questionTemplates = await loadQuestionTemplates();
    const signature = JSON.stringify({
      jobId: result.jobId,
      title: job.title,
      overallScore: result.overallScore,
      action: result.recommendedAction,
      language: settings.language,
      theme: currentTheme(),
      placement,
      apiConfigured: Boolean(settings.api && settings.api.configured),
      proposalQuestions: proposalQuestionsOf(job),
      questionTemplates: questionTemplatesSignature(questionTemplates)
    });
    if (
      signature === lastSidebarSignature &&
      sidebar.querySelector(".uwe-sidebar__body")
    ) {
      sidebar.setAttribute("data-uwe-ai-job-key", aiJobKey(job, result));
      placeSidebar(sidebar, placement, anchor);
      ensureInlineSidebarAnchored(sidebar, placement);
      applyTheme(sidebar);
      positionSidebar(sidebar);
      renderAiState(sidebar);
      return;
    }
    lastSidebarSignature = signature;
    const decisionResponse = await sendMessage({
      type: "GET_DECISION",
      jobId: result.jobId,
      url: job.url
    });
    const savedDecision =
      decisionResponse && decisionResponse.ok ? decisionResponse.decision : null;
    const selectedAction =
      (savedDecision && savedDecision.userDecision) || result.recommendedAction;
    const savedNote = (savedDecision && savedDecision.note) || "";
    const savedTags =
      savedDecision && Array.isArray(savedDecision.tags)
        ? savedDecision.tags.join(", ")
        : "";
    const collapsed =
      placement === "inline" ? false : sidebar.classList.contains("uwe-sidebar--collapsed");

    sidebar.innerHTML = sidebarTemplate(
      job,
      result,
      selectedAction,
      savedNote,
      savedTags,
      questionTemplates
    );
    sidebar.classList.toggle("uwe-sidebar--collapsed", collapsed);
    sidebar.classList.toggle("uwe-sidebar--inline", placement === "inline");
    sidebar.classList.toggle("uwe-sidebar--floating-left", placement === "floating-left");
    sidebar.setAttribute("data-uwe-ai-job-key", aiJobKey(job, result));
    placeSidebar(sidebar, placement, anchor);
    ensureInlineSidebarAnchored(sidebar, placement);
    applyTheme(sidebar);
    positionSidebar(sidebar);
    bindSidebarEvents(sidebar, job, result);
    renderAiState(sidebar);
  }

  function sidebarTemplate(
    job,
    result,
    selectedAction,
    savedNote,
    savedTags,
    templates
  ) {
    const actionLabel = t(`action.${result.recommendedAction}`);
    const reasonsFor = result.positiveReasons.map(localize);
    const reasonsAgainst = result.negativeReasons.map(localize);
    const riskNotes = result.riskNotes.map(localize);
    const missingSignals = result.missingSignals.map(localize);
    return `
      <div class="uwe-sidebar__header">
        <h2 class="uwe-sidebar__title">${escapeHtml(t("sidebar.title"))}</h2>
        <button class="uwe-sidebar__toggle" type="button" data-uwe-toggle>${escapeHtml(
          t("sidebar.collapse")
        )}</button>
      </div>
      <div class="uwe-sidebar__body">
        <section class="uwe-summary" aria-label="${escapeHtml(t("sidebar.summary"))}">
          <div class="uwe-score-ring uwe-score-help" tabindex="0" role="button">${result.overallScore}${scoreTip(
            scoreHelp("overall", result)
          )}</div>
          <div class="uwe-summary__meta">
            <div class="uwe-action uwe-action--${result.recommendedAction} uwe-score-help" tabindex="0" role="button">${escapeHtml(
              actionLabel
            )}${scoreTip(scoreHelp("action", result))}</div>
            <p class="uwe-job-title">${escapeHtml(job.title)}</p>
          </div>
        </section>
        <section class="uwe-breakdown">
          ${scoreRow(t("badge.match"), result.matchScore, scoreHelp("match", result))}
          ${scoreRow(t("badge.client"), result.clientQualityScore, scoreHelp("client", result))}
          ${scoreRow(
            t("badge.competition"),
            result.competitionScore,
            scoreHelp("competition", result)
          )}
          ${scoreRow(t("badge.risk"), result.riskScore, scoreHelp("risk", result))}
        </section>
        ${listSection(t("sidebar.reasonsFor"), reasonsFor)}
        ${listSection(t("sidebar.reasonsAgainst"), reasonsAgainst)}
        ${listSection(t("sidebar.risks"), riskNotes)}
        ${listSection(t("sidebar.missing"), missingSignals)}
        ${proposalQuestionsSection(job, templates)}
        <section class="uwe-section">
          <h3>${escapeHtml(t("sidebar.save"))}</h3>
          <div class="uwe-decision-grid">
            ${decisionButton("apply", selectedAction)}
            ${decisionButton("watch", selectedAction)}
            ${decisionButton("maybe", selectedAction)}
            ${decisionButton("pass", selectedAction)}
          </div>
          <textarea class="uwe-note" data-uwe-note placeholder="${escapeHtml(
            t("sidebar.notes")
          )}">${escapeHtml(savedNote)}</textarea>
          <input class="uwe-tags" data-uwe-tags placeholder="${escapeHtml(
            t("sidebar.tags")
          )}" value="${escapeHtml(savedTags)}" />
          <div class="uwe-actions">
            <button type="button" data-uwe-save>${escapeHtml(t("sidebar.save"))}</button>
            <button type="button" data-uwe-ai ${
              settings.api && settings.api.configured ? "" : "disabled"
            }>${escapeHtml(
              settings.api && settings.api.configured
                ? t("sidebar.ai")
                : t("sidebar.aiUnavailable")
            )}</button>
          </div>
          <div class="uwe-status" data-uwe-status></div>
          <div class="uwe-ai-result" data-uwe-ai-result hidden></div>
        </section>
      </div>
    `;
  }

  function proposalQuestionsSection(job, templates) {
    const questions = proposalQuestionsOf(job);
    if (!questions.length) return "";
    const safeTemplates = Array.isArray(templates) ? templates : [];
    return `
      <section class="uwe-section uwe-question-panel" data-uwe-question-panel>
        <details class="uwe-question-details">
          <summary class="uwe-section-heading">
            <h3>${escapeHtml(t("sidebar.proposalQuestions"))}</h3>
            <span>${escapeHtml(
              t("sidebar.questionCount", { count: questions.length })
            )}</span>
            <p class="uwe-question-collapsed-hint">${escapeHtml(
              t("sidebar.questionCollapsedHint")
            )}</p>
          </summary>
          <div class="uwe-question-list">
            ${questions
              .map((question, index) =>
                proposalQuestionCard(question, index, safeTemplates)
              )
              .join("")}
          </div>
          <details class="uwe-template-manager">
            <summary>${escapeHtml(t("sidebar.manageQuestionTemplates"))}</summary>
            <div class="uwe-template-create">
              <input
                type="text"
                data-uwe-new-template-question
                placeholder="${escapeHtml(t("sidebar.templateQuestionPlaceholder"))}"
              />
              <textarea
                data-uwe-new-template-answer
                placeholder="${escapeHtml(t("sidebar.templateAnswerPlaceholder"))}"
              ></textarea>
              <button type="button" data-uwe-template-create>${escapeHtml(
                t("sidebar.addTemplate")
              )}</button>
            </div>
            <div class="uwe-template-list">
              ${safeTemplates.length
                ? safeTemplates.map(templateEditor).join("")
                : `<p class="uwe-empty">${escapeHtml(t("sidebar.noTemplates"))}</p>`}
            </div>
          </details>
        </details>
      </section>
    `;
  }

  function proposalQuestionCard(question, index, templates) {
    const match = bestQuestionTemplateMatch(question, templates);
    const template = match && match.template ? match.template : null;
    const answer = template ? template.answer : "";
    const matchText = template
      ? t("sidebar.templateMatched", {
          percent: Math.round(match.similarity * 100)
        })
      : t("sidebar.templateNotMatched");
    return `
      <article
        class="uwe-question-card"
        data-uwe-question-index="${index}"
        data-uwe-template-id="${escapeHtml(template ? template.id : "")}"
      >
        <p class="uwe-question-card__question">${escapeHtml(
          `${index + 1}. ${question}`
        )}</p>
        <div class="uwe-question-card__match">${escapeHtml(matchText)}</div>
        <textarea
          data-uwe-question-answer
          placeholder="${escapeHtml(t("sidebar.questionAnswerPlaceholder"))}"
        >${escapeHtml(answer)}</textarea>
        <div class="uwe-question-actions">
          <button
            type="button"
            data-uwe-ai-answer
            ${settings.api && settings.api.configured ? "" : "disabled"}
          >${escapeHtml(t("sidebar.aiAnswer"))}</button>
          <button type="button" data-uwe-copy-answer>${escapeHtml(
            t("sidebar.copyAnswer")
          )}</button>
          <button type="button" data-uwe-save-question-template>${escapeHtml(
            template ? t("sidebar.updateTemplate") : t("sidebar.saveTemplate")
          )}</button>
        </div>
      </article>
    `;
  }

  function templateEditor(template) {
    return `
      <article class="uwe-template-item" data-uwe-template-id="${escapeHtml(
        template.id
      )}">
        <input
          type="text"
          data-uwe-template-question
          value="${escapeHtml(template.question)}"
        />
        <textarea data-uwe-template-answer>${escapeHtml(template.answer)}</textarea>
        <div class="uwe-template-item__actions">
          <span>${escapeHtml(templateUpdatedLabel(template))}</span>
          <button type="button" data-uwe-template-update>${escapeHtml(
            t("sidebar.updateTemplate")
          )}</button>
          <button type="button" data-uwe-template-delete>${escapeHtml(
            t("sidebar.deleteTemplate")
          )}</button>
        </div>
      </article>
    `;
  }

  function templateUpdatedLabel(template) {
    if (!template || !template.updatedAt) return "";
    const date = new Date(template.updatedAt);
    if (Number.isNaN(date.getTime())) return "";
    return t("sidebar.templateUpdated", {
      date: date.toLocaleDateString()
    });
  }

  function scoreRow(label, value, helpText) {
    const width = Math.max(0, Math.min(100, Number(value) || 0));
    return `
      <div class="uwe-breakdown__row uwe-score-help" tabindex="0" role="button">
        <span>${escapeHtml(label)}</span>
        <div class="uwe-meter"><span style="width: ${width}%"></span></div>
        <strong>${width}</strong>
        ${scoreTip(helpText)}
      </div>
    `;
  }

  function listSection(title, items) {
    if (!items.length) return "";
    return `
      <section class="uwe-section">
        <h3>${escapeHtml(title)}</h3>
        <ul class="uwe-list">
          ${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
        </ul>
      </section>
    `;
  }

  function decisionButton(action, selectedAction) {
    return `
      <button type="button" data-uwe-decision="${action}" aria-pressed="${
        action === selectedAction ? "true" : "false"
      }">${escapeHtml(t(`action.${action}`))}</button>
    `;
  }

  function bindSidebarEvents(sidebar, job, result) {
    const status = sidebar.querySelector("[data-uwe-status]");
    const note = sidebar.querySelector("[data-uwe-note]");
    const tags = sidebar.querySelector("[data-uwe-tags]");

    sidebar.querySelector("[data-uwe-toggle]").addEventListener("click", () => {
      sidebar.classList.toggle("uwe-sidebar--collapsed");
      const button = sidebar.querySelector("[data-uwe-toggle]");
      button.textContent = sidebar.classList.contains("uwe-sidebar--collapsed")
        ? t("sidebar.expand")
        : t("sidebar.collapse");
      positionSidebar(sidebar);
    });

    sidebar.querySelectorAll("[data-uwe-decision]").forEach((button) => {
      button.addEventListener("click", () => {
        sidebar.querySelectorAll("[data-uwe-decision]").forEach((item) => {
          item.setAttribute("aria-pressed", "false");
        });
        button.setAttribute("aria-pressed", "true");
      });
    });

    sidebar.querySelector("[data-uwe-save]").addEventListener("click", async () => {
      const selected = sidebar.querySelector('[data-uwe-decision][aria-pressed="true"]');
      const userDecision = selected ? selected.getAttribute("data-uwe-decision") : "";
      const response = await sendMessage({
        type: "SAVE_DECISION",
        decision: {
          jobId: result.jobId,
          url: job.url,
          title: job.title,
          userDecision,
          note: note.value,
          tags: tags.value
            .split(/[,，\n]/)
            .map((tag) => tag.trim())
            .filter(Boolean),
          scoreSnapshot: result,
          savedAt: new Date().toISOString()
        }
      });
      status.textContent = response && response.ok ? t("sidebar.saved") : "Save failed";
    });

    const aiButton = sidebar.querySelector("[data-uwe-ai]");
    aiButton.addEventListener("click", async () => {
      if (aiButton.disabled) return;
      const state = startAiAnalysis(job, result);
      renderAiState(sidebar);
      const response = await sendMessage({
        type: "AI_ANALYZE_STREAM",
        requestId: state.requestId,
        job: compactJobForAi(job),
        score: compactScoreForAi(result)
      });
      if (!aiAnalysisState || aiAnalysisState.requestId !== state.requestId) {
        return;
      }
      if (response && response.ok) {
        if (!aiAnalysisState.text && response.text) {
          aiAnalysisState.text = response.text;
        }
        aiAnalysisState.status = "done";
        aiAnalysisState.error = "";
      } else {
        const error = response && response.error ? response.error : "AI failed";
        aiAnalysisState.status = "error";
        aiAnalysisState.error = error;
      }
      renderAiState(sidebar);
    });

    bindQuestionTemplateEvents(sidebar, job);
  }

  async function loadQuestionTemplates() {
    const response = await sendMessage({ type: "GET_QUESTION_TEMPLATES" });
    return response && response.ok && Array.isArray(response.templates)
      ? response.templates
      : [];
  }

  function bindQuestionTemplateEvents(sidebar, job) {
    const panel = sidebar.querySelector("[data-uwe-question-panel]");
    if (!panel) return;
    const status = sidebar.querySelector("[data-uwe-status]");
    const questions = proposalQuestionsOf(job);

    panel.querySelectorAll("[data-uwe-question-answer]").forEach((textarea) => {
      textarea.addEventListener("input", () => {
        textarea.setAttribute("data-uwe-user-edited", "true");
      });
    });

    panel.querySelectorAll("[data-uwe-ai-answer]").forEach((button) => {
      button.addEventListener("click", async () => {
        if (button.disabled) return;
        const card = button.closest(".uwe-question-card");
        const index = Number(card && card.getAttribute("data-uwe-question-index"));
        const question = questions[index] || "";
        const answer = card && card.querySelector("[data-uwe-question-answer]");
        if (!question || !answer) return;

        const originalText = button.textContent;
        button.disabled = true;
        button.textContent = t("sidebar.aiAnswerLoading");
        if (status) status.textContent = t("sidebar.aiAnswerLoading");

        const match = bestQuestionTemplateMatch(question, questionTemplates);
        const response = await sendMessage({
          type: "AI_GENERATE_QUESTION_ANSWER",
          job: compactJobForAi(job),
          question,
          template: match
            ? {
                matchedQuestion: match.template.question,
                answerTemplate: match.template.answer,
                similarity: match.similarity
              }
            : null
        });

        if (response && response.ok && response.text) {
          answer.value = response.text;
          answer.setAttribute("data-uwe-user-edited", "true");
          if (status) status.textContent = t("sidebar.aiAnswerDone");
        } else if (status) {
          status.textContent = (response && response.error) || t("sidebar.aiError");
        }
        button.disabled = !(settings.api && settings.api.configured);
        button.textContent = originalText;
      });
    });

    panel.querySelectorAll("[data-uwe-copy-answer]").forEach((button) => {
      button.addEventListener("click", async () => {
        const card = button.closest(".uwe-question-card");
        const answer = card && card.querySelector("[data-uwe-question-answer]");
        const value = answer ? answer.value.trim() : "";
        if (!value) {
          if (status) status.textContent = t("sidebar.answerRequired");
          return;
        }
        const ok = await copyText(value);
        if (status) {
          status.textContent = ok
            ? t("sidebar.answerCopied")
            : t("sidebar.copyFailed");
        }
      });
    });

    panel.querySelectorAll("[data-uwe-save-question-template]").forEach((button) => {
      button.addEventListener("click", async () => {
        const card = button.closest(".uwe-question-card");
        const index = Number(card && card.getAttribute("data-uwe-question-index"));
        const answer = card && card.querySelector("[data-uwe-question-answer]");
        const question = questions[index] || "";
        const value = answer ? answer.value.trim() : "";
        if (!question || !value) {
          if (status) status.textContent = t("sidebar.answerRequired");
          return;
        }
        await saveQuestionTemplateAndRefresh(
          {
            id: card.getAttribute("data-uwe-template-id") || "",
            question,
            answer: value
          },
          "sidebar.templateSaved"
        );
      });
    });

    const createButton = panel.querySelector("[data-uwe-template-create]");
    if (createButton) {
      createButton.addEventListener("click", async () => {
        const question = panel
          .querySelector("[data-uwe-new-template-question]")
          ?.value.trim();
        const answer = panel
          .querySelector("[data-uwe-new-template-answer]")
          ?.value.trim();
        if (!question || !answer) {
          if (status) status.textContent = t("sidebar.templateFieldsRequired");
          return;
        }
        await saveQuestionTemplateAndRefresh(
          { question, answer },
          "sidebar.templateSaved"
        );
      });
    }

    panel.querySelectorAll("[data-uwe-template-update]").forEach((button) => {
      button.addEventListener("click", async () => {
        const item = button.closest(".uwe-template-item");
        const question = item
          ?.querySelector("[data-uwe-template-question]")
          ?.value.trim();
        const answer = item
          ?.querySelector("[data-uwe-template-answer]")
          ?.value.trim();
        if (!item || !question || !answer) {
          if (status) status.textContent = t("sidebar.templateFieldsRequired");
          return;
        }
        await saveQuestionTemplateAndRefresh(
          {
            id: item.getAttribute("data-uwe-template-id") || "",
            question,
            answer
          },
          "sidebar.templateSaved"
        );
      });
    });

    panel.querySelectorAll("[data-uwe-template-delete]").forEach((button) => {
      button.addEventListener("click", async () => {
        const item = button.closest(".uwe-template-item");
        const id = item && item.getAttribute("data-uwe-template-id");
        if (!id) return;
        const response = await sendMessage({
          type: "DELETE_QUESTION_TEMPLATE",
          templateId: id
        });
        if (response && response.ok) {
          questionTemplates = Array.isArray(response.templates)
            ? response.templates
            : [];
          await refreshSidebarAfterTemplateChange("sidebar.templateDeleted");
        } else if (status) {
          status.textContent = (response && response.error) || "Delete failed";
        }
      });
    });
  }

  async function saveQuestionTemplateAndRefresh(template, successKey) {
    const response = await sendMessage({
      type: "SAVE_QUESTION_TEMPLATE",
      template
    });
    if (response && response.ok) {
      questionTemplates = Array.isArray(response.templates)
        ? response.templates
        : questionTemplates;
      await refreshSidebarAfterTemplateChange(successKey);
      return;
    }
    const status = document.querySelector(".uwe-sidebar [data-uwe-status]");
    if (status) {
      status.textContent = (response && response.error) || "Template save failed";
    }
  }

  async function refreshSidebarAfterTemplateChange(statusKey) {
    lastSidebarSignature = "";
    await renderDetailSidebar();
    const status = document.querySelector(".uwe-sidebar [data-uwe-status]");
    if (status) status.textContent = t(statusKey);
  }

  async function copyText(value) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(value);
        return true;
      }
    } catch (_) {
      // Fall back to the selection-based copy path below.
    }

    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch (_) {
      ok = false;
    }
    textarea.remove();
    return ok;
  }

  function startAiAnalysis(job, result) {
    aiAnalysisState = {
      requestId: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      jobKey: aiJobKey(job, result),
      status: "loading",
      text: "",
      error: ""
    };
    return aiAnalysisState;
  }

  function renderAiState(sidebar) {
    if (!sidebar) return;
    const output = sidebar.querySelector("[data-uwe-ai-result]");
    const status = sidebar.querySelector("[data-uwe-status]");
    const aiButton = sidebar.querySelector("[data-uwe-ai]");
    if (!output || !status) return;

    const sidebarJobKey = sidebar.getAttribute("data-uwe-ai-job-key") || "";
    const configured = Boolean(settings.api && settings.api.configured);
    if (!aiAnalysisState || aiAnalysisState.jobKey !== sidebarJobKey) {
      if (aiButton) aiButton.disabled = !configured;
      return;
    }

    const isLoading = aiAnalysisState.status === "loading";
    output.hidden = false;
    if (aiButton) aiButton.disabled = !configured || isLoading;

    if (aiAnalysisState.status === "error") {
      const error = aiAnalysisState.error || "AI failed";
      status.textContent = t("sidebar.aiError");
      output.innerHTML = `<p>${escapeHtml(error)}</p>`;
      return;
    }

    status.textContent = isLoading ? t("sidebar.aiLoading") : t("sidebar.aiResult");
    output.innerHTML = aiAnalysisState.text
      ? renderMarkdown(aiAnalysisState.text)
      : `<p>${escapeHtml(t("sidebar.aiLoading"))}</p>`;
    if (aiAnalysisState.status === "done") {
      fillQuestionAnswersFromAiText(sidebar, aiAnalysisState.text);
    }
  }

  function aiJobKey(job, result) {
    return String(
      (result && result.jobId) ||
        (job && (job.jobId || job.url || job.title)) ||
        ""
    );
  }

  function fillQuestionAnswersFromAiText(sidebar, text) {
    const drafts = questionAnswerDraftsFromAiText(text);
    if (!drafts.length) return;

    const cards = Array.from(sidebar.querySelectorAll(".uwe-question-card"));
    cards.forEach((card, index) => {
      const answer = card.querySelector("[data-uwe-question-answer]");
      if (!answer || answer.getAttribute("data-uwe-user-edited") === "true") {
        return;
      }
      const question = cardQuestionText(card);
      const matched = bestDraftForQuestion(question, drafts) || drafts[index];
      if (!matched || !matched.answer) return;
      answer.value = matched.answer;
      answer.setAttribute("data-uwe-ai-filled", "true");
    });
  }

  function cardQuestionText(card) {
    const value =
      card && card.querySelector(".uwe-question-card__question")
        ? card.querySelector(".uwe-question-card__question").textContent
        : "";
    return UWE.cleanText(String(value || "").replace(/^\d+\.\s*/, ""));
  }

  function bestDraftForQuestion(question, drafts) {
    let best = null;
    drafts.forEach((draft) => {
      const similarity = questionSimilarity(question, draft.question);
      if (similarity < 0.45) return;
      if (!best || similarity > best.similarity) {
        best = { ...draft, similarity };
      }
    });
    return best;
  }

  function questionAnswerDraftsFromAiText(value) {
    const text = String(value || "").replace(/\r\n?/g, "\n");
    const drafts = [];
    const pattern =
      /(?:^|\n)\s*(?:[-*]\s*|\d+\.\s*)?(?:\*\*)?Question\s*:\s*(?:\*\*)?([\s\S]*?)\s+(?:\*\*)?Draft answer\s*:\s*(?:\*\*)?([\s\S]*?)(?=\n\s*(?:[-*]\s*|\d+\.\s*)?(?:\*\*)?Question\s*:|\n#{1,6}\s+|$)/gi;
    let match = pattern.exec(text);
    while (match) {
      const question = UWE.cleanText(match[1]);
      const answer = cleanAiDraftAnswer(match[2]);
      if (question && answer) drafts.push({ question, answer });
      match = pattern.exec(text);
    }
    return drafts.slice(0, 12);
  }

  function cleanAiDraftAnswer(value) {
    return String(value || "")
      .replace(/\n\s*(?:[-*]\s*|\d+\.\s*)?$/, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function compactJobForAi(job) {
    const proposalQuestions = proposalQuestionsOf(job);
    return {
      jobId: job.jobId,
      url: job.url,
      title: job.title,
      description: String(job.description || "").slice(0, 3600),
      skills: Array.isArray(job.skills) ? job.skills.slice(0, 24) : [],
      proposalQuestions,
      proposalQuestionAnswerTemplates: matchedQuestionTemplatesForAi(
        proposalQuestions,
        questionTemplates
      ),
      budgetType: job.budgetType,
      hourlyMin: job.hourlyMin,
      hourlyMax: job.hourlyMax,
      fixedBudget: job.fixedBudget,
      experienceLevel: job.experienceLevel,
      proposalCount: job.proposalCount,
      proposalCountLabel: job.proposalCountLabel,
      proposalCountBucket: job.proposalCountBucket,
      proposalCountIsOpenEnded: job.proposalCountIsOpenEnded,
      clientPaymentVerified: job.clientPaymentVerified,
      clientRating: job.clientRating,
      clientSpend: job.clientSpend,
      clientHireRate: job.clientHireRate,
      clientAverageHourlyRate: job.clientAverageHourlyRate,
      countryOrTimezone: job.countryOrTimezone
    };
  }

  function compactScoreForAi(result) {
    return {
      overallScore: result.overallScore,
      recommendedAction: result.recommendedAction,
      matchScore: result.matchScore,
      clientQualityScore: result.clientQualityScore,
      competitionScore: result.competitionScore,
      riskScore: result.riskScore,
      riskLevel: result.riskLevel,
      positiveReasons: result.positiveReasons,
      negativeReasons: result.negativeReasons,
      riskNotes: result.riskNotes,
      missingSignals: result.missingSignals
    };
  }

  function proposalQuestionsOf(job) {
    const seen = new Set();
    return (Array.isArray(job && job.proposalQuestions) ? job.proposalQuestions : [])
      .map((question) => UWE.cleanText(question))
      .filter((question) => {
        const key = normalizeQuestionForMatch(question);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 12);
  }

  function questionTemplatesSignature(templates) {
    return (Array.isArray(templates) ? templates : [])
      .map((template) =>
        [
          template.id,
          template.updatedAt,
          template.question,
          String(template.answer || "").length
        ].join(":")
      )
      .join("|");
  }

  function matchedQuestionTemplatesForAi(questions, templates) {
    return questions
      .map((question) => {
        const match = bestQuestionTemplateMatch(question, templates);
        if (!match || !match.template) return null;
        return {
          question,
          matchedQuestion: match.template.question,
          answerTemplate: match.template.answer,
          similarity: Number(match.similarity.toFixed(2))
        };
      })
      .filter(Boolean);
  }

  function bestQuestionTemplateMatch(question, templates) {
    let best = null;
    (Array.isArray(templates) ? templates : []).forEach((template) => {
      if (!template || !template.question || !template.answer) return;
      const similarity = questionSimilarity(question, template.question);
      if (similarity < QUESTION_TEMPLATE_MATCH_THRESHOLD) return;
      if (!best || similarity > best.similarity) {
        best = { template, similarity };
      }
    });
    return best;
  }

  function questionSimilarity(left, right) {
    const leftTokens = questionTokens(left);
    const rightTokens = questionTokens(right);
    if (!leftTokens.length || !rightTokens.length) return 0;

    const leftKey = leftTokens.join(" ");
    const rightKey = rightTokens.join(" ");
    if (leftKey === rightKey) return 1;
    if (leftKey.includes(rightKey) || rightKey.includes(leftKey)) return 0.88;

    const leftSet = new Set(leftTokens);
    const rightSet = new Set(rightTokens);
    const intersection = Array.from(leftSet).filter((token) => rightSet.has(token))
      .length;
    if (!intersection) return 0;
    const union = new Set([...leftSet, ...rightSet]).size;
    const jaccard = intersection / union;
    const coverage = intersection / Math.min(leftSet.size, rightSet.size);
    return jaccard * 0.62 + coverage * 0.38;
  }

  function questionTokens(value) {
    return normalizeQuestionForMatch(value)
      .split(" ")
      .map(stemQuestionToken)
      .filter(Boolean);
  }

  function normalizeQuestionForMatch(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9+#.]+/g, " ")
      .replace(/\b(?:the|a|an|your|you|i|we|our|have|has|had|with|for|to|of|and|or|in|on|at|by|from|is|are|was|were|be|been|when|what|which|how|why|do|does|did|can|could|would|should|please|describe|tell|about|following|question|questions)\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function stemQuestionToken(token) {
    return String(token || "")
      .replace(/ies$/, "y")
      .replace(/(?:ing|ed|es|s)$/, "");
  }

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>"']/g, (char) => {
      const entities = {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      };
      return entities[char];
    });
  }

  function renderMarkdown(value) {
    const lines = String(value || "").replace(/\r\n?/g, "\n").split("\n");
    const blocks = [];
    let paragraph = [];
    let list = null;
    let code = null;

    const flushParagraph = () => {
      if (!paragraph.length) return;
      blocks.push(`<p>${renderInlineMarkdown(paragraph.join(" "))}</p>`);
      paragraph = [];
    };
    const flushList = () => {
      if (!list || !list.items.length) return;
      const tag = list.ordered ? "ol" : "ul";
      blocks.push(
        `<${tag}>${list.items
          .map((item) => `<li>${renderInlineMarkdown(item)}</li>`)
          .join("")}</${tag}>`
      );
      list = null;
    };
    const flushCode = () => {
      if (!code) return;
      blocks.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
      code = null;
    };

    lines.forEach((line) => {
      if (/^```/.test(line)) {
        if (code) {
          flushCode();
        } else {
          flushParagraph();
          flushList();
          code = [];
        }
        return;
      }
      if (code) {
        code.push(line);
        return;
      }
      if (!line.trim()) {
        flushParagraph();
        flushList();
        return;
      }

      const heading = line.match(/^(#{1,3})\s+(.+)$/);
      if (heading) {
        flushParagraph();
        flushList();
        const level = Math.min(heading[1].length + 2, 5);
        blocks.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
        return;
      }

      const unordered = line.match(/^\s*[-*]\s+(.+)$/);
      const ordered = line.match(/^\s*\d+\.\s+(.+)$/);
      if (unordered || ordered) {
        flushParagraph();
        const orderedList = Boolean(ordered);
        if (!list || list.ordered !== orderedList) {
          flushList();
          list = { ordered: orderedList, items: [] };
        }
        list.items.push((unordered || ordered)[1]);
        return;
      }

      paragraph.push(line.trim());
    });

    flushCode();
    flushParagraph();
    flushList();
    return blocks.join("") || `<p>${escapeHtml(String(value || ""))}</p>`;
  }

  function renderInlineMarkdown(value) {
    return escapeHtml(value)
      .replace(
        /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
        (_match, label, url) => {
          const href = String(url).replace(/&amp;/g, "&");
          return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
        }
      )
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>");
  }

  function scheduleRender() {
    window.clearTimeout(renderTimer);
    renderTimer = window.setTimeout(async () => {
      if (currentUrl !== window.location.href) {
        currentUrl = window.location.href;
      }
      await renderDetailSidebar();
      renderListBadges();
    }, 180);
  }

  function isExtensionElement(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
    return Boolean(
      node.closest &&
        node.closest(".uwe-sidebar, .uwe-card-panel, .uwe-badge")
    );
  }

  function isExtensionMutation(mutation) {
    if (isExtensionElement(mutation.target)) return true;
    const added = Array.from(mutation.addedNodes || []);
    const removed = Array.from(mutation.removedNodes || []);
    const touched = added.concat(removed).filter((node) => node.nodeType === Node.ELEMENT_NODE);
    return touched.length > 0 && touched.every(isExtensionElement);
  }

  function bindScoreHelpEvents() {
    document.addEventListener("click", (event) => {
      const trigger = event.target.closest && event.target.closest(".uwe-score-help");
      document.querySelectorAll(".uwe-score-help.is-open").forEach((element) => {
        if (element !== trigger) element.classList.remove("is-open");
      });
      if (!trigger) return;
      trigger.classList.toggle("is-open");
    });

    document.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const trigger = event.target.closest && event.target.closest(".uwe-score-help");
      if (!trigger) return;
      event.preventDefault();
      trigger.click();
    });
  }

  async function init() {
    await loadSettings();
    scheduleRender();
    bindScoreHelpEvents();

    const observer = new MutationObserver((mutations) => {
      if (mutations.length && mutations.every(isExtensionMutation)) {
        return;
      }
      scheduleRender();
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });

    window.addEventListener("popstate", scheduleRender);
    window.addEventListener("hashchange", scheduleRender);
    window.addEventListener("resize", scheduleRender);
    window.addEventListener(
      "scroll",
      () => {
        positionSidebar(document.querySelector(".uwe-sidebar"));
      },
      { passive: true }
    );
    window.setInterval(() => {
      if (currentUrl !== window.location.href) {
        currentUrl = window.location.href;
        scheduleRender();
      }
    }, 1000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
