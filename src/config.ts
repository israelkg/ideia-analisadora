import 'dotenv/config';

export interface Config {
  port: number;
  webhookToken: string;
  avisa: { baseUrl: string; apiKey: string };
  /** Group chat JIDs the bot answers in; empty = any group. */
  groupAllowlist: string[];
  /** Also analyze ideas sent in DMs, not just groups. */
  allowDirect: boolean;
  /** Matches the "ideia:" trigger prefix (accent/spacing tolerant). */
  trigger: RegExp;
  llm: {
    provider: string;
    openai: { apiKey: string; model: string; webSearch: boolean };
  };
}

function env(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v === undefined || v === '') {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

function bool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return /^(1|true|yes|on)$/i.test(v);
}

export const config: Config = {
  port: Number(env('PORT', '4500')),
  webhookToken: env('WEBHOOK_TOKEN', 'change-me'),
  avisa: {
    baseUrl: env('AVISA_BASE_URL'),
    apiKey: env('AVISA_API_KEY'),
  },
  groupAllowlist: env('GROUP_ALLOWLIST', '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  allowDirect: bool('ALLOW_DIRECT', false),
  // "ideia:", "idéia -", "Ideia :" etc. The captured group is everything after.
  trigger: /^\s*id[eé]ia\s*[:\-–]\s*/i,
  llm: {
    provider: env('LLM_PROVIDER', 'openai'),
    openai: {
      apiKey: env('OPENAI_API_KEY', ''),
      model: env('OPENAI_MODEL', 'gpt-4o'),
      webSearch: bool('OPENAI_WEB_SEARCH', true),
    },
  },
};
