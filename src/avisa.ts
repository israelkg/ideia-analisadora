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
