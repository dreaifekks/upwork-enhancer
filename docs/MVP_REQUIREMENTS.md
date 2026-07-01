# MVP Requirements And Build Plan

This document turns the current product direction into an implementable first version.

## Requirement Summary

Build a Chrome extension that augments the existing Upwork browsing flow with local scoring, compact UI signals, and optional OpenAI-compatible assistance.

The extension should help the freelancer answer three questions while browsing:

1. Is this job worth attention?
2. Why should I apply, watch, review manually, or pass?
3. What proposal angle should I use if I choose to apply?

The MVP should stay conservative: evaluate only visible pages the user opens, avoid automated Upwork actions, and store only decision metadata by default.

## Primary User Flows

### Scan Job List

User opens an Upwork search/list page.

The extension:

- detects visible job cards
- extracts available job-card fields
- runs deterministic local scoring
- renders compact badges on each card
- updates badges as Upwork dynamically changes the page

Expected result: the user can quickly spot apply/watch/pass candidates without leaving Upwork.

### Review Job Detail

User opens an Upwork job detail page.

The extension:

- extracts richer job, client, competition, and budget fields from the page
- recalculates the score with detail-level information
- renders a sidebar with summary, reasons, risks, and recommended action
- lets the user save a decision such as `apply`, `watch`, `maybe`, or `pass`

Expected result: the user can make a final manual decision with the relevant evidence visible.

### Request AI Assistance

User clicks an explicit AI action in the detail sidebar.

The extension:

- sends only the needed job text and profile context to the configured OpenAI-compatible endpoint
- asks for fuzzy analysis such as requirement summary, hidden risks, proposal angle, or short opener
- shows the result in the sidebar
- does not durably store full job descriptions by default

Expected result: AI is used for judgment and writing assistance, not for simple threshold checks.

### Configure Strategy

User clicks the extension icon for a quick settings panel, or opens the full options page for advanced configuration.

The extension lets the user configure:

- API base URL, model, and API key behavior
- freelancer profile summary
- current freelancer profile URL and imported profile snapshot
- preferred and avoided skills
- preferred project types
- minimum hourly rate and fixed budget
- blacklisted phrases
- scoring weights and action thresholds
- display language, with English as the default and Chinese as an option

Expected result: the scoring strategy can evolve without code edits.

### Initialize From Freelancer Profile

User opens their own Upwork freelancer profile page and clicks the extension icon.

The extension:

- can open a configured Upwork freelancer profile URL from settings or the toolbar popup
- extracts the visible profile title, overview, hourly rate, skills, languages, profile URL, and update time
- stores a normalized profile snapshot locally
- builds the profile summary used by optional AI prompts
- merges visible profile skills into preferred skills without deleting manually configured preferences

Expected result: personal match scoring starts from the user's actual Upwork profile instead of an empty or fully manual profile description.

## MVP Feature Requirements

### Extension Shell

- Use a Chrome Manifest V3 extension structure.
- Use content scripts for Upwork page extraction and in-page UI.
- Use an extension service worker for event handling and remote API calls.
- Use an options page for user configuration.
- Use extension storage APIs for settings and decision metadata.
- Scope host permissions to Upwork pages needed for the MVP.

Reference: Chrome content scripts can read and modify page DOM and communicate with the extension; extension service workers are event handlers and cannot access the DOM directly.

Official references:

