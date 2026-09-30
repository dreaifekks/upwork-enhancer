# Safari App Store release

Prepared on 2026-09-30 for the current shared extension, version `0.1.21`.

Current status observed on 2026-09-30: Xcode Organizer confirms `0.1.21 (1)` as **Uploaded to Apple**, with Intel and Apple Silicon architectures. Both targets use team `ALZ45VUZFN`; the native category is Productivity. App Store Connect now displays `0.1.21` in Prepare for Submission with Build `1` selected and three screenshots present. Encryption compliance is still marked missing. The text fields and reviewer contact fields were empty when inspected. Pricing and review submission have not been verified. Use the [Chinese field-by-field filling guide](APP_STORE_FILLING_GUIDE_ZH.md) for copyable values, encryption guidance, and the remaining privacy/review decisions.

## Recommended first release

- Start with **macOS Safari**. The existing project targets macOS; iPhone and iPad need their own layout and runtime verification.
- Sell the containing app as a **one-time paid download**, with **Japan as the base storefront and JPY 100 as the proposed price**. This is a modest support price, not a recurring service charge. Leave other storefronts on Apple's automatic equivalent prices, then review them before release.
- Keep local scoring and saved decisions available without an AI account. Optional AI uses the customer's own API endpoint and key; API usage is charged separately by that provider.
- Keep one shared WebExtension codebase and version for Chrome and Safari. Their local settings and saved decisions are separate; do not advertise automatic browser-to-browser sync.
- If iOS/iPadOS are added later, evaluate Universal Purchase so one purchase covers supported Apple platforms.

Apple's published price-point table supports JPY 100. Paid distribution requires the account holder's Paid Apps Agreement plus completed banking/tax setup. An approved Small Business Program enrollment reduces the applicable paid-app commission to 15%; enrollment is not automatic. Treat JPY 100 as a support/launch price rather than a meaningful maintenance budget. Actual proceeds appear in App Store Connect after applicable taxes and commission.

## What customers should see

1. Buy and install the Mac app from the App Store.
2. Open **Upwork Enhancer** and choose **Open Safari Extension Settings**.
3. Enable the extension for the desired Safari profile, allow access to Upwork, and open an Upwork job page.

The containing app should explain these three steps, display extension status, and provide support and privacy links. It can remain a small setup app; settings and job reviews stay in the extension.

**Current gap:** the generated container still has Apple's default on/off text and settings button. Persist any custom setup page in source control and copy it during `safari:project`; edits made only under ignored `build/` are not a reproducible release.

## Native release preparation

| Item | Current observation | Before submission |
| --- | --- | --- |
| App identifier | `io.github.dreaifekks.UpworkEnhancer` | Register/select the same explicit ID and App Store Connect record |
| Extension identifier | `io.github.dreaifekks.UpworkEnhancer.Extension` | Use the same team and matching provisioning |
| Marketing version | `0.1.21` | Keep app and extension versions aligned |
| Native build number | `1` in generated project | Increment for each new uploaded build of this version |
| Platform | macOS; deployment target 13.0 | Verify the minimum supported Safari/macOS combination; do not infer compatibility from compilation |
| Local signing | Developer ID workflow | Use the App Store Connect distribution workflow for the archive |
| App Sandbox | Enabled on both native targets | Retain it and validate required capabilities |
| Category | Productivity observed in Xcode | Confirm the App Store Connect category |
| Native icon | Generated app-icon asset set exists | Inspect its 1024px rendition before submission |

Refresh the shared files first:

```bash
npm run check
npm run safari:project
```

Then open `build/safari/Upwork Enhancer/Upwork Enhancer.xcodeproj` in Xcode:

1. Select the account's team and automatic signing for both the app and extension targets. The local `.safari.local.json` Developer ID identity is for the existing CLI build; it is not the App Store distribution choice.
2. Set the app category and build number. Confirm both targets' versions and deployment targets agree.
3. Select the Mac release destination. Archive a universal Mac build if supporting both Apple Silicon and Intel; the local `safari:build` command currently selects the host CPU explicitly.
4. Use **Product → Archive**, then **Organizer → Distribute App → App Store Connect**. Resolve validation errors before uploading.
5. Select the processed build in App Store Connect, fill the listing/review fields, and use manual release after approval for the first launch.

An existing Developer ID `.app` or Safari WebExtension `.zip` is not the App Store upload artifact. The repository does not yet provide a tested archive/upload command.

## Listing draft

