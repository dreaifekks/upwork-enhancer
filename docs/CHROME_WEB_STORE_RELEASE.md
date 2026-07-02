# Chrome Web Store Release Checklist

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

The extension stores settings, profile preferences, scoring metadata, and saved decisions locally in browser storage. It does not automatically submit proposals, collect Upwork credentials, or crawl pages in the background.

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
- `https://www.upwork.com/*` and `https://*.upwork.com/*`: Allows content scripts to read visible Upwork job pages and render scoring UI on those pages.
- Optional host permissions: Requested only when the user enables and configures an AI API endpoint, so the extension can call that endpoint for optional analysis.

## Remote Code Declaration

Select "No" if the extension does not download or execute remote JavaScript or WebAssembly. The optional AI feature sends HTTPS requests to a user-configured API endpoint but does not execute code returned by that endpoint.

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
git tag v0.1.15
git push origin v0.1.15
```

The GitHub Actions workflow validates, tests, packages, uploads a workflow artifact, and attaches the zip to the GitHub Release for that tag.

## Official References

- https://developer.chrome.com/docs/webstore/prepare
- https://developer.chrome.com/docs/webstore/publish
- https://developer.chrome.com/docs/webstore/cws-dashboard-privacy
- https://developer.chrome.com/docs/webstore/program-policies/permissions
- https://developer.chrome.com/docs/webstore/images
