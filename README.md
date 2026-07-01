# Upwork Enhancer

Chrome extension for evaluating Upwork opportunities while browsing.

The first goal is not full automation. The extension should help a freelancer make faster and better application decisions by showing strategy-driven evaluation directly on Upwork job pages.

## Current Direction

- Build a Chrome extension first, not an MCP server.
- Enhance the existing Upwork browsing flow instead of replacing it.
- Show evaluation overlays on job list and job detail pages.
- Keep deterministic scoring local where the strategy is already clear.
- Use an OpenAI-compatible remote API only for fuzzy analysis and writing assistance.
- Avoid automatic applying, background scraping, credential proxying, or bulk page collection.

## MVP

1. Read visible job information from the current Upwork page.
2. Score the job with local rules:
   - freelancer match
   - client quality
   - competition level
   - risk level
   - recommended action
3. Render compact badges on job cards.
4. Render a detail sidebar on job detail pages.
5. Optionally call an OpenAI-compatible API for:
   - requirement summary
   - ambiguous risk interpretation
   - proposal angle
   - draft proposal opener
6. Save only local decision metadata, such as job id, scores, tags, and user decision.

## Local Development

This repository is currently a no-build Manifest V3 extension.

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click "Load unpacked".
4. Select this repository directory.
5. Open an Upwork job list or job detail page.

Useful checks:

```bash
npm run check
```

The extension can also be previewed against the local mock page at `tests/fixtures/mock-upwork.html`.

Manual QA checklist:

- Upwork job list pages show compact score/action badges on visible job cards.
- Upwork job detail pages show the opportunity review panel.
- Injected score badges start with a context label, such as `Job`, `History`, or `Client job`, so client-history scores are not confused with the current job.
- Client history scoring is applied to the latest visible history entries, up to 10 items. After clicking Upwork's `View more`, the extension should rescan the newly visible entries.
- Clicking the extension icon opens a quick settings popup for language, opening/importing/updating your profile, common preferences, and AI connection testing.
- Open your own Upwork freelancer profile page and use `Import current profile` to initialize the profile summary and merge profile skills into matching preferences. If you store a profile URL in settings, `Open profile` opens that profile first so you can import it from the visible tab.
- The panel can be collapsed and does not cover the main job title on laptop-width screens.
- Saving a decision persists the selected action, note, and tags locally.
- Options default to English and can switch extension-owned UI text to Chinese.
- Saving options updates already-open Upwork tabs without requiring a manual refresh.
- The extension still works when AI settings are empty or disabled.

## Non-Goals For The First Version

- No automatic proposal submission.
- No automatic clicking or Upwork workflow automation.
- No background crawling of search result pages.
- No password collection or session proxying.
- No long-term storage of full Upwork job content unless the policy boundary is rechecked.
- No MCP interface until the browsing workflow and scoring strategy are stable.

## Project Docs

- [Product goals](docs/PRODUCT_GOALS.md)
- [MVP requirements and build plan](docs/MVP_REQUIREMENTS.md)
