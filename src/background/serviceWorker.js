importScripts("../shared/defaultSettings.js");

const UWE = self.UpworkEnhancer;
const AI_MAX_TOKENS = 1600;
const AI_STREAM_TIMEOUT_MS = 90000;

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

async function handleMessage(message, sender) {
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
    case "AI_ANALYZE_STREAM": {
      return await analyzeWithAiStream(message, sender);
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
  const derivedPreferredSkills = derivePreferredSkills(profile);
  const derivedProjectTypes = derivePreferredProjectTypes(profile);
  const next = UWE.normalizeSettings({
    ...current,
    profileSummary: summary,
    profileUrl: profile.profileUrl,
    profileUpdatedAt: profile.updatedAt,
    profileSnapshot: profile,
    preferredSkills: derivedPreferredSkills.length
      ? derivedPreferredSkills
      : current.preferredSkills,
    preferredProjectTypes: derivedProjectTypes.length
      ? derivedProjectTypes
      : current.preferredProjectTypes
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

  try {
    return await requestAiAnalysis(settings, buildPrompt(job, score, settings));
  } catch (firstError) {
    try {
      return await requestAiAnalysis(
        settings,
        buildPrompt(job, score, settings, { compact: true })
      );
    } catch (secondError) {
      return {
        ok: false,
        error: `AI request failed: ${messageFromError(secondError || firstError)}`
      };
    }
  }
}

async function analyzeWithAiStream(message, sender) {
  const settings = await loadSettings();
  const requestId = String((message && message.requestId) || "");
  if (!isAiConfigured(settings)) {
    const error = "AI is not configured";
    await sendAiStreamEvent(sender, requestId, { error, done: true });
    return { ok: false, error };
  }

  try {
    return await requestAiAnalysisStream(
      settings,
      buildPrompt(message.job, message.score, settings),
      sender,
      requestId
    );
  } catch (firstError) {
    try {
      return await requestAiAnalysisStream(
        settings,
        buildPrompt(message.job, message.score, settings, { compact: true }),
        sender,
        requestId
      );
    } catch (secondError) {
      const error = `AI request failed: ${messageFromError(secondError || firstError)}`;
      await sendAiStreamEvent(sender, requestId, { error, done: true });
      return { ok: false, error };
    }
  }
}

async function requestAiAnalysis(settings, prompt) {
  const endpoint = `${settings.api.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);

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
        temperature: 0.3,
        max_tokens: AI_MAX_TOKENS,
        stream: false,
        messages: [
          {
            role: "system",
            content:
              "You are a concise Upwork opportunity analyst. Focus on fit, risks, and proposal angle. Do not suggest off-platform behavior. Return Markdown."
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
      throw new Error(`${response.status} ${text.slice(0, 160)}`);
    }

    const payload = await response.json();
    const text =
      payload &&
      payload.choices &&
      payload.choices[0] &&
      payload.choices[0].message &&
      payload.choices[0].message.content;

    return { ok: true, text: String(text || "").trim() };
  } finally {
    clearTimeout(timeout);
  }
}

async function requestAiAnalysisStream(settings, prompt, sender, requestId) {
  const endpoint = `${settings.api.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AI_STREAM_TIMEOUT_MS);

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
        temperature: 0.3,
        max_tokens: AI_MAX_TOKENS,
        stream: true,
        messages: [
          {
            role: "system",
            content:
              "You are a concise Upwork opportunity analyst. Focus on fit, risks, and proposal angle. Do not suggest off-platform behavior. Return Markdown."
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
      throw new Error(`${response.status} ${text.slice(0, 160)}`);
    }

    if (!response.body || !response.body.getReader) {
      const payload = await response.json();
      const text = extractAiText(payload);
      await sendAiStreamEvent(sender, requestId, { text, done: true });
      return { ok: true, text };
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let text = "";

    const consumeRecord = async (record) => {
      const deltas = parseSseRecord(record);
      for (const delta of deltas) {
        text += delta;
        await sendAiStreamEvent(sender, requestId, { delta });
      }
    };

    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const records = buffer.split(/(?:\r?\n){2}/);
      buffer = records.pop() || "";
      for (const record of records) {
        await consumeRecord(record);
      }
    }

    buffer += decoder.decode();
    if (buffer.trim()) {
      await consumeRecord(buffer);
    }

    text = text.trim();
    await sendAiStreamEvent(sender, requestId, { text, done: true });
    return { ok: true, text };
  } finally {
    clearTimeout(timeout);
  }
}

function extractAiText(payload) {
  const text =
    payload &&
    payload.choices &&
    payload.choices[0] &&
    payload.choices[0].message &&
    payload.choices[0].message.content;
  return String(text || "").trim();
}

function parseSseRecord(record) {
  const lines = String(record || "").split(/\r?\n/);
  const dataLines = [];
  const jsonLines = [];

  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    if (/^data:/i.test(line)) {
      dataLines.push(line.replace(/^data:\s*/i, ""));
      return;
    }
    if (trimmed[0] === "{") {
      jsonLines.push(trimmed);
    }
  });

  const deltas = deltasFromDataLines(dataLines);
  if (deltas.length) return deltas;

  jsonLines.forEach((line) => {
    const payload = parseJson(line);
    const delta = deltaFromPayload(payload);
    if (delta) deltas.push(delta);
  });
  return deltas;
}

function deltasFromDataLines(dataLines) {
  const deltas = [];
  if (!dataLines.length) return deltas;

  const joined = dataLines.join("\n").trim();
  if (!joined || joined === "[DONE]") return deltas;

  const joinedPayload = parseJson(joined);
  const joinedDelta = deltaFromPayload(joinedPayload);
  if (joinedDelta) {
    deltas.push(joinedDelta);
    return deltas;
  }

  dataLines.forEach((line) => {
    const data = String(line || "").trim();
    if (!data || data === "[DONE]") return;
    const payload = parseJson(data);
    const delta = deltaFromPayload(payload);
    if (delta) deltas.push(delta);
  });
  return deltas;
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch (_) {
    return null;
  }
}

function deltaFromPayload(payload) {
  const choice = payload && payload.choices && payload.choices[0];
  return (
    (choice &&
      choice.delta &&
      typeof choice.delta.content === "string" &&
      choice.delta.content) ||
    (choice &&
      choice.delta &&
      typeof choice.delta.text === "string" &&
      choice.delta.text) ||
    (choice &&
      choice.message &&
      typeof choice.message.content === "string" &&
      choice.message.content) ||
    (choice && typeof choice.text === "string" && choice.text) ||
    (payload && typeof payload.delta === "string" && payload.delta) ||
    (payload && typeof payload.output_text === "string" && payload.output_text) ||
    ""
  );
}

async function sendAiStreamEvent(sender, requestId, event) {
  if (
    !requestId ||
    !sender ||
    !sender.tab ||
    !sender.tab.id ||
    !chrome.tabs ||
    !chrome.tabs.sendMessage
  ) {
    return;
  }

  try {
    const options =
      typeof sender.frameId === "number" ? { frameId: sender.frameId } : undefined;
    await chrome.tabs.sendMessage(
      sender.tab.id,
      {
        type: "AI_ANALYZE_STREAM_EVENT",
        requestId,
        ...event
      },
      options
    );
  } catch (_) {
    // The content script may have navigated while the request was streaming.
  }
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

function messageFromError(error) {
  if (!error) return "Unknown error";
  if (error.name === "AbortError") return "request timed out";
  return error.message || String(error);
}

function buildPrompt(job, score, settings, options = {}) {
  const descriptionLimit = options.compact ? 1800 : 3600;
  const safeJob = {
    title: job && job.title,
    description: job && String(job.description || "").slice(0, descriptionLimit),
    skills: job && Array.isArray(job.skills) ? job.skills.slice(0, 24) : [],
    budgetType: job && job.budgetType,
    hourlyMin: job && job.hourlyMin,
    hourlyMax: job && job.hourlyMax,
    fixedBudget: job && job.fixedBudget,
    experienceLevel: job && job.experienceLevel,
    proposalCount: job && job.proposalCount,
    clientPaymentVerified: job && job.clientPaymentVerified,
    clientRating: job && job.clientRating,
    clientSpend: job && job.clientSpend,
    clientHireRate: job && job.clientHireRate,
    clientAverageHourlyRate: job && job.clientAverageHourlyRate
  };
  const safeScore = {
    overallScore: score && score.overallScore,
    recommendedAction: score && score.recommendedAction,
    matchScore: score && score.matchScore,
    clientQualityScore: score && score.clientQualityScore,
    competitionScore: score && score.competitionScore,
    riskScore: score && score.riskScore,
    riskLevel: score && score.riskLevel,
    positiveReasons: score && score.positiveReasons,
    negativeReasons: score && score.negativeReasons,
    riskNotes: score && score.riskNotes,
    missingSignals: score && score.missingSignals
  };

  return [
    "Analyze this Upwork job for a freelancer.",
    "",
    `Freelancer profile: ${settings.profileSummary || "Not configured."}`,
    `Preferred skills: ${settings.preferredSkills.join(", ")}`,
    `Avoided skills/categories: ${settings.avoidedSkills.join(", ")}`,
    "",
    `Local scoring result: ${JSON.stringify(safeScore, null, 2)}`,
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

function derivePreferredSkills(profile) {
  const sourceText = profilePreferenceText(profile);
  const portfolioSkills = (profile.portfolio || []).flatMap((item) =>
    Array.isArray(item.skills) ? item.skills : []
  );
  const skillRules = [
    ["JavaScript", ["javascript"]],
    ["TypeScript", ["typescript"]],
    ["React", ["react", "react.js", "reactjs"]],
    ["Next.js", ["next.js", "nextjs"]],
    ["Node.js", ["node.js", "nodejs"]],
    ["Python", ["python"]],
    ["Django", ["django"]],
    ["FastAPI", ["fastapi"]],
    ["Flask", ["flask"]],
    ["OpenAI API", ["openai", "gpt", "chatgpt"]],
    ["LLM", ["llm", "large language model", "openai", "gpt"]],
    ["RAG", ["rag", "retrieval augmented generation"]],
    ["Chatbot Development", ["chatbot", "chat bot", "customer support bot"]],
    ["AI Integration", ["ai integration", "ai-powered", "artificial intelligence"]],
    ["Automation", ["automation", "workflow automation", "rpa"]],
    ["Web Scraping", ["web scraping", "scraping", "crawler", "crawling"]],
    ["Playwright", ["playwright"]],
    ["Puppeteer", ["puppeteer"]],
    ["Browser Extension", ["browser extension", "chrome extension"]],
    ["API Integration", ["api integration", "rest api", "graphql"]],
    ["PostgreSQL", ["postgresql", "postgres"]],
    ["MySQL", ["mysql"]],
    ["Supabase", ["supabase"]],
    ["MongoDB", ["mongodb"]],
    [
      "Vector Database",
      ["vector database", "embedding", "embeddings", "pinecone", "qdrant", "weaviate"]
    ],
    ["Tailwind CSS", ["tailwind", "tailwind css"]],
    ["Docker", ["docker"]],
    ["Vercel", ["vercel"]]
  ];
  return uniqueList([
    ...(profile.skills || []),
    ...portfolioSkills,
    ...matchesFromRules(sourceText, skillRules)
  ]).slice(0, 40);
}

function derivePreferredProjectTypes(profile) {
  const sourceText = profilePreferenceText(profile);
  const projectTypeRules = [
    [
      "ai integration",
      ["ai integration", "ai-powered", "openai", "llm", "rag", "artificial intelligence"]
    ],
    [
      "chatbot",
      ["chatbot", "chat bot", "customer support bot", "support automation"]
    ],
    ["automation", ["automation", "workflow automation", "rpa", "scheduled job"]],
    ["browser extension", ["browser extension", "chrome extension", "extension"]],
    ["web app", ["web app", "web application", "saas", "dashboard", "admin panel"]],
    [
      "api integration",
      ["api integration", "openai api", "rest api", "graphql", "webhook"]
    ],
    [
      "data pipeline",
      ["data pipeline", "etl", "scraping", "crawler", "large datasets"]
    ],
    ["backend system", ["backend", "database", "queue", "worker"]],
    ["frontend app", ["frontend", "react", "next.js", "tailwind"]]
  ];
  return matchesFromRules(sourceText, projectTypeRules).slice(0, 20);
}

function profilePreferenceText(profile) {
  const portfolioText = (profile.portfolio || [])
    .map((item) =>
      [
        item.title,
        item.description,
        Array.isArray(item.skills) ? item.skills.join(" ") : ""
      ].join(" ")
    )
    .join(" ");
  return normalizePreferenceText(
    [
      profile.title,
      profile.overview,
      Array.isArray(profile.skills) ? profile.skills.join(" ") : "",
      portfolioText
    ].join(" ")
  );
}

function matchesFromRules(sourceText, rules) {
  return rules
    .filter(([, signals]) =>
      signals.some((signal) => hasPreferenceSignal(sourceText, signal))
    )
    .map(([label]) => label);
}

function hasPreferenceSignal(sourceText, signal) {
  const normalizedSignal = normalizePreferenceText(signal);
  if (!normalizedSignal) return false;
  return sourceText.includes(normalizedSignal);
}

function normalizePreferenceText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9+#.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
