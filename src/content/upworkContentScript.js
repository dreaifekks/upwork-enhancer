(function attachContentScript(root) {
  const CONTENT_SCRIPT_VERSION = "0.1.20";
  const UWE = root.UpworkEnhancer || {};
  const runtime =
    typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage
      ? chrome.runtime
      : null;

  let settings = UWE.publicSettings
    ? UWE.publicSettings(UWE.DEFAULT_SETTINGS)
    : UWE.DEFAULT_SETTINGS;
  let renderTimer = null;
  let listRenderHandle = null;
  let listRenderUsesIdleCallback = false;
  let currentUrl = window.location.href;
  let lastSidebarSignature = "";
  let aiAnalysisState = null;
  let questionTemplates = [];
  let questionTemplatesLoaded = false;
  let questionTemplatesPromise = null;
  let detailRenderGeneration = 0;
  let sidebarCollapsed = true;
  let aiRenderTimer = null;
  let sidebarResizeObserver = null;
  const detailScoreCache = new Map();
  const listJobCache = new Map();
  const detailDraftCache = new Map();
  const DETAIL_SCORE_CACHE_MAX = 30;
  const QUESTION_TEMPLATE_MATCH_THRESHOLD = 0.38;
  const SIDEBAR_NARROW_WIDTH = 520;

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
    // The injected UI normally sits on Upwork's own surface. A forced theme
    // that disagrees with the page needs its own backdrop to stay readable.
    element.classList.toggle(
      "uwe-surface-solid",
      theme === settings.theme && theme !== detectPageTheme()
    );
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

    scheduleAiRender(Boolean(message.error || message.done));
  }

  function scheduleAiRender(immediate) {
    if (aiRenderTimer) {
      window.clearTimeout(aiRenderTimer);
      aiRenderTimer = null;
    }
    if (immediate) {
      renderAiState(document.querySelector(".uwe-sidebar"));
      return;
    }
    aiRenderTimer = window.setTimeout(() => {
      aiRenderTimer = null;
      renderAiState(document.querySelector(".uwe-sidebar"));
    }, 60);
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
      riskLevel: result.riskLevel,
      actionGateReason: result.actionGateReason,
      positiveReasons: result.positiveReasons,
      negativeReasons: result.negativeReasons,
      riskNotes: result.riskNotes,
      missingSignals: result.missingSignals
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

  function cacheListJob(job) {
    const keys = detailCacheKeys(job, { jobId: job && job.jobId });
    keys.forEach((key) => {
      listJobCache.delete(key);
      listJobCache.set(key, job);
    });
    while (listJobCache.size > DETAIL_SCORE_CACHE_MAX * 2) {
      listJobCache.delete(listJobCache.keys().next().value);
    }
  }

  function cachedListJobForJob(job) {
    const keys = detailCacheKeys(job, { jobId: job && job.jobId });
    for (const key of keys) {
      const cached = listJobCache.get(key);
      if (cached) return cached;
    }
    return null;
  }

  function captureSidebarDraft(sidebar) {
    if (!sidebar || !sidebar.querySelector(".uwe-sidebar__body")) return;
    const key = sidebar.getAttribute("data-uwe-draft-job-key") || "";
    if (!key) return;
    const selected = sidebar.querySelector(
      '[data-uwe-decision][aria-pressed="true"]'
    );
    const questionDetails = sidebar.querySelector(".uwe-question-details");
    const templateManager = sidebar.querySelector(".uwe-template-manager");
    const draft = {
      selectedAction: selected && selected.getAttribute("data-uwe-decision"),
      note: sidebar.querySelector("[data-uwe-note]")?.value || "",
      tags: sidebar.querySelector("[data-uwe-tags]")?.value || "",
      answers: Array.from(
        sidebar.querySelectorAll("[data-uwe-question-answer]")
      ).map((element) => ({
        value: element.value,
        userEdited: element.getAttribute("data-uwe-user-edited") === "true"
      })),
      questionsOpen: Boolean(questionDetails && questionDetails.open),
      templatesOpen: Boolean(templateManager && templateManager.open)
    };
    detailDraftCache.delete(key);
    detailDraftCache.set(key, draft);
    while (detailDraftCache.size > DETAIL_SCORE_CACHE_MAX) {
      detailDraftCache.delete(detailDraftCache.keys().next().value);
    }
  }

  function restoreSidebarDraft(sidebar, draft) {
    if (!sidebar || !draft) return;
    const questionDetails = sidebar.querySelector(".uwe-question-details");
    const templateManager = sidebar.querySelector(".uwe-template-manager");
    if (questionDetails) questionDetails.open = Boolean(draft.questionsOpen);
    if (templateManager) templateManager.open = Boolean(draft.templatesOpen);
    Array.from(sidebar.querySelectorAll("[data-uwe-question-answer]")).forEach(
      (element, index) => {
        const answer = draft.answers && draft.answers[index];
        if (!answer) return;
        element.value = answer.value;
        if (answer.userEdited) {
          element.setAttribute("data-uwe-user-edited", "true");
        }
      }
    );
  }

  function discoverListJobForDetail(job) {
    const expectedKeys = new Set(detailCacheKeys(job, { jobId: job && job.jobId }));
    if (!expectedKeys.size) return null;
    const detailRoot = findDetailRoot();
    for (const card of UWE.findJobCards(document)) {
      if (detailRoot && (card === detailRoot || detailRoot.contains(card))) continue;
      const candidate = UWE.parseJobCard(card);
      cacheListJob(candidate);
      const candidateKeys = detailCacheKeys(candidate, { jobId: candidate.jobId });
      if (candidateKeys.some((key) => expectedKeys.has(key))) return candidate;
    }
    return null;
  }

  const ICON_PATHS = {
    check: '<path d="M3.5 8.4l2.9 2.9 6.1-6.6"/>',
    minus: '<path d="M4 8h8"/>',
    alert:
      '<path d="M8 2.5l6.1 10.6H1.9L8 2.5z"/><path d="M8 6.7v2.9"/><path d="M8 11.3v.1"/>',
    question:
      '<circle cx="8" cy="8" r="5.7"/><path d="M6.3 6.6a1.75 1.75 0 0 1 3.4.5c0 1.1-1.7 1.4-1.7 2.4"/><path d="M8 11.3v.1"/>',
    chevron: '<path d="M4 6l4 4 4-4"/>'
  };

  function icon(name) {
    return `<svg class="uwe-icon uwe-icon--${name}" viewBox="0 0 16 16" aria-hidden="true" focusable="false">${
      ICON_PATHS[name] || ""
    }</svg>`;
  }

  // Sub-scores start near 50 and move with evidence, so anything under 50 is
  // net-negative and worth flagging; 70+ means the positive signals dominate.
  function toneForScore(value) {
    const score = Number(value) || 0;
    if (score >= 70) return "good";
    return score >= 50 ? "fair" : "weak";
  }

  function toneForRisk(level) {
    if (level === "low") return "good";
    return level === "medium" ? "fair" : "weak";
  }

  function badge(label, value, modifier, helpText, flagTone) {
    const className = ["uwe-badge", modifier, flagTone && `uwe-tone--${flagTone}`]
      .filter(Boolean)
      .join(" ");
    const helpClass = helpText ? " uwe-score-help" : "";
    const helpAttrs = helpText ? ' tabindex="0" role="button"' : "";
    const helpTip = helpText ? scoreTip(helpText) : "";
    const flag = flagTone ? '<i class="uwe-flag" aria-hidden="true"></i>' : "";
    return `<span class="${className}${helpClass}"${helpAttrs}>${flag}<span>${escapeHtml(label)}</span><strong>${escapeHtml(
      value
    )}</strong>${helpTip}</span>`;
  }

  // A flag marks what needs a second look: weak sub-scores and any elevated
  // risk. Middling sub-scores stay quiet so the flags keep their meaning.
  function metricBadge(metric, value, helpText, tone) {
    const flagged = tone === "weak" || (metric === "risk" && tone === "fair");
    return badge(
      t(`badge.${metric}`),
      value,
      "uwe-badge--metric",
      helpText,
      flagged ? tone : ""
    );
  }

  function verdictBadge(result) {
    const action = result.recommendedAction;
    return `<span class="uwe-badge uwe-badge--verdict uwe-score-help" tabindex="0" role="button"><strong>${
      result.overallScore
    }</strong><span>${escapeHtml(t(`action.${action}`))}</span>${scoreTip(
      scoreHelp("overall"),
      verdictReason(result)
    )}</span>`;
  }

  function verdictReason(result) {
    return result.actionGateReason ? localize(result.actionGateReason) : "";
  }

  function contextBadge(job) {
    const knownContexts = new Set(["job", "history", "clientJob"]);
    const context = knownContexts.has(job.context) ? job.context : "job";
    // Ordinary job cards need no label; only mark entries that could be
    // mistaken for the job being reviewed.
    if (context === "job") return "";
    const label = t(`context.${context}`);
    const title = cleanLabelTitle(job.title);
    const display = title ? `${label}: ${title}` : label;
    return `<span class="uwe-badge uwe-badge--context" title="${escapeHtml(
      display
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

  function scoreTip(text, lead) {
    const leadHtml = lead ? `<strong>${escapeHtml(lead)}</strong>` : "";
    return `<span class="uwe-score-tip" role="tooltip">${leadHtml}${escapeHtml(text)}</span>`;
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
    cacheListJob(job);
    const cachedScore = cachedDetailScoreForJob(job);
    const result = cachedScore ? cachedScore.result : score(job);
    const panel = existing || document.createElement("div");
    panel.className = `uwe-card-panel uwe-card-panel--${result.recommendedAction}`;
    applyTheme(panel);
    panel.setAttribute("data-uwe-job-id", result.jobId || "");
    panel.setAttribute("data-uwe-score-source", cachedScore ? "detail" : "list");
    panel.setAttribute(
      "data-uwe-score-signature",
      cachedScore ? cachedScore.signature : scoreSignature(result)
    );
    panel.innerHTML = [
      contextBadge(job),
      verdictBadge(result),
      metricBadges(result)
    ].join("");

    if (!existing) {
      insertCardPanel(card, panel);
    }
    card.setAttribute("data-uwe-text", nextText);
  }

  function metricBadges(result) {
    return [
      metricBadge(
        "match",
        String(result.matchScore),
        scoreHelp("match", result),
        toneForScore(result.matchScore)
      ),
      metricBadge(
        "client",
        String(result.clientQualityScore),
        scoreHelp("client", result),
        toneForScore(result.clientQualityScore)
      ),
      metricBadge(
        "competition",
        String(result.competitionScore),
        scoreHelp("competition", result),
        toneForScore(result.competitionScore)
      ),
      metricBadge(
        "risk",
        t(`risk.${result.riskLevel}`),
        scoreHelp("risk", result),
        toneForRisk(result.riskLevel)
      )
    ].join("");
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
    cancelListRender();
    detailScoreCache.clear();
    listJobCache.clear();
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
      observeSidebarWidth(sidebar);
    }
    sidebar.classList.toggle("uwe-sidebar--inline", placement === "inline");
    sidebar.classList.toggle("uwe-sidebar--floating-left", placement === "floating-left");
    applyTheme(sidebar);
    return sidebar;
  }

  // The panel lives in columns of very different widths (slider, full page,
  // laptop breakpoints), so its layout follows its own width, not the window.
  function syncSidebarWidth(sidebar) {
    const width = sidebar.getBoundingClientRect().width;
    if (!width) return;
    sidebar.classList.toggle("uwe-sidebar--narrow", width < SIDEBAR_NARROW_WIDTH);
  }

  function observeSidebarWidth(sidebar) {
    if (typeof ResizeObserver !== "function") return;
    if (sidebarResizeObserver) sidebarResizeObserver.disconnect();
    sidebarResizeObserver = new ResizeObserver(() => syncSidebarWidth(sidebar));
    sidebarResizeObserver.observe(sidebar);
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
    syncSidebarWidth(sidebar);
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
    const generation = ++detailRenderGeneration;
    captureSidebarDraft(document.querySelector(".uwe-sidebar"));
    if (!UWE.isLikelyDetailPage(document)) {
      document.querySelector(".uwe-sidebar")?.remove();
      lastSidebarSignature = "";
      return;
    }

    const placement = detailPlacement();
    let anchor = placement === "inline" ? findInlineReviewAnchor() : null;
    if (placement === "inline" && !anchor) {
      document.querySelector(".uwe-sidebar")?.remove();
      lastSidebarSignature = "";
      return;
    }
    const sidebar = getSidebar(placement);
    const parsedJob = UWE.parseJobDetail(document);
    const listJob =
      cachedListJobForJob(parsedJob) || discoverListJobForDetail(parsedJob);
    const job = UWE.mergeJobSignals
      ? UWE.mergeJobSignals(parsedJob, listJob)
      : parsedJob;
    const result = score(job);
    cacheDetailScore(job, result);
    questionTemplates = await ensureQuestionTemplates();
    if (generation !== detailRenderGeneration) return;
    const signature = JSON.stringify({
      jobId: result.jobId,
      title: job.title,
      score: scoreSignature(result),
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
    const decisionResponse = await sendMessage({
      type: "GET_DECISION",
      jobId: result.jobId,
      url: job.url
    });
    if (generation !== detailRenderGeneration) return;
    lastSidebarSignature = signature;
    const savedDecision =
      decisionResponse && decisionResponse.ok ? decisionResponse.decision : null;
    const draftKey = aiJobKey(job, result);
    const draft = detailDraftCache.get(draftKey) || null;
    const selectedAction =
      (draft && draft.selectedAction) ||
      (savedDecision && savedDecision.userDecision) ||
      result.recommendedAction;
    const savedNote = draft
      ? draft.note
      : (savedDecision && savedDecision.note) || "";
    const savedTags =
      draft
        ? draft.tags
        : savedDecision && Array.isArray(savedDecision.tags)
        ? savedDecision.tags.join(", ")
        : "";
    const collapsed = sidebarCollapsed;

    sidebar.innerHTML = sidebarTemplate(
      job,
      result,
      selectedAction,
      savedNote,
      savedTags,
      questionTemplates
    );
    sidebar.classList.toggle("uwe-sidebar--collapsed", collapsed);
    syncSidebarToggle(sidebar);
    sidebar.classList.toggle("uwe-sidebar--inline", placement === "inline");
    sidebar.classList.toggle("uwe-sidebar--floating-left", placement === "floating-left");
    sidebar.setAttribute("data-uwe-ai-job-key", aiJobKey(job, result));
    sidebar.setAttribute("data-uwe-draft-job-key", draftKey);
    placeSidebar(sidebar, placement, anchor);
    ensureInlineSidebarAnchored(sidebar, placement);
    applyTheme(sidebar);
    positionSidebar(sidebar);
    bindSidebarEvents(sidebar, job, result);
    restoreSidebarDraft(sidebar, draft);
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
    const action = result.recommendedAction;
    const actionLabel = t(`action.${action}`);
    const reason = verdictReason(result);
    return `
      <div class="uwe-sidebar__header" role="group" aria-label="${escapeHtml(
        t("sidebar.summary")
      )}">
        <div class="uwe-score-ring uwe-score-ring--${action} uwe-score-help" tabindex="0" role="button" aria-label="${escapeHtml(
          `${t("badge.overall")} ${result.overallScore}`
        )}">${scoreRing(result.overallScore)}<span class="uwe-score-ring__value">${
          result.overallScore
        }</span>${scoreTip(scoreHelp("overall", result))}</div>
        <div class="uwe-sidebar__lead">
          <div class="uwe-verdict">
            <div class="uwe-action uwe-action--${action} uwe-score-help" tabindex="0" role="button" aria-label="${escapeHtml(
              t("sidebar.recommendedActionLabel", { action: actionLabel })
            )}">${escapeHtml(
              actionLabel
            )}${scoreTip(scoreHelp("action", result))}</div>
            ${
              reason
                ? `<p class="uwe-verdict__reason"><span class="uwe-visually-hidden">${escapeHtml(
                    t("sidebar.actionReason")
                  )}: </span>${escapeHtml(reason)}</p>`
                : ""
            }
          </div>
          <div class="uwe-sidebar__compact">${metricBadges(result)}</div>
          <div class="uwe-sidebar__caption">
            <h2 class="uwe-sidebar__title">${escapeHtml(t("sidebar.title"))}</h2>
            <p class="uwe-job-title">${escapeHtml(job.title)}</p>
          </div>
        </div>
        <button class="uwe-sidebar__toggle" type="button" data-uwe-toggle aria-expanded="true" aria-controls="uwe-sidebar-body"><span data-uwe-toggle-label>${escapeHtml(
          t("sidebar.collapse")
        )}</span>${icon("chevron")}</button>
      </div>
      <div class="uwe-sidebar__body" id="uwe-sidebar-body">
        <section class="uwe-breakdown" aria-label="${escapeHtml(t("sidebar.breakdown"))}">
          ${scoreRow(
            t("badge.match"),
            result.matchScore,
            scoreHelp("match", result),
            toneForScore(result.matchScore)
          )}
          ${scoreRow(
            t("badge.client"),
            result.clientQualityScore,
            scoreHelp("client", result),
            toneForScore(result.clientQualityScore)
          )}
          ${scoreRow(
            t("badge.competition"),
            result.competitionScore,
            scoreHelp("competition", result),
            toneForScore(result.competitionScore)
          )}
          ${scoreRow(
            t("badge.risk"),
            result.riskScore,
            scoreHelp("risk", result),
            toneForRisk(result.riskLevel),
            t(`risk.${result.riskLevel}`)
          )}
        </section>
        ${reasonColumns(result)}
        ${proposalQuestionsSection(job, templates)}
        <section class="uwe-section uwe-decision">
          <div class="uwe-decision__choice">
            <h3>${escapeHtml(t("sidebar.decision"))}</h3>
            <div class="uwe-decision-grid">
              ${decisionButton("apply", selectedAction)}
              ${decisionButton("watch", selectedAction)}
              ${decisionButton("maybe", selectedAction)}
              ${decisionButton("pass", selectedAction)}
            </div>
          </div>
          <div class="uwe-decision__fields">
            <textarea class="uwe-note" rows="1" data-uwe-note aria-label="${escapeHtml(
              t("sidebar.notes")
            )}" placeholder="${escapeHtml(
              t("sidebar.notes")
            )}">${escapeHtml(savedNote)}</textarea>
            <input class="uwe-tags" data-uwe-tags aria-label="${escapeHtml(
              t("sidebar.tags")
            )}" placeholder="${escapeHtml(
              t("sidebar.tags")
            )}" value="${escapeHtml(savedTags)}" />
          </div>
          <div class="uwe-actions">
            <button class="uwe-btn uwe-btn--primary" type="button" data-uwe-save>${escapeHtml(
              t("sidebar.save")
            )}</button>
            <button class="uwe-btn uwe-btn--secondary" type="button" data-uwe-ai ${
              settings.api && settings.api.configured ? "" : "disabled"
            }>${escapeHtml(
              settings.api && settings.api.configured
                ? t("sidebar.ai")
                : t("sidebar.aiUnavailable")
            )}</button>
            <div class="uwe-status" data-uwe-status role="status" aria-live="polite"></div>
          </div>
          <div class="uwe-ai-result" data-uwe-ai-result hidden></div>
        </section>
      </div>
    `;
  }

  function scoreRing(value) {
    const score = Math.max(0, Math.min(100, Number(value) || 0));
    return `<svg class="uwe-score-ring__chart" viewBox="0 0 44 44" aria-hidden="true" focusable="false"><circle class="uwe-score-ring__track" cx="22" cy="22" r="19.5"/>${
      score > 0
        ? `<circle class="uwe-score-ring__arc" cx="22" cy="22" r="19.5" pathLength="100" stroke-dasharray="${score} 100"/>`
        : ""
    }</svg>`;
  }

  function reasonColumns(result) {
    const pros = listSection(
      t("sidebar.reasonsFor"),
      result.positiveReasons.map(localize),
      "for"
    );
    const cons = [
      listSection(
        t("sidebar.reasonsAgainst"),
        result.negativeReasons.map(localize),
        "against"
      ),
      listSection(t("sidebar.risks"), result.riskNotes.map(localize), "risk"),
      listSection(
        t("sidebar.missing"),
        result.missingSignals.map(localize),
        "missing"
      )
    ].join("");
    const columns = [pros, cons]
      .filter((column) => column.trim())
      .map((column) => `<div class="uwe-reasons__col">${column}</div>`);
    return columns.length
      ? `<div class="uwe-reasons">${columns.join("")}</div>`
      : "";
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
            <span class="uwe-count">${escapeHtml(
              t("sidebar.questionCount", { count: questions.length })
            )}</span>
            ${icon("chevron")}
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
            <summary>${escapeHtml(t("sidebar.manageQuestionTemplates"))}${icon(
              "chevron"
            )}</summary>
            <div class="uwe-template-create">
              <input
                type="text"
                data-uwe-new-template-question
                aria-label="${escapeHtml(t("sidebar.templateQuestionPlaceholder"))}"
                placeholder="${escapeHtml(t("sidebar.templateQuestionPlaceholder"))}"
              />
              <textarea
                data-uwe-new-template-answer
                aria-label="${escapeHtml(t("sidebar.templateAnswerPlaceholder"))}"
                placeholder="${escapeHtml(t("sidebar.templateAnswerPlaceholder"))}"
              ></textarea>
              <button class="uwe-btn uwe-btn--quiet" type="button" data-uwe-template-create>${escapeHtml(
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
          aria-label="${escapeHtml(`${question}: ${t("sidebar.questionAnswerPlaceholder")}`)}"
          placeholder="${escapeHtml(t("sidebar.questionAnswerPlaceholder"))}"
        >${escapeHtml(answer)}</textarea>
        <div class="uwe-question-actions">
          <button
            class="uwe-btn uwe-btn--quiet"
            type="button"
            data-uwe-ai-answer
            ${settings.api && settings.api.configured ? "" : "disabled"}
          >${escapeHtml(t("sidebar.aiAnswer"))}</button>
          <button class="uwe-btn uwe-btn--quiet" type="button" data-uwe-copy-answer>${escapeHtml(
            t("sidebar.copyAnswer")
          )}</button>
          <button class="uwe-btn uwe-btn--quiet" type="button" data-uwe-save-question-template>${escapeHtml(
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
          aria-label="${escapeHtml(t("sidebar.templateQuestionPlaceholder"))}"
          value="${escapeHtml(template.question)}"
        />
        <textarea data-uwe-template-answer aria-label="${escapeHtml(
          t("sidebar.templateAnswerPlaceholder")
        )}">${escapeHtml(template.answer)}</textarea>
        <div class="uwe-template-item__actions">
          <span>${escapeHtml(templateUpdatedLabel(template))}</span>
          <button class="uwe-btn uwe-btn--quiet" type="button" data-uwe-template-update>${escapeHtml(
            t("sidebar.updateTemplate")
          )}</button>
          <button class="uwe-btn uwe-btn--quiet uwe-btn--danger" type="button" data-uwe-template-delete>${escapeHtml(
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

  function scoreRow(label, value, helpText, tone, note) {
    const width = Math.max(0, Math.min(100, Number(value) || 0));
    return `
      <div class="uwe-breakdown__row uwe-tone--${tone} uwe-score-help" tabindex="0" role="button">
        <span class="uwe-breakdown__label">${escapeHtml(label)}</span>
        <span class="uwe-breakdown__figure"><strong>${width}</strong>${
          note ? `<em>${escapeHtml(note)}</em>` : ""
        }</span>
        <div class="uwe-meter"><span style="width: ${width}%"></span></div>
        ${scoreTip(helpText)}
      </div>
    `;
  }

  const REASON_ICONS = {
    for: "check",
    against: "minus",
    risk: "alert",
    missing: "question"
  };

  function listSection(title, items, kind) {
    if (!items.length) return "";
    return `
      <section class="uwe-section uwe-section--${kind}">
        <h3>${escapeHtml(title)}</h3>
        <ul class="uwe-list">
          ${items
            .map(
              (item) =>
                `<li>${icon(REASON_ICONS[kind])}<span>${escapeHtml(item)}</span></li>`
            )
            .join("")}
        </ul>
      </section>
    `;
  }

  function decisionButton(action, selectedAction) {
    return `
      <button class="uwe-choice" type="button" data-uwe-decision="${action}" aria-pressed="${
        action === selectedAction ? "true" : "false"
      }" aria-label="${escapeHtml(
        t("sidebar.selectAction", { action: t(`action.${action}`) })
      )}">${escapeHtml(t(`action.${action}`))}</button>
    `;
  }

  function bindSidebarEvents(sidebar, job, result) {
    const status = sidebar.querySelector("[data-uwe-status]");
    const note = sidebar.querySelector("[data-uwe-note]");
    const tags = sidebar.querySelector("[data-uwe-tags]");

    sidebar.querySelector("[data-uwe-toggle]").addEventListener("click", () => {
      sidebar.classList.toggle("uwe-sidebar--collapsed");
      sidebarCollapsed = sidebar.classList.contains("uwe-sidebar--collapsed");
      syncSidebarToggle(sidebar);
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

    sidebar.querySelector("[data-uwe-save]").addEventListener("click", async (event) => {
      if (!event.isTrusted) return;
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
    aiButton.addEventListener("click", async (event) => {
      if (!event.isTrusted) return;
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
      : null;
  }

  async function ensureQuestionTemplates() {
    if (questionTemplatesLoaded) return questionTemplates;
    if (!questionTemplatesPromise) {
      questionTemplatesPromise = loadQuestionTemplates()
        .then((templates) => {
          if (Array.isArray(templates)) {
            questionTemplates = templates;
            questionTemplatesLoaded = true;
          }
          return questionTemplates;
        })
        .finally(() => {
          questionTemplatesPromise = null;
        });
    }
    return questionTemplatesPromise;
  }

  function syncSidebarToggle(sidebar) {
    const button = sidebar && sidebar.querySelector("[data-uwe-toggle]");
    if (!button) return;
    const collapsed = sidebar.classList.contains("uwe-sidebar--collapsed");
    const label = button.querySelector("[data-uwe-toggle-label]") || button;
    label.textContent = collapsed ? t("sidebar.expand") : t("sidebar.collapse");
    button.setAttribute("aria-expanded", collapsed ? "false" : "true");
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
      button.addEventListener("click", async (event) => {
        if (!event.isTrusted) return;
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
      button.addEventListener("click", async (event) => {
        if (!event.isTrusted) return;
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
      button.addEventListener("click", async (event) => {
        if (!event.isTrusted) return;
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
      createButton.addEventListener("click", async (event) => {
        if (!event.isTrusted) return;
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
      button.addEventListener("click", async (event) => {
        if (!event.isTrusted) return;
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
      button.addEventListener("click", async (event) => {
        if (!event.isTrusted) return;
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
    renderTimer = window.setTimeout(() => {
      if (currentUrl !== window.location.href) {
        currentUrl = window.location.href;
      }
      renderDetailSidebar().catch(() => null);
      scheduleListRender();
    }, 180);
  }

  function scheduleListRender() {
    if (listRenderHandle !== null) return;
    const run = () => {
      listRenderHandle = null;
      listRenderUsesIdleCallback = false;
      renderListBadges();
    };
    if (typeof window.requestIdleCallback === "function") {
      listRenderUsesIdleCallback = true;
      listRenderHandle = window.requestIdleCallback(run, { timeout: 500 });
      return;
    }
    listRenderHandle = window.setTimeout(run, 0);
  }

  function cancelListRender() {
    if (listRenderHandle === null) return;
    if (listRenderUsesIdleCallback && typeof window.cancelIdleCallback === "function") {
      window.cancelIdleCallback(listRenderHandle);
    } else {
      window.clearTimeout(listRenderHandle);
    }
    listRenderHandle = null;
    listRenderUsesIdleCallback = false;
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

  // Tips open under their trigger; nudge them left when they would spill
  // past the panel or the viewport.
  function positionScoreTip(trigger) {
    const tip = trigger.querySelector(":scope > .uwe-score-tip");
    const panel = trigger.closest(".uwe-sidebar, .uwe-card-panel");
    if (!tip || !panel) return;
    // The strip only hugs its content; let its tips use the job card's width.
    const host =
      (panel.classList.contains("uwe-card-panel") && panel.parentElement) || panel;
    tip.style.setProperty("--uwe-tip-shift", "0px");
    const tipRect = tip.getBoundingClientRect();
    if (!tipRect.width) return;
    const hostRect = host.getBoundingClientRect();
    const overflow = tipRect.right - Math.min(hostRect.right, window.innerWidth - 8);
    if (overflow <= 0) return;
    const room = Math.max(0, tipRect.left - hostRect.left);
    tip.style.setProperty(
      "--uwe-tip-shift",
      `${-Math.round(Math.min(overflow, room))}px`
    );
  }

  function bindScoreHelpEvents() {
    ["mouseover", "focusin"].forEach((type) => {
      document.addEventListener(type, (event) => {
        const trigger = event.target.closest && event.target.closest(".uwe-score-help");
        if (trigger) positionScoreTip(trigger);
      });
    });

    document.addEventListener("click", (event) => {
      const trigger = event.target.closest && event.target.closest(".uwe-score-help");
      document.querySelectorAll(".uwe-score-help.is-open").forEach((element) => {
        if (element !== trigger) element.classList.remove("is-open");
      });
      if (!trigger) return;
      trigger.classList.toggle("is-open");
      positionScoreTip(trigger);
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
    if (window.navigation && window.navigation.addEventListener) {
      window.navigation.addEventListener("navigate", scheduleRender);
    }
    window.addEventListener(
      "scroll",
      () => {
        positionSidebar(document.querySelector(".uwe-sidebar"));
      },
      { passive: true }
    );
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
