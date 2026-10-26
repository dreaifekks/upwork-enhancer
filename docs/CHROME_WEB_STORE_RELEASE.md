# Chrome Web Store Release Checklist

## Prepared update: 0.2.0 (2026-10-27)

- Upload package: `dist/chrome/upwork-enhancer-v0.2.0.zip`, also attached to the GitHub release `v0.2.0`. Not submitted yet.
- Validation: 77 tests passed, including the local Chrome fixture render, 0 failures. Boosted bids on list cards were observed in a real logged-in Chrome session with the unpacked build.
- Permissions are unchanged from 0.1.21: `storage`, `activeTab`, Upwork host permissions, and optional host permissions for the user's AI endpoint. The update should not trigger a new permission warning for existing users.
- New in 0.2.0: boosted bids on job cards and in the review panel, remembered Find Work filters, a model list fetched from the AI endpoint, collapsible AI results, smoother AI streaming, and settings fixes.

### Remote code: decide before submitting

`src/content/boostBridge.js` runs in the Upwork page's main world. To read boosted bids it inserts a `<script>` whose source is Upwork's own sign-in script on `auth.upwork.com`, the same script Upwork pages load themselves. The script runs in the page, with no access to extension APIs; the extension's own logic is entirely in the package.

The Manifest V3 policy lists "a `<script>` tag that points to a resource not within the extension's package" as remote code. It also exempts code in contexts isolated from extension APIs, but its examples are iframes and sandboxed pages, not the page main world. A reviewer may flag this file.

Options:

1. Submit as is. Answer the remote code question honestly and put the explanation above in the justification and reviewer notes.
2. Submit a store build without the boost bridge, and keep boosted bids in the GitHub build. This needs a small build switch that is not implemented yet.

A same-origin hidden iframe of the apply page was tried as a way to avoid the script tag. Upwork renders the page and its bids inside the iframe, but it does not register a reusable request function there, so that route does not work.

### Listing description (English)

Review Upwork opportunities while you browse.

Upwork Enhancer adds concise scoring badges to job listings and a review panel to job pages, so you can compare profile fit, client signals, competition, and potential risks at a glance.

- See an at-a-glance recommendation and the reasons behind it.
- See the top boosted bids, in Connects, on job cards and in the review panel.
- Keep your Find Work filters after a page reload.
- Adjust preferred skills, budget floors, risk phrases, and scoring weights.
- Save decisions, notes, and tags locally in your browser.
- Use English or Chinese extension text.
- Optionally connect your own OpenAI-compatible AI API for deeper analysis, with the model list loaded from your endpoint.

Core scoring works without AI. Optional AI uses your own endpoint and API key; provider fees are separate. Settings and saved decisions stay in this browser. This is an independent, unofficial tool and is not affiliated with or endorsed by Upwork.

### Privacy practices tab

- Data leaving the device: only when the user starts an AI action, job details, scoring context, the profile summary, matching answer templates, and boosted bids go to the user-configured AI endpoint.
- Boosted bids are read from Upwork with the user's existing Upwork session inside the page and are not sent anywhere else.
- No developer server, no analytics, no sale or transfer of data. The certifications (no sale, no unrelated use, no creditworthiness use) remain accurate.
- Privacy policy URL: `https://github.com/dreaifekks/upwork-enhancer/blob/master/docs/PRIVACY_POLICY.md`. The pushed `master` already describes boosted bids and the model list request.

### Screenshots

All three current screenshots show 0.1.21. The list and review panel now carry a Boost badge, and the AI settings layout changed. Recapture all three from a real session with 0.2.0 before submitting.

### Reviewer notes draft

Open an Upwork job list, then a job detail. Job cards show a score strip ending with a Boost badge, the top bids in Connects for that job. The review panel shows the same. Boosted bids are read only for cards visible on screen, at most ten lookups a minute, and can be turned off in settings ("Show boosted bids on job cards"). To read them, `boostBridge.js` asks Upwork's own sign-in script, loaded into the Upwork page, to make the request; the extension never reads or stores the Upwork access token. Core scoring works without AI. Optional AI uses an endpoint and key the user supplies.

Safari uses a separate [App Store release plan](APP_STORE_RELEASE.md).

## Before The First Upload

