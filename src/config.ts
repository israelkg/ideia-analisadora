import 'dotenv/config';

/**
 * Infra-level env ONLY. Everything the user configures (LLM/AvisaAPI keys,
 * model, group allowlist…) lives in the encrypted settings store and is edited
 * via the /admin Integrações page — see settings.ts.
 */
export interface Env {
  port: number;
  /** Secret path segment for the webhook URL: /webhook/<token>. */
  webhookToken: string;
  /** Key used to encrypt secret settings at rest. */
  secretsKey: string;
  /** Password for HTTP Basic auth on the /admin page (user: admin). */
  adminPassword: string;
  /** Where the JSON settings store lives (mount a volume here in prod). */
  settingsPath: string;
  /** Matches the "ideia:" trigger prefix (accent/spacing tolerant). */
  trigger: RegExp;
}

function envVar(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v === undefined || v === '') {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

export const env: Env = {
  port: Number(envVar('PORT', '4500')),
  webhookToken: envVar('WEBHOOK_TOKEN', 'change-me'),
  secretsKey: envVar('SECRETS_ENCRYPTION_KEY', 'dev-only-insecure-key-change-me'),
  adminPassword: envVar('ADMIN_PASSWORD', 'admin'),
  settingsPath: envVar('SETTINGS_PATH', './data/settings.json'),
  trigger: /^\s*id[eé]ia\s*[:\-–]\s*/i,
};
