const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const vm = require("node:vm");

const API_KEY_FIELD = "api" + "Key";
const AUTH_SCHEME = "Bear" + "er";
const TEST_API_KEY = ["test", "api", "key"].join("-");

test("PATCH_SETTINGS preserves the stored API key while returning public settings", async () => {
  const worker = createServiceWorker({
    initialStore: {
      uwe_settings_v1: {
        api: {
          enabled: true,
          baseUrl: "https://api.example.com/v1",
          model: "demo-model",
          [API_KEY_FIELD]: TEST_API_KEY
        },
        preferredSkills: ["Old Skill"]
      }
    }
  });

  const response = await worker.send({
    type: "PATCH_SETTINGS",
    patch: {
      preferredSkills: "React\nNode.js",
      minimumHourlyRate: "45"
    }
  });

  assert.equal(response.ok, true);
  assert.equal(response.settings.api.configured, true);
  assert.equal(response.settings.api.apiKey, "");
  assert.equal(worker.store.uwe_settings_v1.api[API_KEY_FIELD], TEST_API_KEY);
  assert.deepEqual(Array.from(worker.store.uwe_settings_v1.preferredSkills), [
    "React",
    "Node.js"
  ]);
  assert.equal(worker.store.uwe_settings_v1.minimumHourlyRate, 45);
});

test("TEST_AI_CONFIG sends the stored API key only from the service worker", async () => {
  const fetchCalls = [];
  const worker = createServiceWorker({
    initialStore: {
      uwe_settings_v1: {
        api: {
          enabled: true,
          baseUrl: "https://api.example.com/v1/",
          model: "demo-model",
          [API_KEY_FIELD]: TEST_API_KEY
        }
      }
    },
    fetchImpl: async (url, options) => {
      fetchCalls.push({
        url,
        authorization: options.headers.authorization,
        body: JSON.parse(options.body)
      });
      return {
        ok: true,
        async json() {
          return {
            choices: [{ message: { content: "OK" } }]
          };
        }
      };
    }
  });

  const response = await worker.send({ type: "TEST_AI_CONFIG" });

  assert.equal(response.ok, true);
  assert.equal(response.text, "OK");
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].url, "https://api.example.com/v1/chat/completions");
  assert.equal(fetchCalls[0].authorization, `${AUTH_SCHEME} ${TEST_API_KEY}`);
  assert.equal(fetchCalls[0].body.model, "demo-model");
  assert.match(
    fetchCalls[0].body.messages[1].content,
    /Upwork Enhancer connection test/
  );
});

test("AI_ANALYZE retries with a compact prompt after a network failure", async () => {
  const fetchCalls = [];
  const worker = createServiceWorker({
    initialStore: {
      uwe_settings_v1: {
        api: {
          enabled: true,
          baseUrl: "https://api.example.com/v1/",
          model: "demo-model",
          [API_KEY_FIELD]: TEST_API_KEY
        },
        profileSummary: "Full-stack React and Node developer",
        preferredSkills: ["React", "Node.js"]
      }
    },
    fetchImpl: async (_url, options) => {
      fetchCalls.push(JSON.parse(options.body));
      if (fetchCalls.length === 1) {
        throw new TypeError("Failed to fetch");
      }
      return {
        ok: true,
        async json() {
          return {
            choices: [{ message: { content: "## Fit\nGood match." } }]
          };
        }
      };
    }
  });

  const response = await worker.send({
    type: "AI_ANALYZE",
    job: {
      title: "Build a React dashboard",
      description: "A".repeat(5000),
      skills: ["React", "Node.js", "PostgreSQL"]
    },
    score: {
      overallScore: 82,
      recommendedAction: "apply",
      positiveReasons: ["Matches preferred skills"]
    }
  });

  assert.equal(response.ok, true);
  assert.equal(response.text, "## Fit\nGood match.");
  assert.equal(fetchCalls.length, 2);
  assert.equal(fetchCalls[0].model, "demo-model");
  assert.equal(fetchCalls[0].messages[0].content.includes("Return Markdown"), true);
  assert.ok(
    fetchCalls[1].messages[1].content.length < fetchCalls[0].messages[1].content.length
  );
});

