(function attachContentScript(root) {
  const CONTENT_SCRIPT_VERSION = "0.1.9";
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
      return Promise.resolve({ ok: false, error: "runtime unavailable" });
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
        resolve({ ok: false, error: messageFromError(error) });
      }
    });
  }

  function safeRuntimeLastError() {
    try {
      const lastError =
        typeof chrome !== "undefined" &&
        chrome.runtime &&
        chrome.runtime.lastError;
      return lastError ? messageFromError(lastError) : "";
    } catch (error) {
      return messageFromError(error);
    }
  }

  function messageFromError(error) {
    if (!error) return "";
    return error.message || String(error);
  }

  if (runtime && runtime.onMessage) {
    runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message && message.type === "SETTINGS_UPDATED" && message.settings) {
        settings = message.settings;
        invalidateRenderedScores();
        scheduleRender();
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
    if (previousText === nextText && existing) {
      applyTheme(existing);
      return;
    }

    const job = UWE.parseJobCard(card);
    const result = score(job);
    const panel = existing || document.createElement("div");
    panel.className = "uwe-card-panel";
    applyTheme(panel);
    panel.setAttribute("data-uwe-job-id", result.jobId || "");
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
    placeSidebar(sidebar, placement);
    applyTheme(sidebar);
    return sidebar;
  }

  function placeSidebar(sidebar, placement) {
    if (placement !== "inline") {
      if (sidebar.parentElement !== document.body) {
        document.body.appendChild(sidebar);
      }
      return;
    }

    const anchor = findInlineReviewAnchor();
    const parent = (anchor && anchor.parentElement) || findDetailRoot();
    if (!parent) {
      document.body.appendChild(sidebar);
      return;
    }
    if (anchor && anchor !== sidebar) {
      parent.insertBefore(sidebar, anchor);
      return;
    }
    if (sidebar.parentElement !== parent) {
      parent.insertBefore(sidebar, parent.firstChild);
    }
  }

  function positionSidebar(sidebar) {
    if (!sidebar) return;
    if (sidebar.classList.contains("uwe-sidebar--inline")) {
      sidebar.style.left = "";
      sidebar.style.right = "";
      sidebar.style.top = "";
      sidebar.style.bottom = "";
      sidebar.style.maxHeight = "";
      return;
    }
    if (window.innerWidth <= 980) {
      sidebar.style.left = "";
      sidebar.style.right = "";
      sidebar.style.top = "";
      sidebar.style.bottom = "";
      sidebar.style.maxHeight = "";
      return;
    }

    const gap = 14;
    const margin = 14;
    const fallbackTop = 84;
    const mainRect = findMainContentRect();
    const measuredWidth = sidebar.getBoundingClientRect().width || 372;
    const sidebarWidth = Math.min(measuredWidth, 328, window.innerWidth - margin * 2);
    const fallbackLeft = margin;
    let top = fallbackTop;
    let left = fallbackLeft;

    if (mainRect) {
      top = clamp(mainRect.top, 70, Math.max(70, window.innerHeight - 180));
      left = clamp(
        mainRect.left - sidebarWidth - gap,
        margin,
        window.innerWidth - sidebarWidth - margin
      );
    }

    sidebar.style.left = `${Math.round(left)}px`;
    sidebar.style.right = "auto";
    sidebar.style.top = `${Math.round(top)}px`;
    sidebar.style.bottom = "auto";
    sidebar.style.maxHeight = `calc(100vh - ${Math.round(top + margin)}px)`;
  }

  function findDetailRoot() {
    return (
      document.querySelector(".air3-slider-job-details .job-details-content") ||
      document.querySelector(".air3-slider-job-details") ||
      document.querySelector("[data-test='job-details']") ||
      document.querySelector("[data-test*='job-detail']") ||
      document.querySelector("main") ||
      document.body
    );
  }

  function isSliderDetailPage() {
    const url = window.location.href;
    return (
      /\/nx\/find-work\/[^?]+\/details\//.test(url) ||
      /[?&]_modalInfo=/.test(url)
    );
  }

  function detailPlacement() {
    return isSliderDetailPage() ? "inline" : "floating-left";
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
        return /^(Summary|Job Description)\b/i.test(text);
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
    if (candidates[0]) return candidates[0];

    const title = findVisibleTitle();
    if (!title) return null;
    const titleBlock = title.closest("section, article, div") || title;
    return titleBlock.nextElementSibling;
  }

  function findMainContentRect() {
    const title = findVisibleTitle();
    if (title) {
      const titleRect = title.getBoundingClientRect();
      let node = title.parentElement;
      while (node && node !== document.body) {
        const rect = node.getBoundingClientRect();
        if (
          rect.width >= Math.max(420, titleRect.width) &&
          rect.width <= 980 &&
          rect.left <= titleRect.left + 12 &&
          rect.height >= titleRect.height
        ) {
          return rect;
        }
        node = node.parentElement;
      }
      return titleRect;
    }
    const summary = findInlineReviewAnchor();
    return summary ? summary.getBoundingClientRect() : null;
  }

  function findVisibleTitle() {
    const rootNode = findDetailRoot();
    const isSliderRoot = Boolean(rootNode.closest(".air3-slider-job-details"));
    const selector = isSliderRoot
      ? "h1, h2, h3, h4, [data-test*='job-title']"
      : "h1, [data-test*='job-title']";
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

    const placement = detailPlacement();
    const sidebar = getSidebar(placement);
    const job = UWE.parseJobDetail(document);
    const result = score(job);
    const signature = JSON.stringify({
      jobId: result.jobId,
      title: job.title,
      overallScore: result.overallScore,
      action: result.recommendedAction,
      language: settings.language,
      theme: currentTheme(),
      placement,
      apiConfigured: Boolean(settings.api && settings.api.configured)
    });
    if (
      signature === lastSidebarSignature &&
      sidebar.querySelector(".uwe-sidebar__body") &&
      sidebar.contains(document.activeElement) &&
      /^(TEXTAREA|INPUT|BUTTON)$/.test(document.activeElement.tagName)
    ) {
      applyTheme(sidebar);
      positionSidebar(sidebar);
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
      savedTags
    );
    sidebar.classList.toggle("uwe-sidebar--collapsed", collapsed);
    sidebar.classList.toggle("uwe-sidebar--inline", placement === "inline");
    sidebar.classList.toggle("uwe-sidebar--floating-left", placement === "floating-left");
    placeSidebar(sidebar, placement);
    applyTheme(sidebar);
    positionSidebar(sidebar);
    bindSidebarEvents(sidebar, job, result);
  }

  function sidebarTemplate(job, result, selectedAction, savedNote, savedTags) {
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
      const output = sidebar.querySelector("[data-uwe-ai-result]");
      status.textContent = t("sidebar.aiLoading");
      output.hidden = true;
      const response = await sendMessage({
        type: "AI_ANALYZE",
        job,
        score: result
      });
      if (response && response.ok) {
        output.hidden = false;
        output.textContent = response.text;
        status.textContent = t("sidebar.aiResult");
      } else {
        status.textContent = response && response.error ? response.error : "AI failed";
      }
    });
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

  function scheduleRender() {
    window.clearTimeout(renderTimer);
    renderTimer = window.setTimeout(async () => {
      if (currentUrl !== window.location.href) {
        currentUrl = window.location.href;
      }
      renderListBadges();
      await renderDetailSidebar();
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
