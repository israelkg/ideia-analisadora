import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { env } from './config.js';

/** One analyzed idea + its response, for the /admin Histórico view. */
export interface HistoryEntry {
  ts: string;
  channel: string;
  group?: string;
  author?: string;
  idea: string;
  response: string;
}

const MAX = 500; // keep the last N analyses

export function appendHistory(e: HistoryEntry): void {
  try {
    mkdirSync(dirname(env.historyPath), { recursive: true });
    const cur = existsSync(env.historyPath)
      ? readFileSync(env.historyPath, 'utf8').split('\n').filter(Boolean)
      : [];
    cur.push(JSON.stringify(e));
    writeFileSync(env.historyPath, cur.slice(-MAX).join('\n') + '\n', { mode: 0o600 });
  } catch {
    // history is best-effort — never break analysis on a log failure
  }
}

/** Most recent first. */
export function readHistory(limit = 100): HistoryEntry[] {
  if (!existsSync(env.historyPath)) return [];
  try {
    const lines = readFileSync(env.historyPath, 'utf8').split('\n').filter(Boolean);
    return lines
      .slice(-limit)
      .reverse()
      .map((l) => {
        try {
          return JSON.parse(l) as HistoryEntry;
        } catch {
          return null;
        }
      })
      .filter((x): x is HistoryEntry => x !== null);
  } catch {
    return [];
  }
}
