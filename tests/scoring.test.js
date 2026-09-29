const test = require("node:test");
const assert = require("node:assert/strict");

require("../src/shared/defaultSettings.js");
require("../src/shared/i18n.js");
require("../src/content/upworkParser.js");
const { scoreJob } = require("../src/scoring/scoreJob.js");

const UWE = globalThis.UpworkEnhancer;

test("scores a strong matching job as apply", () => {
  const settings = UWE.normalizeSettings({
    ...UWE.DEFAULT_SETTINGS,
    minimumHourlyRate: 30,
    preferredSkills: ["chrome extension", "typescript", "automation"],
    preferredProjectTypes: ["browser extension"]
  });
  const result = scoreJob(
    {
      title: "Build a Chrome extension for workflow automation",
      description:
        "Need a TypeScript browser extension with API integration. Payment verified. Proposals: Less than 5. Posted 2 hours ago.",
      skills: ["Chrome Extension", "TypeScript", "Automation"],
      hourlyMin: 45,
      hourlyMax: 70,
      proposalCount: 4,
      postedAgeHours: 2,
      clientPaymentVerified: true,
      clientRating: 4.95,
      clientSpend: 25000,
      clientHireRate: 80
    },
    settings
  );

  assert.equal(result.recommendedAction, "apply");
  assert.ok(result.overallScore >= 78);
  assert.equal(result.riskLevel, "low");
  assert.equal(result.actionGateReason.key, "actionGate.applyReady");
});

test("matches preferred skills by token boundaries instead of substrings", () => {
  const settings = UWE.normalizeSettings({
    preferredSkills: ["Java", "AI", "Node.js", "C++"],
    preferredProjectTypes: [],
    avoidedSkills: [],
    blacklistedPhrases: [],
    offPlatformPhrases: []
  });
  const falsePositive = scoreJob(
    {
      title: "JavaScript maintainer for detailed email workflows",
      description: "Maintain a capital reporting dashboard.",
      skills: ["JavaScript"],
      hourlyMax: 60,
      proposalCount: 5,
      clientPaymentVerified: true,
      clientSpend: 10000
    },
    settings
  );
  const positive = scoreJob(
    {
      title: "AI service with Java, Node.js and C++",
      skills: ["AI", "Java", "Node.js", "C++"],
      hourlyMax: 60,
      proposalCount: 5,
      clientPaymentVerified: true,
      clientSpend: 10000
    },
    settings
  );

  assert.equal(
    falsePositive.positiveReasons.some(
      (item) => item.key === "reason.preferredSkillMatch"
    ),
    false
  );
  assert.deepEqual(
    positive.positiveReasons.find(
      (item) => item.key === "reason.preferredSkillMatch"
    ).params.skills,
    ["Java", "AI", "Node.js", "C++"]
  );
});

test("parses current payment verification wording", () => {
  assert.equal(UWE.parsePaymentVerification("Payment method verified"), true);
  assert.equal(UWE.parsePaymentVerification("Payment verified"), true);
  assert.equal(UWE.parsePaymentVerification("Payment method not verified"), false);
  assert.equal(UWE.parsePaymentVerification("Payment unverified"), false);
  assert.equal(UWE.parsePaymentVerification("About the client"), null);
});

test("merges missing detail signals without overwriting richer detail values", () => {
  const merged = UWE.mergeJobSignals(
    {
      jobId: "~01",
      title: "Detail title",
      description: "Full detail description",
      proposalCount: null,
      proposalCountBucket: "",
      clientPaymentVerified: true,
      skills: ["React"]
    },
    {
      title: "List title",
      description: "Short list text",
      proposalCount: 50,
      proposalCountLabel: "20 to 50",
      proposalCountBucket: "high",
      clientPaymentVerified: false,
      skills: ["JavaScript"]
    }
  );

  assert.equal(merged.title, "Detail title");
  assert.equal(merged.description, "Full detail description");
  assert.equal(merged.proposalCount, 50);
  assert.equal(merged.proposalCountBucket, "high");
  assert.equal(merged.clientPaymentVerified, true);
  assert.deepEqual(merged.skills, ["React"]);
});

