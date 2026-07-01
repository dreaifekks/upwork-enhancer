importScripts("../shared/defaultSettings.js");

const UWE = self.UpworkEnhancer;

chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then((response) => sendResponse(response))
    .catch((error) => {
      sendResponse({
        ok: false,
        error: error && error.message ? error.message : String(error)
      });
    });
  return true;
});

async function handleMessage(message) {
  switch (message && message.type) {
    case "GET_PUBLIC_SETTINGS": {
      const settings = await loadSettings();
      return { ok: true, settings: UWE.publicSettings(settings) };
    }
    case "SAVE_SETTINGS": {
      const publicSettings = await saveSettings(message.settings);
      return { ok: true, settings: publicSettings };
    }
    case "PATCH_SETTINGS": {
      const current = await loadSettings();
      const patch = message.patch && typeof message.patch === "object" ? message.patch : {};
      const next = mergeSettingsPatch(current, patch);
      const publicSettings = await saveSettings(next);
      return { ok: true, settings: publicSettings };
    }
    case "IMPORT_PROFILE_FROM_ACTIVE_TAB": {
      return await importProfileFromActiveTab();
    }
    case "GET_DECISION": {
      const decisions = await loadDecisions();
      const key = decisionKey(message.jobId, message.url);
      return { ok: true, decision: decisions[key] || null };
    }
    case "SAVE_DECISION": {
      const decisions = await loadDecisions();
      const decision = sanitizeDecision(message.decision);
      decisions[decisionKey(decision.jobId, decision.url)] = decision;
      await chrome.storage.local.set({ [UWE.DECISIONS_STORAGE_KEY]: decisions });
      return { ok: true, decision };
    }
    case "AI_ANALYZE": {
      return await analyzeWithAi(message.job, message.score);
    }
    case "TEST_AI_CONFIG": {
      return await testAiConfig();
    }
    default:
      return { ok: false, error: "Unknown message type" };
  }
}

async function saveSettings(input) {
  const settings = UWE.normalizeSettings(input);
  await chrome.storage.local.set({ [UWE.SETTINGS_STORAGE_KEY]: settings });
  const publicSettings = UWE.publicSettings(settings);
  await notifyUpworkTabs(publicSettings);
  return publicSettings;
}

function mergeSettingsPatch(current, patch) {
  return UWE.normalizeSettings({
    ...current,
    ...patch,
    api: patch.api ? { ...current.api, ...patch.api } : current.api,
    weights: patch.weights ? { ...current.weights, ...patch.weights } : current.weights,
    thresholds: patch.thresholds
      ? { ...current.thresholds, ...patch.thresholds }
      : current.thresholds,
    profileSnapshot: patch.profileSnapshot || current.profileSnapshot
  });
}

async function notifyUpworkTabs(settings) {
  if (!chrome.tabs || !chrome.tabs.query || !chrome.tabs.sendMessage) return;
  try {
    const tabs = await chrome.tabs.query({
      url: ["https://www.upwork.com/*", "https://*.upwork.com/*"]
    });
    await Promise.all(
      tabs.map((tab) =>
        chrome.tabs
          .sendMessage(tab.id, { type: "SETTINGS_UPDATED", settings })
          .catch(() => null)
      )
    );
  } catch (_) {
    // Existing Upwork tabs can still refresh manually if tab messaging is unavailable.
  }
}

async function loadSettings() {
  const stored = await chrome.storage.local.get(UWE.SETTINGS_STORAGE_KEY);
  return UWE.normalizeSettings(stored[UWE.SETTINGS_STORAGE_KEY]);
}

async function importProfileFromActiveTab() {
  if (!chrome.tabs || !chrome.tabs.query || !chrome.tabs.sendMessage) {
    return { ok: false, error: "Tab access is unavailable." };
  }

  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs && tabs[0];
  if (!tab || !tab.id) {
    return { ok: false, error: "No active tab found." };
  }

  let response;
  try {
    response = await chrome.tabs.sendMessage(tab.id, {
      type: "REQUEST_PROFILE_SNAPSHOT"
    });
  } catch (error) {
    return {
      ok: false,
      error:
        "Open your Upwork freelancer profile page and reload it before importing."
    };
  }

  if (!response || !response.ok || !response.profile) {
    return {
      ok: false,
      error:
        (response && response.error) ||
        "Open your Upwork freelancer profile page before importing."
    };
  }

  const current = await loadSettings();
  const profile = UWE.normalizeProfileSnapshot(response.profile);
  const summary =
    response.profile.summary || UWE.profileSummaryFromSnapshot(profile);
  const next = UWE.normalizeSettings({
    ...current,
    profileSummary: summary,
    profileUrl: profile.profileUrl,
    profileUpdatedAt: profile.updatedAt,
    profileSnapshot: profile,
    preferredSkills: uniqueList(
      current.preferredSkills.concat(profile.skills || [])
    ).slice(0, 40)
  });
  const publicSettings = await saveSettings(next);
  return {
    ok: true,
    profile,
    settings: publicSettings
  };
}

