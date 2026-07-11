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

test("question answer templates are saved, deduped, and deleted locally", async () => {
  const worker = createServiceWorker();

  const first = await worker.send({
    type: "SAVE_QUESTION_TEMPLATE",
    template: {
      question: "What frameworks have you worked with?",
      answer: "I usually work with React, Next.js, FastAPI, and Node.js."
    }
  });

  assert.equal(first.ok, true);
  assert.equal(first.templates.length, 1);
  assert.equal(first.template.question, "What frameworks have you worked with?");
  assert.equal(worker.store.uwe_question_templates_v1.length, 1);

  const second = await worker.send({
    type: "SAVE_QUESTION_TEMPLATE",
    template: {
      question: "Which frameworks have you worked with",
      answer: "React, Next.js, FastAPI, Node.js, and PostgreSQL are my usual stack."
    }
  });

  assert.equal(second.ok, true);
  assert.equal(second.templates.length, 1);
  assert.equal(second.templates[0].id, first.template.id);
  assert.match(second.templates[0].answer, /PostgreSQL/);

  const listed = await worker.send({ type: "GET_QUESTION_TEMPLATES" });
  assert.equal(listed.ok, true);
  assert.equal(listed.templates.length, 1);

  const deleted = await worker.send({
    type: "DELETE_QUESTION_TEMPLATE",
    templateId: first.template.id
  });
  assert.equal(deleted.ok, true);
  assert.deepEqual(Array.from(deleted.templates), []);
  assert.deepEqual(Array.from(worker.store.uwe_question_templates_v1), []);
});

test("IMPORT_PROFILE_FROM_ACTIVE_TAB merges profile signals with manual preferences", async () => {
  const worker = createServiceWorker({
    initialStore: {
      uwe_settings_v1: {
        preferredSkills: ["chrome extension", "browser extension"],
        preferredProjectTypes: ["browser extension"],
        api: {
          enabled: true,
          baseUrl: "https://api.example.com/v1",
          model: "demo-model",
          [API_KEY_FIELD]: TEST_API_KEY
        }
      }
    },
    tabQueryImpl: async () => [{ id: 7 }],
    tabSendMessageImpl: async () => ({
      ok: true,
      profile: {
        title: "AI Customer Support Chatbot Developer",
        overview:
          "I build Next.js, Python, and OpenAI RAG systems with admin dashboards.",
        skills: ["Python", "Next.js"],
        portfolio: [
          {
            title: "AI customer support chatbot",
            description:
              "RAG chatbot with vector database retrieval, OpenAI API, FastAPI, and React admin dashboard.",
            skills: ["React", "FastAPI"]
          }
        ],
        profileUrl: "https://www.upwork.com/freelancers/~011",
        updatedAt: "2026-07-02T00:00:00.000Z"
      }
    })
  });

  const response = await worker.send({ type: "IMPORT_PROFILE_FROM_ACTIVE_TAB" });

  assert.equal(response.ok, true);
  assert.deepEqual(Array.from(worker.store.uwe_settings_v1.preferredSkills.slice(0, 6)), [
    "chrome extension",
    "browser extension",
    "Python",
    "Next.js",
    "React",
    "FastAPI"
  ]);
  assert.ok(worker.store.uwe_settings_v1.preferredSkills.includes("RAG"));
  assert.equal(
    worker.store.uwe_settings_v1.preferredSkills.includes("chrome extension"),
    true
  );
  assert.deepEqual(
    Array.from(worker.store.uwe_settings_v1.preferredProjectTypes.slice(0, 5)),
    ["browser extension", "ai integration", "chatbot", "web app", "api integration"]
  );
  assert.equal(response.settings.api.configured, true);
  assert.equal(response.settings.api.apiKey, "");
});

test("IMPORT_PROFILE_FROM_ACTIVE_TAB keeps current preferences when profile has no signals", async () => {
  const worker = createServiceWorker({
    initialStore: {
      uwe_settings_v1: {
        preferredSkills: ["Manual Skill"],
        preferredProjectTypes: ["manual project"]
      }
    },
    tabQueryImpl: async () => [{ id: 7 }],
    tabSendMessageImpl: async () => ({
      ok: true,
      profile: {
        title: "",
        overview: "",
        skills: [],
        portfolio: [],
        profileUrl: "https://www.upwork.com/freelancers/~011",
        updatedAt: "2026-07-02T00:00:00.000Z"
      }
    })
  });

  const response = await worker.send({ type: "IMPORT_PROFILE_FROM_ACTIVE_TAB" });

  assert.equal(response.ok, true);
  assert.deepEqual(Array.from(worker.store.uwe_settings_v1.preferredSkills), [
    "Manual Skill"
  ]);
  assert.deepEqual(
    Array.from(worker.store.uwe_settings_v1.preferredProjectTypes),
    ["manual project"]
  );
});

