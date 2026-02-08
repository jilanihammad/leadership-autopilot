# API Reference

Base URL: `http://localhost:3456`

## Endpoints

### POST /api/ask

Non-streaming question endpoint.

**Request:**
```json
{
  "question": "Why did PC GMS grow?",
  "sessionId": "web-123456789",
  "week": "2026-wk05",
  "gl": "pc"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| question | string | Yes | Natural language question |
| sessionId | string | No | Session identifier (default: "default") |
| week | string | No | Week to analyze (default: latest) |
| gl | string | No | GL to analyze (default: auto-detect) |

**Response:**
```json
{
  "response": "**WHAT:**\n- PC GMS grew +66% YoY...\n\n**WHY:**\n...",
  "gl": "pc",
  "week": "2026-wk05"
}
```

---

### POST /api/ask/stream

Streaming question endpoint (Server-Sent Events).

**Request:** Same as `/api/ask`

**Response:** SSE stream with events:

```
data: {"type": "content", "text": "**WHAT:**"}

data: {"type": "content", "text": "\n- PC GMS grew"}

data: {"type": "content", "text": " +66% YoY..."}

data: {"type": "done", "gl": "pc", "week": "2026-wk05"}
```

**Event Types:**

| Type | Description |
|------|-------------|
| content | Partial response text |
| done | Stream complete, includes gl and week |
| error | Error occurred |

---

### GET /api/weeks

List available weeks of data.

**Response:**
```json
{
  "weeks": ["2026-wk05", "2026-wk04", "2026-wk03"]
}
```

---

### GET /api/gls/:week

List available GLs for a given week.

**Request:**
```
GET /api/gls/2026-wk05
```

**Response:**
```json
{
  "gls": [
    {
      "name": "pc",
      "metrics": ["GMS", "ShippedUnits", "ASP", "NetPPMLessSD", "CM"]
    },
    {
      "name": "toys",
      "metrics": ["GMS", "ShippedUnits", "ASP"]
    }
  ]
}
```

---

### GET /api/session/:sessionId

Get session state.

**Response:**
```json
{
  "currentGL": "pc",
  "currentWeek": "2026-wk05",
  "historyLength": 4
}
```

---

### POST /api/session/:sessionId/reset

Reset a session (clear history and context).

**Response:**
```json
{
  "success": true
}
```

---

### GET /api/config

Get current LLM configuration.

**Response:**
```json
{
  "config": {
    "provider": "bedrock",
    "providerName": "AWS Bedrock",
    "model": "global.anthropic.claude-opus-4-6-v1",
    "availableModels": [
      "global.anthropic.claude-opus-4-6-v1",
      "us.anthropic.claude-opus-4-20250514-v1:0"
    ]
  },
  "providers": [
    {
      "id": "anthropic",
      "name": "Anthropic",
      "configured": false
    },
    {
      "id": "bedrock",
      "name": "AWS Bedrock",
      "configured": true
    }
  ]
}
```

---

### GET /api/providers

List all available LLM providers.

**Response:**
```json
[
  {
    "id": "anthropic",
    "name": "Anthropic",
    "models": ["claude-opus-4-6-20250205", "claude-sonnet-4-20250514"],
    "defaultModel": "claude-sonnet-4-20250514",
    "configured": false
  },
  {
    "id": "bedrock",
    "name": "AWS Bedrock",
    "models": ["global.anthropic.claude-opus-4-6-v1"],
    "defaultModel": "global.anthropic.claude-opus-4-6-v1",
    "configured": true
  }
]
```

---

### POST /api/config/validate

Validate LLM credentials.

**Response (success):**
```json
{
  "valid": true,
  "config": {
    "provider": "bedrock",
    "model": "global.anthropic.claude-opus-4-6-v1"
  }
}
```

**Response (failure):**
```json
{
  "valid": false,
  "error": "Missing API key: ANTHROPIC_API_KEY"
}
```

---

## Error Handling

All endpoints return errors in this format:

```json
{
  "error": "Error message describing what went wrong"
}
```

HTTP Status Codes:
- `200` - Success
- `400` - Bad request (missing required fields)
- `500` - Server error

---

## Usage Examples

### JavaScript (Fetch)

```javascript
// Non-streaming
const response = await fetch('/api/ask', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    question: 'Why did PC grow?',
    sessionId: 'my-session',
  }),
});
const data = await response.json();
console.log(data.response);
```

### JavaScript (Streaming)

```javascript
const response = await fetch('/api/ask/stream', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ question: 'Why did PC grow?' }),
});

const reader = response.body.getReader();
const decoder = new TextDecoder();

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  
  const chunk = decoder.decode(value);
  const lines = chunk.split('\n');
  
  for (const line of lines) {
    if (line.startsWith('data: ')) {
      const event = JSON.parse(line.slice(6));
      if (event.type === 'content') {
        process.stdout.write(event.text);
      }
    }
  }
}
```

### cURL

```bash
# Non-streaming
curl -X POST http://localhost:3456/api/ask \
  -H "Content-Type: application/json" \
  -d '{"question": "Why did PC grow?", "gl": "pc"}'

# Streaming
curl -X POST http://localhost:3456/api/ask/stream \
  -H "Content-Type: application/json" \
  -d '{"question": "Why did PC grow?"}'
```
