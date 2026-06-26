import { config } from './config.js';
import { parseWebhook, sendText, type NormalizedInbound } from './avisa.js';
import { OpenAiProvider } from './providers/openai.js';
import type { IdeaProvider } from './providers/types.js';

/** Build the configured provider. Add cases here to support more backends. */
function buildProvider(): IdeaProvider {
  switch (config.llm.provider) {
    case 'openai':
      return new OpenAiProvider(config.llm.openai);
    default:
      throw new Error(`Unsupported LLM_PROVIDER: ${config.llm.provider}`);
  }
}

const provider = buildProvider();

// In-memory dedup — AvisaAPI can redeliver the same event. Bounded ring.
const seen = new Set<string>();
function alreadyHandled(id: string): boolean {
  if (seen.has(id)) return true;
  seen.add(id);
  if (seen.size > 1000) seen.delete(seen.values().next().value as string);
  return false;
}

/** Decide whether an inbound message is an idea we should analyze. */
function shouldAnalyze(evt: NormalizedInbound): boolean {
  if (evt.isFromMe) return false;
  if (!evt.isGroup && !config.allowDirect) return false;
  if (evt.isGroup && config.groupAllowlist.length && !config.groupAllowlist.includes(evt.chatJid)) return false;
  return config.trigger.test(evt.text);
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
  if (!shouldAnalyze(evt)) return 'skip';
  if (alreadyHandled(evt.providerMessageId)) return 'dup';

  const idea = evt.text.replace(config.trigger, '').trim();
  if (idea.length < 8) {
    await sendText(config.avisa, evt.chatJid, 'Manda a ideia logo após "ideia:" que eu analiso 🙂');
    return 'empty-idea';
  }

  const result = await provider.analyze({ idea, author: evt.contactDisplayName });
  await sendText(config.avisa, evt.chatJid, formatReply(evt.contactDisplayName, result.text));
  return `analyzed (${result.model})`;
}

/** Direct analysis for the manual test endpoint — no WhatsApp involved. */
export async function analyzeIdea(idea: string, author?: string): Promise<string> {
  const result = await provider.analyze({ idea, author });
  return result.text;
}
