import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const command = process.argv[2];
if (!["prepare", "build"].includes(command) || process.argv.length !== 3) {
  throw new Error("Usage: node scripts/safari.mjs prepare|build");
}
if (process.platform !== "darwin") {
  throw new Error("The Safari app requires macOS and full Xcode. Use npm run package:safari for just the web extension files.");
}

const appName = "Upwork Enhancer";
const bundleIdentifier = "io.github.dreaifekks.UpworkEnhancer";
const localConfigPath = resolve(root, ".safari.local.json");
const localConfig = await exists(localConfigPath)
  ? JSON.parse(await readFile(localConfigPath, "utf8"))
  : {};
if (!localConfig || typeof localConfig !== "object" || Array.isArray(localConfig)) {
  throw new Error(".safari.local.json must contain a JSON object.");
}
const signingIdentity = process.env.SAFARI_SIGNING_IDENTITY ?? localConfig.signingIdentity ?? "";
const team = process.env.SAFARI_DEVELOPMENT_TEAM ?? localConfig.developmentTeam ?? "";
if (typeof signingIdentity !== "string" || typeof team !== "string") {
  throw new Error("Safari signing identity and development team must be strings.");
}
const configuration = process.env.SAFARI_CONFIGURATION ?? localConfig.configuration ??
  (signingIdentity.startsWith("Developer ID Application") ? "Release" : "Debug");
if (!["Debug", "Release"].includes(configuration)) {
  throw new Error("SAFARI_CONFIGURATION must be Debug or Release.");
}
const outputDir = resolve(root, "build/safari");
const projectPath = resolve(outputDir, appName, `${appName}.xcodeproj`);
const projectFile = resolve(projectPath, "project.pbxproj");
// File Provider can add FinderInfo to bundles in Documents, even in .nosync
// folders. Keep signed products in Xcode's local cache, scoped to this checkout.
const checkoutId = createHash("sha256").update(root).digest("hex").slice(0, 12);
const derivedData = resolve(homedir(), "Library/Developer/Xcode/DerivedData", `UpworkEnhancer-${checkoutId}`);
const appPath = resolve(derivedData, "Build/Products", configuration, `${appName}.app`);

if (team && !/^[A-Z0-9]{10}$/.test(team)) {
  throw new Error("SAFARI_DEVELOPMENT_TEAM must be your 10-character Apple development team ID.");
}
if (process.env.SAFARI_ALLOW_PROVISIONING_UPDATES === "1" && (!team || signingIdentity)) {
  throw new Error("Provisioning updates require a development team with automatic signing, without an explicit signing identity.");
}

// New Xcode versions call this tool a packager; older versions use converter.
const packager = ["safari-web-extension-packager", "safari-web-extension-converter"]
  .find((name) => spawnSync("xcrun", ["--find", name], { encoding: "utf8" }).status === 0);
if (!packager) {
  throw new Error("Safari's packager was not found. Install full Xcode and select it with xcode-select.");
}

run(process.execPath, [resolve(root, "scripts/package-extension.mjs"), "--browser", "safari"]);
const manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8"));

const newProject = !(await exists(projectFile));
if (newProject) {
  run("xcrun", [
    packager,
    resolve(root, "dist/safari/extension"),
    "--project-location", outputDir,
    "--app-name", appName,
    "--bundle-identifier", bundleIdentifier,
    "--swift", "--macos-only", "--no-open", "--no-prompt"
  ]);
}

let project = await readFile(projectFile, "utf8");
if (newProject) {
  // Xcode 27's packager derives the app ID from the display name even when an
  // explicit ID is supplied. Keep the embedded extension under the app's ID.
  project = project.replace(/PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);/g, (_, value) =>
    `PRODUCT_BUNDLE_IDENTIFIER = ${bundleIdentifier}${value.includes(".Extension") ? ".Extension" : ""};`
  );
  // The generated extension targets 12.0 while the app inherits the newest SDK.
  // Use a consistent deployment target; Safari runtime QA is still required.
  project = project.replace(/MACOSX_DEPLOYMENT_TARGET = [^;]+;/g, "MACOSX_DEPLOYMENT_TARGET = 13.0;");
}
// Refresh the version while preserving signing choices and native project edits.
project = project.replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${manifest.version};`);
await writeFile(projectFile, project);
console.log(`Safari Xcode project: ${projectPath}`);

if (command === "build") {
  const signing = signingIdentity
    ? ["CODE_SIGN_STYLE=Manual", `CODE_SIGN_IDENTITY=${signingIdentity}`, `DEVELOPMENT_TEAM=${team}`, "PROVISIONING_PROFILE_SPECIFIER="]
    : team
      ? ["CODE_SIGN_STYLE=Automatic", "CODE_SIGN_IDENTITY=Apple Development", `DEVELOPMENT_TEAM=${team}`]
      : ["CODE_SIGN_STYLE=Manual", "CODE_SIGN_IDENTITY=-", "DEVELOPMENT_TEAM=", "PROVISIONING_PROFILE_SPECIFIER="];
  if (process.env.SAFARI_ALLOW_PROVISIONING_UPDATES === "1") {
    signing.push("-allowProvisioningUpdates");
  }
  run("xcodebuild", [
    "-project", projectPath,
    "-scheme", appName,
    "-configuration", configuration,
    "-destination", `platform=macOS,arch=${process.arch === "arm64" ? "arm64" : "x86_64"}`,
    "-derivedDataPath", derivedData,
    "-quiet", "build", ...signing
  ]);

  const extensionResources = resolve(appPath, "Contents/PlugIns", `${appName} Extension.appex`, "Contents/Resources");
  const bundledManifest = JSON.parse(await readFile(resolve(extensionResources, "manifest.json"), "utf8"));
  if (JSON.stringify(bundledManifest) !== JSON.stringify(manifest)) {
    throw new Error("The built Safari extension has a stale manifest.");
  }
  await access(resolve(extensionResources, manifest.background.service_worker));
  run("codesign", ["--verify", "--deep", "--strict", appPath]);
  await writeFile(resolve(outputDir, "app-path.txt"), `${appPath}\n`);
  console.log(`Built Safari app: ${appPath}`);
  console.log((signingIdentity ? signingIdentity !== "-" : team)
    ? "Signed with an Apple identity. Enable the extension in Safari Settings > Extensions."
    : "Ad-hoc development build. Safari requires Allow unsigned extensions, or rebuild with your Apple development team.");
}

function run(executable, args) {
  const result = spawnSync(executable, args, { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${executable} failed (${result.signal || result.status}).`);
  }
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