test("reads a job's rate or budget from Upwork's own labels", () => {
  assert.deepEqual(
    UWE.parseBudgetSignal(
      "Hourly: $30-$35 - Expert - Est. Time: Less than 1 month, 30+ hrs/week"
    ),
    { budgetType: "hourly", hourlyMin: 30, hourlyMax: 35, fixedBudget: null }
  );
  assert.deepEqual(
    UWE.parseBudgetSignal("Expert Experience Level $30.00 - $35.00 Hourly"),
    { budgetType: "hourly", hourlyMin: 30, hourlyMax: 35, fixedBudget: null }
  );
  assert.deepEqual(
    UWE.parseBudgetSignal("Fixed-price - Expert - Est. Budget: $2,500"),
    { budgetType: "fixed", hourlyMin: null, hourlyMax: null, fixedBudget: 2500 }
  );
  assert.deepEqual(
    UWE.parseBudgetSignal("Build AI features. $2,500.00 Fixed-price Expert"),
    { budgetType: "fixed", hourlyMin: null, hourlyMax: null, fixedBudget: 2500 }
  );
  assert.deepEqual(
    UWE.parseBudgetSignal("Payment verified. $45-$75/hr. Proposals: Less than 5."),
    { budgetType: "hourly", hourlyMin: 45, hourlyMax: 75, fixedBudget: null }
  );
  assert.deepEqual(
    UWE.parseBudgetSignal(
      "Hourly - Expert - Est. Time: 3 to 6 months, 30+ hrs/week. $20K+ spent"
    ),
    { budgetType: "", hourlyMin: null, hourlyMax: null, fixedBudget: null }
  );
});

test("does not read a fixed budget into an hourly job", () => {
  [
    "Hourly: $40-$55 - Expert. We fixed the data model and want a fair price.",
    "Budget is flexible for the right person: $40-$55/hr to start.",
    "Budget: $40-$55/hr. $462K total spent.",
    "Summary Our budget is tight. 30+ hrs/week Hourly $40.00 - $55.00 Hourly"
  ].forEach((text) => {
    assert.deepEqual(
      UWE.parseBudgetSignal(text),
      { budgetType: "hourly", hourlyMin: 40, hourlyMax: 55, fixedBudget: null },
      text
    );
  });
  // Upwork's label wins over a rate the description mentions in passing.
  assert.deepEqual(
    UWE.parseBudgetSignal(
      "Fixed-price - Expert - Est. Budget: $2,500 Our last developer charged $50/hr."
    ),
    { budgetType: "fixed", hourlyMin: null, hourlyMax: null, fixedBudget: 2500 }
  );
  assert.equal(
    UWE.parseBudgetSignal("Est. Budget: $500Must have React").fixedBudget,
    500
  );
});

test("reads job terms without the client's average rate or other jobs", () => {
  const client =
    "About the client $30K total spent $17.44 /hr avg hourly rate paid 955 hours";
  const history =
    "Client\u2019s recent history (16) Logo design Fixed-price $50.00 " +
    "Data entry 16 hrs @ $12.00/hr Billed: $192.00";

  assert.deepEqual(
    UWE.parseBudgetSignal(
      `${client} Summary Build it. $30.00 - $35.00 Hourly Proposals: 5 to 10 ${history}`
    ),
    { budgetType: "hourly", hourlyMin: 30, hourlyMax: 35, fixedBudget: null }
  );
  assert.deepEqual(
    UWE.parseBudgetSignal(
      `Summary Build it. $2,500.00 Fixed-price Proposals: 5 to 10 ${history} ${client}`
    ),
    { budgetType: "fixed", hourlyMin: null, hourlyMax: null, fixedBudget: 2500 }
  );
  assert.deepEqual(
    UWE.parseBudgetSignal(
      `Summary Build it. 30+ hrs/week Hourly Proposals: 5 to 10 ${client} ${history}`
    ),
    { budgetType: "", hourlyMin: null, hourlyMax: null, fixedBudget: null }
  );
  // A history entry is its own job, so what it paid is its rate.
  assert.deepEqual(
    UWE.parseBudgetSignal(
      "To freelancer: Great work. Billed: $621.23. 16 hrs @ $35.00/hr.",
      { context: "history" }
    ),
    { budgetType: "hourly", hourlyMin: 35, hourlyMax: 35, fixedBudget: null }
  );
});

test("judges budget risk by the hourly rate when a job states one", () => {
  const job = {
    title: "Senior full stack engineer",
    description:
      "Must be expert in frontend, backend, API, database and automation work.",
    skills: ["React", "Node.js"],
    proposalCount: 4,
    clientPaymentVerified: true,
    clientSpend: 25000
  };
  const hasBudgetRisk = (result) =>
    result.riskNotes.some((note) => note.key === "reason.unrealisticBudget");

  const fairRate = scoreJob(
    { ...job, hourlyMin: 40, hourlyMax: 55, fixedBudget: 40 },
    UWE.DEFAULT_SETTINGS
  );
  assert.equal(hasBudgetRisk(fairRate), false);
  assert.equal(fairRate.riskLevel, "low");

  const lowRate = scoreJob(
    { ...job, hourlyMin: 10, hourlyMax: 15, fixedBudget: 10 },
    UWE.DEFAULT_SETTINGS
  );
  assert.equal(hasBudgetRisk(lowRate), true);
  assert.equal(lowRate.riskScore, 67);

  const lowFixed = scoreJob({ ...job, fixedBudget: 50 }, UWE.DEFAULT_SETTINGS);
  assert.equal(hasBudgetRisk(lowFixed), true);
  assert.equal(lowFixed.riskScore, 67);
});

