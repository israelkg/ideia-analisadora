import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { env } from './config.js';
import { encrypt, decrypt } from './crypto.js';

/**
 * User-configurable settings, edited via the /admin Integrações page and stored
 * as JSON on disk (mount a volume at SETTINGS_PATH's dir in prod). Secret fields
 * (API keys) are encrypted at rest with SECRETS_ENCRYPTION_KEY.
 */
export interface Settings {
  llmProvider: string;
  openaiApiKey: string;
  openaiModel: string;
  openaiWebSearch: boolean;
  avisaBaseUrl: string;
  avisaApiKey: string;
  /** Group chat JIDs the bot answers in; empty = any group. */
  groupAllowlist: string[];
  /** Also analyze ideas sent in DMs, not just groups. */
  allowDirect: boolean;
}

const SECRET_FIELDS: Array<keyof Settings> = ['openaiApiKey', 'avisaApiKey'];

const DEFAULTS: Settings = {
  llmProvider: 'openai',
  openaiApiKey: '',
  openaiModel: 'gpt-4o',
  openaiWebSearch: true,
  avisaBaseUrl: 'https://api.avisaapi.com.br',
  avisaApiKey: '',
  groupAllowlist: [],
  allowDirect: false,
};

let cache: Settings | null = null;

function load(): Settings {
  if (!existsSync(env.settingsPath)) return { ...DEFAULTS };
  try {
    const onDisk = JSON.parse(readFileSync(env.settingsPath, 'utf8')) as Record<string, unknown>;
    const merged: Settings = { ...DEFAULTS, ...(onDisk as Partial<Settings>) };
    // Decrypt secret fields back to plaintext for in-memory use.
    for (const f of SECRET_FIELDS) {
      const raw = onDisk[f];
      (merged[f] as string) = typeof raw === 'string' ? decrypt(raw, env.secretsKey) : '';
    }
    return merged;
  } catch {
    return { ...DEFAULTS };
  }
}

export function getSettings(): Settings {
  if (!cache) cache = load();
  return cache;
}

/**
 * Persist a partial update. Secret fields left blank/undefined keep their
 * current value (so the UI never has to re-send a key just to change a model).
 */
export function saveSettings(patch: Partial<Settings>): Settings {
  const current = getSettings();
  const next: Settings = { ...current, ...patch };
  for (const f of SECRET_FIELDS) {
    const incoming = patch[f];
    if (incoming === undefined || incoming === '') (next[f] as string) = current[f] as string;
  }

  // Write with secrets encrypted.
  const onDisk: Record<string, unknown> = { ...next };
  for (const f of SECRET_FIELDS) onDisk[f] = encrypt(next[f] as string, env.secretsKey);

  mkdirSync(dirname(env.settingsPath), { recursive: true });
  writeFileSync(env.settingsPath, JSON.stringify(onDisk, null, 2), { mode: 0o600 });
  cache = next;
  return next;
}

/** True when the bot has the keys it needs to actually run. */
export function isConfigured(s: Settings = getSettings()): boolean {
  return Boolean(s.avisaApiKey && (s.llmProvider !== 'openai' || s.openaiApiKey));
}