async function loadDecisions() {
  const stored = await chrome.storage.local.get(UWE.DECISIONS_STORAGE_KEY);
  const decisions = stored[UWE.DECISIONS_STORAGE_KEY];
  return decisions && typeof decisions === "object" ? decisions : {};
}

function decisionKey(jobId, url) {
  return String(jobId || url || "unknown");
}

function sanitizeDecision(input) {
  const source = input && typeof input === "object" ? input : {};
  return {
    jobId: String(source.jobId || source.url || ""),
    url: String(source.url || ""),
    title: String(source.title || ""),
    userDecision: ["apply", "watch", "maybe", "pass"].includes(source.userDecision)
      ? source.userDecision
      : "maybe",
    note: String(source.note || "").slice(0, 2000),
    tags: Array.isArray(source.tags) ? source.tags.map(String).slice(0, 20) : [],
    scoreSnapshot: source.scoreSnapshot || null,
    savedAt: source.savedAt || new Date().toISOString()
  };
}

async function analyzeWithAi(job, score) {
  const settings = await loadSettings();
  if (!isAiConfigured(settings)) {
    return { ok: false, error: "AI is not configured" };
  }

  const endpoint = `${settings.api.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const prompt = buildPrompt(job, score, settings);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${settings.api.apiKey}`
    },
    body: JSON.stringify({
      model: settings.api.model,
      temperature: 0.3,
      messages: [
        {
          role: "system",
          content:
            "You are a concise Upwork opportunity analyst. Focus on fit, risks, and proposal angle. Do not suggest off-platform behavior."
        },
        {
          role: "user",
          content: prompt
        }
      ]
    })
  });

  if (!response.ok) {
    const text = await response.text();
    return {
      ok: false,
      error: `AI request failed: ${response.status} ${text.slice(0, 160)}`
    };
  }

  const payload = await response.json();
  const text =
    payload &&
    payload.choices &&
    payload.choices[0] &&
    payload.choices[0].message &&
    payload.choices[0].message.content;

  return { ok: true, text: String(text || "").trim() };
}

async function testAiConfig() {
  const settings = await loadSettings();
  if (!isAiConfigured(settings)) {
    return { ok: false, error: "AI is not configured" };
  }

  const endpoint = `${settings.api.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${settings.api.apiKey}`
      },
      body: JSON.stringify({
        model: settings.api.model,
        temperature: 0,
        messages: [
          {
            role: "system",
            content: "Reply with a short confirmation only."
          },
          {
            role: "user",
            content: "Upwork Enhancer connection test. Reply OK if you can read this."
          }
        ]
      })
    });

    if (!response.ok) {
      const text = await response.text();
      return {
        ok: false,
        error: `AI test failed: ${response.status} ${text.slice(0, 160)}`
      };
    }

    const payload = await response.json();
    const text =
      payload &&
      payload.choices &&
      payload.choices[0] &&
      payload.choices[0].message &&
      payload.choices[0].message.content;
    return {
      ok: true,
      text: String(text || "OK").trim().slice(0, 240)
    };
  } finally {
    clearTimeout(timeout);
  }
}

function isAiConfigured(settings) {
  return Boolean(
    settings.api.enabled &&
      settings.api.baseUrl &&
      settings.api.model &&
      settings.api.apiKey
  );
}

function buildPrompt(job, score, settings) {
  const safeJob = {
    title: job && job.title,
    description: job && String(job.description || "").slice(0, 6000),
    skills: job && job.skills,
    budgetType: job && job.budgetType,
    hourlyMin: job && job.hourlyMin,
    hourlyMax: job && job.hourlyMax,
    fixedBudget: job && job.fixedBudget,
    experienceLevel: job && job.experienceLevel,
    proposalCount: job && job.proposalCount,
    clientPaymentVerified: job && job.clientPaymentVerified,
    clientRating: job && job.clientRating,
    clientSpend: job && job.clientSpend
  };

  return [
    "Analyze this Upwork job for a freelancer.",
    "",
    `Freelancer profile: ${settings.profileSummary || "Not configured."}`,
    `Preferred skills: ${settings.preferredSkills.join(", ")}`,
    `Avoided skills/categories: ${settings.avoidedSkills.join(", ")}`,
    "",
    `Local scoring result: ${JSON.stringify(score, null, 2)}`,
    "",
    `Job data: ${JSON.stringify(safeJob, null, 2)}`,
    "",
    "Return four short sections:",
    "1. Requirement summary",
    "2. Hidden risks",
    "3. Proposal angle",
    "4. First 2-3 sentence opener"
  ].join("\n");
}

function uniqueList(values) {
  const seen = new Set();
  const result = [];
  for (const value of values || []) {
    const normalized = String(value || "").trim();
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}
