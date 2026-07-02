import { spawnSync } from "node:child_process";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";

const root = process.cwd();
const inputDir = resolve(root, process.argv[2] || "assets/store/raw");
const outputDir = resolve(root, process.argv[3] || "assets/store/screenshots");
const magick = findExecutable(["magick", "convert"]);
const screenshotWidth = 1280;
const screenshotHeight = 800;
const allowedExtensions = new Set([".png", ".jpg", ".jpeg"]);

if (!magick) {
  throw new Error("ImageMagick not found. Install ImageMagick to prepare PNG24 screenshots.");
}

const inputFiles = await listInputFiles(inputDir);
if (inputFiles.length === 0) {
  throw new Error(
    `No raw screenshots found in ${inputDir}. Add 1-5 PNG/JPEG files and rerun.`
  );
}
if (inputFiles.length > 5) {
  throw new Error(`Chrome Web Store allows at most 5 screenshots. Found ${inputFiles.length}.`);
}

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

for (const [index, inputFile] of inputFiles.entries()) {
  const sequence = String(index + 1).padStart(2, "0");
  const name = basename(inputFile, extname(inputFile))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const outputFile = resolve(outputDir, `${sequence}-${name || "screenshot"}.png`);
  prepareScreenshot(inputFile, outputFile);
  console.log(`Created ${outputFile}`);
}

console.log(`Prepared ${inputFiles.length} Chrome Web Store screenshot(s).`);

async function listInputFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true }).catch((error) => {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  });
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    const path = resolve(dir, entry.name);
    const extension = extname(entry.name).toLowerCase();
    if (!allowedExtensions.has(extension)) {
      continue;
    }
    const metadata = await stat(path);
    if (metadata.size > 0) {
      files.push(path);
    }
  }
  return files.sort((left, right) => basename(left).localeCompare(basename(right)));
}

function prepareScreenshot(inputFile, outputFile) {
  const result = spawnSync(
    magick,
    [
      inputFile,
      "-auto-orient",
      "-alpha",
      "remove",
      "-alpha",
      "off",
      "-resize",
      `${screenshotWidth}x${screenshotHeight}^`,
      "-gravity",
      "center",
      "-extent",
      `${screenshotWidth}x${screenshotHeight}`,
      `PNG24:${outputFile}`
    ],
    {
      encoding: "utf8",
      timeout: 15000
    }
  );

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `Failed to prepare ${inputFile}`);
  }
}

function findExecutable(candidates) {
  for (const candidate of candidates) {
    const result = spawnSync(candidate, ["--version"], {
      encoding: "utf8",
      timeout: 5000
    });
    if (result.status === 0) {
      return candidate;
    }
  }
  return "";
}
