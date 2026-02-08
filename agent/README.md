# leadership-autopilot-agent (v0)

This is the custom-agent implementation of the Leadership Autopilot.

## What it does
- Pulls data from approved sources (Slack channels, GitHub repos, Asana projects, SIM tickets, metrics source)
- Produces:
  - Slack-ready weekly update text
  - Email subject + body
  - citations list
- Enforces guardrails (no private/DM data, citations required, concise)

## Running model
- The agent will be invoked by n8n via HTTP.
- Endpoint: POST /runWeeklyUpdate

## TODO (wired once you provide details)
- Slack channel allowlist + token
- GitHub repo allowlist + token
- Asana project IDs + token
- SIM ticket API details
- Metrics source (API/CSV/dashboard)
- Email delivery method (Gmail/SMTP/Outlook)
