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
});

test("flags unpaid off-platform low-budget work as pass", () => {
  const result = scoreJob(
    {
      title: "Need expert full stack AI automation ASAP",
      description:
        "Tiny fixed budget. Must do unpaid test and contact on Telegram outside Upwork. Proposals: 50+.",
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
  assert.ok(result.riskNotes.length >= 2);
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
    blacklistedPhrases: ""
  });

  assert.deepEqual(settings.preferredSkills, []);
  assert.deepEqual(settings.avoidedSkills, []);
  assert.deepEqual(settings.preferredProjectTypes, []);
  assert.deepEqual(settings.blacklistedPhrases, []);
});

test("normalizes theme setting with auto default", () => {
  assert.equal(UWE.normalizeSettings({}).theme, "auto");
  assert.equal(UWE.normalizeSettings({ theme: "dark" }).theme, "dark");
  assert.equal(UWE.normalizeSettings({ theme: "light" }).theme, "light");
  assert.equal(UWE.normalizeSettings({ theme: "solarized" }).theme, "auto");
});

test("normalizes imported profile snapshots and builds profile summary", () => {
  const settings = UWE.normalizeSettings({
    profileUrl: "/freelancers/~011",
    profileSnapshot: {
      title: "Node.js/React Full-Stack Developer",
      hourlyRate: "$30.00/hr",
      overview: "I build and maintain full-stack applications.",
      skills: "React, Node.js\nOpenAI API",
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