- Register and set up a Chrome Web Store developer account.
- Prepare a public privacy policy URL. A draft is available in `docs/PRIVACY_POLICY.md`.
- Confirm extension icons are present and referenced from `manifest.json`.
- Prepare store listing assets:
  - Short description.
  - Detailed description.
  - Screenshots of Upwork list badges, detail panel, popup, and options page.
  - Support URL or support email.
- Run manual QA with the unpacked extension on real Upwork list and detail pages.

## Suggested Single Purpose

Upwork Enhancer helps freelancers evaluate visible Upwork opportunities while browsing Upwork by showing local scoring, risk signals, and optional user-configured AI assistance.

## Data Disclosure Notes

The extension stores settings, profile preferences, scoring metadata, saved decisions, and the last applied Find Work filters locally in browser storage. It does not automatically submit proposals, collect Upwork credentials, or crawl pages in the background. Boosted bids are read only for job cards visible on screen, through the user's existing Upwork session in the page.

When the optional AI feature is enabled, visible job information and scoring context may be sent to the user-configured OpenAI-compatible API endpoint. The API key is provided by the user and used only from the extension background service worker to call that endpoint.

## Privacy Policy URL

Chrome Web Store asks for a public privacy policy URL. This is your own web page, not a Google-provided site. For this project, you can use the rendered GitHub page if the repository is public:

```text
https://github.com/dreaifekks/upwork-enhancer/blob/master/docs/PRIVACY_POLICY.md
```

For a cleaner URL, publish the same content through GitHub Pages or another public website, then paste that URL into the Chrome Web Store privacy policy field.

## Permission Justification Draft

- `storage`: Saves local extension settings, user preferences, scoring metadata, and saved decisions.
- `activeTab`: Allows the popup to work with the current Upwork tab when the user invokes extension actions.
- `https://www.upwork.com/*` and `https://*.upwork.com/*`: Allows content scripts to read visible Upwork job pages, render scoring UI on those pages, and read boosted bids for the jobs shown, using the user's existing Upwork session in the page.
- Optional host permissions: Requested only when the user enables and configures an AI API endpoint, so the extension can call that endpoint for optional analysis.

## Remote Code Declaration

Before 0.2.0 the answer was "No". Since 0.2.0, `boostBridge.js` inserts Upwork's own sign-in script into the Upwork page to read boosted bids. See "Remote code: decide before submitting" above before answering. The optional AI feature only sends HTTPS requests and never executes code returned by the endpoint.

## Package Locally

```bash
npm run package:extension
```

The Chrome upload zip is written to:

```text
dist/chrome/upwork-enhancer-v<version>.zip
```

The zip root contains `manifest.json`, not a nested project folder.

## Prepare Store Screenshots

Chrome Web Store screenshots should show the real extension experience. Capture real browser screenshots first, then normalize them to `1280x800` PNG24 files.

Recommended screenshots for this extension:

1. A real Upwork job list page showing score badges on job cards.
2. A real Upwork job detail or slider page showing the Opportunity Review panel.
3. The real Upwork Enhancer options page showing profile/preferences/AI settings.

Put 1-5 raw screenshots in:

```text
assets/store/raw/
```

Then prepare Chrome Web Store-compatible files with:

```bash
npm run screenshots:store
```

The generated screenshots are written to:

```text
assets/store/screenshots/
```

The script crops/resizes to `1280x800`, removes alpha transparency, and writes 24-bit PNG files suitable for the Chrome Web Store listing.

Practical capture notes:

- Use real pages from a logged-in Chrome session with the extension installed.
- Avoid showing personal profile details, private client names, messages, financial data, or anything you do not want public.
- If needed, blur sensitive text in the raw screenshot before running the script.
- Do not use mock fixture pages for final store screenshots.

## Tag Release Flow

1. Update `manifest.json` and `package.json` to the same version.
2. Commit the version change.
3. Tag with the same version, prefixed with `v`.

```bash
git tag v0.1.16
git push origin v0.1.16
```

The GitHub Actions workflow validates, tests, packages, uploads a workflow artifact, and attaches the zip to the GitHub Release for that tag.

## Official References

- https://developer.chrome.com/docs/webstore/prepare
- https://developer.chrome.com/docs/webstore/publish
- https://developer.chrome.com/docs/webstore/cws-dashboard-privacy
- https://developer.chrome.com/docs/webstore/program-policies/permissions
- https://developer.chrome.com/docs/webstore/images
