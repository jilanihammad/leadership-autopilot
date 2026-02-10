# Leadership Autopilot

AI-powered Weekly Business Review (WBR) analysis assistant. Ask natural language questions about your business metrics and get instant, data-backed insights.

## Quick Start

```bash
# 1. Start the backend API (port 3456)
cd agent
cp .env.example .env
# Edit .env with your LLM credentials
npm install
npm start

# 2. Start the dashboard (port 3000) - in a new terminal
cd dashboard
npm install --legacy-peer-deps
npm run dev

# 3. Open http://localhost:3000
```

## Features

- **Natural Language Queries**: "Why did PC GMS grow this week?"
- **Multi-Provider LLM Support**: Anthropic, OpenAI, Gemini, AWS Bedrock
- **Streaming Responses**: See insights immediately, details load progressively
- **WHAT/WHY Format**: Key insights first, detailed analysis expandable
- **Executive Dashboard**: Clean, modern UI with metric cards and context panels
- **GL/Week Selection**: Quick context switching between business units and time periods

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Dashboard (Next.js)                       │
│                    http://localhost:3000                     │
│  ┌─────────┐  ┌──────────────────┐  ┌─────────────────────┐ │
│  │ Sidebar │  │   Metric Cards   │  │   Context Panel    │ │
│  │ GL/Week │  │   GMS/Units/ASP  │  │   Movers/Alerts    │ │
│  └─────────┘  └──────────────────┘  └─────────────────────┘ │
│              ┌──────────────────────────────────────────┐   │
│              │           Chat Interface                  │   │
│              │     Streaming AI Analysis                 │   │
│              └──────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ API Calls
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   Backend API (Express)                      │
│                   http://localhost:3456                      │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────┐  │
│  │   Routes    │  │  LLM Layer   │  │   Data Tools       │  │
│  │  /api/ask   │  │  Multi-model │  │  Excel extraction  │  │
│  └─────────────┘  └──────────────┘  └────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      Data Layer                              │
│   data/weekly/2026-wk05/gl/pc/*.xlsx                        │
│   knowledge/*.yaml (causal rules, profiles)                  │
└─────────────────────────────────────────────────────────────┘
```

## Project Structure

```
leadership-autopilot/
├── dashboard/                # Next.js Dashboard UI
│   ├── app/                 # App router pages
│   ├── components/          # React components
│   │   ├── chat-interface.tsx
│   │   ├── metric-cards.tsx
│   │   ├── left-sidebar.tsx
│   │   └── right-sidebar.tsx
│   └── lib/                 # API client, context, types
│       ├── api.ts
│       ├── dashboard-context.tsx
│       └── types.ts
├── agent/                    # Backend API
│   ├── server.js            # Express server + session management
│   ├── llm.js               # Multi-provider LLM abstraction
│   ├── tools.js             # Data extraction tools
│   ├── cli.js               # Command-line interface
│   ├── SYSTEM_PROMPT.md     # Agent persona
│   └── ANALYSIS_FRAMEWORK.md # Analysis methodology
├── data/                     # WBR data files
│   └── weekly/
│       └── 2026-wk05/gl/pc/  # GL-specific Excel files
├── knowledge/                # Domain knowledge
│   ├── causal_rules.yaml    # Root cause patterns
│   ├── gl_profiles.yaml     # GL characteristics
│   └── metric_aliases.yaml  # Metric terminology
└── docs/                     # Documentation
```

## Documentation

| Document | Description |
|----------|-------------|
| [ARCHITECTURE-V2.md](./ARCHITECTURE-V2.md) | Detailed system design |
| [docs/API.md](./docs/API.md) | REST API endpoints |
| [agent/TOOLS.md](./agent/TOOLS.md) | Data extraction tools |
| [MEMORY.md](./MEMORY.md) | Memory system design |

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/weeks` | GET | List available weeks |
| `/api/gls/:week` | GET | List GLs for a week |
| `/api/ask/stream` | POST | Streaming chat (SSE) |
| `/api/session/:id/reset` | POST | Reset session |

## Environment Variables

**Backend (.env in agent/):**
```bash
# Pick one LLM provider
ANTHROPIC_API_KEY=sk-ant-...
# or
OPENAI_API_KEY=sk-...
# or
AWS_REGION=us-east-1  # for Bedrock
```

**Dashboard (.env.local in dashboard/):**
```bash
NEXT_PUBLIC_API_URL=http://localhost:3456
```

## License

Private - Internal use only.
