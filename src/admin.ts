import type { Request, Response, NextFunction } from 'express';
import { env } from './config.js';
import { getSettings, saveSettings, isConfigured, type Settings } from './settings.js';
import {
  setWebhook,
  getWebhook,
  getQrCode,
  getInstanceStatus,
  listGroups,
  type AvisaConfig,
} from './avisa.js';

/** HTTP Basic auth (user: admin, pass: ADMIN_PASSWORD) for the /admin routes. */
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

function avisaConfig(s: Settings): AvisaConfig {
  return { baseUrl: s.avisaBaseUrl, apiKey: s.avisaApiKey };
}

/** The webhook URL we want AvisaAPI to call, derived from publicBaseUrl + token. */
function expectedWebhookUrl(s: Settings): string | null {
  if (!s.publicBaseUrl) return null;
  return `${s.publicBaseUrl.replace(/\/$/, '')}/webhook/${env.webhookToken}`;
}

/** Register our webhook in AvisaAPI. Safe to call repeatedly. */
async function registerWebhook(s: Settings): Promise<{ ok: boolean; url?: string; error?: string }> {
  const url = expectedWebhookUrl(s);
  if (!url) return { ok: false, error: 'Public Base URL não configurada' };
  if (!s.avisaApiKey || !s.avisaBaseUrl) return { ok: false, error: 'AvisaAPI não configurada' };
  try {
    await setWebhook(avisaConfig(s), url);
    return { ok: true, url };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'falha' };
  }
}

function secretField(label: string, name: string, isSet: boolean): string {
  return `<label>${label}
    <input type="password" name="${name}" autocomplete="new-password"
      placeholder="${isSet ? '•••••••• (já configurada — deixe vazio p/ manter)' : 'não configurada'}">
  </label>`;
}