| Field | Proposed value |
| --- | --- |
| Name | Upwork Enhancer |
| Subtitle | Review jobs with local scoring |
| Primary category | Productivity |
| Platform | macOS |
| Primary listing language | English (US) |
| Keywords | freelance,jobs,workflow,productivity,client,scoring,safari |
| Support URL | `https://dreaife.tokyo/en/projects/` (pending the profile email button) |
| Privacy URL | `https://github.com/dreaifekks/upwork-enhancer/blob/master/docs/PRIVACY_POLICY.md` |

Public URLs must contain the current published content and load without authentication before submission. The user selected the blog projects page for support; add and verify a public email button in its profile sidebar before treating this field as ready. GitHub Issues remains an additional feedback destination. Do not advertise Japanese UI: the extension currently supports English and Chinese.

### Description

Review Upwork opportunities while you browse in Safari.

Upwork Enhancer adds concise scoring badges to job listings and a review panel to job pages, helping you compare profile fit, client signals, competition, and potential risks.

- See an at-a-glance recommendation and its scoring reasons.
- Adjust your preferred skills, budget thresholds, and review preferences.
- Save decisions, notes, and tags locally in your browser.
- Use English or Chinese extension text.
- Optionally connect your own compatible AI API for additional analysis.

The purchase includes the Safari extension. Core local scoring does not require an AI subscription or API key. Optional AI requires your own API provider account, endpoint, and key; provider usage fees are separate.

Requires Safari on Mac and access to the relevant Upwork webpages. Some Upwork pages require an Upwork account. After installation, open the app, enable the extension in Safari Settings, and allow access to Upwork.

Settings and saved decisions are stored locally in this browser. Chrome and Safari do not automatically sync their extension data. This is an independent, unofficial tool and is not affiliated with or endorsed by Upwork.

### Review notes draft

This macOS app contains a Safari Web Extension. The app opens Safari's extension settings; the primary functionality appears on Upwork webpages after the extension is enabled and website access is allowed.

Enable Upwork Enhancer in Safari Settings → Extensions, allow Upwork access, and open a job listing followed by a job detail. The extension adds a score/recommendation to the list and an opportunity review panel to the detail. The toolbar popup and its settings page allow preferences to be edited. Core scoring works with AI disabled. Optional AI uses a user-supplied endpoint and key and is not required for core functionality.

**Before sending:** supply a tested path to real job content the reviewer can access. If the needed pages require login, resolve reviewer access or an approved demonstration approach with App Review; do not assume the reviewer has an Upwork account. Add concrete working test URLs and any necessary review-only details to App Store Connect, not to this public document. The AI feature's review path must also be explained if it is included.

## Screenshots and final checks

Capture the released UI in the actual target browser. Use three images: job-list badges, the expanded opportunity review, and clean settings with no private profile data or API key. Add a fourth Safari setup image only if it helps explain enablement.

- Chrome accepts up to five screenshots; use `1280×800` PNG24 and retain the current required promotional image (or update it if it shows old UI).
- Mac screenshots accept `1280×800`, `1440×900`, `2560×1600`, or `2880×1800`. The same composition and captions can be reused, but capture Safari for the Safari listing.
- Update the Chrome package on the **existing listing**. Compare its published version first: the upload version must be newer. A new screenshot alone does not require a code version change.
- Verify real Safari list/detail rendering, saved-decision persistence, settings, profile import, and optional AI permission/error/stream behavior before submission.
- Complete App Privacy from the actual data flow, including optional third-party AI transfers. No developer backend by itself does not settle all disclosure answers.
- Ensure a privacy-policy link is accessible inside the app/extension as well as on the store page.
- Complete the current age-rating, encryption/export, content-rights, and availability questions in App Store Connect based on the build and chosen markets.

## Official sources checked

- [Safari distribution and Universal Purchase](https://developer.apple.com/documentation/safariservices/distributing-your-safari-web-extension)
- [Set a price and choose a base storefront](https://developer.apple.com/help/app-store-connect/manage-app-pricing/set-a-price/)
- [JPY price points, page 3](https://www.apple.com/newsroom/pdfs/App-Store-Pricing-Update.pdf)
- [Small Business Program](https://developer.apple.com/app-store/small-business-program/)
- [Mac screenshot sizes](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/)
- [Chrome listing images](https://developer.chrome.com/docs/webstore/images)
- [App Review preparation](https://developer.apple.com/app-store/review/)
- [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
