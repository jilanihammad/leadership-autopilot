# Leadership Autopilot — Spec (v0)

## Goal
Generate a **weekly Monday 10:00am PT** leadership update that is:
- short, skimmable, leadership-ready
- grounded in real metrics (with links/citations)
- focused on:
  - **Topline performance** at **GL** level
  - **Top driving ASINs** + **top declining ASINs** (and/or sub-category)
  - **Bottom-line (NPPM)** performance by GL + callouts of declining ASINs/sub-categories
  - **AI strategy** updates
  - **Agentic workflow buildout status + performance** of existing workflows
- delivered via **Slack + email**

## Hard Constraints / Guardrails
- Do **not** include content from private Slack messages.
  - Only use approved sources: designated Slack channels, GitHub repos, Asana projects, SIM ticket system.
- Keep PII/customer data out of the summary.
- Every non-obvious claim should have a link/citation to its source artifact (Asana task, GitHub PR, SIM ticket, dashboard URL).

## Inputs (Sources)
1) Slack
   - Allowed: specific channels you designate (e.g., #weekly-biz-review, #agentic-workflows)
   - Use: announcements, status posts, weekly metrics summaries, launch notes
2) GitHub
   - Allowed: specific org/repos
   - Use: merged PRs, releases/tags, issues closed, workflows run results
3) Asana
   - Allowed: specific project(s)
   - Use: completed milestones, blocked tasks, status updates
4) SIM ticket system
   - Allowed: specific queues / saved searches
   - Use: open/closed counts, high severity items, recurring themes
5) Business Metrics
   - You referenced GL/ASIN/NPPM metrics. These need a data source:
   - Option A: internal dashboard URLs (manually provided)
   - Option B: CSV export dropped into a folder
   - Option C: API endpoint

## Output Format (Slack + Email)
Single message (<= ~2500 chars) + optionally a longer “appendix” link.

**Template**
- Header: Week of <date>
- Topline (GL)
  - 2–4 bullets: biggest movers, driver hypotheses, links
- Top ASIN Drivers
  - 3–5 bullets: ASIN + delta + why + link
- Top ASIN Decliners
  - 3–5 bullets: ASIN + delta + likely cause + next action + link
- NPPM (GL)
  - 2–4 bullets: movers + margin drivers + link
- Margin Risks / Fixes
  - 2–3 bullets: what could hurt NPPM next week + mitigation
- AI Strategy
  - 2–3 bullets: bets, experiments, decisions needed
- Agentic Workflows
  - Buildout: 2–3 bullets (what shipped / what’s next)
  - Performance: 2–3 bullets (usage, time saved, failure rate, top issues)
- Asks / Decisions
  - 1–3 bullets: what leadership should decide/unblock

## Key Computations (v0)
### 1) Identify top movers (GL)
- Sort GLs by WoW delta (topline, NPPM)
- Pick top + bottom N

### 2) Identify top movers (ASIN)
- Rank ASINs by contribution (drivers) and negative contribution (decliners)
- Include delta + impact + a short driver explanation if available

### 3) Workflow performance summary
- For each workflow: runs/week, success rate, avg duration, time saved estimate, top error causes

## System Design (Two Implementations)
### A) n8n-first
- Schedule trigger: Mondays 10am PT
- Collectors:
  - Slack: channel history for approved channels
  - GitHub: PRs merged since last Monday
  - Asana: tasks completed/blocked since last Monday
  - SIM: tickets created/closed since last Monday
  - Metrics: from dashboard/API/CSV
- LLM steps:
  - Normalize into JSON schema
  - Draft summary
  - Self-check: missing citations? too long? mentions private? (re-write)
- Delivery:
  - Post to Slack + send email

### B) Custom agent service
- A small HTTP service with endpoints:
  - POST /runWeeklyUpdate { since, until, sources, recipients }
  - returns { slackText, emailSubject, emailText, citations[] }
- n8n calls it; agent handles reasoning, formatting, and validation.

## Open Questions (need answers to finalize)
1) What is the **source of GL/ASIN/NPPM** metrics? (dashboard URL, CSV, API?)
2) Which **Slack channels** are allowed? Which Slack workspace?
3) Which **GitHub repos** are in-scope?
4) Which **Asana project(s)** and which fields matter?
5) SIM ticket system: how do we query it (API? export? webhook?)
6) Email: Gmail/Google Workspace? Outlook? (how should we send?)