test("IMPORT_PROFILE_FROM_ACTIVE_TAB prefers an open freelancer profile tab", async () => {
  const queried = [];
  const messagedTabs = [];
  const worker = createServiceWorker({
    initialStore: {
      uwe_settings_v1: {
        preferredSkills: ["Manual Skill"],
        preferredProjectTypes: ["manual project"]
      }
    },
    tabQueryImpl: async (query) => {
      queried.push(query);
      if (query && query.url) {
        return [
          {
            id: 11,
            url: "https://www.upwork.com/freelancers/~011?viewMode=1"
          }
        ];
      }
      return [{ id: 7, url: "https://www.upwork.com/nx/search/jobs/" }];
    },
    tabSendMessageImpl: async (tabId, message) => {
      if (message && message.type === "REQUEST_PROFILE_SNAPSHOT") {
        messagedTabs.push(tabId);
      }
      return {
        ok: true,
        profile: {
          title: "AI automation developer",
          overview: "I build React and Node.js automations.",
          skills: ["React", "Node.js"],
          portfolio: [],
          profileUrl: "https://www.upwork.com/freelancers/~011?viewMode=1",
          updatedAt: "2026-07-03T00:00:00.000Z"
        }
      };
    }
  });

  const response = await worker.send({ type: "IMPORT_PROFILE_FROM_ACTIVE_TAB" });

  assert.equal(response.ok, true);
  assert.deepEqual(messagedTabs, [11]);
  assert.equal(queried[0].currentWindow, true);
  assert.ok(queried[0].url);
  assert.ok(
    queried[0].url.includes("https://www.upwork.com/freelancers/settings/profile*")
  );
  assert.deepEqual(Array.from(worker.store.uwe_settings_v1.preferredSkills), [
    "Manual Skill",
    "React",
    "Node.js",
    "Automation"
  ]);
});

test("content senders cannot invoke settings mutation messages", async () => {
  const worker = createServiceWorker();
  const response = await worker.send(
    { type: "SAVE_SETTINGS", settings: {} },
    { tab: { id: 7, url: "https://www.upwork.com/nx/find-work/" } }
  );

  assert.equal(response.ok, false);
  assert.match(response.error, /not available to page content/i);
});

test("messages from a different extension id are rejected", async () => {
  const worker = createServiceWorker();
  const response = await worker.send(
    { type: "GET_PUBLIC_SETTINGS" },
    { id: "another-extension" }
  );

  assert.equal(response.ok, false);
  assert.match(response.error, /unauthorized extension sender/i);
});

test("service worker restricts local storage to trusted extension contexts", () => {
  const worker = createServiceWorker();
  assert.deepEqual(worker.storageAccessLevels, ["TRUSTED_CONTEXTS"]);
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
        language: "zh",
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
      skills: ["React", "Node.js", "PostgreSQL"],
      proposalQuestions: [
        "Describe your approach to testing and improving QA",
        "What frameworks have you worked with?"
      ],
      proposalQuestionAnswerTemplates: [
        {
          question: "What frameworks have you worked with?",
          matchedQuestion: "Which frameworks have you worked with?",
          answerTemplate: "React, Next.js, Node.js, FastAPI, and PostgreSQL.",
          similarity: 0.82
        }
      ]
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
  assert.match(fetchCalls[0].messages[1].content, /需求总结/);
  assert.match(fetchCalls[0].messages[1].content, /write in Simplified Chinese/);
  assert.match(fetchCalls[0].messages[1].content, /Proposal angle - write in English/);
  assert.match(fetchCalls[0].messages[1].content, /opener - write in English/);
  assert.match(fetchCalls[0].messages[1].content, /Screening question answer drafts/);
  assert.match(fetchCalls[0].messages[1].content, /Draft answer/);
  assert.match(fetchCalls[0].messages[1].content, /What frameworks have you worked with/);
  assert.match(fetchCalls[0].messages[1].content, /proposalQuestionAnswerTemplates/);
  assert.ok(
    fetchCalls[1].messages[1].content.length < fetchCalls[0].messages[1].content.length
  );
});