export function renderAdmin(saved = false, hook = ''): string {
  const s = getSettings();
  const ok = isConfigured(s);
  const expected = expectedWebhookUrl(s) ?? '(defina a Public Base URL)';
  const hookBanner =
    hook === 'ok' ? '<div class="status ok">Webhook registrado na AvisaAPI ✅</div>'
    : hook === 'err' ? '<div class="status warn">Não consegui registrar o webhook (confira AvisaAPI/Base URL).</div>'
    : '';
  return `<!doctype html><html lang="pt-br"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Integrações · idea-analyzer</title>
<style>
  :root{color-scheme:light}
  body{font-family:system-ui,sans-serif;max-width:660px;margin:2rem auto;padding:0 1rem;color:#222;background:#faf7f5}
  h1{font-size:1.4rem}h2{font-size:1.05rem;margin:.2rem 0}
  .status{padding:.6rem .9rem;border-radius:.6rem;margin:1rem 0;font-weight:600}
  .ok{background:#dcfce7;color:#166534}.warn{background:#fef9c3;color:#854d0e}.muted{background:#eee;color:#555}
  form{display:grid;gap:1rem;margin-top:1rem}
  label{display:grid;gap:.3rem;font-weight:600;font-size:.9rem}
  input[type=text],input[type=password],select{padding:.5rem .6rem;border:1px solid #d6cfc9;border-radius:.5rem;font-size:.95rem}
  .row{display:flex;gap:.5rem;align-items:center;font-weight:500}.row input{width:auto}
  fieldset{border:1px solid #e7ded8;border-radius:.7rem;padding:1rem;display:grid;gap:1rem;margin:0}
  legend{font-weight:700;padding:0 .4rem}
  button{background:#7c2d12;color:#fff;border:0;padding:.6rem 1.1rem;border-radius:.6rem;font-size:.95rem;cursor:pointer}
  button.sec{background:#e7ded8;color:#333}
  code{background:#efe9e4;padding:.1rem .3rem;border-radius:.3rem;font-size:.82rem;word-break:break-all}
  .hint{font-weight:400;color:#6b6b6b;font-size:.8rem}
  #qrbox img{width:240px;height:240px;border:1px solid #ddd;border-radius:.5rem;background:#fff}
  .panel{border:1px solid #e7ded8;border-radius:.7rem;padding:1rem;display:grid;gap:.8rem;margin-top:1.2rem}
</style></head><body>
<h1>⚙️ Integrações — idea-analyzer</h1>
${saved ? '<div class="status ok">Salvo ✅</div>' : ''}
${hookBanner}
<div class="status ${ok ? 'ok' : 'warn'}">${ok ? 'Chaves configuradas.' : 'Faltam chaves — preencha abaixo p/ ativar.'}</div>

<form method="post" action="/admin">
  <fieldset><legend>IA</legend>
    <label>Provedor <select name="llmProvider"><option value="openai" ${s.llmProvider === 'openai' ? 'selected' : ''}>OpenAI</option></select></label>
    <label>Modelo <input type="text" name="openaiModel" value="${esc(s.openaiModel)}"></label>
    ${secretField('OpenAI API Key', 'openaiApiKey', Boolean(s.openaiApiKey))}
    <label class="row"><input type="checkbox" name="openaiWebSearch" ${s.openaiWebSearch ? 'checked' : ''}> Busca web real (concorrentes/mercado)</label>
  </fieldset>
  <fieldset><legend>WhatsApp (AvisaAPI)</legend>
    <label>Base URL <input type="text" name="avisaBaseUrl" value="${esc(s.avisaBaseUrl)}"></label>
    ${secretField('AvisaAPI API Key', 'avisaApiKey', Boolean(s.avisaApiKey))}
    <label>Public Base URL (deste serviço) <span class="hint">p/ registrar o webhook, ex: <code>https://ideias.berrysystem.com.br</code></span>
      <input type="text" name="publicBaseUrl" value="${esc(s.publicBaseUrl)}"></label>
    <label>Grupo(s) permitido(s) — JIDs <span class="hint">vazio = qualquer grupo. Use o seletor abaixo após conectar.</span>
      <input type="text" id="groupAllowlist" name="groupAllowlist" value="${esc(s.groupAllowlist.join(', '))}"></label>
    <label class="row"><input type="checkbox" name="allowDirect" ${s.allowDirect ? 'checked' : ''}> Responder também em DMs</label>
  </fieldset>
  <button type="submit">Salvar</button>
  <p class="hint">Webhook esperado: <code>${esc(expected)}</code></p>
</form>

<div class="panel">
  <h2>📱 Conexão WhatsApp</h2>
  <div id="connStatus" class="status muted">Verificando…</div>
  <div id="qrbox"></div>
  <div class="row" style="flex-wrap:wrap;gap:.6rem">
    <button type="button" id="btnConnect" class="sec">Conectar / Gerar QR</button>
    <button type="button" id="btnWebhook" class="sec">Registrar webhook</button>
    <button type="button" id="btnGroups" class="sec">Listar grupos</button>
  </div>
  <label>Grupos do número <span class="hint">selecione p/ travar o allowlist</span>
    <select id="groupSelect"><option value="">— conecte e clique em Listar grupos —</option></select>
  </label>
</div>

<script>
const $ = (id) => document.getElementById(id);
async function jget(u){ const r = await fetch(u); return r.json(); }
async function jpost(u){ const r = await fetch(u,{method:'POST'}); return r.json(); }

async function refreshStatus(){
  const d = await jget('/admin/api/status');
  const c = d.connection || {};
  if (c.loggedIn){ $('connStatus').className='status ok'; $('connStatus').textContent='Conectado'+(c.phone?(' · '+c.phone):''); $('qrbox').innerHTML=''; }
  else { $('connStatus').className='status warn'; $('connStatus').textContent='Desconectado — gere o QR e escaneie'; }
  if (d.webhook){ const w=d.webhook; if(w.expected){ $('connStatus').title='webhook: '+(w.match?'ok':'divergente'); } }
  return c.loggedIn;
}
let polling=null;
async function connect(){
  $('qrbox').innerHTML='gerando QR…';
  const d = await jget('/admin/api/qr');
  if (d.status==='already_connected'){ $('qrbox').innerHTML=''; await refreshStatus(); return; }
  if (d.status!=='qr_ready'){ $('qrbox').innerHTML='<div class="status warn">'+(d.message||'erro ao gerar QR')+'</div>'; return; }
  $('qrbox').innerHTML='<img src="'+d.qrCode+'" alt="QR">';
  if (polling) clearInterval(polling);
  polling = setInterval(async()=>{ const on=await refreshStatus(); if(on){ clearInterval(polling); polling=null; await jpost('/admin/api/webhook'); await loadGroups(); } }, 3000);
}
async function loadGroups(){
  const gs = await jget('/admin/api/groups');
  const sel = $('groupSelect');
  sel.innerHTML = '<option value="">— escolher grupo —</option>' + gs.map(g=>'<option value="'+g.jid+'">'+(g.name||g.jid)+'</option>').join('');
}
$('btnConnect').onclick=connect;
$('btnWebhook').onclick=async()=>{ const d=await jpost('/admin/api/webhook'); $('connStatus').className='status '+(d.ok?'ok':'warn'); $('connStatus').textContent=d.ok?('Webhook registrado: '+d.url):('Webhook falhou: '+(d.error||'')); };
$('btnGroups').onclick=loadGroups;
$('groupSelect').onchange=(e)=>{ if(e.target.value) $('groupAllowlist').value = e.target.value; };
refreshStatus();
</script>
</body></html>`;
}

