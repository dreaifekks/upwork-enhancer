(function attachDefaultSettings(root) {
  const namespace = root.UpworkEnhancer || {};

  const SETTINGS_STORAGE_KEY = "uwe_settings_v1";
  const DECISIONS_STORAGE_KEY = "uwe_decisions_v1";

  const DEFAULT_SETTINGS = {
    language: "en",
    theme: "auto",
    profileSummary: "",
    profileUrl: "",
    profileUpdatedAt: "",
    profileSnapshot: {
      name: "",
      title: "",
      overview: "",
      hourlyRate: "",
      skills: [],
      languages: [],
      location: "",
      profileUrl: "",
      updatedAt: ""
    },
    preferredSkills: [
      "chrome extension",
      "browser extension",
      "javascript",
      "typescript",
      "react",
      "automation",
      "api integration",
      "openai",
      "ai"
    ],
    avoidedSkills: ["crypto", "nft", "casino"],
    preferredProjectTypes: [
      "browser extension",
      "automation",
      "ai integration",
      "web app"
    ],
    minimumHourlyRate: 35,
    minimumFixedBudget: 300,
    blacklistedPhrases: [
      "unpaid test",
      "free sample",
      "outside upwork",
      "telegram",
      "whatsapp",
      "commission only"
    ],
    weights: {
      match: 0.35,
      clientQuality: 0.25,
      competition: 0.2,
      risk: 0.2
    },
    thresholds: {
      apply: 78,
      watch: 66,
      pass: 45
    },
    api: {
      enabled: false,
      baseUrl: "",
      model: "gpt-4o-mini",
      apiKey: ""
    }
  };

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function arrayFromValue(value) {
    if (Array.isArray(value)) {
      return value
        .map((item) => String(item).trim())
        .filter(Boolean);
    }
    if (typeof value === "string") {
      return value
        .split(/[\n,，]/)
        .map((item) => item.trim())
        .filter(Boolean);
    }
    return [];
  }

  function numberOrDefault(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function normalizeProfileUrl(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";

    let candidate = raw;
    if (/^\/?freelancers\/~/i.test(raw)) {
      candidate = `https://www.upwork.com/${raw.replace(/^\/+/, "")}`;
    } else if (/^(?:www\.)?upwork\.com\//i.test(raw)) {
      candidate = `https://${raw}`;
    }

    try {
      const url = new URL(candidate);
      if (
        url.protocol === "https:" &&
        /(^|\.)upwork\.com$/i.test(url.hostname) &&
        /^\/freelancers\/~[A-Za-z0-9]+/.test(url.pathname)
      ) {
        return url.toString();
      }
    } catch (_) {
      return "";
    }
    return "";
  }

  function normalizeWeights(weights) {
    const defaults = DEFAULT_SETTINGS.weights;
    const next = {
      match: numberOrDefault(weights && weights.match, defaults.match),
      clientQuality: numberOrDefault(
        weights && weights.clientQuality,
        defaults.clientQuality
      ),
      competition: numberOrDefault(
        weights && weights.competition,
        defaults.competition
      ),
      risk: numberOrDefault(weights && weights.risk, defaults.risk)
    };
    const total = Object.values(next).reduce((sum, value) => sum + value, 0);
    if (!total) {
      return clone(defaults);
    }
    return {
      match: next.match / total,
      clientQuality: next.clientQuality / total,
      competition: next.competition / total,
      risk: next.risk / total
    };
  }

  function normalizeSettings(input) {
    const defaults = clone(DEFAULT_SETTINGS);
    const source = input && typeof input === "object" ? input : {};
    const api = source.api && typeof source.api === "object" ? source.api : {};
    const has = (key) => Object.prototype.hasOwnProperty.call(source, key);

    return {
      ...defaults,
      ...source,
      language: source.language === "zh" ? "zh" : "en",
      theme: ["auto", "light", "dark"].includes(source.theme)
        ? source.theme
        : defaults.theme,
      profileSummary: String(source.profileSummary || ""),
      profileUrl: normalizeProfileUrl(source.profileUrl),
      profileUpdatedAt: String(source.profileUpdatedAt || ""),
      profileSnapshot: normalizeProfileSnapshot(source.profileSnapshot),
      preferredSkills: arrayFromValue(
        has("preferredSkills") ? source.preferredSkills : defaults.preferredSkills
      ),
      avoidedSkills: arrayFromValue(
        has("avoidedSkills") ? source.avoidedSkills : defaults.avoidedSkills
      ),
      preferredProjectTypes: arrayFromValue(
        has("preferredProjectTypes")
          ? source.preferredProjectTypes
          : defaults.preferredProjectTypes
      ),
      minimumHourlyRate: numberOrDefault(
        source.minimumHourlyRate,
        defaults.minimumHourlyRate
      ),
      minimumFixedBudget: numberOrDefault(
        source.minimumFixedBudget,
        defaults.minimumFixedBudget
      ),
      blacklistedPhrases: arrayFromValue(
        has("blacklistedPhrases")
          ? source.blacklistedPhrases
          : defaults.blacklistedPhrases
      ),
      weights: normalizeWeights(source.weights || defaults.weights),
      thresholds: {
        apply: numberOrDefault(
          source.thresholds && source.thresholds.apply,
          defaults.thresholds.apply
        ),
        watch: numberOrDefault(
          source.thresholds && source.thresholds.watch,
          defaults.thresholds.watch
        ),
        pass: numberOrDefault(
          source.thresholds && source.thresholds.pass,
          defaults.thresholds.pass
        )
      },
      api: {
        ...defaults.api,
        ...api,
        enabled: Boolean(api.enabled),
        baseUrl: String(api.baseUrl || "").trim(),
        model: String(api.model || defaults.api.model).trim(),
        apiKey: String(api.apiKey || "")
      }
    };
  }

  function normalizeProfileSnapshot(input) {
    const source = input && typeof input === "object" ? input : {};
    return {
      name: String(source.name || ""),
      title: String(source.title || ""),
      overview: String(source.overview || ""),
      hourlyRate: String(source.hourlyRate || ""),
      skills: arrayFromValue(source.skills || []),
      languages: arrayFromValue(source.languages || []),
      location: String(source.location || ""),
      profileUrl: normalizeProfileUrl(source.profileUrl),
      updatedAt: String(source.updatedAt || "")
    };
  }

  function profileSummaryFromSnapshot(input) {
    const profile = normalizeProfileSnapshot(input);
    const parts = [];
    if (profile.title) {
      parts.push(`Title: ${profile.title}`);
    }
    if (profile.hourlyRate) {
      parts.push(`Rate: ${profile.hourlyRate}`);
    }
    if (profile.overview) {
      parts.push(`Overview: ${profile.overview}`);
    }
    if (profile.skills.length) {
      parts.push(`Skills: ${profile.skills.join(", ")}`);
    }
    if (profile.languages.length) {
      parts.push(`Languages: ${profile.languages.join(", ")}`);
    }
    return parts.join("\n");
  }

  function publicSettings(settings) {
    const normalized = normalizeSettings(settings);
    return {
      ...normalized,
      api: {
        enabled: normalized.api.enabled,
        baseUrl: normalized.api.baseUrl,
        model: normalized.api.model,
        apiKey: "",
        configured: Boolean(
          normalized.api.enabled &&
            normalized.api.baseUrl &&
            normalized.api.model &&
            normalized.api.apiKey
        )
      }
    };
  }

  const api = {
    SETTINGS_STORAGE_KEY,
    DECISIONS_STORAGE_KEY,
    DEFAULT_SETTINGS,
    normalizeSettings,
    normalizeProfileUrl,
    normalizeProfileSnapshot,
    profileSummaryFromSnapshot,
    publicSettings,
    arrayFromValue
  };

  root.UpworkEnhancer = { ...namespace, ...api };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
