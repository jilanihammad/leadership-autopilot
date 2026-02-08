# Leadership Autopilot

AI-powered Weekly Business Review (WBR) analysis assistant. Ask natural language questions about your business metrics and get instant, data-backed insights.

## Quick Start

```bash
cd agent
cp .env.example .env
# Edit .env with your LLM credentials
npm install
npm start
# Open http://localhost:3456
```

## Features

- **Natural Language Queries**: "Why did PC GMS grow this week?"
- **Multi-Provider LLM Support**: Anthropic, OpenAI, Gemini, AWS Bedrock
- **Streaming Responses**: See insights immediately, details load progressively
- **WHAT/WHY Format**: Key insights first, detailed analysis expandable
- **GL Dropdown Filter**: Quick context switching between business units
- **Deterministic Data Loading**: All subcat data always available

## Documentation

| Document | Description |
|----------|-------------|
| [ARCHITECTURE.md](./docs/ARCHITECTURE.md) | System design and data flow |
| [API.md](./docs/API.md) | REST API endpoints |
| [TOOLS.md](./agent/TOOLS.md) | Data extraction tools |
| [PROMPTS.md](./docs/PROMPTS.md) | System prompts and analysis framework |
| [CONFIGURATION.md](./docs/CONFIGURATION.md) | LLM providers and settings |

## Project Structure

```
leadership-autopilot/
├── agent/                    # Main application
│   ├── server.js            # Express server + session management
│   ├── llm.js               # Multi-provider LLM abstraction
│   ├── tools.js             # Data extraction tools
│   ├── cli.js               # Command-line interface
│   ├── public/index.html    # Web UI
│   ├── SYSTEM_PROMPT.md     # Agent persona and instructions
│   ├── ANALYSIS_FRAMEWORK.md # Analysis methodology
│   └── .env.example         # Configuration template
├── data/                     # WBR data files
│   └── weekly/
│       └── 2026-wk05/
│           └── gl/
│               └── pc/       # GL-specific data
├── knowledge/                # Domain knowledge
│   ├── causal_rules.yaml    # Root cause patterns
│   ├── gl_profiles.yaml     # GL characteristics
│   └── metric_aliases.yaml  # Metric terminology
├── scripts/                  # Utilities
│   └── generate_summary.js  # Auto-generate GL summaries
└── docs/                     # Documentation
```

## License

Private - Internal use only.
