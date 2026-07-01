(function attachOptions(root) {
  const UWE = root.UpworkEnhancer;
  const form = document.getElementById("settingsForm");
  const status = document.getElementById("status");
  const resetDefaults = document.getElementById("resetDefaults");
  const language = document.getElementById("language");
  const importProfile = document.getElementById("importProfile");
  const openProfile = document.getElementById("openProfile");
  const profileMeta = document.getElementById("profileMeta");
  const testAi = document.getElementById("testAi");

  let settings = UWE.normalizeSettings(UWE.DEFAULT_SETTINGS);

  init();

  async function init() {
    settings = await loadSettings();
    populateForm(settings);
    applyLanguage(settings.language);

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
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
    form.elements.profileSummary.value = next.profileSummary || "";
    form.elements.profileUrl.value = next.profileUrl || "";
    form.elements.preferredSkills.value = next.preferredSkills.join("\n");
    form.elements.avoidedSkills.value = next.avoidedSkills.join("\n");
    form.elements.preferredProjectTypes.value = next.preferredProjectTypes.join("\n");
    form.elements.blacklistedPhrases.value = next.blacklistedPhrases.join("\n");
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
    const current = new FormData(form);
    return UWE.normalizeSettings({
      language: current.get("language"),
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
