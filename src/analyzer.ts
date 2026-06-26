import { env } from './config.js';
import { getSettings, isConfigured, type Settings } from './settings.js';
import { parseWebhook, sendText, type AvisaConfig, type NormalizedInbound } from './avisa.js';
import { OpenAiProvider } from './providers/openai.js';
import type { IdeaProvider } from './providers/types.js';
import { appendHistory } from './history.js';

/** Build the configured provider from current settings. Add cases for more backends. */
function buildProvider(s: Settings): IdeaProvider {
  switch (s.llmProvider) {
    case 'openai':
      return new OpenAiProvider({ apiKey: s.openaiApiKey, model: s.openaiModel, webSearch: s.openaiWebSearch });
    default:
      throw new Error(`Unsupported LLM provider: ${s.llmProvider}`);
  }
}

function avisaConfig(s: Settings): AvisaConfig {
  return { baseUrl: s.avisaBaseUrl, apiKey: s.avisaApiKey };
}

// In-memory dedup — AvisaAPI can redeliver the same event. Bounded ring.
const seen = new Set<string>();
function alreadyHandled(id: string): boolean {
  if (seen.has(id)) return true;
  seen.add(id);
  if (seen.size > 1000) seen.delete(seen.values().next().value as string);
  return false;
}

/** Returns '' if we should analyze, else a short reason for logging. */
function skipReason(evt: NormalizedInbound, s: Settings): string {
  if (evt.isFromMe && !s.allowFromMe) return 'fromMe';
  if (!evt.isGroup && !s.allowDirect) return 'not-group';
  if (evt.isGroup && s.groupAllowlist.length && !s.groupAllowlist.includes(evt.chatJid)) return `group-not-allowed (${evt.chatJid})`;
  if (!env.trigger.test(evt.text)) return 'no-trigger';
  return '';
}

function formatReply(author: string | undefined, analysis: string): string {
  const greet = author ? `${author}, sobre sua ideia 👇\n\n` : '';
  return `${greet}${analysis}`;
}

/**
 * Process one webhook payload end to end. Returns a short status for logging.
 * Throws are caught by the caller — never let analysis failure crash the server.
 */
export async function handleInbound(payload: unknown): Promise<string> {
  const evt = parseWebhook(payload);
  if (!evt) return 'noise';
  const s = getSettings();
  const reason = skipReason(evt, s);
  if (reason) return `skip: ${reason}`;
  if (!isConfigured(s)) return 'not-configured';
  if (alreadyHandled(evt.providerMessageId)) return 'dup';

  const idea = evt.text.replace(env.trigger, '').trim();
  if (idea.length < 8) {
    await sendText(avisaConfig(s), evt.chatJid, 'Manda a ideia logo após "ideia:" que eu analiso 🙂');
    return 'empty-idea';
  }

  const result = await buildProvider(s).analyze({ idea, author: evt.contactDisplayName });
  await sendText(avisaConfig(s), evt.chatJid, formatReply(evt.contactDisplayName, result.text));
  appendHistory({
    ts: new Date().toISOString(),
    channel: evt.isGroup ? 'group' : 'dm',
    group: evt.isGroup ? evt.chatJid : undefined,
    author: evt.contactDisplayName,
    idea,
    response: result.text,
  });
  return `analyzed (${result.model})`;
}

/** Direct analysis for the manual test endpoint — no WhatsApp involved. */
export async function analyzeIdea(idea: string, author?: string): Promise<string> {
  const s = getSettings();
  const result = await buildProvider(s).analyze({ idea, author });
  appendHistory({ ts: new Date().toISOString(), channel: 'test', author, idea, response: result.text });
  return result.text;
}
