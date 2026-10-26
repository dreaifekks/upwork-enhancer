// Upwork keeps the Find Work "Filters" modal state only in page memory, so a
// reload or a fresh visit starts unfiltered. This remembers what the user last
// applied and re-applies it when the feed loads without any active filter.
(function attachFeedFilterMemory(root) {
  const FEED_PATH = /^\/nx\/find-work(\/|$)/;
  const SELECTORS = {
    button: '[data-test="filters-button"]',
    modal: '.air3-modal[role="dialog"]',
    apply: '[data-test="filters-apply-btn"]',
    clear: '[data-test="filters-clear-btn"]',
    section: '[data-test="filter-section"]',
    sectionToggle: '[data-test="filter-section-toggle"]'
  };
  const RESTORE_WAIT_MS = 12000;
  const MODAL_WAIT_MS = 5000;

  function emptyState() {
    return { checked: [], inputs: {} };
  }

  function stripCount(text) {
    return String(text || "")
      .replace(/\s+/g, " ")
      .replace(/\(\s*[\d,.]+\+?\s*\)\s*$/, "")
      .trim();
  }

  function sectionKey(element) {
    const section = element.closest(SELECTORS.section);
    const toggle = section && section.querySelector(SELECTORS.sectionToggle);
    if (!toggle) return "";
    const controls = toggle.getAttribute("aria-controls") || "";
    return controls.replace(/^filter-section-content-/, "") || stripCount(toggle.textContent);
  }

  function checkboxEntries(modal) {
    const counters = new Map();
    return Array.from(modal.querySelectorAll('input[type="checkbox"]')).map((input) => {
      const section = sectionKey(input);
      const label = stripCount(input.closest("label") && input.closest("label").textContent);
      let name = label;
      if (!name) {
        const index = counters.get(section) || 0;
        counters.set(section, index + 1);
        name = `#${index}`;
      }
      return { input, key: `${section}::${name}` };
    });
  }

  function valueInputs(modal) {
    return Array.from(
      modal.querySelectorAll('input[id]:not([type="checkbox"]):not([type="radio"])')
    ).filter((input) => input.id);
  }

  function readModalState(modal) {
    const state = emptyState();
    checkboxEntries(modal).forEach(({ input, key }) => {
      if (input.checked) state.checked.push(key);
    });
    valueInputs(modal).forEach((input) => {
      const value = String(input.value || "").trim();
      if (value) state.inputs[input.id] = value;
    });
    return state;
  }

  function hasState(state) {
    return Boolean(
      state &&
        ((Array.isArray(state.checked) && state.checked.length) ||
          (state.inputs && Object.keys(state.inputs).length))
    );
  }

  function visibleFilterButton() {
    return Array.from(document.querySelectorAll(SELECTORS.button)).find(
      (button) => button.offsetParent !== null
    );
  }

  function buttonHasActiveCount(button) {
    return /\d/.test(String(button.textContent || ""));
  }

  function openModal() {
    return document.querySelector(SELECTORS.modal + " " + SELECTORS.apply)
      ? document.querySelector(SELECTORS.modal)
      : null;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function waitFor(check, timeoutMs) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const value = check();
      if (value) return value;
      await sleep(150);
    }
    return null;
  }

  function setInputValue(input, value) {
    const setter = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(input),
      "value"
    );
    if (setter && setter.set) {
      setter.set.call(input, value);
    } else {
      input.value = value;
    }
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  async function applyStateToModal(modal, state) {
    modal
      .querySelectorAll(`${SELECTORS.sectionToggle}[aria-expanded="false"]`)
      .forEach((toggle) => toggle.click());
    await sleep(150);

    const wanted = new Set(state.checked || []);
    checkboxEntries(modal).forEach(({ input, key }) => {
      if (input.checked !== wanted.has(key)) input.click();
    });
    await sleep(150);

    const inputs = state.inputs || {};
    valueInputs(modal).forEach((input) => {
      const next = Object.prototype.hasOwnProperty.call(inputs, input.id)
        ? String(inputs[input.id])
        : "";
      if (String(input.value || "") !== next) setInputValue(input, next);
    });
    await sleep(200);
  }

  function createController({ sendMessage, location = root.location } = {}) {
    let restoring = false;
    let restoredForLoad = false;

    async function loadState() {
      const response = await sendMessage({ type: "GET_FEED_FILTERS" });
      return response && response.ok ? response.filters : null;
    }

    async function saveState(state) {
      await sendMessage({ type: "SAVE_FEED_FILTERS", filters: state });
    }

    function onClick(event) {
      if (!event.isTrusted || restoring) return;
      const target = event.target && event.target.closest && event.target;
      if (!target) return;
      const modal = target.closest(SELECTORS.modal);
      if (!modal) return;
      if (target.closest(SELECTORS.apply)) {
        // Capture phase: read the boxes before Upwork closes the modal.
        saveState(readModalState(modal)).catch(() => null);
      } else if (target.closest(SELECTORS.clear)) {
        saveState(emptyState()).catch(() => null);
      }
    }

    async function restoreIfNeeded() {
      if (restoring || restoredForLoad) return;
      if (!FEED_PATH.test(location.pathname)) return;
      restoredForLoad = true;
      restoring = true;
      try {
        const state = await loadState();
        if (!hasState(state)) return;
        const button = await waitFor(visibleFilterButton, RESTORE_WAIT_MS);
        if (!button || buttonHasActiveCount(button)) return;
        button.click();
        const modal = await waitFor(openModal, MODAL_WAIT_MS);
        if (!modal) return;
        await applyStateToModal(modal, state);
        const apply = modal.querySelector(SELECTORS.apply);
        if (apply) apply.click();
      } catch (_) {
        // Leave the page as Upwork rendered it.
      } finally {
        restoring = false;
      }
    }

    function handleRouteChange() {
      if (!FEED_PATH.test(location.pathname)) {
        restoredForLoad = false;
        return;
      }
      restoreIfNeeded();
    }

    return { onClick, restoreIfNeeded, handleRouteChange };
  }

  function start() {
    if (
      typeof chrome === "undefined" ||
      !chrome.runtime ||
      !chrome.runtime.sendMessage ||
      typeof document === "undefined"
    ) {
      return;
    }
    const sendMessage = async (message) => {
      try {
        return await chrome.runtime.sendMessage(message);
      } catch (_) {
        return null;
      }
    };
    const controller = createController({ sendMessage });
    document.addEventListener("click", controller.onClick, true);
    controller.restoreIfNeeded();
    root.addEventListener("popstate", controller.handleRouteChange);
    if (root.navigation && root.navigation.addEventListener) {
      root.navigation.addEventListener("navigatesuccess", controller.handleRouteChange);
    }
  }

  const api = { stripCount, hasState, readModalState, applyStateToModal, createController };
  root.UpworkEnhancer = { ...(root.UpworkEnhancer || {}), feedFilterMemory: api };
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    start();
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
