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

/** Effective public origin: per-settings override, else infra env. */
function publicBase(s: Settings): string {
  return (s.publicBaseUrl || env.publicBaseUrl || '').replace(/\/$/, '');
}

/** The webhook URL we want AvisaAPI to call, derived from publicBaseUrl + token. */
function expectedWebhookUrl(s: Settings): string | null {
  const base = publicBase(s);
  return base ? `${base}/webhook/${env.webhookToken}` : null;
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

function secretRow(label: string, name: string, isSet: boolean): string {
  const chip = isSet
    ? '<span class="chip chip-ok">configurada</span>'
    : '<span class="chip chip-off">não configurada</span>';
  return `<div class="field">
    <div class="field-head"><label for="${name}">${label}</label>${chip}</div>
    <input id="${name}" type="password" name="${name}" autocomplete="new-password"
      placeholder="${isSet ? '•••••••• — deixe vazio para manter' : 'cole a chave aqui'}">
  </div>`;
}

export function renderAdmin(saved = false, hook = ''): string {
  const s = getSettings();
  const ok = isConfigured(s);
  const expected = expectedWebhookUrl(s) ?? '(defina a Public Base URL)';
  const toast =
    saved && hook === 'ok' ? 'Salvo e webhook registrado ✅'
    : saved && hook === 'err' ? 'Salvo, mas o webhook falhou — confira a AvisaAPI/Base URL'
    : saved ? 'Salvo ✅'
    : '';
  return `<!doctype html><html lang="pt-br"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Integrações · idea-analyzer</title>
<style>
  :root{
    --bg:#0f1117;--card:#171a23;--card2:#1d212c;--bd:#2a2f3d;--bd2:#353b4d;
    --txt:#e7e9ee;--mut:#9aa1b2;--pri:#7c5cff;--pri2:#9d86ff;
    --ok:#22c55e;--okbg:#10301d;--warn:#f59e0b;--warnbg:#33260a;--err:#f43f5e;--errbg:#33121c;
    color-scheme:dark;
  }
  *{box-sizing:border-box}
  body{font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;margin:0;
    color:var(--txt);background:radial-gradient(1200px 600px at 50% -10%,#1a1d2b,var(--bg));min-height:100vh}
  .wrap{max-width:720px;margin:0 auto;padding:2rem 1.1rem 5rem}
  header.top{display:flex;align-items:center;gap:.8rem;margin-bottom:1.4rem}
  .logo{width:42px;height:42px;border-radius:12px;display:grid;place-items:center;font-size:1.4rem;
    background:linear-gradient(135deg,var(--pri),#4f3bd1);box-shadow:0 6px 20px -6px var(--pri)}
  .top h1{font-size:1.25rem;margin:0}.top p{margin:.1rem 0 0;color:var(--mut);font-size:.82rem}
  .pill{margin-left:auto;display:inline-flex;align-items:center;gap:.45rem;padding:.4rem .75rem;border-radius:999px;
    font-size:.8rem;font-weight:600;border:1px solid var(--bd2);background:var(--card)}
  .dot{width:8px;height:8px;border-radius:50%;background:var(--mut)}
  .dot.on{background:var(--ok);box-shadow:0 0 0 3px #22c55e22}.dot.off{background:var(--warn)}
  .card{background:linear-gradient(180deg,var(--card),var(--card2));border:1px solid var(--bd);
    border-radius:16px;padding:1.2rem;margin-bottom:1.1rem;box-shadow:0 8px 30px -18px #000}
  .card h2{font-size:.95rem;margin:0 0 1rem;display:flex;align-items:center;gap:.5rem;letter-spacing:.2px}
  .card h2 .ic{font-size:1.05rem}
  .field{display:grid;gap:.35rem;margin-bottom:1rem}.field:last-child{margin-bottom:0}
  .field-head{display:flex;align-items:center;justify-content:space-between;gap:.5rem}
  label{font-weight:600;font-size:.82rem;color:var(--txt)}
  .sub{font-weight:400;color:var(--mut);font-size:.74rem}
  input[type=text],input[type=password],select{width:100%;padding:.6rem .7rem;border:1px solid var(--bd2);
    border-radius:10px;font-size:.9rem;background:#0e1018;color:var(--txt);transition:border .15s,box-shadow .15s}
  input:focus,select:focus{outline:none;border-color:var(--pri);box-shadow:0 0 0 3px #7c5cff33}
  .chip{font-size:.68rem;font-weight:700;padding:.18rem .5rem;border-radius:999px;text-transform:uppercase;letter-spacing:.3px}
  .chip-ok{background:var(--okbg);color:#4ade80}.chip-off{background:var(--warnbg);color:#fbbf24}
  .switch{display:flex;align-items:center;gap:.6rem;font-size:.84rem;font-weight:500;cursor:pointer}
  .switch input{display:none}
  .track{width:40px;height:23px;border-radius:999px;background:var(--bd2);position:relative;transition:background .15s;flex:none}
  .track::after{content:'';position:absolute;top:2px;left:2px;width:19px;height:19px;border-radius:50%;background:#fff;transition:transform .15s}
  .switch input:checked+.track{background:var(--pri)}.switch input:checked+.track::after{transform:translateX(17px)}
  .btn{border:0;padding:.62rem 1.1rem;border-radius:10px;font-size:.86rem;font-weight:600;cursor:pointer;transition:filter .15s,transform .05s}
  .btn:active{transform:translateY(1px)}.btn:disabled{opacity:.5;cursor:not-allowed}
  .btn-pri{background:linear-gradient(135deg,var(--pri),#5a43d6);color:#fff;box-shadow:0 6px 18px -8px var(--pri)}
  .btn-pri:hover{filter:brightness(1.08)}
  .btn-sec{background:#222634;color:var(--txt);border:1px solid var(--bd2)}.btn-sec:hover{background:#2a2f3f}
  .btns{display:flex;flex-wrap:wrap;gap:.5rem}
  code{background:#0e1018;border:1px solid var(--bd);padding:.15rem .4rem;border-radius:6px;font-size:.76rem;word-break:break-all;color:var(--pri2)}
  .conn{display:flex;align-items:center;gap:.7rem;padding:.7rem .85rem;border-radius:12px;background:#0e1018;border:1px solid var(--bd2);margin-bottom:1rem}
  .conn .lbl{font-weight:600;font-size:.88rem}.conn .ph{color:var(--mut);font-size:.8rem;margin-left:auto}
  #qrbox{display:grid;place-items:center;margin-bottom:1rem}
  #qrbox img{width:230px;height:230px;border-radius:14px;background:#fff;padding:10px;box-shadow:0 10px 30px -12px #000}
  #qrbox .qrhint{color:var(--mut);font-size:.78rem;margin-top:.5rem;text-align:center}
  .savebar{position:fixed;left:0;right:0;bottom:0;background:#0e1018cc;backdrop-filter:blur(8px);
    border-top:1px solid var(--bd);padding:.8rem 1.1rem;display:flex;align-items:center;gap:1rem;justify-content:center}
  .savebar .exp{color:var(--mut);font-size:.72rem;margin-right:auto;max-width:60%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .toast{position:fixed;top:1rem;left:50%;transform:translateX(-50%);background:var(--okbg);color:#86efac;
    border:1px solid #22c55e44;padding:.6rem 1rem;border-radius:10px;font-size:.84rem;font-weight:600;z-index:9;box-shadow:0 10px 30px -10px #000}
  .msg{padding:.55rem .75rem;border-radius:9px;font-size:.82rem;font-weight:500;margin-top:.6rem}
  .msg.ok{background:var(--okbg);color:#86efac}.msg.warn{background:var(--warnbg);color:#fcd34d}.msg.err{background:var(--errbg);color:#fda4af}
  .tabs{display:flex;gap:.35rem;margin-bottom:1.1rem;background:var(--card);border:1px solid var(--bd);border-radius:12px;padding:.3rem}
  .tab{flex:1;display:flex;align-items:center;justify-content:center;gap:.4rem;padding:.55rem .6rem;border-radius:9px;
    font-size:.84rem;font-weight:600;color:var(--mut);background:transparent;border:0;cursor:pointer;transition:background .15s,color .15s}
  .tab:hover{color:var(--txt)}
  .tab.active{background:linear-gradient(135deg,var(--pri),#5a43d6);color:#fff;box-shadow:0 6px 16px -8px var(--pri)}
  .tab .badge{width:7px;height:7px;border-radius:50%;background:var(--warn)}.tab .badge.on{background:var(--ok)}
  .tabpanel{display:none}.tabpanel.active{display:block}
</style></head><body>
<div class="wrap">
  <header class="top">
    <div class="logo">💡</div>
    <div><h1>idea-analyzer</h1><p>Integrações</p></div>
    <span class="pill"><span id="pillDot" class="dot"></span><span id="pillTxt">…</span></span>
  </header>

  ${toast ? `<div class="toast" id="toast">${esc(toast)}</div>` : ''}

  <div class="status-banner card" style="${ok ? 'border-color:#22c55e44' : 'border-color:#f59e0b44'}">
    <h2 style="margin:0"><span class="ic">${ok ? '✅' : '⚠️'}</span>${ok ? 'Tudo configurado — o bot está pronto.' : 'Faltam chaves — preencha abaixo para ativar.'}</h2>
  </div>

  <div class="tabs" role="tablist">
    <button type="button" class="tab active" data-tab="ia">🤖 IA</button>
    <button type="button" class="tab" data-tab="wa">💬 WhatsApp</button>
    <button type="button" class="tab" data-tab="conn"><span id="tabConnBadge" class="badge"></span> Conexão</button>
  </div>

  <form method="post" action="/admin" id="form">
    <div class="card tabpanel active" data-panel="ia">
      <h2><span class="ic">🤖</span> Inteligência Artificial</h2>
      <div class="field">
        <label for="llmProvider">Provedor</label>
        <select id="llmProvider" name="llmProvider"><option value="openai" ${s.llmProvider === 'openai' ? 'selected' : ''}>OpenAI</option></select>
      </div>
      <div class="field">
        <div class="field-head"><label for="openaiModel">Modelo</label><span class="sub">escolha um ou digite outro</span></div>
        <input id="openaiModel" type="text" name="openaiModel" value="${esc(s.openaiModel)}" list="modelOptions" placeholder="gpt-4o" autocomplete="off">
        <datalist id="modelOptions">
          <option value="gpt-5">gpt-5 — mais novo e capaz</option>
          <option value="gpt-5-mini">gpt-5-mini — novo, rápido/barato</option>
          <option value="gpt-4.1">gpt-4.1 — forte, suporta busca web</option>
          <option value="gpt-4.1-mini">gpt-4.1-mini — barato, suporta busca web</option>
          <option value="gpt-4o">gpt-4o — equilibrado (padrão)</option>
          <option value="gpt-4o-mini">gpt-4o-mini — mais barato</option>
          <option value="o4-mini">o4-mini — reasoning barato</option>
          <option value="o3">o3 — reasoning forte</option>
        </datalist>
        <span class="sub">⚠️ modelos de reasoning (o3/o4-mini/gpt-5) podem não suportar busca web — se a análise falhar, use gpt-4.1/gpt-4o ou desligue a busca.</span>
      </div>
      ${secretRow('OpenAI API Key', 'openaiApiKey', Boolean(s.openaiApiKey))}
      <label class="switch"><input type="checkbox" name="openaiWebSearch" ${s.openaiWebSearch ? 'checked' : ''}><span class="track"></span> Busca web real (concorrentes / mercado atual)</label>
    </div>

    <div class="card tabpanel" data-panel="wa">
      <h2><span class="ic">💬</span> WhatsApp (AvisaAPI)</h2>
      <div class="field">
        <label for="avisaBaseUrl">Base URL</label>
        <input id="avisaBaseUrl" type="text" name="avisaBaseUrl" value="${esc(s.avisaBaseUrl)}" placeholder="https://www.avisaapi.com.br/api">
      </div>
      ${secretRow('AvisaAPI API Key', 'avisaApiKey', Boolean(s.avisaApiKey))}
      <div class="field">
        <div class="field-head"><label for="publicBaseUrl">Public Base URL</label><span class="sub">deste serviço — usado no webhook</span></div>
        <input id="publicBaseUrl" type="text" name="publicBaseUrl" value="${esc(s.publicBaseUrl || publicBase(s))}" placeholder="https://ideias.berrysystem.com.br">
      </div>
      <div class="field">
        <div class="field-head"><label for="groupAllowlist">Grupos permitidos (JIDs)</label><span class="sub">vazio = qualquer grupo</span></div>
        <input id="groupAllowlist" type="text" name="groupAllowlist" value="${esc(s.groupAllowlist.join(', '))}" placeholder="120363...@g.us">
      </div>
      <label class="switch"><input type="checkbox" name="allowDirect" ${s.allowDirect ? 'checked' : ''}><span class="track"></span> Responder também em DMs</label>
      <label class="switch"><input type="checkbox" name="allowFromMe" ${s.allowFromMe ? 'checked' : ''}><span class="track"></span> Analisar minhas próprias mensagens <span class="sub">(ligue se o bot usa seu número pessoal)</span></label>
    </div>

    <div class="card tabpanel" data-panel="conn">
      <h2><span class="ic">📱</span> Conexão do número</h2>
      <div class="conn">
        <span id="connDot" class="dot"></span>
        <span id="connLbl" class="lbl">Verificando…</span>
        <span id="connPh" class="ph"></span>
      </div>
      <div id="qrbox"></div>
      <div class="btns">
        <button type="button" class="btn btn-pri" id="btnConnect">Conectar / Gerar QR</button>
        <button type="button" class="btn btn-sec" id="btnRefresh">Atualizar status</button>
        <button type="button" class="btn btn-sec" id="btnWebhook">Registrar webhook</button>
        <button type="button" class="btn btn-sec" id="btnGroups">Listar grupos</button>
      </div>
      <div class="field" style="margin-top:1rem">
        <div class="field-head"><label for="groupSelect">Grupos do número</label><span class="sub">selecione p/ travar o allowlist</span></div>
        <select id="groupSelect"><option value="">— conecte e clique em Listar grupos —</option></select>
      </div>
      <div id="connMsg"></div>
    </div>
  </form>
</div>

<div class="savebar">
  <span class="exp">Webhook: <code>${esc(expected)}</code></span>
  <button type="submit" form="form" class="btn btn-pri">Salvar alterações</button>
</div>

<script>
const $ = (id) => document.getElementById(id);
async function jget(u){ const r = await fetch(u); return r.json(); }
async function jpost(u){ const r = await fetch(u,{method:'POST'}); return r.json(); }
function setMsg(kind,text){ $('connMsg').innerHTML = text ? '<div class="msg '+kind+'">'+text+'</div>' : ''; }

// Tabs
document.querySelectorAll('.tab').forEach((t)=>{
  t.onclick=()=>{
    const id=t.dataset.tab;
    document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x===t));
    document.querySelectorAll('.tabpanel').forEach(p=>p.classList.toggle('active',p.dataset.panel===id));
    location.hash=id;
  };
});
if(location.hash){ const t=document.querySelector('.tab[data-tab="'+location.hash.slice(1)+'"]'); if(t) t.click(); }

function paintStatus(c){
  const on = !!c.loggedIn;
  $('pillDot').className = 'dot ' + (on?'on':'off');
  $('pillTxt').textContent = on ? 'Conectado' : 'Desconectado';
  $('connDot').className = 'dot ' + (on?'on':'off');
  $('connLbl').textContent = on ? 'Conectado' : 'Desconectado — gere o QR e escaneie';
  $('connPh').textContent = on && c.phone ? '+'+c.phone : '';
  const b=$('tabConnBadge'); if(b) b.className='badge'+(on?' on':'');
  if (on) $('qrbox').innerHTML='';
  return on;
}
async function refreshStatus(){ const d = await jget('/admin/api/status'); return paintStatus(d.connection||{}); }

let polling=null;
async function connect(){
  setMsg('', '');
  $('qrbox').innerHTML='<div class="qrhint">gerando QR…</div>';
  const d = await jget('/admin/api/qr');
  if (d.status==='already_connected'){ await refreshStatus(); return; }
  if (d.status!=='qr_ready'){ $('qrbox').innerHTML=''; setMsg('err', d.message||'erro ao gerar QR'); return; }
  $('qrbox').innerHTML='<img src="'+d.qrCode+'" alt="QR"><div class="qrhint">Abra o WhatsApp › Aparelhos conectados › Conectar aparelho</div>';
  if (polling) clearInterval(polling);
  polling = setInterval(async()=>{ const on=await refreshStatus(); if(on){ clearInterval(polling); polling=null; await jpost('/admin/api/webhook'); await loadGroups(); setMsg('ok','Conectado! Webhook registrado e grupos carregados.'); } }, 3000);
}
async function loadGroups(){
  const gs = await jget('/admin/api/groups');
  const sel = $('groupSelect');
  if (!gs.length){ sel.innerHTML='<option value="">— nenhum grupo (o número está em algum grupo?)</option>'; return; }
  sel.innerHTML = '<option value="">— escolher grupo —</option>' + gs.map(g=>'<option value="'+g.jid+'">'+(g.name||g.jid)+'</option>').join('');
}
$('btnConnect').onclick=connect;
$('btnRefresh').onclick=refreshStatus;
$('btnGroups').onclick=async()=>{ setMsg('',''); await loadGroups(); };
$('btnWebhook').onclick=async()=>{ const d=await jpost('/admin/api/webhook'); setMsg(d.ok?'ok':'err', d.ok?('Webhook registrado: '+d.url):('Falhou: '+(d.error||''))); };
$('groupSelect').onchange=(e)=>{ if(e.target.value){ $('groupAllowlist').value = e.target.value; setMsg('ok','Allowlist travado neste grupo. Clique em Salvar.'); } };

(async()=>{ const on = await refreshStatus(); if(on) loadGroups(); })();
const t=$('toast'); if(t) setTimeout(()=>{ t.style.transition='opacity .4s'; t.style.opacity='0'; }, 3000);
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
    allowFromMe: b.allowFromMe === 'on',
  };
  if (b.openaiApiKey && b.openaiApiKey.trim()) patch.openaiApiKey = b.openaiApiKey.trim();
  if (b.avisaApiKey && b.avisaApiKey.trim()) patch.avisaApiKey = b.avisaApiKey.trim();
  const next = saveSettings(patch);

  // Auto-register the webhook in AvisaAPI when we have what we need.
  let hook = '';
  if (next.avisaApiKey && next.avisaBaseUrl && publicBase(next)) {
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