export async function handleSave(req: Request, res: Response): Promise<void> {
  const b = req.body as Record<string, string | undefined>;
  const patch: Partial<Settings> = {
    llmProvider: (b.llmProvider || 'openai').trim(),
    openaiModel: (b.openaiModel || 'gpt-4o').trim(),
    openaiWebSearch: b.openaiWebSearch === 'on',
    avisaBaseUrl: (b.avisaBaseUrl || '').trim(),
    publicBaseUrl: (b.publicBaseUrl || '').trim(),
    groupAllowlist: (b.groupAllowlist || '').split(',').map((x) => x.trim()).filter(Boolean),
    allowDirect: b.allowDirect === 'on',
  };
  if (b.openaiApiKey && b.openaiApiKey.trim()) patch.openaiApiKey = b.openaiApiKey.trim();
  if (b.avisaApiKey && b.avisaApiKey.trim()) patch.avisaApiKey = b.avisaApiKey.trim();
  const next = saveSettings(patch);

  // Auto-register the webhook in AvisaAPI when we have what we need.
  let hook = '';
  if (next.avisaApiKey && next.avisaBaseUrl && next.publicBaseUrl) {
    hook = (await registerWebhook(next)).ok ? 'ok' : 'err';
  }
  res.redirect(`/admin?saved=1&hook=${hook}`);
}

// --- JSON endpoints for the connection panel ---

export async function apiStatus(_req: Request, res: Response): Promise<void> {
  const s = getSettings();
  if (!s.avisaApiKey || !s.avisaBaseUrl) {
    res.json({ connection: { loggedIn: false }, webhook: null });
    return;
  }
  const [connection, current] = await Promise.all([getInstanceStatus(avisaConfig(s)), getWebhook(avisaConfig(s))]);
  const expected = expectedWebhookUrl(s);
  res.json({ connection, webhook: { current, expected, match: Boolean(expected && current === expected) } });
}

export async function apiQr(_req: Request, res: Response): Promise<void> {
  const s = getSettings();
  if (!s.avisaApiKey || !s.avisaBaseUrl) {
    res.json({ status: 'error', qrCode: null, message: 'AvisaAPI não configurada' });
    return;
  }
  res.json(await getQrCode(avisaConfig(s)));
}

export async function apiRegisterWebhook(_req: Request, res: Response): Promise<void> {
  res.json(await registerWebhook(getSettings()));
}

export async function apiGroups(_req: Request, res: Response): Promise<void> {
  const s = getSettings();
  if (!s.avisaApiKey || !s.avisaBaseUrl) {
    res.json([]);
    return;
  }
  res.json(await listGroups(avisaConfig(s)));
}