test("flags unpaid off-platform low-budget work as pass", () => {
  const result = scoreJob(
    {
      title: "Need expert full stack AI automation ASAP",
      description:
        "Tiny fixed budget. Must do unpaid test and contact outside Upwork. Proposals: 50+.",
      fixedBudget: 50,
      proposalCount: 50,
      clientPaymentVerified: false,
      clientRating: 3.8,
      clientSpend: 100
    },
    UWE.DEFAULT_SETTINGS
  );

  assert.equal(result.recommendedAction, "pass");
  assert.equal(result.riskLevel, "high");
  assert.equal(result.actionGateReason.key, "actionGate.highRisk");
  assert.ok(result.riskNotes.length >= 2);
});

test("explains when missing signals gate an otherwise strong score", () => {
  const settings = UWE.normalizeSettings({
    ...UWE.DEFAULT_SETTINGS,
    preferredSkills: ["React", "TypeScript", "automation"],
    preferredProjectTypes: ["web app"],
    thresholds: { apply: 70, watch: 60, pass: 40 }
  });
  const result = scoreJob(
    {
      title: "React TypeScript automation web app",
      description: "Build a polished automation web app.",
      skills: ["React", "TypeScript", "Automation"],
      hourlyMax: 80,
      proposalCount: 5,
      postedAgeHours: 2,
      clientPaymentVerified: true,
      clientRating: 4.9,
      clientHireRate: 80
    },
    settings
  );

  assert.ok(result.overallScore >= settings.thresholds.apply);
  assert.equal(result.recommendedAction, "watch");
  assert.equal(result.actionGateReason.key, "actionGate.missingSignals");
  assert.ok(result.actionGateReason.params.count > 0);
});

test("does not treat Telegram or WhatsApp as off-platform risk by default", () => {
  const result = scoreJob(
    {
      title: "Build an AI automation dashboard",
      description:
        "Need React TypeScript automation with OpenAI API integration. We use Telegram or WhatsApp as a gateway for vendor access.",
      skills: ["React", "TypeScript", "Automation", "OpenAI"],
      hourlyMin: 45,
      hourlyMax: 70,
      proposalCount: 4,
      postedAgeHours: 2,
      clientPaymentVerified: true,
      clientRating: 4.95,
      clientSpend: 25000,
      clientHireRate: 80
    },
    UWE.DEFAULT_SETTINGS
  );

  assert.notEqual(result.recommendedAction, "pass");
  assert.equal(result.riskLevel, "low");
  assert.equal(
    result.riskNotes.some((note) => note.key === "reason.offPlatform"),
    false
  );
});

test("uses configured off-platform phrases for high-risk pass decisions", () => {
  const settings = UWE.normalizeSettings({
    ...UWE.DEFAULT_SETTINGS,
    offPlatformPhrases: ["telegram"]
  });
  const result = scoreJob(
    {
      title: "Build an AI automation dashboard",
      description:
        "Need React TypeScript automation with OpenAI API integration. We use Telegram or WhatsApp as a gateway for vendor access.",
      skills: ["React", "TypeScript", "Automation", "OpenAI"],
      hourlyMin: 45,
      hourlyMax: 70,
      proposalCount: 4,
      postedAgeHours: 2,
      clientPaymentVerified: true,
      clientRating: 4.95,
      clientSpend: 25000,
      clientHireRate: 80
    },
    settings
  );

  assert.equal(result.recommendedAction, "pass");
  assert.equal(result.riskLevel, "high");
  assert.ok(result.riskNotes.some((note) => note.key === "reason.offPlatform"));
});

