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

  let settings = UWE.publicSettings(UWE.DEFAULT_SETTINGS);

  init();

  async function init() {
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
      await openUrl(profileUrl);
      setStatus(UWE.t(settings.language, "options.openedProfile"));
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
    controls.preferredSkills.value = settings.preferredSkills.join("\n");
    controls.avoidedSkills.value = settings.avoidedSkills.join("\n");
    controls.minimumHourlyRate.value = settings.minimumHourlyRate;
    controls.minimumFixedBudget.value = settings.minimumFixedBudget;
    applyLanguage(settings.language);
    applyTheme(settings.theme);
    renderProfileStatus();
    renderAiStatus();
  }

  function readPatch() {
    return {
      language: controls.language.value,
      theme: controls.theme.value,
      preferredSkills: controls.preferredSkills.value,
      avoidedSkills: controls.avoidedSkills.value,
      minimumHourlyRate: controls.minimumHourlyRate.value,
      minimumFixedBudget: controls.minimumFixedBudget.value
    };
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
      controls.openProfile.disabled = true;
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
    controls.openProfile.disabled = !validatedProfileUrl(settings.profileUrl);
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
