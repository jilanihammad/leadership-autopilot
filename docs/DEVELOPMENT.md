# Development Guide

## Setup

```bash
# Clone and install
cd leadership-autopilot/agent
npm install

# Configure
cp .env.example .env
# Edit .env with your LLM credentials

# Run
npm start        # Production server
npm run dev      # Development with auto-reload
npm run cli      # Interactive CLI
```

---

## Project Structure

```
agent/
├── server.js           # Express server, session management, API routes
├── llm.js              # Multi-provider LLM abstraction
├── tools.js            # Data extraction tools
├── cli.js              # Command-line interface
├── public/
│   └── index.html      # Web UI (single file)
├── SYSTEM_PROMPT.md    # Agent persona and instructions
├── ANALYSIS_FRAMEWORK.md # Analysis methodology
├── .env.example        # Configuration template
└── package.json
```

---

## Key Files

### server.js

Main entry point. Contains:
- Express server setup
- `AnalysisSession` class for session management
- API routes (`/api/ask`, `/api/ask/stream`, etc.)
- GL detection logic
- Context building

**Key functions:**
```javascript
class AnalysisSession {
  detectGL(question)           // Pattern match GL from question
  determineDataNeeds(question) // What data to load
  buildContext(week, gl, question, dataNeeds)  // Build LLM context
  handleQuery(question, week)  // Main query handler
}
```

### llm.js

LLM provider abstraction. Contains:
- Provider configurations (Anthropic, OpenAI, Gemini, Bedrock)
- `chat()` - Unified non-streaming call
- `chatStream()` - Unified streaming generator
- Provider-specific implementations

**Adding a new provider:**
```javascript
// 1. Add to PROVIDERS config
const PROVIDERS = {
  newprovider: {
    name: 'New Provider',
    envKey: 'NEW_PROVIDER_API_KEY',
    defaultModel: 'model-name',
    models: ['model-name', 'model-2'],
  },
};

// 2. Implement call function
async function callNewProvider(system, messages, options) {
  // ...
}

// 3. Implement stream function (optional)
async function* streamNewProvider(system, messages, options) {
  // ...
}

// 4. Add to chat() and chatStream() switch
```

### tools.js

Data extraction tools. All tools are deterministic (no LLM calls).

**Key functions:**
```javascript
listWeeks()                    // List available weeks
listGLs(week)                  // List GLs for a week
getSummary(week, gl)           // Get summary markdown
getAllSubcatData(week, gl)     // Get ALL subcat data (deterministic)
getMetricDrivers(week, gl, metric, options)  // Top drivers by CTC
getAsinDetail(week, gl, metric, options)     // ASIN-level detail
getTrafficChannels(week, gl, options)        // Traffic by channel
searchSubcats(week, gl, query) // Search for specific subcat
```

---

## Making Changes

### Modifying Response Format

1. Edit `agent/SYSTEM_PROMPT.md`
2. Update "Response Format" section
3. If changing WHAT/WHY format, also update `public/index.html`:
   - `renderStreamingResponse()` function
   - `renderFinalResponse()` function

### Adding New Metrics

1. Add Excel files to `data/weekly/{week}/gl/{gl}/`
2. Update `_manifest.yaml` to list the new files
3. If new column structure, update `tools.js`:
   - Add to `metricConfigs` in `getAllSubcatData()`
   - Handle in `getMetricDrivers()`

### Adding New GLs

1. Create directory: `data/weekly/{week}/gl/{newgl}/`
2. Add data files and manifest
3. GL will auto-appear in dropdown (fetched from `/api/gls/{week}`)
4. Optionally add GL profile to `knowledge/gl_profiles.yaml`

### Modifying UI

All UI is in `agent/public/index.html` (single file):
- CSS in `<style>` block
- HTML structure in `<body>`
- JavaScript in `<script>` block

---

## Testing

### Manual Testing

```bash
# Start server
npm start

# Test via CLI
npm run cli
> Why did PC grow?

# Test via curl
curl -X POST http://localhost:3456/api/ask \
  -H "Content-Type: application/json" \
  -d '{"question": "Why did PC grow?", "gl": "pc"}'
```

### Testing Tools

```bash
# Test tools directly
node -e "
const tools = require('./tools');
console.log(tools.listWeeks());
console.log(tools.getAllSubcatData('2026-wk05', 'pc'));
"
```

### Testing LLM

```bash
# Test LLM connection
node -e "
require('dotenv').config();
const llm = require('./llm');

async function test() {
  const config = llm.getConfig();
  console.log('Config:', config);
  
  llm.validateCredentials();
  console.log('Credentials: OK');
  
  const response = await llm.chat(
    'You are a helpful assistant.',
    [{ role: 'user', content: 'Say hello' }]
  );
  console.log('Response:', response);
}
test().catch(console.error);
"
```

---

## Debugging

### Enable Verbose Logging

```javascript
// In server.js, add before LLM call:
console.log('Context length:', dataContext.length);
console.log('Messages:', JSON.stringify(messages, null, 2));
```

### Check Session State

```bash
curl http://localhost:3456/api/session/web-123456789
```

### Check Data Loading

```javascript
// Add to buildContext():
console.log('Loaded subcats:', allData.subcats.length);
console.log('First subcat:', allData.subcats[0]);
```

---

## Common Issues

### "Port already in use"

```bash
# Find and kill process
lsof -i :3456
kill -9 <PID>

# Or use different port
PORT=3457 npm start
```

### "Module not found"

```bash
npm install
```

### Streaming not working

Check browser console for SSE errors. Ensure:
- Response headers are set correctly
- No proxy buffering (nginx: `proxy_buffering off`)

### Data not loading

1. Check file exists:
   ```bash
   ls data/weekly/2026-wk05/gl/pc/
   ```
2. Check manifest:
   ```bash
   cat data/weekly/2026-wk05/gl/pc/_manifest.yaml
   ```
3. Test tools directly:
   ```bash
   node tools.js get-summary 2026-wk05 pc
   ```

---

## Deployment

### Local Development

```bash
npm run dev  # Auto-reload on changes
```

### Production

```bash
npm start
# Or with PM2:
pm2 start server.js --name leadership-autopilot
```

### Environment Variables

Ensure `.env` is set in production:
```bash
LLM_PROVIDER=bedrock
LLM_MODEL=global.anthropic.claude-opus-4-6-v1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-east-1
PORT=3456
```

---

## Git Workflow

```bash
# Make changes
git add .
git commit -m "feat: description"
git push origin main
```

### Commit Message Format

```
feat: Add new feature
fix: Fix bug
docs: Update documentation
refactor: Code refactoring
chore: Maintenance tasks
```
