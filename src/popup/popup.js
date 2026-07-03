(function attachPopup(root) {
  const UWE = root.UpworkEnhancer;
  const controls = {
    language: document.getElementById("language"),
    theme: document.getElementById("theme"),
    preferredSkills: document.getElementById("preferredSkills"),
    avoidedSkills: document.getElementById("avoidedSkills"),
    minimumHourlyRate: document.getElementById("minimumHourlyRate"),
    minimumFixedBudget: document.getElementById("minimumFixedBudget"),
    profileStatus: document.getElementById("profileStatus"),
    aiStatus: document.getElementById("aiStatus"),
    status: document.getElementById("status"),
    save: document.getElementById("save"),
    importProfile: document.getElementById("importProfile"),
    openProfile: document.getElementById("openProfile"),
    testAi: document.getElementById("testAi"),
    openOptions: document.getElementById("openOptions")
  };
  const tagEditors = new Map();
  const TAG_EDITOR_ROW_STEP = 3;

  let settings = UWE.publicSettings(UWE.DEFAULT_SETTINGS);

  init();

  async function init() {
    initTagEditors();
    const response = await sendMessage({ type: "GET_PUBLIC_SETTINGS" });
    if (response && response.ok && response.settings) {
      settings = response.settings;
    }
    populate();
    bindEvents();
  }

  function bindEvents() {
    controls.language.addEventListener("change", async () => {
      applyLanguage(controls.language.value);
      await savePatch({ language: controls.language.value }, false);
    });

    controls.theme.addEventListener("change", async () => {
      applyTheme(controls.theme.value);
      await savePatch({ theme: controls.theme.value }, false);
    });

    controls.save.addEventListener("click", async () => {
      await savePatch(readPatch(), true);
    });

    controls.importProfile.addEventListener("click", async () => {
      setStatus(UWE.t(settings.language, "popup.importProfile"));
      const response = await sendMessage({ type: "IMPORT_PROFILE_FROM_ACTIVE_TAB" });
      if (response && response.ok && response.settings) {
        settings = response.settings;
        populate();
        setStatus(UWE.t(settings.language, "options.importedProfile"));
      } else {
        setStatus(
          `${UWE.t(settings.language, "options.importProfileFailed")}: ${
            (response && response.error) || ""
          }`
        );
      }
    });

    controls.openProfile.addEventListener("click", async () => {
      const profileUrl = validatedProfileUrl(settings.profileUrl);
      if (!profileUrl) {
        setStatus(UWE.t(settings.language, "options.profileUrlRequired"));
        return;
      }
      try {
        await openUrl(profileUrl);
        setStatus(UWE.t(settings.language, "options.openedProfile"));
      } catch (error) {
        setStatus(
          `${UWE.t(settings.language, "popup.error")}: ${messageFromError(error)}`
        );
      }
    });

    controls.testAi.addEventListener("click", async () => {
      setStatus(UWE.t(settings.language, "popup.testingAi"));
      const permissionGranted = await requestApiPermission(settings);
      if (!permissionGranted) {
        setStatus(UWE.t(settings.language, "options.permissionDenied"));
        return;
      }
      const response = await sendMessage({ type: "TEST_AI_CONFIG" });
      if (response && response.ok) {
        setStatus(
          UWE.t(settings.language, "popup.aiTestOk", {
            text: response.text || "OK"
          })
        );
      } else {
        setStatus(`${UWE.t(settings.language, "popup.error")}: ${(response && response.error) || ""}`);
      }
    });

    controls.openOptions.addEventListener("click", () => {
      if (chrome.runtime && chrome.runtime.openOptionsPage) {
        chrome.runtime.openOptionsPage();
      }
    });
  }

  function populate() {
    controls.language.value = settings.language;
    controls.theme.value = settings.theme || "auto";
    setTagEditorValue("preferredSkills", settings.preferredSkills);
    setTagEditorValue("avoidedSkills", settings.avoidedSkills);
    controls.minimumHourlyRate.value = settings.minimumHourlyRate;
    controls.minimumFixedBudget.value = settings.minimumFixedBudget;
    applyLanguage(settings.language);
    applyTheme(settings.theme);
    renderProfileStatus();
    renderAiStatus();
  }

  function readPatch() {
    syncTagEditors();
    return {
      language: controls.language.value,
      theme: controls.theme.value,
      preferredSkills: controls.preferredSkills.value,
      avoidedSkills: controls.avoidedSkills.value,
      minimumHourlyRate: controls.minimumHourlyRate.value,
      minimumFixedBudget: controls.minimumFixedBudget.value
    };
  }

  function initTagEditors() {
    document.querySelectorAll("[data-tag-editor]").forEach((editor) => {
      const name = editor.getAttribute("data-tag-editor");
      const list = editor.querySelector("[data-tag-list]");
      const input = editor.querySelector("[data-tag-input]");
      const hidden = controls[name];
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
      if (controls[name]) {
        controls[name].value = UWE.arrayFromValue(values).join("\n");
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

  async function savePatch(patch, showSaved) {
    const response = await sendMessage({
      type: "PATCH_SETTINGS",
      patch
    });
    if (response && response.ok && response.settings) {
      settings = response.settings;
      populate();
      if (showSaved) setStatus(UWE.t(settings.language, "popup.saved"));
    } else {
      setStatus(`${UWE.t(settings.language, "popup.error")}: ${(response && response.error) || ""}`);
    }
  }

  function renderProfileStatus() {
    const profile = settings.profileSnapshot || {};
    if (!settings.profileUrl && !profile.title) {
      controls.profileStatus.textContent = UWE.t(
        settings.language,
        "popup.profileNotImported"
      );
      controls.importProfile.textContent = UWE.t(
        settings.language,
        "popup.importProfile"
      );
      controls.openProfile.disabled = false;
      return;
    }

    const updated = settings.profileUpdatedAt
      ? UWE.t(settings.language, "popup.lastUpdated", {
          time: new Date(settings.profileUpdatedAt).toLocaleString()
        })
      : "";
    controls.profileStatus.textContent = [profile.title, settings.profileUrl, updated]
      .filter(Boolean)
      .join(" | ");
    controls.importProfile.textContent = UWE.t(settings.language, "popup.updateProfile");
    controls.openProfile.disabled = false;
  }

  function renderAiStatus() {
    controls.aiStatus.textContent =
      settings.api && settings.api.configured
        ? `${UWE.t(settings.language, "popup.aiConfigured")}: ${settings.api.model}`
        : UWE.t(settings.language, "popup.aiNotConfigured");
  }

  function applyLanguage(nextLanguage) {
    const lang = nextLanguage === "zh" ? "zh" : "en";
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
    document.querySelectorAll("[data-i18n]").forEach((element) => {
      element.textContent = UWE.t(lang, element.getAttribute("data-i18n"));
    });
    renderAiStatus();
  }

  function applyTheme(nextTheme) {
    const theme = ["auto", "light", "dark"].includes(nextTheme) ? nextTheme : "auto";
    if (theme === "auto") {
      document.documentElement.removeAttribute("data-theme");
      return;
    }
    document.documentElement.setAttribute("data-theme", theme);
  }

  function setStatus(message) {
    controls.status.textContent = message || "";
  }

  function messageFromError(error) {
    if (!error) return "";
    return error.message || String(error);
  }

  async function requestApiPermission(next) {
    if (
      !next.api ||
      !next.api.enabled ||
      !next.api.baseUrl ||
      typeof chrome === "undefined" ||
      !chrome.permissions
    ) {
      return true;
    }
    try {
      const url = new URL(next.api.baseUrl);
      return await chrome.permissions.request({ origins: [`${url.origin}/*`] });
    } catch (_) {
      return true;
    }
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

  function sendMessage(message) {
    if (
      typeof chrome === "undefined" ||
      !chrome.runtime ||
      !chrome.runtime.sendMessage
    ) {
      return Promise.resolve({ ok: false, error: "runtime unavailable" });
    }
    return chrome.runtime.sendMessage(message);
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
