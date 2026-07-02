# Chrome Web Store Release Checklist

## Before The First Upload

- Register and set up a Chrome Web Store developer account.
- Prepare a public privacy policy URL.
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
