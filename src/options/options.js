(function attachOptions(root) {
  const UWE = root.UpworkEnhancer;
  const form = document.getElementById("settingsForm");
  const status = document.getElementById("status");
  const resetDefaults = document.getElementById("resetDefaults");
  const language = document.getElementById("language");
  const theme = document.getElementById("theme");
  const importProfile = document.getElementById("importProfile");
  const openProfile = document.getElementById("openProfile");
  const profileMeta = document.getElementById("profileMeta");
  const testAi = document.getElementById("testAi");
  const tagEditors = new Map();
  const TAG_EDITOR_ROW_STEP = 3;

  let settings = UWE.normalizeSettings(UWE.DEFAULT_SETTINGS);

  init().catch((error) => {
    setStatus(error && error.message ? error.message : String(error));
  });

  async function init() {
    initTagEditors();
    settings = await loadSettings();
    populateForm(settings);
    applyLanguage(settings.language);

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!validateThresholdOrder()) return;
      const next = readForm();
      const permissionGranted = await requestApiPermission(next);
      if (!permissionGranted) {
        next.api.enabled = false;
        form.elements.apiEnabled.checked = false;
        setStatus(UWE.t(next.language, "options.permissionDenied"));
      }
      await saveSettings(next);
      settings = next;
      applyLanguage(settings.language);
      setStatus(
        permissionGranted
          ? UWE.t(settings.language, "options.saved")
          : UWE.t(settings.language, "options.permissionDenied")
      );
    });

    resetDefaults.addEventListener("click", () => {
      settings = UWE.normalizeSettings(UWE.DEFAULT_SETTINGS);
      populateForm(settings);
      applyLanguage(settings.language);
      setStatus("");
    });

    importProfile.addEventListener("click", async () => {
      setStatus(UWE.t(language.value, "options.importCurrentProfile"));
      const response = await sendMessage({ type: "IMPORT_PROFILE_FROM_ACTIVE_TAB" });
      if (response && response.ok) {
        settings = await loadSettings();
        populateForm(settings);
        applyLanguage(settings.language);
        setStatus(UWE.t(settings.language, "options.importedProfile"));
      } else {
        setStatus(
          `${UWE.t(language.value, "options.importProfileFailed")}: ${
            (response && response.error) || ""
          }`
        );
      }
    });

    openProfile.addEventListener("click", async () => {
      const profileUrl = validatedProfileUrl(form.elements.profileUrl.value);
      if (!profileUrl) {
        setStatus(UWE.t(language.value, "options.profileUrlRequired"));
        return;
      }
      await openUrl(profileUrl);
      setStatus(UWE.t(language.value, "options.openedProfile"));
    });

    testAi.addEventListener("click", async () => {
      if (!validateThresholdOrder()) return;
      const next = readForm();
      const permissionGranted = await requestApiPermission(next);
      if (!permissionGranted) {
        setStatus(UWE.t(next.language, "options.permissionDenied"));
        return;
      }
      await saveSettings(next);
      settings = next;
      setStatus(UWE.t(settings.language, "options.aiTesting"));
      const response = await sendMessage({ type: "TEST_AI_CONFIG" });
      setStatus(
        response && response.ok
          ? `${UWE.t(settings.language, "options.aiTestPassed")}: ${response.text}`
          : `${UWE.t(settings.language, "options.aiTestFailed")}: ${
              (response && response.error) || ""
            }`
      );
    });

    language.addEventListener("change", () => {
      applyLanguage(language.value);
    });

    theme.addEventListener("change", () => {
      applyTheme(theme.value);
    });

    ["thresholdApply", "thresholdWatch", "thresholdPass"].forEach((name) => {
      form.elements[name].addEventListener("input", validateThresholdOrder);
    });
  }

  async function sendMessage(message) {
    if (
      typeof chrome === "undefined" ||
      !chrome.runtime ||
      !chrome.runtime.sendMessage
    ) {
      return { ok: false, error: "runtime unavailable" };
    }
    return await chrome.runtime.sendMessage(message);
  }

  async function loadSettings() {
    if (
      typeof chrome === "undefined" ||
      !chrome.storage ||
      !chrome.storage.local
    ) {
      return UWE.normalizeSettings(UWE.DEFAULT_SETTINGS);
    }
    const stored = await chrome.storage.local.get(UWE.SETTINGS_STORAGE_KEY);
    return UWE.normalizeSettings(stored[UWE.SETTINGS_STORAGE_KEY]);
  }

  async function saveSettings(next) {
    if (
      typeof chrome !== "undefined" &&
      chrome.runtime &&
      chrome.runtime.sendMessage
    ) {
      const response = await chrome.runtime.sendMessage({
        type: "SAVE_SETTINGS",
        settings: next
      });
      if (response && response.ok) return;
    }
    if (
      typeof chrome === "undefined" ||
      !chrome.storage ||
      !chrome.storage.local
    ) {
      return;
    }
    await chrome.storage.local.set({ [UWE.SETTINGS_STORAGE_KEY]: next });
  }

  function populateForm(next) {
    form.elements.language.value = next.language;
    form.elements.theme.value = next.theme || "auto";
    form.elements.profileSummary.value = next.profileSummary || "";
    form.elements.profileUrl.value = next.profileUrl || "";
    setTagEditorValue("preferredSkills", next.preferredSkills);
    setTagEditorValue("avoidedSkills", next.avoidedSkills);
    setTagEditorValue("preferredProjectTypes", next.preferredProjectTypes);
    setTagEditorValue("blacklistedPhrases", next.blacklistedPhrases);
    setTagEditorValue("offPlatformPhrases", next.offPlatformPhrases);
    form.elements.minimumHourlyRate.value = next.minimumHourlyRate;
    form.elements.minimumFixedBudget.value = next.minimumFixedBudget;
    form.elements.weightMatch.value = roundWeight(next.weights.match);
    form.elements.weightClient.value = roundWeight(next.weights.clientQuality);
    form.elements.weightCompetition.value = roundWeight(next.weights.competition);
    form.elements.weightRisk.value = roundWeight(next.weights.risk);
    form.elements.thresholdApply.value = next.thresholds.apply;
    form.elements.thresholdWatch.value = next.thresholds.watch;
    form.elements.thresholdPass.value = next.thresholds.pass;
    form.elements.apiEnabled.checked = next.api.enabled;
    form.elements.apiBaseUrl.value = next.api.baseUrl;
    form.elements.apiModel.value = next.api.model;
    form.elements.apiKey.value = next.api.apiKey;
    profileMeta.textContent = profileMetaText(next);
  }

  function readForm() {
    syncTagEditors();
    const current = new FormData(form);
    return UWE.normalizeSettings({
      language: current.get("language"),
      theme: current.get("theme"),
      profileSummary: current.get("profileSummary"),
      profileUrl: current.get("profileUrl"),
      profileUpdatedAt: settings.profileUpdatedAt,
      profileSnapshot: settings.profileSnapshot,
      preferredSkills: current.get("preferredSkills"),
      avoidedSkills: current.get("avoidedSkills"),
      preferredProjectTypes: current.get("preferredProjectTypes"),
      minimumHourlyRate: current.get("minimumHourlyRate"),
      minimumFixedBudget: current.get("minimumFixedBudget"),
      blacklistedPhrases: current.get("blacklistedPhrases"),
      offPlatformPhrases: current.get("offPlatformPhrases"),
      weights: {
        match: current.get("weightMatch"),
        clientQuality: current.get("weightClient"),
        competition: current.get("weightCompetition"),
        risk: current.get("weightRisk")
      },
      thresholds: {
        apply: current.get("thresholdApply"),
        watch: current.get("thresholdWatch"),
        pass: current.get("thresholdPass")
      },
      api: {
        enabled: Boolean(current.get("apiEnabled")),
        baseUrl: current.get("apiBaseUrl"),
        model: current.get("apiModel"),
        apiKey: current.get("apiKey")
      }
    });
  }

  function validateThresholdOrder() {
    const apply = form.elements.thresholdApply;
    const watch = form.elements.thresholdWatch;
    const pass = form.elements.thresholdPass;
    [apply, watch, pass].forEach((field) => field.setCustomValidity(""));
    const values = [apply, watch, pass].map((field) => field.value.trim());
    const valid =
      values.every((value) => value !== "" && Number.isFinite(Number(value))) &&
      Number(apply.value) >= Number(watch.value) &&
      Number(watch.value) >= Number(pass.value);
    if (valid) {
      if (status.textContent === UWE.t(language.value, "options.thresholdOrderError")) {
        setStatus("");
      }
      return true;
    }
    const message = UWE.t(language.value, "options.thresholdOrderError");
    [apply, watch, pass].forEach((field) => field.setCustomValidity(message));
    setStatus(message);
    apply.reportValidity();
    return false;
  }

  function initTagEditors() {
    document.querySelectorAll("[data-tag-editor]").forEach((editor) => {
      const name = editor.getAttribute("data-tag-editor");
      const list = editor.querySelector("[data-tag-list]");
      const input = editor.querySelector("[data-tag-input]");
      const hidden = form.elements[name];
      if (!name || !list || !input || !hidden) return;

      const state = {
        name,
        editor,
        list,
        input,
        hidden,
        values: [],
        pendingBackspaceDelete: false
      };
      tagEditors.set(name, state);

      editor.addEventListener("click", () => input.focus());
      input.addEventListener("keydown", (event) =>
        handleTagInputKeydown(event, state)
      );
      input.addEventListener("input", () => handleTagInput(state));
      input.addEventListener("blur", () => commitTagInput(state));
    });
  }

  function handleTagInputKeydown(event, state) {
    if (event.key === "Enter") {
      event.preventDefault();
      commitTagInput(state);
      return;
    }

    if (event.key === "," || event.key === "\uFF0C") {
      event.preventDefault();
      commitTagInput(state);
      return;
    }

    if (event.key === "Backspace" && !state.input.value) {
      if (!state.values.length) return;
      event.preventDefault();
      if (state.pendingBackspaceDelete) {
        state.values.pop();
        state.pendingBackspaceDelete = false;
      } else {
        state.pendingBackspaceDelete = true;
      }
      renderTagEditor(state);
      return;
    }

    state.pendingBackspaceDelete = false;
    renderTagEditor(state);
  }

  function handleTagInput(state) {
    state.pendingBackspaceDelete = false;
    if (!/[\n,\uFF0C]/.test(state.input.value)) {
      renderTagEditor(state);
      return;
    }

    const parts = state.input.value.split(/[\n,\uFF0C]/);
    parts.slice(0, -1).forEach((part) => addTag(state, part));
    state.input.value = parts[parts.length - 1] || "";
    renderTagEditor(state);
  }

  function commitTagInput(state) {
    addTag(state, state.input.value);
    state.input.value = "";
    state.pendingBackspaceDelete = false;
    renderTagEditor(state);
  }

  function addTag(state, value) {
    const tag = String(value || "").trim();
    if (!tag) return;
    const exists = state.values.some(
      (item) => item.toLowerCase() === tag.toLowerCase()
    );
    if (!exists) state.values.push(tag);
  }

  function removeTag(state, index) {
    state.values.splice(index, 1);
    state.pendingBackspaceDelete = false;
    renderTagEditor(state);
    state.input.focus();
  }

  function setTagEditorValue(name, values) {
    const state = tagEditors.get(name);
    if (!state) {
      if (form.elements[name]) {
        form.elements[name].value = UWE.arrayFromValue(values).join("\n");
      }
      return;
    }
    state.values = UWE.arrayFromValue(values);
    state.input.value = "";
    state.pendingBackspaceDelete = false;
    renderTagEditor(state);
  }

  function syncTagEditors() {
    tagEditors.forEach((state) => {
      commitTagInput(state);
    });
  }

  function renderTagEditor(state) {
    state.hidden.value = state.values.join("\n");
    state.list.textContent = "";
    state.values.forEach((value, index) => {
      const tag = document.createElement("span");
      tag.className = "tag-editor__tag";
      if (
        state.pendingBackspaceDelete &&
        index === state.values.length - 1 &&
        !state.input.value
      ) {
        tag.classList.add("is-pending-delete");
      }

      const label = document.createElement("span");
      label.className = "tag-editor__label";
      label.textContent = value;

      const remove = document.createElement("button");
      remove.className = "tag-editor__remove";
      remove.type = "button";
      remove.setAttribute("aria-label", `Remove ${value}`);
      remove.textContent = "x";
      remove.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        removeTag(state, index);
      });

      tag.append(label, remove);
      state.list.append(tag);
    });
    scheduleTagEditorRows(state);
  }

  function scheduleTagEditorRows(state) {
    const schedule = root.requestAnimationFrame || root.setTimeout;
    schedule(() => updateTagEditorRows(state), 0);
  }

  function updateTagEditorRows(state) {
    const items = [...Array.from(state.list.children), state.input];
    const rowTops = new Set(
      items
        .filter((item) => item && item.offsetParent !== null)
        .map((item) => Math.round(item.offsetTop))
    );
    const neededRows = Math.max(TAG_EDITOR_ROW_STEP, rowTops.size || 1);
    const visibleRows =
      Math.ceil(neededRows / TAG_EDITOR_ROW_STEP) * TAG_EDITOR_ROW_STEP;
    state.editor.style.setProperty("--tag-editor-rows", String(visibleRows));
  }

  async function requestApiPermission(next) {
    if (
      !next.api.enabled ||
      !next.api.baseUrl ||
      typeof chrome === "undefined" ||
      !chrome.permissions
    ) {
      return true;
    }
    let originPattern = "";
    try {
      const url = new URL(next.api.baseUrl);
      originPattern = `${url.origin}/*`;
    } catch (_) {
      return true;
    }
    return await chrome.permissions.request({ origins: [originPattern] });
  }

  function validatedProfileUrl(value) {
    return UWE.normalizeProfileUrl
      ? UWE.normalizeProfileUrl(value)
      : String(value || "").trim();
  }

  async function openUrl(url) {
    if (
      typeof chrome !== "undefined" &&
      chrome.tabs &&
      chrome.tabs.create
    ) {
      await chrome.tabs.create({ url });
      return;
    }
    window.open(url, "_blank", "noopener");
  }

  function applyLanguage(nextLanguage) {
    const lang = nextLanguage === "zh" ? "zh" : "en";
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
    document.querySelectorAll("[data-i18n]").forEach((element) => {
      element.textContent = UWE.t(lang, element.getAttribute("data-i18n"));
    });
    applyTheme(form.elements.theme.value);
  }

  function applyTheme(nextTheme) {
    const resolved = ["auto", "light", "dark"].includes(nextTheme)
      ? nextTheme
      : "auto";
    if (resolved === "auto") {
      document.documentElement.removeAttribute("data-theme");
      return;
    }
    document.documentElement.setAttribute("data-theme", resolved);
  }

  function setStatus(message) {
    status.textContent = message || "";
  }

  function profileMetaText(next) {
    const pieces = [];
    if (next.profileUrl) {
      pieces.push(next.profileUrl);
    }
    if (next.profileUpdatedAt) {
      pieces.push(
        `${UWE.t(next.language, "options.profileUpdated")}: ${new Date(
          next.profileUpdatedAt
        ).toLocaleString()}`
      );
    }
    return pieces.join(" | ");
  }

  function roundWeight(value) {
    return Math.round(Number(value || 0) * 100) / 100;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
