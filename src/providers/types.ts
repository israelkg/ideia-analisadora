export interface AnalyzeInput {
  /** The raw idea text (already stripped of the "ideia:" prefix). */
  idea: string;
  /** WhatsApp display name of whoever sent it, if known. */
  author?: string;
}

export interface AnalyzeResult {
  text: string;
  model: string;
}

/** A pluggable LLM backend for idea analysis. Add more (anthropic, gemini…) later. */
export interface IdeaProvider {
  readonly name: string;
  analyze(input: AnalyzeInput): Promise<AnalyzeResult>;
}
