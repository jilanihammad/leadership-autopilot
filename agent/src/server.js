import http from 'http';

const PORT = process.env.PORT || 8787;

function json(res, status, body) {
  const s = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(s)
  });
  res.end(s);
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    return json(res, 200, { ok: true });
  }

  if (req.method === 'POST' && req.url === '/runWeeklyUpdate') {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', async () => {
      let payload;
      try {
        payload = JSON.parse(raw || '{}');
      } catch {
        return json(res, 400, { ok: false, error: 'invalid_json' });
      }

      // Placeholder: this is where we will implement connectors + LLM calls.
      // For now, return a deterministic stub so n8n integration can be tested.
      const since = payload.since || null;
      const until = payload.until || null;

      return json(res, 200, {
        ok: true,
        since,
        until,
        slackText: "Weekly update stub (connectors not wired yet).",
        emailSubject: "Weekly update (stub)",
        emailText: "Weekly update stub (connectors not wired yet).",
        citations: []
      });
    });
    return;
  }

  json(res, 404, { ok: false, error: 'not_found' });
});

server.listen(PORT, () => {
  console.log(`leadership-autopilot-agent listening on :${PORT}`);
});
