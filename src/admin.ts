import type { Request, Response, NextFunction } from 'express';
import { env } from './config.js';
import { getSettings, saveSettings, isConfigured, type Settings } from './settings.js';

/** HTTP Basic auth (user: admin, pass: ADMIN_PASSWORD) for the /admin page. */
export function basicAuth(req: Request, res: Response, next: NextFunction): void {
  const hdr = req.headers.authorization ?? '';
  const [scheme, b64] = hdr.split(' ');
  if (scheme === 'Basic' && b64) {
    const [user, pass] = Buffer.from(b64, 'base64').toString('utf8').split(':');
    if (user === 'admin' && pass === env.adminPassword) {
      next();
      return;
    }
  }
  res.set('WWW-Authenticate', 'Basic realm="idea-analyzer admin"').status(401).send('Auth required');
}

function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

function secretField(label: string, name: string, isSet: boolean): string {
  return `<label>${label}
    <input type="password" name="${name}" autocomplete="new-password"
      placeholder="${isSet ? '•••••••• (já configurada — deixe vazio p/ manter)' : 'não configurada'}">
  </label>`;
}

export function renderAdmin(saved = false): string {
  const s = getSettings();
  const ok = isConfigured(s);
  return `<!doctype html><html lang="pt-br"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Integrações · idea-analyzer</title>
<style>
  :root{color-scheme:light}
  body{font-family:system-ui,sans-serif;max-width:640px;margin:2rem auto;padding:0 1rem;color:#222;background:#faf7f5}
  h1{font-size:1.4rem}
  .status{padding:.6rem .9rem;border-radius:.6rem;margin:1rem 0;font-weight:600}
  .ok{background:#dcfce7;color:#166534}.warn{background:#fef9c3;color:#854d0e}
  form{display:grid;gap:1rem;margin-top:1rem}
  label{display:grid;gap:.3rem;font-weight:600;font-size:.9rem}
  input[type=text],input[type=password],select{padding:.5rem .6rem;border:1px solid #d6cfc9;border-radius:.5rem;font-size:.95rem}
  .row{display:flex;gap:.5rem;align-items:center;font-weight:500}
  .row input{width:auto}
  fieldset{border:1px solid #e7ded8;border-radius:.7rem;padding:1rem;display:grid;gap:1rem}
  legend{font-weight:700;padding:0 .4rem}
  button{background:#7c2d12;color:#fff;border:0;padding:.7rem 1.2rem;border-radius:.6rem;font-size:1rem;cursor:pointer}
  code{background:#efe9e4;padding:.1rem .3rem;border-radius:.3rem;font-size:.85rem}
  .hint{font-weight:400;color:#6b6b6b;font-size:.8rem}
</style></head><body>
<h1>⚙️ Integrações — idea-analyzer</h1>
${saved ? '<div class="status ok">Salvo ✅</div>' : ''}
<div class="status ${ok ? 'ok' : 'warn'}">${ok ? 'Configurado e pronto.' : 'Faltam chaves — preencha abaixo p/ ativar o bot.'}</div>
<p class="hint">Webhook (AvisaAPI): <code>/webhook/${esc(env.webhookToken)}</code></p>
<form method="post" action="/admin">
  <fieldset><legend>IA</legend>
    <label>Provedor
      <select name="llmProvider">
        <option value="openai" ${s.llmProvider === 'openai' ? 'selected' : ''}>OpenAI</option>
      </select>
    </label>
    <label>Modelo <input type="text" name="openaiModel" value="${esc(s.openaiModel)}"></label>
    ${secretField('OpenAI API Key', 'openaiApiKey', Boolean(s.openaiApiKey))}
    <label class="row"><input type="checkbox" name="openaiWebSearch" ${s.openaiWebSearch ? 'checked' : ''}> Busca web real (concorrentes/mercado)</label>
  </fieldset>
  <fieldset><legend>WhatsApp (AvisaAPI)</legend>
    <label>Base URL <input type="text" name="avisaBaseUrl" value="${esc(s.avisaBaseUrl)}"></label>
    ${secretField('AvisaAPI API Key', 'avisaApiKey', Boolean(s.avisaApiKey))}
    <label>Grupo(s) permitido(s) — JIDs <span class="hint">separados por vírgula, ex: <code>123...@g.us</code>. Vazio = qualquer grupo.</span>
      <input type="text" name="groupAllowlist" value="${esc(s.groupAllowlist.join(', '))}"></label>
    <label class="row"><input type="checkbox" name="allowDirect" ${s.allowDirect ? 'checked' : ''}> Responder também em conversas diretas (DM)</label>
  </fieldset>
  <button type="submit">Salvar</button>
</form>
</body></html>`;
}

export function handleSave(req: Request, res: Response): void {
  const b = req.body as Record<string, string | undefined>;
  const patch: Partial<Settings> = {
    llmProvider: (b.llmProvider || 'openai').trim(),
    openaiModel: (b.openaiModel || 'gpt-4o').trim(),
    openaiWebSearch: b.openaiWebSearch === 'on',
    avisaBaseUrl: (b.avisaBaseUrl || '').trim(),
    groupAllowlist: (b.groupAllowlist || '').split(',').map((x) => x.trim()).filter(Boolean),
    allowDirect: b.allowDirect === 'on',
  };
  // Secrets: only overwrite when a non-empty value was typed.
  if (b.openaiApiKey && b.openaiApiKey.trim()) patch.openaiApiKey = b.openaiApiKey.trim();
  if (b.avisaApiKey && b.avisaApiKey.trim()) patch.avisaApiKey = b.avisaApiKey.trim();
  saveSettings(patch);
  res.redirect('/admin?saved=1');
}