test("treats public proposal ranges as conservative competition buckets", () => {
  assert.deepEqual(UWE.parseProposalSignal("Proposals: 20 to 50"), {
    count: 50,
    label: "20 to 50",
    bucket: "high",
    openEnded: false
  });
  assert.deepEqual(UWE.parseProposalSignal("Proposals: 50+"), {
    count: 50,
    label: "50+",
    bucket: "extreme",
    openEnded: true
  });

  const high = scoreJob(
    {
      title: "Build a React SaaS dashboard",
      description: "React SaaS work. Payment verified. Proposals: 20 to 50.",
      skills: ["React", "SaaS"],
      hourlyMin: 45,
      hourlyMax: 70,
      proposalCount: 50,
      proposalCountLabel: "20 to 50",
      proposalCountBucket: "high",
      clientPaymentVerified: true
    },
    UWE.DEFAULT_SETTINGS
  );
  const extreme = scoreJob(
    {
      title: "Build a React SaaS dashboard",
      description: "React SaaS work. Payment verified. Proposals: 50+.",
      skills: ["React", "SaaS"],
      hourlyMin: 45,
      hourlyMax: 70,
      proposalCount: 50,
      proposalCountLabel: "50+",
      proposalCountBucket: "extreme",
      proposalCountIsOpenEnded: true,
      clientPaymentVerified: true
    },
    UWE.DEFAULT_SETTINGS
  );

  assert.ok(extreme.competitionScore < high.competitionScore);
  assert.ok(
    high.negativeReasons.some((note) => note.key === "reason.highCompetitionBucket")
  );
  assert.ok(
    extreme.negativeReasons.some((note) => note.key === "reason.extremeCompetition")
  );
  assert.match(
    UWE.localizeReason(
      "zh",
      extreme.negativeReasons.find((note) => note.key === "reason.extremeCompetition")
    ),
    /真实数量可能远高于/
  );
});

test("extracts proposal screening questions from detail text", () => {
  const questions = UWE.parseProposalQuestions(
    null,
    [
      "Summary We need a full stack developer.",
      "You will be asked to answer the following questions when submitting a proposal:",
      "1. Describe your approach to testing and improving QA",
      "2. What frameworks have you worked with?",
      "Skills and Expertise JavaScript React"
    ].join(" ")
  );

  assert.deepEqual(questions, [
    "Describe your approach to testing and improving QA",
    "What frameworks have you worked with?"
  ]);
});

test("does not split helper verbs inside unnumbered proposal questions", () => {
  const questions = UWE.parseProposalQuestions(
    null,
    [
      "You will be asked to answer the following questions when submitting a proposal:",
      "Describe your approach to testing and improving QA",
      "What frameworks have you worked with?",
      "Skills and Expertise JavaScript React"
    ].join(" ")
  );

  assert.deepEqual(questions, [
    "Describe your approach to testing and improving QA",
    "What frameworks have you worked with?"
  ]);
});

test("distinguishes search list URLs from detail URLs", () => {
  assert.equal(
    UWE.extractJobIdFromUrl("https://www.upwork.com/nx/search/jobs/saved/"),
    ""
  );
  assert.equal(
    UWE.extractJobIdFromUrl("https://www.upwork.com/nx/search/jobs/"),
    ""
  );
  assert.equal(
    UWE.extractJobIdFromUrl(
      "https://www.upwork.com/nx/search/jobs/saved/details/~022072873862867873999"
    ),
    "~022072873862867873999"
  );
  assert.equal(
    UWE.isSearchListUrl("https://www.upwork.com/nx/search/jobs/saved/"),
    true
  );
  assert.equal(
    UWE.isSearchListUrl("https://www.upwork.com/nx/search/jobs/"),
    true
  );
  assert.equal(
    UWE.isSearchListUrl(
      "https://www.upwork.com/nx/search/jobs/saved/details/~022072873862867873999"
    ),
    false
  );
  assert.equal(
    UWE.isSearchListUrl("https://www.upwork.com/jobs/~022072873862867873999"),
    false
  );
  assert.equal(
    UWE.isDetailLikeUrl("https://www.upwork.com/nx/search/jobs/saved/"),
    false
  );
  assert.equal(
    UWE.isDetailLikeUrl("https://www.upwork.com/nx/search/jobs/"),
    false
  );
  assert.equal(
    UWE.isDetailLikeUrl(
      "https://www.upwork.com/nx/search/jobs/saved/?__cf_chl_f_tk=abc"
    ),
    false
  );
  assert.equal(
    UWE.isDetailLikeUrl(
      "https://www.upwork.com/nx/search/jobs/saved/details/~022072873862867873999"
    ),
    true
  );
  assert.equal(
    UWE.isDetailLikeUrl(
      "file:///tmp/mock-upwork-saved-detail.html?referrer=/nx/search/jobs/saved/details/~022072873862867873999"
    ),
    true
  );
  assert.equal(
    UWE.isDetailLikeUrl(
      "https://www.upwork.com/jobs/Looking-for-full-stack-developer_~022072873862867873999/"
    ),
    true
  );
});

