import express from 'express';
import { env } from './config.js';
import { getSettings, isConfigured } from './settings.js';
import { handleInbound, analyzeIdea } from './analyzer.js';
import {
  basicAuth,
  renderAdmin,
  handleSave,
  apiStatus,
  apiQr,
  apiRegisterWebhook,
  apiGroups,
} from './admin.js';

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false }));

app.get('/health', (_req, res) => {
  const s = getSettings();
  res.json({ status: 'ok', provider: s.llmProvider, configured: isConfigured(s) });
});

// --- Integrações (admin) ---
app.get('/admin', basicAuth, (req, res) => {
  res.type('html').send(renderAdmin(req.query.saved === '1', String(req.query.hook ?? '')));
});
app.post('/admin', basicAuth, handleSave);
app.get('/admin/api/status', basicAuth, apiStatus);
app.get('/admin/api/qr', basicAuth, apiQr);
app.post('/admin/api/webhook', basicAuth, apiRegisterWebhook);
app.get('/admin/api/groups', basicAuth, apiGroups);

/**
 * AvisaAPI webhook. Respond 200 immediately, then process async so a slow LLM
 * call never makes the gateway retry/time out.
 */
app.post('/webhook/:token', (req, res) => {
  if (req.params.token !== env.webhookToken) {
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

app.listen(env.port, () => {
  console.log(`idea-analyzer listening on :${env.port}`);
  console.log(`admin/integrações: GET /admin   ·   webhook: POST /webhook/${env.webhookToken}`);
});
