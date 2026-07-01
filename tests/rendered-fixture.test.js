const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { spawnSync } = require("node:child_process");

const CHROME_CANDIDATES = [
  process.env.CHROME_BIN,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "google-chrome",
  "chromium",
  "chromium-browser"
].filter(Boolean);

test("renders score context labels for job cards and client history", (t) => {
  if (process.env.UWE_RUN_BROWSER_SMOKE !== "1") {
    t.skip("set UWE_RUN_BROWSER_SMOKE=1 to run the local Chrome fixture render");
    return;
  }

  const chrome = findChrome();
  if (!chrome) {
    t.skip("Chrome executable not found for rendered fixture smoke test");
    return;
  }

  const profileDir = mkdtempSync(join(tmpdir(), "uwe-chrome-profile-"));
  try {
    const fixtureUrl = `file://${resolve("tests/fixtures/mock-upwork.html")}`;
    const result = spawnSync(
      chrome,
      [
        "--headless=new",
        "--disable-gpu",
        "--no-first-run",
        "--no-default-browser-check",
        "--allow-file-access-from-files",
        `--user-data-dir=${profileDir}`,
        "--virtual-time-budget=2000",
        "--dump-dom",
        fixtureUrl
      ],
      {
        encoding: "utf8",
        timeout: 15000
      }
    );

    assert.equal(
      result.status,
      0,
      result.stderr || result.stdout || "Chrome fixture render failed"
    );
    assert.match(result.stdout, /class="uwe-card-panel"/);
    assert.match(result.stdout, />Job<\/span>/);
    assert.match(
      result.stdout,
      /History: 3D Artist Needed for Furniture 3D Modeling/
    );
    assert.match(
      result.stdout,
      /History: Telegram Bot for AI Assistant/
    );
    assert.doesNotMatch(result.stdout, /History: Yuriy L\./);
    assert.doesNotMatch(result.stdout, /History: Aleksei N\./);
  } finally {
    rmSync(profileDir, { recursive: true, force: true });
  }
});

test("parses visible freelancer profile data", (t) => {
  if (process.env.UWE_RUN_BROWSER_SMOKE !== "1") {
    t.skip("set UWE_RUN_BROWSER_SMOKE=1 to run the local Chrome fixture render");
    return;
  }

  const chrome = findChrome();
  if (!chrome) {
    t.skip("Chrome executable not found for rendered fixture smoke test");
    return;
  }

  const profileDir = mkdtempSync(join(tmpdir(), "uwe-chrome-profile-"));
  try {
    const fixtureUrl = `file://${resolve("tests/fixtures/mock-profile.html")}`;
    const result = spawnSync(
      chrome,
      [
        "--headless=new",
        "--disable-gpu",
        "--no-first-run",
        "--no-default-browser-check",
        "--allow-file-access-from-files",
        `--user-data-dir=${profileDir}`,
        "--virtual-time-budget=1000",
        "--dump-dom",
        fixtureUrl
      ],
      {
        encoding: "utf8",
        timeout: 15000
      }
    );

    assert.equal(
      result.status,
      0,
      result.stderr || result.stdout || "Chrome profile fixture render failed"
    );
    assert.match(result.stdout, /Node\.js\/React Full-Stack Developer/);
    assert.match(result.stdout, /\$30\.00\/hr/);
    assert.match(result.stdout, /OpenAI API/);
    assert.match(result.stdout, /Chinese: Native or Bilingual/);
  } finally {
    rmSync(profileDir, { recursive: true, force: true });
  }
});

function findChrome() {
  for (const candidate of CHROME_CANDIDATES) {
    const probe = spawnSync(candidate, ["--version"], {
      encoding: "utf8",
      timeout: 5000
    });
    if (probe.status === 0) {
      return candidate;
    }
  }
  return "";
}
