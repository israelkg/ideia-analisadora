import { SYSTEM_PROMPT, userPrompt } from '../prompt.js';
import type { AnalyzeInput, AnalyzeResult, IdeaProvider } from './types.js';

export interface OpenAiOptions {
  apiKey: string;
  model: string;
  /** Enable the built-in web_search tool for real competitor/market grounding. */
  webSearch: boolean;
}

/**
 * OpenAI provider using the Responses API. When webSearch is on, the model can
 * call the built-in web_search tool to ground the analysis in current sources
 * (no separate search API key needed).
 */
export class OpenAiProvider implements IdeaProvider {
  readonly name = 'openai';

  constructor(private readonly opts: OpenAiOptions) {
    if (!opts.apiKey) throw new Error('OPENAI_API_KEY missing');
  }

  async analyze(input: AnalyzeInput): Promise<AnalyzeResult> {
    const body: Record<string, unknown> = {
      model: this.opts.model,
      instructions: SYSTEM_PROMPT,
      input: userPrompt(input),
      max_output_tokens: 1500,
    };
    if (this.opts.webSearch) body.tools = [{ type: 'web_search_preview' }];

    const res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.opts.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const text = await res.text();
    if (!res.ok) throw new Error(`OpenAI Responses HTTP ${res.status}: ${text.slice(0, 300)}`);

    const data = JSON.parse(text) as OpenAiResponse;
    const out = extractText(data);
    if (!out) throw new Error('OpenAI returned no text output');
    return { text: out, model: data.model ?? this.opts.model };
  }
}

interface OpenAiResponse {
  model?: string;
  output_text?: string;
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
}

/** Responses API: prefer output_text; otherwise concat message text parts. */
function extractText(data: OpenAiResponse): string {
  if (typeof data.output_text === 'string' && data.output_text.trim()) {
    return data.output_text.trim();
  }
  const parts: string[] = [];
  for (const item of data.output ?? []) {
    if (item.type && item.type !== 'message') continue;
    for (const c of item.content ?? []) {
      if (c.type === 'output_text' && typeof c.text === 'string') parts.push(c.text);
    }
  }
  return parts.join('').trim();
}
