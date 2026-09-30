# macOS Safari

Safari uses the same `manifest.json`, JavaScript, CSS, and icons as Chrome. Apple's packager generates a small containing macOS app and embeds the extension in it. No second copy of the application logic is maintained.

Apple supports both `chrome.*` and `browser.*`, and both callback and Promise APIs. The existing MV3 service worker, popup, options page, and content scripts can therefore be packaged directly. See Apple's [compatibility guide](https://developer.apple.com/documentation/safariservices/assessing-your-safari-web-extension-s-browser-compatibility).

This workflow targets **macOS**. iPhone/iPad packaging and mobile UI verification are separate work. The generated native deployment target is macOS 13; that setting is not a claim that every older Safari release has been tested.

## Build and run

Requirements: Node.js 20+, macOS, and full Xcode selected as the active developer directory. Check the latter with `xcode-select -p` and `xcodebuild -version`.

```bash
npm run safari:run
```

The run command stops the existing Upwork Enhancer containing app, runs the checks, refreshes the packaged extension, builds the app, and launches it. It does not restart Safari. The same command is available as the project's Codex **Run** action.

Individual steps:

| Command | Result |
| --- | --- |
| `npm run package:safari` | Validated web extension folder and zip; works without Xcode |
| `npm run safari:project` | Refreshed web extension files and generated macOS Xcode project |
| `npm run safari:build` | Validated, built macOS app; does not launch it |
| `./script/build_and_run.sh --verify` | Build, launch, and verify the containing app process |
| `./script/build_and_run.sh --logs` | Build, launch, and stream containing-app logs |
| `./script/build_and_run.sh --debug` | Build and start the containing app under LLDB |

Generated locations:

```text
dist/safari/extension/
dist/safari/upwork-enhancer-safari-webextension-v<version>.zip
build/safari/Upwork Enhancer/Upwork Enhancer.xcodeproj
build/safari/app-path.txt
```

`app-path.txt` records the built app's absolute path. Build products live in `~/Library/Developer/Xcode/DerivedData/UpworkEnhancer-<checkout-id>/Build/Products/<configuration>/` so separate checkouts do not share outputs.

The project is generated once and reused. Preparation refreshes the staged extension and native marketing version, while preserving native edits and signing selections. Run `npm run safari:project` after changing extension code before building directly in Xcode. Use `npm run safari:build` to combine those steps.

All files under `build/` and `dist/` are disposable and ignored by Git. Put durable packaging changes in `scripts/safari.mjs`. Native app and extension identifiers are `io.github.dreaifekks.UpworkEnhancer` and `io.github.dreaifekks.UpworkEnhancer.Extension`. The generator keeps their prefixes aligned, including with Xcode 27's display-name-derived app identifier. Build products stay outside Documents: File Provider can add Finder metadata there that prevents code signing, even inside a `.nosync` directory.

## Enable local development

When no identity or team is configured, the command builds with **ad-hoc signing**, which needs no Apple certificate. Safari treats this as an unsigned extension for development and may hide it from extension settings until unsigned extensions are allowed:

1. In Safari **Settings → Advanced**, enable features for web developers if the Developer tab is hidden.
2. In **Settings → Developer**, enable **Allow unsigned extensions**.
3. Open the built containing app, then use its button to open Safari extension settings.
4. Enable **Upwork Enhancer** for your desired Safari profile.
5. Open an Upwork page and grant access to Upwork when Safari asks, then reload the page.

Safari resets the unsigned-extension allowance after it quits. See Apple's [running guide](https://developer.apple.com/documentation/safariservices/running-your-safari-web-extension).

Recent Safari versions also offer **Settings → Developer → Add Temporary Extension…**. After `npm run package:safari`, select `dist/safari/extension/` or its zip. This is useful for quick testing without the native app; temporary extensions expire after 24 hours or when Safari quits. Avoid enabling both the temporary and containing-app copies at the same time.

## Use your Apple Developer account

To use development signing instead of the unsigned-extension allowance, add your Apple account in **Xcode → Settings → Accounts** and ensure an Apple Development certificate is available. Supply your team ID:

