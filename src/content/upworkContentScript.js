(function attachContentScript(root) {
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

  function t(key, params) {
    return UWE.t(settings.language, key, params);
  }

  function localize(reason) {
    return UWE.localizeReason(settings.language, reason);
  }

  function sendMessage(message) {
    if (!runtime) {
      return Promise.resolve({ ok: false, error: "runtime unavailable" });
    }
    return new Promise((resolve) => {
      runtime.sendMessage(message, (response) => {
        resolve(response || { ok: false, error: chrome.runtime.lastError });
      });
    });
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

  function badge(label, value, modifier) {
    const className = ["uwe-badge", modifier].filter(Boolean).join(" ");
    return `<span class="${className}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(
      value
    )}</strong></span>`;
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

  function renderJobCard(card) {
    const previousText = card.getAttribute("data-uwe-text") || "";
    const nextText = UWE.cleanText(card.textContent).slice(0, 1200);
    const existing = findExistingCardPanel(card);
    if (previousText === nextText && existing) {
      return;
    }

    const job = UWE.parseJobCard(card);
    const result = score(job);
    const panel = existing || document.createElement("div");
    panel.className = "uwe-card-panel";
    panel.setAttribute("data-uwe-job-id", result.jobId || "");
    panel.innerHTML = [
      contextBadge(job),
      badge(t("badge.overall"), String(result.overallScore), "uwe-badge--overall"),
      badge(
        "",
        t(`action.${result.recommendedAction}`),
        `uwe-badge--${result.recommendedAction}`
      ),
      badge(t("badge.match"), String(result.matchScore)),
      badge(t("badge.client"), String(result.clientQualityScore)),
      badge(t("badge.competition"), String(result.competitionScore)),
      badge(
        t("badge.risk"),
        t(`risk.${result.riskLevel}`),
        `uwe-badge--risk-${result.riskLevel}`
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

  function getSidebar() {
    let sidebar = document.querySelector(".uwe-sidebar");
    if (!sidebar) {
      sidebar = document.createElement("aside");
      sidebar.className = "uwe-sidebar";
      document.body.appendChild(sidebar);
    }
    return sidebar;
  }

  async function renderDetailSidebar() {
    const sidebar = getSidebar();
    if (!UWE.isLikelyDetailPage(document)) {
      sidebar.remove();
      lastSidebarSignature = "";
      return;
    }

    const job = UWE.parseJobDetail(document);
    const result = score(job);
    const signature = JSON.stringify({
      jobId: result.jobId,
      title: job.title,
      overallScore: result.overallScore,
      action: result.recommendedAction,
      language: settings.language,
      apiConfigured: Boolean(settings.api && settings.api.configured)
    });
    if (
      signature === lastSidebarSignature &&
      sidebar.querySelector(".uwe-sidebar__body") &&
      sidebar.contains(document.activeElement) &&
      /^(TEXTAREA|INPUT|BUTTON)$/.test(document.activeElement.tagName)
    ) {
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
    const collapsed = sidebar.classList.contains("uwe-sidebar--collapsed");

    sidebar.innerHTML = sidebarTemplate(
      job,
      result,
      selectedAction,
      savedNote,
      savedTags
    );
    sidebar.classList.toggle("uwe-sidebar--collapsed", collapsed);
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
          <div class="uwe-score-ring">${result.overallScore}</div>
          <div class="uwe-summary__meta">
            <div class="uwe-action uwe-action--${result.recommendedAction}">${escapeHtml(
              actionLabel
            )}</div>
            <p class="uwe-job-title">${escapeHtml(job.title)}</p>
          </div>
        </section>
        <section class="uwe-breakdown">
          ${scoreRow(t("badge.match"), result.matchScore)}
          ${scoreRow(t("badge.client"), result.clientQualityScore)}
          ${scoreRow(t("badge.competition"), result.competitionScore)}
          ${scoreRow(t("badge.risk"), result.riskScore)}
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

  function scoreRow(label, value) {
    const width = Math.max(0, Math.min(100, Number(value) || 0));
    return `
      <div class="uwe-breakdown__row">
        <span>${escapeHtml(label)}</span>
        <div class="uwe-meter"><span style="width: ${width}%"></span></div>
        <strong>${width}</strong>
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

  async function init() {
    await loadSettings();
    scheduleRender();

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
