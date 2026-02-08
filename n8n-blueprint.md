# n8n Blueprint — Leadership Autopilot (v0)

Goal: run every **Monday 10:00am America/Los_Angeles**, gather signals, generate a concise leadership update, deliver to **Slack + email**.

## Node Map (high level)
1) **Cron Trigger**
   - Schedule: 10:00 Mondays, TZ America/Los_Angeles

2) **Set Window**
   - Compute: since = previous Monday 00:00 PT, until = now

3) **Collect: Slack (approved channels only)**
   - Slack node: conversation.history per channel
   - Inputs: channel IDs allowlist
   - Output: messages[] (strip user DMs entirely)

4) **Collect: GitHub**
   - GitHub node: search PRs merged in window (repo allowlist)
   - Output: prs[] with url, title, mergedAt, labels

5) **Collect: Asana**
   - Asana node: tasks in project(s) updated/completed in window
   - Output: tasks[] with url, status, assignee, due

6) **Collect: SIM tickets**
   - Placeholder node: HTTP Request (depends on SIM API/export)
   - Output: tickets[] with id, severity, status, url, summary

7) **Collect: Metrics (GL/ASIN/NPPM)**
   - Option A: HTTP Request to internal metrics API
   - Option B: Read from Google Sheet / CSV in Drive
   - Output schema:
     - glTopline[] { gl, wowDelta, value, link }
     - glNppm[] { gl, wowDelta, value, link }
     - asinDrivers[] { asin, impact, wowDelta, gl, link }
     - asinDecliners[] { asin, impact, wowDelta, gl, link }

8) **Normalize to JSON (LLM) — "facts extractor"**
   - Prompt: convert all raw inputs into a single strict JSON object.
   - Enforce citations/links.

9) **Draft Update (LLM) — "writer"**
   - Prompt: produce the weekly update using the required template, concise bullets, no private content.

10) **Self-check / Guardrail pass (LLM) — "auditor"**
   - Checks:
     - contains any DM/private content? (must be NO)
     - missing citations for claims?
     - too long?
     - does it include required sections?
   - If issues: return revised text + issue list.

11) **Deliver: Slack**
   - Slack node: post message to target channel or DM to manager

12) **Deliver: Email**
   - Gmail/SMTP node: send email

## Prompts (v0)
### (8) Facts Extractor Prompt (sketch)
- Input: Slack msgs (channel-only), PRs, Asana tasks, SIM tickets, metrics
- Output: STRICT JSON with these top-level keys:
  - topline, nppm, asinDrivers, asinDecliners, aiStrategy, workflows, risks, asks, citations

### (9) Writer Prompt (sketch)
- Output <= 2500 chars, bullets, section headers.
- Must include topline by GL, ASIN drivers/decliners, NPPM by GL, AI strategy, agentic workflows status/perf.
- Include citations as inline links.

### (10) Auditor Prompt (sketch)
Return JSON:
- ok: boolean
- issues: string[]
- revisedText: string

## Secrets / Config
- Slack OAuth token with **channel history** scope for allowed channels
- GitHub token (repo read)
- Asana token (project read)
- SIM API token (TBD)
- Metrics source credentials (TBD)

## MVP Decision Points
- The *metrics source* is the gating item. Without GL/ASIN/NPPM inputs, we can still draft the “AI strategy + agentic workflows status” portion, but the business performance section will be weak.
