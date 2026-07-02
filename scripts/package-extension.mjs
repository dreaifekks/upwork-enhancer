import { spawnSync } from "node:child_process";
import { cp, mkdir, readFile, rm, stat } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

const root = process.cwd();
const manifestPath = resolve(root, "manifest.json");
const packagePath = resolve(root, "package.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const packageJson = JSON.parse(await readFile(packagePath, "utf8"));

assert(manifest.version, "manifest.json is missing version");
assert(packageJson.version, "package.json is missing version");
assert(
  manifest.version === packageJson.version,
  `Version mismatch: manifest.json has ${manifest.version}, package.json has ${packageJson.version}`
);

const tagName = process.env.GITHUB_REF_TYPE === "tag"
  ? process.env.GITHUB_REF_NAME
  : process.env.RELEASE_TAG;
if (tagName) {
  const normalizedTag = tagName.replace(/^v/, "");
  assert(
    normalizedTag === manifest.version,
    `Tag ${tagName} does not match manifest version ${manifest.version}`
  );
}

const extensionName = packageJson.name || "extension";
const version = manifest.version;
const outputDir = resolve(root, "dist", "chrome");
const stagingDir = resolve(outputDir, "extension");
const zipPath = resolve(outputDir, `${extensionName}-v${version}.zip`);

await rm(stagingDir, { recursive: true, force: true });
await mkdir(stagingDir, { recursive: true });

for (const entry of packageEntries()) {
  await copyRequired(entry);
}

await assertExists(resolve(stagingDir, "manifest.json"));

await rm(zipPath, { force: true });
const zipResult = spawnSync("zip", ["-r", "-9", zipPath, "."], {
  cwd: stagingDir,
  encoding: "utf8"
});

if (zipResult.status !== 0) {
  throw new Error(
    `Failed to create zip.\n${zipResult.stderr || zipResult.stdout || "No output"}`
  );
}

console.log(`Created ${zipPath}`);

function packageEntries() {
  const entries = new Set(["manifest.json", "src", ...manifestAssetPaths(manifest)]);
  return [...entries];
}

function manifestAssetPaths(value, parentKey = "") {
  const paths = [];
  if (!value || typeof value !== "object") {
    return paths;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      paths.push(...manifestAssetPaths(item, parentKey));
    }
    return paths;
  }
  for (const [key, item] of Object.entries(value)) {
    if (
      typeof item === "string" &&
      (/^(icon|default_popup|options_page)$/.test(key) ||
        /^(icons?|default_icon)$/.test(parentKey))
    ) {
      paths.push(item);
    } else {
      paths.push(...manifestAssetPaths(item, key));
    }
  }
  return paths.filter((path) => !path.startsWith("http://") && !path.startsWith("https://"));
}

async function copyRequired(relativePath) {
  const from = resolve(root, relativePath);
  try {
    await stat(from);
  } catch {
    throw new Error(`Missing required package file: ${relativePath}`);
  }

  const to = resolve(stagingDir, relativePath);
  await mkdir(dirname(to), { recursive: true });
  await cp(from, to, { recursive: true });
  console.log(`Included ${basename(relativePath)}`);
}

async function assertExists(path) {
  try {
    await stat(path);
  } catch {
    throw new Error(`Missing required packaged file: ${path}`);
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
