# Configuration

## Environment Variables

All configuration is done via `.env` file in the `agent/` directory.

```bash
cd agent
cp .env.example .env
# Edit .env with your credentials
```

## LLM Providers

### AWS Bedrock (Recommended for Enterprise)

```bash
LLM_PROVIDER=bedrock
LLM_MODEL=global.anthropic.claude-opus-4-6-v1

AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-east-1
```

**Available Models:**
| Model ID | Description |
|----------|-------------|
| `global.anthropic.claude-opus-4-6-v1` | Claude Opus 4.6 (latest, best quality) |
| `us.anthropic.claude-opus-4-20250514-v1:0` | Claude Opus 4 |
| `us.anthropic.claude-3-5-sonnet-20241022-v2:0` | Claude 3.5 Sonnet v2 |
| `us.anthropic.claude-3-5-haiku-20241022-v1:0` | Claude 3.5 Haiku (fast, cheap) |

**Note:** Bedrock uses inference profile format with `global.` or `us.` prefix.

---

### Anthropic (Direct API)

```bash
LLM_PROVIDER=anthropic
LLM_MODEL=claude-sonnet-4-20250514

ANTHROPIC_API_KEY=sk-ant-api03-...
```

**Available Models:**
| Model ID | Description |
|----------|-------------|
| `claude-opus-4-6-20250205` | Latest flagship, 1M context |
| `claude-opus-4-5-20250929` | Previous flagship |
| `claude-sonnet-4-20250514` | Balanced performance/cost |
| `claude-3-5-haiku-20241022` | Fast, cost-effective |

Get API key: https://console.anthropic.com/

---

### OpenAI

```bash
LLM_PROVIDER=openai
LLM_MODEL=gpt-4o

OPENAI_API_KEY=sk-...
```

**Available Models:**
| Model ID | Description |
|----------|-------------|
| `gpt-5` | Latest flagship |
| `gpt-4.1` | Improved GPT-4 |
| `gpt-4.1-mini` | Cost-effective |
| `gpt-4o` | Multimodal |
| `o3` | Reasoning, advanced |
| `o4-mini` | Reasoning, fast |

Get API key: https://platform.openai.com/api-keys

---

### Google Gemini

```bash
LLM_PROVIDER=gemini
LLM_MODEL=gemini-2.5-pro

GEMINI_API_KEY=...
```

**Available Models:**
| Model ID | Description |
|----------|-------------|
| `gemini-2.5-pro` | Latest flagship |
| `gemini-2.5-flash` | Fast, cost-effective |
| `gemini-2.0-flash` | Stable |
| `gemini-2.0-flash-lite` | Fastest, cheapest |

Get API key: https://aistudio.google.com/apikey

---

## Server Configuration

```bash
PORT=3456  # Server port (default: 3456)
```

---

## Switching Providers

To switch providers:

1. Edit `.env`:
   ```bash
   LLM_PROVIDER=bedrock  # or: anthropic, openai, gemini
   LLM_MODEL=global.anthropic.claude-opus-4-6-v1
   ```

2. Restart the server:
   ```bash
   npm start
   ```

3. Verify via CLI:
   ```bash
   npm run cli
   # Shows: 🤖 Provider: AWS Bedrock | Model: global.anthropic.claude-opus-4-6-v1
   ```

---

## Validating Configuration

### Via CLI

```bash
npm run cli
# On startup, shows provider and validates credentials
```

### Via API

```bash
curl http://localhost:3456/api/config/validate
```

Response:
```json
{
  "valid": true,
  "config": {
    "provider": "bedrock",
    "model": "global.anthropic.claude-opus-4-6-v1"
  }
}
```

---

## Troubleshooting

### "Missing API key" Error

```
Error: Missing API key: ANTHROPIC_API_KEY
```

**Fix:** Ensure the correct environment variable is set for your provider.

### Bedrock "Model ID invalid" Error

```
Error: The provided model identifier is invalid.
```

**Fix:** Use inference profile format:
- ❌ `anthropic.claude-3-5-sonnet-20241022-v2:0`
- ✅ `us.anthropic.claude-3-5-sonnet-20241022-v2:0`

### Bedrock "On-demand throughput not supported" Error

```
Error: Invocation of model ID ... with on-demand throughput isn't supported.
```

**Fix:** Use inference profile with `us.` or `global.` prefix:
- ✅ `global.anthropic.claude-opus-4-6-v1`
- ✅ `us.anthropic.claude-3-5-sonnet-20241022-v2:0`

### AWS Credentials Error

```
Error: Could not load credentials from any providers
```

**Fix:** Verify AWS credentials:
```bash
# Check credentials are set
echo $AWS_ACCESS_KEY_ID
echo $AWS_SECRET_ACCESS_KEY

# Or test with AWS CLI
aws sts get-caller-identity
```
