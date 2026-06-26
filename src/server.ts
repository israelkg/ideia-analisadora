import express from 'express';
import { config } from './config.js';
import { handleInbound, analyzeIdea } from './analyzer.js';

const app = express();
app.use(express.json({ limit: '2mb' }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', provider: config.llm.provider });
});

/**
 * AvisaAPI webhook. Respond 200 immediately, then process async so a slow LLM
 * call never makes the gateway retry/time out.
 */
app.post('/webhook/:token', (req, res) => {
  if (req.params.token !== config.webhookToken) {
    res.status(404).end();
    return;
  }
  res.status(200).json({ ok: true });
  handleInbound(req.body)
    .then((status) => console.log(`[webhook] ${status}`))
    .catch((err) => console.error('[webhook] failed:', err instanceof Error ? err.message : err));
});

/** Manual test endpoint — analyze an idea without WhatsApp. */
app.post('/analyze', async (req, res) => {
  const idea = typeof req.body?.idea === 'string' ? req.body.idea : '';
  if (idea.trim().length < 8) {
    res.status(400).json({ error: 'idea too short' });
    return;
  }
  try {
    const text = await analyzeIdea(idea, req.body?.author);
    res.json({ text });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'failed' });
  }
});

app.listen(config.port, () => {
  console.log(`idea-analyzer listening on :${config.port} (provider: ${config.llm.provider})`);
  console.log(`webhook path: POST /webhook/${config.webhookToken}`);
});
