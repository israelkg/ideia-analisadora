import { randomUUID } from 'node:crypto';

/**
 * AvisaAPI (unofficial WhatsApp HTTP gateway) — ported from Berry Money/Ops.
 * Outbound: sendText. Inbound: parseWebhook normalizes the double-wrapped,
 * mixed-case payload and drops noise (status broadcasts, protocol messages).
 */

export interface AvisaConfig {
  baseUrl: string;
  apiKey: string;
}

export interface NormalizedInbound {
  providerMessageId: string;
  contactPhone: string;
  contactDisplayName?: string;
  chatJid: string;
  isGroup: boolean;
  isFromMe: boolean;
  text: string;
  raw: unknown;
  timestamp: Date;
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

function normaliseRecipient(to: string): string {
  if (!to) return to;
  if (to.includes('@')) return to;
  if (/^\d+$/.test(to) && to.length > 13) return `${to}@g.us`;
  return to;
}

export async function sendText(config: AvisaConfig, to: string, message: string): Promise<void> {
  const res = await fetch(joinUrl(config.baseUrl, '/actions/sendMessage'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({ number: normaliseRecipient(to), message }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`AvisaAPI sendMessage HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
}

export async function setWebhook(config: AvisaConfig, webhookUrl: string): Promise<void> {
  const res = await fetch(joinUrl(config.baseUrl, '/webhook'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({ webhook: webhookUrl }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`AvisaAPI setWebhook HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
}

export interface QrResult {
  status: 'qr_ready' | 'already_connected' | 'error';
  qrCode: string | null;
  message?: string;
}

/** Fetch a pairing QR (also puts the instance into pairing mode). */
export async function getQrCode(config: AvisaConfig): Promise<QrResult> {
  try {
    const res = await fetch(joinUrl(config.baseUrl, '/instance/qr'), {
      headers: { Authorization: `Bearer ${config.apiKey}` },
    });
    const text = await res.text();
    let data: Record<string, unknown> = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
    if (!res.ok) return { status: 'error', qrCode: null, message: `HTTP ${res.status}: ${text.slice(0, 200)}` };
    const inner = (data.data as Record<string, unknown>) ?? data;
    const raw = (inner.qrcode ?? inner.qr ?? inner.image ?? data.qrcode ?? data.qr) as string | undefined;
    if (!raw) {
      const loggedIn = Boolean(inner.loggedIn ?? inner.connected ?? data.loggedIn);
      return loggedIn
        ? { status: 'already_connected', qrCode: null }
        : { status: 'error', qrCode: null, message: 'QR não retornado pela AvisaAPI' };
    }
    return { status: 'qr_ready', qrCode: raw.startsWith('data:') ? raw : `data:image/png;base64,${raw}` };
  } catch (err) {
    return { status: 'error', qrCode: null, message: err instanceof Error ? err.message : String(err) };
  }
}

/** Current instance connection status. */
export async function getInstanceStatus(config: AvisaConfig): Promise<{ loggedIn: boolean; phone?: string }> {
  try {
    const res = await fetch(joinUrl(config.baseUrl, '/instance/status'), {
      headers: { Authorization: `Bearer ${config.apiKey}` },
    });
    if (!res.ok) return { loggedIn: false };
    const data = JSON.parse(await res.text()) as Record<string, unknown>;
    const inner =
      ((data.data as Record<string, unknown>)?.data as Record<string, unknown>) ??
      (data.data as Record<string, unknown>) ??
      data;
    return {
      loggedIn: Boolean(inner.LoggedIn ?? inner.loggedIn ?? inner.Connected ?? inner.connected),
      phone: typeof inner.Jid === 'string' ? String(inner.Jid).split(':')[0].split('@')[0] : undefined,
    };
  } catch {
    return { loggedIn: false };
  }
}

export interface AvisaGroup {
  jid: string;
  name: string;
}

/** List groups the connected number belongs to (for picking the allowlist JID). */
export async function listGroups(config: AvisaConfig): Promise<AvisaGroup[]> {
  try {
    const res = await fetch(joinUrl(config.baseUrl, '/group/list'), {
      headers: { Authorization: `Bearer ${config.apiKey}` },
    });
    if (!res.ok) return [];
    // AvisaAPI nests deep + varies: data.data.data.Groups | data.data.Groups |
    // data.Groups | data.groups | data (array). Dig for the first array we find.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = JSON.parse(await res.text()) as any;
    const raw =
      d?.data?.data?.Groups ??
      d?.data?.Groups ??
      d?.Groups ??
      d?.data?.groups ??
      d?.groups ??
      (Array.isArray(d?.data) ? d.data : Array.isArray(d) ? d : []);
    const arr = Array.isArray(raw) ? raw : [];
    return arr
      .map((g) => {
        const o = g as Record<string, unknown>;
        const jid = (o.JID ?? o.jid ?? o.id ?? o.Id) as string | undefined;
        const name = (o.Name ?? o.name ?? o.Subject ?? o.subject) as string | undefined;
        return jid ? { jid: String(jid), name: String(name ?? jid) } : null;
      })
      .filter((g): g is AvisaGroup => g !== null);
  } catch {
    return [];
  }
}

/** Read the webhook URL currently registered in AvisaAPI (null if none/unreachable). */
export async function getWebhook(config: AvisaConfig): Promise<string | null> {
  try {
    const res = await fetch(joinUrl(config.baseUrl, '/webhook'), {
      headers: { Authorization: `Bearer ${config.apiKey}` },
    });
    if (!res.ok) return null;
    const data = JSON.parse(await res.text()) as Record<string, unknown>;
    const inner = (data.data as Record<string, unknown>) ?? data;
    return (inner.webhook ?? inner.url ?? data.webhook ?? null) as string | null;
  } catch {
    return null;
  }
}

function extractObj(parent: unknown, ...keys: string[]): Record<string, unknown> {
  if (!parent || typeof parent !== 'object') return {};
  for (const k of keys) {
    const v = (parent as Record<string, unknown>)[k];
    if (v && typeof v === 'object') return v as Record<string, unknown>;
  }
  return {};
}

function pickString(parent: unknown, ...keys: string[]): string | undefined {
  if (!parent || typeof parent !== 'object') return undefined;
  for (const k of keys) {
    const v = (parent as Record<string, unknown>)[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return undefined;
}

function hasProtocolMessage(message: Record<string, unknown>): boolean {
  const raw = (message.RawMessage ?? message.rawMessage ?? {}) as Record<string, unknown>;
  return Boolean(message.protocolMessage ?? message.ProtocolMessage ?? raw.protocolMessage ?? raw.ProtocolMessage);
}

/** Parse the AvisaAPI webhook envelope into a structured event, or null if noise. */
export function parseWebhook(payload: unknown): NormalizedInbound | null {
  if (!payload || typeof payload !== 'object') return null;
  const body = payload as Record<string, unknown>;
  let parsed: Record<string, unknown> = body;
  if (typeof body.jsonData === 'string') {
    try {
      parsed = JSON.parse(body.jsonData) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== 'object') return null;

  const event = (parsed.event ?? parsed) as Record<string, unknown>;
  const info = (event.Info ?? event.info ?? {}) as Record<string, unknown>;
  const message = (event.Message ?? event.message ?? {}) as Record<string, unknown>;

  if (!info.Chat && !info.Sender) return null;
  if (String(info.Chat ?? '').toLowerCase() === 'status@broadcast') return null;
  if (hasProtocolMessage(message)) return null;

  const extractPhone = (jid?: unknown): string => {
    if (!jid || typeof jid !== 'string') return '';
    return jid.split(':')[0].split('@')[0];
  };

  let senderPhone = extractPhone(info.Sender);
  let chatPhone = extractPhone(info.Chat);
  const isFromMe = info.IsFromMe === true;
  const isGroup = info.IsGroup === true;

  const text =
    pickString(message, 'Conversation', 'conversation') ??
    pickString(extractObj(message, 'ExtendedTextMessage', 'extendedTextMessage'), 'Text', 'text') ??
    pickString(extractObj(message, 'ImageMessage', 'imageMessage'), 'Caption', 'caption') ??
    '';

  let canonicalJid: string = (info.Chat as string) ?? '';
  if (canonicalJid.endsWith('@lid') && !isGroup) {
    const altSender = (info.SenderAlt as string) ?? '';
    const altRecipient = (info.RecipientAlt as string) ?? '';
    const alt = isFromMe
      ? altRecipient.includes('@s.whatsapp.net')
        ? altRecipient
        : altSender
      : altSender.includes('@s.whatsapp.net')
        ? altSender
        : altRecipient;
    if (alt.includes('@s.whatsapp.net')) {
      canonicalJid = alt;
    } else {
      const contactPhone = isFromMe ? chatPhone : senderPhone;
      if (contactPhone && contactPhone.length > 5) canonicalJid = `${contactPhone}@s.whatsapp.net`;
    }
  }
  const canonicalPhone = extractPhone(canonicalJid);
  if (!isGroup && canonicalPhone) {
    chatPhone = canonicalPhone;
    if (String(info.Sender ?? '').endsWith('@lid')) senderPhone = canonicalPhone;
  }

  return {
    providerMessageId: (info.ID as string) ?? randomUUID(),
    contactPhone: isGroup ? chatPhone : isFromMe ? chatPhone : senderPhone,
    contactDisplayName: (info.PushName as string) ?? undefined,
    chatJid: canonicalJid,
    isGroup,
    isFromMe,
    text: text || '',
    raw: parsed,
    timestamp: info.Timestamp ? new Date(info.Timestamp as string) : new Date(),
  };
}