test("AI_ANALYZE_STREAM streams markdown chunks back to the sender tab", async () => {
  const fetchCalls = [];
  const streamMessages = [];
  const worker = createServiceWorker({
    initialStore: {
      uwe_settings_v1: {
        api: {
          enabled: true,
          baseUrl: "https://api.example.com/v1/",
          model: "demo-model",
          [API_KEY_FIELD]: TEST_API_KEY
        },
        profileSummary: "Full-stack React and Node developer",
        preferredSkills: ["React", "Node.js"]
      }
    },
    fetchImpl: async (_url, options) => {
      fetchCalls.push(JSON.parse(options.body));
      return streamResponse([
        'data: {"choices":[{"delta":{"content":"## Fit\\n"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"Good match."}}]}\n\n',
        "data: [DONE]\n\n"
      ]);
    },
    tabSendMessageImpl: async (tabId, message, options) => {
      streamMessages.push({ tabId, message, options });
      return null;
    }
  });

  const response = await worker.send(
    {
      type: "AI_ANALYZE_STREAM",
      requestId: "request-1",
      job: {
        title: "Build a React dashboard",
        description: "Need streaming UI",
        skills: ["React", "Node.js"]
      },
      score: {
        overallScore: 82,
        recommendedAction: "apply",
        positiveReasons: ["Matches preferred skills"]
      }
    },
    { tab: { id: 42 }, frameId: 7 }
  );

  assert.equal(response.ok, true);
  assert.equal(response.text, "## Fit\nGood match.");
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].stream, true);
  assert.equal(fetchCalls[0].model, "demo-model");
  assert.deepEqual(
    JSON.parse(JSON.stringify(streamMessages.map((item) => item.message))),
    [
      {
        type: "AI_ANALYZE_STREAM_EVENT",
        requestId: "request-1",
        delta: "## Fit\n"
      },
      {
        type: "AI_ANALYZE_STREAM_EVENT",
        requestId: "request-1",
        delta: "Good match."
      },
      {
        type: "AI_ANALYZE_STREAM_EVENT",
        requestId: "request-1",
        text: "## Fit\nGood match.",
        done: true
      }
    ]
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(streamMessages.map((item) => [item.tabId, item.options]))),
    [
      [42, { frameId: 7 }],
      [42, { frameId: 7 }],
      [42, { frameId: 7 }]
    ]
  );
});

function streamResponse(chunks) {
  const encoder = new TextEncoder();
  return {
    ok: true,
    body: {
      getReader() {
        let index = 0;
        return {
          async read() {
            if (index >= chunks.length) {
              return { done: true };
            }
            const value = encoder.encode(chunks[index]);
            index += 1;
            return { done: false, value };
          }
        };
      }
    },
    async json() {
      return { choices: [{ message: { content: chunks.join("") } }] };
    }
  };
}

function createServiceWorker({
  initialStore = {},
  fetchImpl,
  tabSendMessageImpl
} = {}) {
  const store = { ...initialStore };
  const backgroundDir = resolve("src/background");
  let messageListener = null;

  const context = {
    AbortController,
    TextDecoder,
    URL,
    clearTimeout,
    console,
    fetch: fetchImpl || (async () => ({ ok: false, async text() { return ""; } })),
    setTimeout,
    chrome: {
      action: {
        onClicked: {
          addListener() {}
        }
      },
      runtime: {
        onMessage: {
          addListener(listener) {
            messageListener = listener;
          }
        },
        openOptionsPage() {}
      },
      storage: {
        local: {
          async get(key) {
            return { [key]: store[key] };
          },
          async set(next) {
            Object.assign(store, next);
          }
        }
      },
      tabs: {
        async query() {
          return [];
        },
        async sendMessage(tabId, message, options) {
          if (tabSendMessageImpl) {
            return tabSendMessageImpl(tabId, message, options);
          }
          return null;
        }
      }
    }
  };
  context.self = context;
  context.globalThis = context;
  context.importScripts = (...paths) => {
    for (const path of paths) {
      const absolute = resolve(backgroundDir, path);
      vm.runInContext(readFileSync(absolute, "utf8"), vmContext, {
        filename: absolute
      });
    }
  };

  const vmContext = vm.createContext(context);
  const serviceWorkerPath = resolve(backgroundDir, "serviceWorker.js");
  vm.runInContext(readFileSync(serviceWorkerPath, "utf8"), vmContext, {
    filename: serviceWorkerPath
  });

  assert.ok(messageListener, "service worker registered a message listener");

  return {
    store,
    send(message, sender = {}) {
      return new Promise((resolveResponse) => {
        messageListener(message, sender, resolveResponse);
      });
    }
  };
}
