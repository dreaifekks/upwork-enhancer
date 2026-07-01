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

## Non-Goals For The First Version

- No automatic proposal submission.
- No automatic clicking or Upwork workflow automation.
- No background crawling of search result pages.
- No password collection or session proxying.
- No long-term storage of full Upwork job content unless the policy boundary is rechecked.
- No MCP interface until the browsing workflow and scoring strategy are stable.

## Project Docs

- [Product goals](docs/PRODUCT_GOALS.md)