```bash
SAFARI_DEVELOPMENT_TEAM=YOURTEAMID npm run safari:run
```

`YOURTEAMID` is a placeholder for your 10-character team ID. If Xcode needs to obtain provisioning assets, explicitly enable that operation:

```bash
SAFARI_DEVELOPMENT_TEAM=YOURTEAMID SAFARI_ALLOW_PROVISIONING_UPDATES=1 npm run safari:build
```

Both native targets use automatic Apple Development signing in this mode.

### Existing Developer ID Application certificate

A **Developer ID Application** identity can sign both the containing Mac app and the Safari extension. It is associated with your developer identity, not a single app. The downloaded `.cer` alone is insufficient: the matching private key must also be available in your keychain. Check available identities with `security find-identity -v -p codesigning`.

After importing your existing identity, use its exact certificate name:

```bash
SAFARI_SIGNING_IDENTITY='Developer ID Application: Your Name (YOURTEAMID)' npm run safari:run
```

This uses manual signing and defaults to **Release** for a named Developer ID Application identity. To remember the choice locally, create `.safari.local.json` (ignored by Git):

```json
{
  "signingIdentity": "Developer ID Application: Your Name (YOURTEAMID)",
  "developmentTeam": "YOURTEAMID",
  "configuration": "Release"
}
```

Subsequent `npm run safari:run` commands reuse that configuration. Environment variables override their matching fields. `SAFARI_CONFIGURATION` accepts `Debug` or `Release`. Store only the identity's public name and team in this file; keep private keys and passwords in your existing signing storage.

To switch a remembered identity to automatic development signing for one command, set `SAFARI_SIGNING_IDENTITY=''` alongside `SAFARI_DEVELOPMENT_TEAM`.

Building with an Apple identity does not publish or notarize the app. External Developer ID distribution requires notarization; App Store distribution uses its own archive/signing workflow. See Apple's [Safari distribution guide](https://developer.apple.com/documentation/safariservices/distributing-your-safari-web-extension). This repository's existing tag workflow still publishes only the Chrome zip.

## Website access and local data

- Grant Upwork access in Safari; declaring it in the manifest alone does not grant consent.
- Optional AI still requests the configured endpoint's origin from a user action. Keep AI disabled if that permission is denied. A broad optional host declaration allows custom endpoints; it is not a requirement to grant access to every website.
- Safari and Chrome have separate local extension storage. Preferences, API configuration, imported profile data, and saved decisions do not migrate automatically.
- `storage.local.setAccessLevel` is feature-detected because support differs between browsers. API keys stay out of content-script message responses, but Chrome's storage access restriction must not be assumed on a browser without that API.

## Safari verification checklist

Verified on 2026-09-29 with macOS/Safari 27 and Xcode 27: Developer ID Release build and signature validation, extension enablement with Upwork-only website access, real job-list scoring badges, toolbar popup rendering, and an options-save/popup-read round trip. The temporary test setting was restored afterward. AI calls, profile import, job-detail interactions, and iOS have not been verified in Safari in this pass.

Building the native app proves packaging and compilation. Verify these behaviors in Safari before calling a version ready for release:

- Enable the extension and Upwork access in the intended Safari profile.
- Confirm list badges and the detail review panel appear on real Upwork pages.
- Open the toolbar popup, change language/theme, and confirm already-open pages update.
- Open the full options page; save and reload preferences.
- Save a decision/note and verify persistence after a page reload.
- Import a visible freelancer profile and confirm the result persists.
- Confirm the extension remains useful with AI disabled.
- With a deliberately configured test endpoint, check permission denial/grant, connection test, analysis streaming, and errors. Local automated checks do not send requests to a paid API.
- Quit/reopen Safari and repeat the relevant enablement/signing steps; check persistence and background messages.

Use **Develop → Web Extension Background Content** and the popup/page inspector when diagnosing extension JavaScript. Containing-app logs do not substitute for service-worker or content-script inspection.