test("AI_GENERATE_QUESTION_ANSWER drafts one screening answer with template context", async () => {
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
        profileSummary: "Full-stack React and Python developer",
        preferredSkills: ["React", "Python", "QA"]
      }
    },
    fetchImpl: async (_url, options) => {
      fetchCalls.push(JSON.parse(options.body));
      return {
        ok: true,
        async json() {
          return {
            choices: [
              {
                message: {
                  content:
                    "I start with the highest-risk workflows, add focused automated coverage, and pair that with manual regression checks before release."
                }
              }
            ]
          };
        }
      };
    }
  });

  const response = await worker.send({
    type: "AI_GENERATE_QUESTION_ANSWER",
    question: "Describe your approach to testing and improving QA",
    template: {
      matchedQuestion: "Describe your QA process",
      answerTemplate: "I combine automated tests with practical manual QA."
    },
    job: {
      title: "React web app improvements",
      description: "Improve UI quality and performance.",
      skills: ["React", "Python"]
    }
  });

  assert.equal(response.ok, true);
  assert.match(response.text, /highest-risk workflows/);
  assert.equal(fetchCalls.length, 1);
  assert.match(fetchCalls[0].messages[1].content, /Question: Describe your approach/);
  assert.match(fetchCalls[0].messages[1].content, /Reusable answer template/);
  assert.match(fetchCalls[0].messages[1].content, /Write only the answer text/);
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
        'data: {"choices":[{"delta":\n',
        'data: {"content":"Good match."}}]}\n\n',
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
    {
      tab: { id: 42, url: "https://www.upwork.com/jobs/~01" },
      url: "https://www.upwork.com/jobs/~01",
      frameId: 7
    }
  );

  assert.equal(response.ok, true);
  assert.equal(response.text, "## Fit\nGood match.");
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].stream, true);
  assert.equal(fetchCalls[0].model, "demo-model");
  assert.equal(fetchCalls[0].max_tokens, 2200);
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

test("AI_ANALYZE_STREAM does not append a retry after partial output", async () => {
  let fetchCount = 0;
  const streamMessages = [];
  const encoder = new TextEncoder();
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
    fetchImpl: async () => {
      fetchCount += 1;
      let reads = 0;
      return {
        ok: true,
        body: {
          getReader() {
            return {
              async read() {
                reads += 1;
                if (reads === 1) {
                  return {
                    done: false,
                    value: encoder.encode(
                      'data: {"choices":[{"delta":{"content":"Partial"}}]}\n\n'
                    )
                  };
                }
                throw new Error("stream disconnected");
              }
            };
          }
        }
      };
    },
    tabSendMessageImpl: async (_tabId, message) => {
      streamMessages.push(message);
      return null;
    }
  });

  const response = await worker.send(
    {
      type: "AI_ANALYZE_STREAM",
      requestId: "request-partial",
      job: { title: "Test" },
      score: { overallScore: 80 }
    },
    {
      tab: { id: 42, url: "https://www.upwork.com/jobs/~01" },
      url: "https://www.upwork.com/jobs/~01"
    }
  );

  assert.equal(response.ok, false);
  assert.equal(fetchCount, 1);
  assert.equal(streamMessages[0].delta, "Partial");
  assert.match(streamMessages.at(-1).error, /after partial output/i);
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
  tabQueryImpl,
  tabSendMessageImpl
} = {}) {
  const store = { ...initialStore };
  const storageAccessLevels = [];
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
        id: "upwork-enhancer-test",
        onMessage: {
          addListener(listener) {
            messageListener = listener;
          }
        },
        openOptionsPage() {}
      },
      storage: {
        local: {
          setAccessLevel({ accessLevel }) {
            storageAccessLevels.push(accessLevel);
            return Promise.resolve();
          },
          async get(key) {
            return { [key]: store[key] };
          },
          async set(next) {
            Object.assign(store, next);
          }
        }
      },
      tabs: {
        async query(query) {
          if (tabQueryImpl) {
            return tabQueryImpl(query);
          }
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
    storageAccessLevels,
    send(message, sender = {}) {
      return new Promise((resolveResponse) => {
        messageListener(message, sender, resolveResponse);
      });
    }
  };
}