test("localizes labels in English and Chinese", () => {
  assert.equal(UWE.t("en", "action.apply"), "Apply");
  assert.equal(UWE.t("zh", "action.apply"), "投递");
  assert.equal(UWE.t("en", "context.history"), "History");
  assert.equal(UWE.t("zh", "context.history"), "历史项目");
  assert.equal(
    UWE.localizeReason("zh", {
      key: "reason.preferredSkillMatch",
      params: { skills: ["TypeScript"] }
    }),
    "匹配偏好技能：TypeScript"
  );
});

test("normalizes intentionally empty list settings without restoring defaults", () => {
  const settings = UWE.normalizeSettings({
    preferredSkills: "",
    avoidedSkills: [],
    preferredProjectTypes: "",
    blacklistedPhrases: "",
    offPlatformPhrases: ""
  });

  assert.deepEqual(settings.preferredSkills, []);
  assert.deepEqual(settings.avoidedSkills, []);
  assert.deepEqual(settings.preferredProjectTypes, []);
  assert.deepEqual(settings.blacklistedPhrases, []);
  assert.deepEqual(settings.offPlatformPhrases, []);
});

test("migrates legacy off-platform defaults out of blacklisted phrases", () => {
  const settings = UWE.normalizeSettings({
    blacklistedPhrases: [
      "unpaid test",
      "free sample",
      "outside upwork",
      "telegram",
      "whatsapp",
      "commission only"
    ]
  });

  assert.deepEqual(settings.blacklistedPhrases, [
    "unpaid test",
    "free sample",
    "commission only"
  ]);
  assert.deepEqual(settings.offPlatformPhrases, ["outside upwork"]);
});

test("normalizes theme setting with auto default", () => {
  assert.equal(UWE.normalizeSettings({}).theme, "auto");
  assert.equal(UWE.normalizeSettings({ theme: "dark" }).theme, "dark");
  assert.equal(UWE.normalizeSettings({ theme: "light" }).theme, "light");
  assert.equal(UWE.normalizeSettings({ theme: "solarized" }).theme, "auto");
});

test("clamps valid thresholds and rejects contradictory ordering", () => {
  assert.deepEqual(UWE.normalizeSettings({ thresholds: {
    apply: 120,
    watch: 70,
    pass: -5
  } }).thresholds, { apply: 100, watch: 70, pass: 0 });
  assert.deepEqual(UWE.normalizeSettings({ thresholds: {
    apply: 60,
    watch: 80,
    pass: 40
  } }).thresholds, UWE.DEFAULT_SETTINGS.thresholds);
});

test("normalizes imported profile snapshots and builds profile summary", () => {
  const settings = UWE.normalizeSettings({
    profileUrl: "/freelancers/~011",
    profileSnapshot: {
      title: "Node.js/React Full-Stack Developer",
      hourlyRate: "$30.00/hr",
      overview: "I build and maintain full-stack applications.",
      skills: "React, Node.js\nOpenAI API",
      portfolio: [
        {
          title: "AI support chatbot",
          description: "RAG assistant with document upload workflow",
          skills: "Python, FastAPI"
        }
      ],
      languages: ["English: Conversational", "Chinese: Native"]
    }
  });

  assert.equal(settings.profileUrl, "https://www.upwork.com/freelancers/~011");
  assert.equal(
    UWE.normalizeProfileUrl("upwork.com/freelancers/~022?viewMode=1"),
    "https://upwork.com/freelancers/~022?viewMode=1"
  );
  assert.deepEqual(settings.profileSnapshot.skills, [
    "React",
    "Node.js",
    "OpenAI API"
  ]);
  assert.deepEqual(settings.profileSnapshot.portfolio[0], {
    title: "AI support chatbot",
    description: "RAG assistant with document upload workflow",
    skills: ["Python", "FastAPI"]
  });
  assert.match(
    UWE.profileSummaryFromSnapshot(settings.profileSnapshot),
    /Node\.js\/React Full-Stack Developer/
  );
});

test("classifies Upwork card scoring context", () => {
  assert.equal(
    UWE.classifyJobCardContextText(
      "Client's recent history (50) To freelancer: Great work. Billed: $621.23."
    ),
    "history"
  );
  assert.equal(
    UWE.classifyJobCardContextText("Other open jobs by this Client (1) Hourly"),
    "clientJob"
  );
  assert.equal(
    UWE.classifyJobCardContextText(
      "Full-Stack Developer Needed Posted 1 hour ago Proposals: 20 to 50"
    ),
    ""
  );
});
