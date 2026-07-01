import { access, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";

const root = process.cwd();
const manifestPath = resolve(root, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const jsFiles = new Set();

const requiredTopLevel = [
  "manifest_version",
  "name",
  "version",
  "background",
  "content_scripts",
  "options_page"
];

for (const key of requiredTopLevel) {
  assert(manifest[key], `manifest.json is missing ${key}`);
}

assert(manifest.manifest_version === 3, "manifest_version must be 3");

await assertFile(manifest.background.service_worker);
jsFiles.add(resolve(root, manifest.background.service_worker));
await assertFile(manifest.options_page);
if (manifest.action && manifest.action.default_popup) {
  await assertFile(manifest.action.default_popup);
}

for (const script of manifest.content_scripts || []) {
  for (const js of script.js || []) {
    await assertFile(js);
    jsFiles.add(resolve(root, js));
  }
  for (const css of script.css || []) {
    await assertFile(css);
  }
}

await collectHtmlAssets(manifest.options_page, jsFiles);
if (manifest.action && manifest.action.default_popup) {
  await collectHtmlAssets(manifest.action.default_popup, jsFiles);
}

for (const file of jsFiles) {
  const result = spawnSync(process.execPath, ["--check", file], {
    encoding: "utf8"
  });
  if (result.status !== 0) {
    throw new Error(
      `Syntax check failed for ${file}\n${result.stderr || result.stdout}`
    );
  }
}

await assertI18nCompleteness(resolve(root, "src/shared/i18n.js"));

console.log("Extension manifest validation passed.");

async function assertFile(relativeOrAbsolutePath) {
  const path = relativeOrAbsolutePath.startsWith("/")
    ? relativeOrAbsolutePath
    : resolve(root, relativeOrAbsolutePath);
  try {
    await access(path);
  } catch {
    throw new Error(`Missing file referenced by extension: ${relativeOrAbsolutePath}`);
  }
}

async function collectHtmlAssets(htmlPath, jsFiles) {
  const html = await readFile(resolve(root, htmlPath), "utf8");
  const scriptMatches = Array.from(html.matchAll(/<script src="([^"]+)"/g));
  const styleMatches = Array.from(html.matchAll(/<link[^>]+href="([^"]+)"/g));
  const htmlDir = dirname(resolve(root, htmlPath));

  for (const match of scriptMatches) {
    const file = resolve(htmlDir, match[1]);
    await assertFile(file);
    jsFiles.add(file);
  }

  for (const match of styleMatches) {
    await assertFile(resolve(htmlDir, match[1]));
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function assertI18nCompleteness(file) {
  const text = await readFile(file, "utf8");
  const enKeys = extractLanguageKeys(text, "en");
  const zhKeys = extractLanguageKeys(text, "zh");
  const missingZh = enKeys.filter((key) => !zhKeys.includes(key));
  const missingEn = zhKeys.filter((key) => !enKeys.includes(key));
  assert(
    missingZh.length === 0 && missingEn.length === 0,
    `i18n key mismatch. Missing zh: ${missingZh.join(", ")}. Missing en: ${missingEn.join(", ")}`
  );
}

function extractLanguageKeys(text, language) {
  const blockMatch = text.match(new RegExp(`${language}: \\{([\\s\\S]*?)\\n    \\}`, "m"));
  assert(blockMatch, `Missing i18n language block: ${language}`);
  return Array.from(blockMatch[1].matchAll(/"([^"]+)":/g)).map((match) => match[1]);
}
