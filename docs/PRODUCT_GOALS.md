# Product Goals

## Problem

Upwork has too much job information to scan manually. The user needs help deciding which jobs are worth attention, which ones to skip, and what proposal angle to use when applying.

The useful surface is the Upwork page itself: the user is already browsing job lists and detail pages, so evaluation should appear in context instead of requiring a separate agent workflow.

## Product Shape

Build a Chrome extension that augments Upwork pages with evaluation signals.

The extension should act as a decision assistant:

- make good opportunities visually obvious
- explain why a job is worth applying to or skipping
- highlight client, competition, budget, and scope signals
- draft proposal angles when needed
- leave the final application decision to the user

## Evaluation Dimensions

### Match

How well the job fits the freelancer.

Inputs may include:

- required skills and tools
- project type
- domain fit
- budget or hourly range
- expected seniority
- time zone and communication requirements
- excluded keywords or categories

### Client Quality

How likely the client is to be worth working with.

Inputs may include:

- payment verification
- historical spend
- client rating
- number of reviews
- hire rate
- average hourly rate paid
- recent activity
- clarity and professionalism of the job post

### Competition

How hard the job may be to win.

Inputs may include:

- posting age
- proposal count
- interview count
- invite count
- whether the job is already actively interviewing
- whether the job appears stale

### Risk

How likely the job is to waste time or create trouble.

Signals may include:

- vague scope
- unrealistic budget
- unpaid test requests
- off-platform communication or payment requests
- broad keyword stuffing
- excessive requirements for a small budget
- mismatch between required seniority and budget

### Recommended Action

The extension should collapse the score into a simple action:

- `apply`: strong fit, acceptable competition, low risk
- `watch`: promising but missing important information
- `maybe`: needs manual review
- `pass`: weak fit or high risk

## UI Goals

### Job List

Each visible job card should receive compact badges:

- overall score
- match score
- client quality
- competition
- risk
- recommended action

The list view should make scanning faster without covering important Upwork controls.

Client history is also useful context, but it must not be confused with the current job. When a job detail page shows client history, each recent-history item should be scored separately with a visible `History` context label. The first version should score up to the latest 10 visible history entries and update after the user expands more history items.

### Job Detail

The detail page should show a sidebar with:

- decision summary
- score breakdown
- strongest reasons to apply
- strongest reasons to skip
- risk notes
- suggested proposal angle
- optional AI-generated opening draft

### Language

The extension UI should support both English and Chinese display text.

English should be the default display language. The user should be able to switch to Chinese in settings.

### Toolbar Popup

The extension icon should open a small operational settings panel for frequent actions:

- switch language
- open the configured freelancer profile URL
- import or update the current freelancer profile
- adjust common matching preferences
- see whether AI is configured
- test the configured AI connection
- open the full options page

## Configuration

The user should be able to configure:

- API base URL
- API key
- model name
- freelancer profile summary
- freelancer profile URL and imported profile snapshot
- preferred skills
- avoided skills or categories
- minimum hourly rate
- minimum fixed budget
- preferred project types
- blacklisted phrases
- scoring weights
- display language, with English as the default and Chinese as an option

The scoring policy should live in editable local configuration where practical.

The user's own Upwork profile should be a first-class matching input. The extension should be able to open a configured Upwork freelancer profile URL, initialize from the visible profile page, and merge profile skills into matching preferences without deleting manual overrides.

## Data Handling

The extension should be conservative with Upwork data.

For the first version:

- parse only pages the user has actively opened
- avoid background crawling
- avoid bulk extraction
- store only job id, URL, scores, tags, notes, and user decision by default
- treat full job descriptions as short-lived input for analysis rather than durable data
- do not store Upwork credentials

Before implementing any data-heavy behavior, recheck the current Upwork API and site policy boundaries.

## AI Usage

Use AI only where deterministic rules are weak:

- interpret ambiguous requirements
- summarize job intent
- detect subtle risks
- generate proposal angles
- draft short custom proposal openers

Do not use AI for simple threshold checks that local rules can handle.

The remote model API should be OpenAI-compatible so the backend can be swapped later.

## Later MCP Direction

An MCP server can be added after the browser workflow stabilizes.

Potential future MCP tools:

- search reviewed jobs
- summarize recent decisions
- compare proposal outcomes
- generate reusable portfolio snippets
- sync accepted decisions into a broader job-search workflow

MCP is intentionally not part of the first milestone.