- [Chrome content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)
- [Chrome extension service workers](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers)
- [Chrome extension storage API](https://developer.chrome.com/docs/extensions/reference/api/storage)

### Page Parsing

Create a parser layer that converts Upwork DOM content into normalized data models.

Initial normalized fields:

- `jobId`
- `url`
- `title`
- `description`
- `skills`
- `budgetType`
- `hourlyMin`
- `hourlyMax`
- `fixedBudget`
- `experienceLevel`
- `postedAge`
- `proposalCount`
- `interviewCount`
- `inviteCount`
- `clientPaymentVerified`
- `clientRating`
- `clientReviewCount`
- `clientSpend`
- `clientHireRate`
- `clientAverageHourlyRate`
- `countryOrTimezone`

Implementation notes:

- Support missing fields explicitly.
- Keep raw DOM selectors isolated from scoring logic.
- Add parser fixtures from manually saved sanitized snippets when available.
- Use a mutation observer or route-change detector because Upwork behaves like a dynamic web app.
- Treat client history as individual recent-history entries, not as one large client container.
- Score up to the latest 10 visible client-history entries, and rescan when the user expands Upwork's `View more` content.
- Add an explicit context to every rendered score, such as `job`, `history`, or `clientJob`, so the user can see what object was scored.

### Local Scoring

Create a deterministic scoring engine that accepts normalized job data and user strategy config.

Output shape:

- `overallScore`
- `matchScore`
- `clientQualityScore`
- `competitionScore`
- `riskScore`
- `recommendedAction`
- `positiveReasons`
- `negativeReasons`
- `riskNotes`
- `missingSignals`

Scoring principles:

- Make threshold checks local and explainable.
- Keep weights editable.
- Treat missing data as uncertainty, not automatic failure.
- Separate score calculation from UI rendering.
- Return reasons with every score so the user can trust or override the recommendation.

### In-Page UI

Job list UI:

- compact overall badge
- dimension badges for match, client, competition, risk
- recommended action badge
- hover or click detail popover only if it does not cover important Upwork controls

Job detail UI:

- right-side sidebar or collapsible panel
- decision summary
- score breakdown
- strongest apply reasons
- strongest skip reasons
- risk notes
- proposal angle
- optional AI draft opener
- decision buttons for `apply`, `watch`, `maybe`, and `pass`

UI constraints:

- Do not block Upwork's native controls.
- Avoid layout shifts on job cards.
- Make injected elements visually distinct but quiet.
- Include loading, unavailable, parser failure, and API failure states.

Language requirements:

- Support English and Chinese display text for extension-owned UI.
- Use English as the default display language.
- Allow the user to switch the display language in settings.
- Keep parsed Upwork job content in its original language unless a future translation feature is explicitly added.
- Keep scoring action values stable internally, such as `apply`, `watch`, `maybe`, and `pass`, while localizing labels shown to the user.

Popup requirements:

- Clicking the extension toolbar icon should open a small settings panel.
- The panel should support common operations: language switching, opening/importing/updating the configured profile, preferred and avoided skills, minimum budget preferences, AI configured status, AI connection test, and a link to full settings.
- The popup must not expose or overwrite the stored API key.

### AI Integration

AI calls are optional and user-triggered for the MVP.

Supported tasks:

- summarize requirement intent
- interpret ambiguous risks
- suggest a proposal angle
- draft a short custom opener

Boundaries:

- Do not use AI for basic numeric threshold checks.
- Do not send Upwork credentials.
- Do not call AI automatically on every visible card in the first version.
- Keep prompts small and scoped to the opened job.
- Allow the user to disable AI completely.

### Storage And Privacy

Default persisted data:

- job id
- URL
- score snapshot
- tags
- saved user decision
- user notes
- scoring configuration

Short-lived data:

- full job description
- AI prompt inputs
- AI draft outputs unless the user explicitly saves them

Sensitive configuration:

- Treat API keys as sensitive.
- Do not expose API keys to content scripts when avoidable.
- Prefer service-worker mediated API calls.
- Consider a later local proxy or backend if API key handling becomes a release blocker.

## Suggested Project Structure

```text
src/
  manifest/
    manifest.json
  background/
    serviceWorker.ts
  content/
    upworkContentScript.ts
    parser/
      listParser.ts
      detailParser.ts
      normalizedJob.ts
    ui/
      badges.ts
      sidebar.ts
  scoring/
    scoreJob.ts
    defaultStrategy.ts
    types.ts
  ai/
    openaiCompatibleClient.ts
    prompts.ts
  storage/
    settingsStore.ts
    decisionStore.ts
  options/
    OptionsApp.tsx
  shared/
    messages.ts
    result.ts
```

This can be adjusted after choosing the build stack, but the ownership boundaries should stay similar: parsing, scoring, UI, storage, and AI should not be mixed together.

## Milestone Plan

### Milestone 0: Project Skeleton

- choose stack
- create extension manifest
- create content script entry
- create service worker entry
- create options page entry
- set up build, lint, formatting, and test commands
- document local load instructions for Chrome

### Milestone 1: Local Evaluation Prototype

- parse visible job cards
- render list badges
- implement default strategy config
- implement local scoring with reasons
- handle dynamic page updates

### Milestone 2: Detail Sidebar

- parse job detail page
- render detail sidebar
- show score breakdown and reasons
- support manual user decision save
- persist decision metadata locally

### Milestone 3: Configuration

- implement options page
- edit profile, skills, budgets, blacklists, and weights
- edit display language, with English selected by default
- validate configuration
- import/export strategy JSON if useful

### Milestone 4: Optional AI

- add OpenAI-compatible API settings
- route API calls through service worker
- implement requirement summary, risk interpretation, proposal angle, and opener draft
- add API error and rate-limit handling

### Milestone 5: Hardening

- add parser fixtures and scoring tests
- test on search list, saved search, and detail pages
- verify UI does not block native Upwork actions
- add privacy review checklist
- recheck current Upwork and Chrome Web Store policy boundaries before wider release

## Open Decisions

These should be decided before or during Milestone 0:

- Build stack: plain TypeScript, React, Vite, Plasmo, WXT, or another extension framework.
- Whether options/settings should use `chrome.storage.local`, `chrome.storage.sync`, or a split model.
- Whether API key persistence is acceptable for private local use.
- Whether AI results are ephemeral only or can be explicitly saved per job.
- Exact Upwork URL patterns and page variants to support first.
- Default scoring weights and action thresholds.
- Translation approach for UI strings: simple local dictionary first, browser locale fallback later if needed.
- Whether the extension is private/local-only first or intended for Chrome Web Store distribution.

## Acceptance Criteria For The First Usable Version

- Loading the unpacked extension adds badges to visible Upwork job cards.
- Opening a job detail page shows a useful evaluation sidebar.
- Scores are explainable through visible reasons.
- The user can save a manual decision for a job.
- The extension works without AI configured.
- Extension-owned UI can display in English by default and Chinese after changing settings.
- AI can be enabled later without changing the local scoring contract.
- No automatic applying, clicking, or background crawling is implemented.
- Full job descriptions are not stored durably by default.
