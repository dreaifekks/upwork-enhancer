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

function createServiceWorker({ initialStore = {}, fetchImpl } = {}) {
  const store = { ...initialStore };
  const backgroundDir = resolve("src/background");
  let messageListener = null;

  const context = {
    AbortController,
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
        async sendMessage() {
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
    send(message) {
      return new Promise((resolveResponse) => {
        messageListener(message, {}, resolveResponse);
      });
    }
  };
}
